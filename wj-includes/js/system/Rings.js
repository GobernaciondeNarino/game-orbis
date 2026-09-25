/**
 * Rings — anillos planetarios.
 *
 * Los radios interno y externo vienen del catálogo en radios planetarios, con
 * su fuente; no son valores estéticos. La geometría de anillo de Three.js trae
 * unas coordenadas UV que no sirven para una textura radial, así que se
 * reescriben: cada vértice recibe una U proporcional a su distancia al centro.
 *
 * ILUMINACIÓN. Antes era un MeshBasicMaterial: sin luz, igual de brillante de
 * día que de noche y sin la sombra del planeta, que es de lo primero que se ve
 * en cualquier foto de Saturno. Ahora los ilumina el Sol, que está en el
 * origen de la escena, con la física de un anillo, que no es la de una lámina:
 *
 *   · Un anillo es una nube de partículas de hielo, no una superficie. Se
 *     ilumina con el modelo de dispersión simple de una capa de espesor
 *     óptico τ (Chandrasekhar, Radiative Transfer, 1960), la primera
 *     aproximación clásica para anillos planetarios:
 *
 *         cara iluminada:  I ∝ μ0/(μ0+μ) · [1 − e^(−τ/μ0 − τ/μ)]
 *         cara de sombra:  I ∝ μ0/(μ−μ0) · [e^(−τ/μ) − e^(−τ/μ0)]
 *
 *     con μ0 y μ los cosenos del Sol y de la visual respecto a la normal. El
 *     espesor óptico sale de la opacidad de la textura. Lo que predice es lo
 *     que se ve: cuando el Sol les da muy de canto los anillos densos se
 *     apagan, y los tenues mucho menos; y por la cara no iluminada las zonas
 *     densas (el anillo B) se ven oscuras mientras las tenues (el C, la
 *     división de Cassini) brillan, como en las fotos de la Cassini.
 *   · La luz del propio planeta: su cara de día ilumina los anillos, con el
 *     albedo geométrico del catálogo. Cuenta sobre todo cuando el Sol está
 *     cerca del plano de los anillos, que es cuando más se nota en las fotos.
 *   · Retrodispersión: con el Sol a la espalda del observador, el anillo
 *     brilla más —el efecto de oposición—. Y dispersión hacia delante: a
 *     contraluz, las zonas tenues y polvorientas se encienden. Las dos,
 *     suaves.
 *   · La sombra del planeta: para cada punto del anillo se lanza un rayo hacia
 *     el Sol y, si atraviesa la esfera del planeta, ese punto está a la sombra.
 */

import * as THREE from 'three';

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec2 vUv;
  varying vec3 vPosicionMundo;
  varying vec3 vCentro;
  varying vec3 vNormal;
  varying float vEscala;

  void main() {
    vUv = uv;
    vec4 mundo = modelMatrix * vec4(position, 1.0);
    vPosicionMundo = mundo.xyz;
    // El anillo está centrado en su planeta: su origen ES el centro.
    vCentro = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    // RingGeometry nace en el plano XY: su normal es +Z local.
    vNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    vEscala = length(modelMatrix[0].xyz);
    gl_Position = projectionMatrix * viewMatrix * mundo;
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform sampler2D mapa;
  uniform sampler2D alphaMap;
  uniform float tieneMapa;
  uniform vec3 color;
  uniform float opacidad;
  uniform float radioPlaneta;    // en unidades locales del anillo
  uniform vec3 colorLuz;
  uniform float intensidadLuz;
  uniform float albedoPlaneta;

  varying vec2 vUv;
  varying vec3 vPosicionMundo;
  varying vec3 vCentro;
  varying vec3 vNormal;
  varying float vEscala;

  void main() {
    #include <logdepthbuf_fragment>

    // --- Color y opacidad, como los daba el MeshBasicMaterial ----------------
    // La tira de la textura aporta el color y, como alphaMap, su canal verde
    // multiplica la opacidad (además de su propio alfa). Sin textura, bandas
    // de color plano: SIMULACIÓN.
    vec3 albedo = color;
    float alfa = opacidad;
    if (tieneMapa > 0.5) {
      vec4 texel = texture2D(mapa, vUv);
      albedo *= texel.rgb;
      alfa *= texel.a * texture2D(alphaMap, vUv).g;
    }
    if (alfa < 0.003) discard;

    // --- Geometría de la luz -------------------------------------------------
    vec3 haciaSol = normalize(-vPosicionMundo);
    vec3 haciaCamara = normalize(cameraPosition - vPosicionMundo);
    float cosSol = dot(vNormal, haciaSol);
    float cosVista = dot(vNormal, haciaCamara);
    float mu0 = abs(cosSol);
    float mu = abs(cosVista);

    // Espesor óptico normal, a partir de la opacidad: alfa = 1 − e^(−τ).
    float tau = -log(max(1.0 - min(alfa, 0.985), 1e-3));
    float m0 = max(mu0, 1e-3);
    float m = max(mu, 1e-3);

    // ¿Vemos la cara iluminada o la de sombra?
    bool caraIluminada = cosSol * cosVista > 0.0;
    float difusa;
    if (caraIluminada) {
      difusa = m0 / (m0 + m) * (1.0 - exp(-tau / m0 - tau / m));
    } else {
      // Cuando μ ≈ μ0 el cociente es 0/0; su límite es τ·e^(−τ/μ)/μ.
      float d = m - m0;
      difusa = abs(d) < 1e-3
        ? m0 * tau * exp(-tau / m) / (m * m)
        : m0 / d * (exp(-tau / m) - exp(-tau / m0));
    }
    // En las vistas muy rasantes el modelo de capa plana se dispara (1/μ): se
    // acota a lo que da una vista de frente.
    difusa = min(difusa, 0.75);

    // Ángulo de fase: 0 con el Sol detrás del observador, π a contraluz.
    float cosFase = dot(haciaSol, haciaCamara);
    float fase = acos(clamp(cosFase, -1.0, 1.0));
    float oposicion = 1.0 + 0.35 * exp(-fase / 0.12);
    float adelante = pow(max(-cosFase, 0.0), 6.0) * (1.0 - alfa) * 0.9;

    // --- Sombra del planeta ---------------------------------------------------
    // Rayo desde este punto del anillo hacia el Sol: ¿pasa por la esfera?
    // b es cuánto avanza el rayo hasta el punto más cercano al centro; si es
    // negativo, el planeta queda del lado contrario al Sol y no tapa nada.
    vec3 aCentro = vCentro - vPosicionMundo;
    float b = dot(aCentro, haciaSol);
    float radio = radioPlaneta * vEscala;
    float separacion = sqrt(max(dot(aCentro, aCentro) - b * b, 0.0));
    // Borde con una penumbra breve: el Sol no es un punto.
    float sombra = b > 0.0 ? smoothstep(radio * 0.985, radio * 1.015, separacion) : 1.0;

    // Luz del planeta: su disco visto desde este punto del anillo, más lleno
    // cuanto más del lado del Sol esté el punto, y más grande cuanto más
    // cerca. Albedo geométrico del catálogo.
    vec3 desdePlaneta = -aCentro;
    float distancia = length(desdePlaneta);
    float lleno = 0.5 + 0.5 * dot(desdePlaneta / max(distancia, 1e-6), normalize(-vCentro));
    float tamanoPlaneta = (radio / max(distancia, radio)) * (radio / max(distancia, radio));
    float planeta = albedoPlaneta * lleno * tamanoPlaneta * 0.5 * (1.0 - exp(-tau / m));

    vec3 luz = colorLuz * intensidadLuz;
    vec3 resultado = albedo * luz * ((difusa * oposicion + adelante) * sombra + planeta);
    // Se entrega premultiplicado por la opacidad —la capa ya cuenta cuánto
    // cubre en el término 1 − e^(−τ…)—: se divide aquí para que la mezcla
    // normal no lo multiplique otra vez.
    resultado /= max(alfa, 0.05);
    // Un mínimo de luz ambiente, del orden de la que reciben los planetas,
    // para que la cara de sombra no sea un recorte negro contra el cielo.
    resultado += albedo * 0.012;

    gl_FragColor = vec4(resultado, alfa);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Rings {
  /**
   * @param {object} config    datos.render.anillos del catálogo
   * @param {number} radioBase radio del planeta en unidades de escena
   * @param {number|null} albedoPlaneta albedo geométrico del planeta (catálogo)
   */
  constructor(config, radioBase, gestor, albedoPlaneta = null) {
    this.gestor = gestor;

    const interno = radioBase * (config.radioInternoRadios ?? 1.3);
    const externo = radioBase * (config.radioExternoRadios ?? 2.2);
    this.interno = interno;
    this.externo = externo;

    const geometria = gestor.registrar(new THREE.RingGeometry(interno, externo, 160, 4));
    this._reasignarUV(geometria, interno, externo);

    // La textura de anillos es una tira de 1024×63: no hay versión reducida
    // que merezca la pena, pesa 7 kB. Sin mapa fotográfico: bandas de color
    // planas, y la interfaz lo declara como SIMULACIÓN para no hacerlas pasar
    // por una imagen real.
    const tieneMapa = Boolean(config.textura);
    const mapa = tieneMapa ? gestor.cargarTextura(config.textura) : null;

    this.material = gestor.registrar(
      new THREE.ShaderMaterial({
        uniforms: {
          mapa: { value: mapa },
          alphaMap: { value: mapa },
          tieneMapa: { value: tieneMapa ? 1 : 0 },
          color: { value: new THREE.Color(tieneMapa ? '#ffffff' : (config.color ?? '#9fb6c4')) },
          opacidad: { value: tieneMapa ? 0.92 : 0.35 },
          radioPlaneta: { value: radioBase },
          // La misma luz que ilumina los planetas (el PointLight del Sol, sin
          // atenuación): color y la intensidad que da su término difuso,
          // 1,9 / π, con un empuje porque las partículas son hielo muy claro y
          // la tira de color de la textura no es un albedo.
          colorLuz: { value: new THREE.Color(0xfff3d6) },
          // Calibrada para que, con el Sol y la visual a 30° del plano y un
          // espesor óptico de 1, el anillo brille lo que la cara de día del
          // planeta: así se veían en la versión sin luz, y así se ven en las
          // fotos. La tira de color de la textura no es un albedo.
          intensidadLuz: { value: (1.9 / Math.PI) * 2.1 },
          albedoPlaneta: { value: albedoPlaneta ?? 0.3 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      }),
    );

    this.malla = new THREE.Mesh(geometria, this.material);
    this.malla.rotation.x = Math.PI / 2;   // El anillo nace en el plano XY; el ecuador está en XZ.
    this.malla.renderOrder = 1;
    this.esSimulacion = !config.textura;
    /** La textura de la tira, para quien quiera proyectar la sombra del anillo. */
    this.mapa = mapa;
  }

  /**
   * RingGeometry reparte las UV como si fuera un plano. Para una textura de
   * anillo —una tira que va del borde interior al exterior— hace falta que U
   * sea la distancia normalizada al centro.
   */
  _reasignarUV(geometria, interno, externo) {
    const posicion = geometria.attributes.position;
    const uv = geometria.attributes.uv;
    const v = new THREE.Vector3();

    for (let i = 0; i < posicion.count; i++) {
      v.fromBufferAttribute(posicion, i);
      const distancia = v.length();
      uv.setXY(i, (distancia - interno) / (externo - interno), 0.5);
    }
    uv.needsUpdate = true;
  }

  get objeto() {
    return this.malla;
  }

  destruir() {
    this.malla.geometry.dispose();
    // Mapa y alphaMap son la misma textura: se libera una vez.
    this.mapa?.dispose();
    this.material.dispose();
    this.malla.removeFromParent();
  }
}
