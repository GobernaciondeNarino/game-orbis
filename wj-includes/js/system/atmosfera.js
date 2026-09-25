/**
 * Atmósferas — el halo del limbo de los cuerpos que tienen aire.
 *
 * QUÉ CUERPOS. Los que traen un objeto `atmosfera` en el catálogo y tienen una
 * entrada en APARIENCIA_ATMOSFERICA. Lo primero es el dato; lo segundo, cómo se
 * ve, y va justificado cuerpo a cuerpo. Si un día el catálogo añade una
 * atmósfera sin decir aquí cómo se ve, no se dibuja nada: mejor sin halo que
 * con uno de color inventado.
 *
 * CÓMO. Una esfera algo mayor que el cuerpo, dibujada por DENTRO (BackSide) y
 * sumando luz. Lo que se ve de ella es solo el anillo que sobresale del disco
 * —el resto lo tapa el propio cuerpo—, y su brillo no depende del ángulo de
 * una normal sino de cuánto aire atraviesa la visual: para cada píxel se
 * calcula a qué altura sobre el limbo pasa el rayo de la cámara (el parámetro
 * de impacto) y la densidad cae exponencialmente con esa altura, como cae la de
 * una atmósfera real. Llega a cero antes del borde de la esfera, así que la
 * esfera no tiene silueta que delatar.
 *
 * Y solo brilla del lado del Sol, que está en el origen de la escena: un halo
 * que rodea también la cara nocturna no es una atmósfera, es un contorno. Del
 * lado nocturno queda únicamente lo que la dispersión hacia delante enciende
 * cuando se mira hacia el Sol a través del limbo, que es el anillo luminoso de
 * las fotos a contraluz de Titán o de la Tierra.
 *
 * El GROSOR está exagerado, como en cualquier ilustración: a escala, el aire
 * de la Tierra sería más fino que la línea con la que se dibuja la órbita. Lo
 * que se respeta es el orden entre cuerpos.
 */

import * as THREE from 'three';

/**
 * Cómo se ve cada atmósfera: color del halo, grosor en fracción del radio e
 * intensidad. SIMULACIÓN en la forma, no en la presencia: qué cuerpos tienen
 * atmósfera lo dice el catálogo.
 */
export const APARIENCIA_ATMOSFERICA = Object.freeze({
  // Exosfera, no atmósfera: sus átomos casi nunca chocan entre sí (lo dice la
  // nota del propio catálogo). No dispersan luz visible en cantidad que se
  // aprecie —el sodio solo se ve con filtros espectrales—, así que dibujarle
  // un halo sería inventárselo.
  mercurio: null,

  // Noventa y dos veces la presión terrestre y una capa continua de nubes de
  // ácido sulfúrico con bruma por encima: el halo más espeso de los planetas
  // rocosos, blanco amarillento como las cimas de sus nubes.
  venus: { color: '#f2dfb4', espesor: 0.05, intensidad: 1.0 },

  // El azul de la dispersión de Rayleigh. Es el halo que la Tierra ya tenía,
  // con su color y su grosor; ahora sale del mismo sitio que el de los demás.
  tierra: { color: '#4a90e2', espesor: 0.035, intensidad: 0.9 },

  // Menos del 1 % de la presión terrestre (nota del catálogo), cargada de
  // polvo fino: un velo delgado y tenue, color caramelo.
  marte: { color: '#d9a879', espesor: 0.03, intensidad: 0.45 },

  // Hidrógeno por encima de las nubes: dispersión de Rayleigh, un azul muy
  // pálido. Fino en proporción a un radio once veces el terrestre.
  jupiter: { color: '#cbd8ec', espesor: 0.02, intensidad: 0.35 },

  // Sobre las nubes de amoníaco, una bruma fotoquímica que tiñe de ocre pálido
  // el limbo. Tan fina en proporción como la de Júpiter.
  saturno: { color: '#eadcb6', espesor: 0.02, intensidad: 0.35 },

  // El metano absorbe el rojo y devuelve el azul verdoso (nota del catálogo).
  urano: { color: '#a6e4ec', espesor: 0.03, intensidad: 0.5 },

  // Mismo mecanismo que Urano, con algo menos de bruma: un tono más azul.
  neptuno: { color: '#88b6f0', espesor: 0.03, intensidad: 0.5 },

  // Tenue y estacional (nota del catálogo), pero con capas de bruma que la New
  // Horizons fotografió a más de doscientos kilómetros de altura sobre un
  // cuerpo de mil doscientos de radio, y de un azul inesperado: las partículas
  // son tan pequeñas que dispersan como el aire. Gruesa en proporción, débil.
  pluton: { color: '#a8c6ff', espesor: 0.1, intensidad: 0.3 },

  // La única luna con una atmósfera densa: una neblina anaranjada de
  // compuestos orgánicos que la Cassini vio extenderse cientos de kilómetros
  // por encima de la superficie. Es el halo más grueso de todos en proporción.
  titan: { color: '#e3a04a', espesor: 0.11, intensidad: 0.75 },

  // Muy tenue (nota del catálogo): la Voyager 2 vio brumas finas de nitrógeno
  // cerca del limbo. Un velo blanquecino, apenas visible.
  triton: { color: '#dce6ff', espesor: 0.03, intensidad: 0.25 },
});

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec3 vPosicionMundo;
  varying vec3 vCentro;
  varying float vEscala;

  void main() {
    vec4 mundo = modelMatrix * vec4(position, 1.0);
    vPosicionMundo = mundo.xyz;
    vCentro = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vEscala = length(modelMatrix[0].xyz);
    gl_Position = projectionMatrix * viewMatrix * mundo;
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  uniform vec3 color;
  uniform float intensidad;
  uniform float radioCuerpo;     // en unidades locales de la esfera
  uniform float radioExterior;   // ídem

  varying vec3 vPosicionMundo;
  varying vec3 vCentro;
  varying float vEscala;

  void main() {
    #include <logdepthbuf_fragment>

    // Punto de la visual más cercano al centro del cuerpo. Si la cámara está
    // dentro de la atmósfera y el centro queda detrás, el punto más cercano
    // hacia delante es la propia cámara.
    vec3 rayo = normalize(vPosicionMundo - cameraPosition);
    float t = max(0.0, dot(vCentro - cameraPosition, rayo));
    vec3 cercano = cameraPosition + rayo * t;
    float impacto = length(cercano - vCentro);

    float radio = radioCuerpo * vEscala;
    float exterior = radioExterior * vEscala;
    float altura = clamp((impacto - radio) / max(1e-6, exterior - radio), 0.0, 1.0);

    // Densidad exponencial con la altura, y cero antes del borde de la esfera.
    float aire = exp(-4.0 * altura) * (1.0 - smoothstep(0.55, 1.0, altura));

    // Luz: el lado del Sol, con un margen de crepúsculo más allá del
    // terminador, y la dispersión hacia delante cuando se mira hacia el Sol.
    vec3 normalLimbo = (cercano - vCentro) / max(impacto, 1e-6);
    vec3 haciaSol = normalize(-vCentro);
    float dia = smoothstep(-0.2, 0.35, dot(normalLimbo, haciaSol));
    float contraluz = pow(max(dot(rayo, haciaSol), 0.0), 8.0) * 0.8;

    gl_FragColor = vec4(color * aire * (dia + contraluz) * intensidad, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class CapaAtmosferica {
  /**
   * @param {number} radioCuerpo radio de la geometría del cuerpo (radioBase)
   * @param {{color:string, espesor:number, intensidad:number}} apariencia
   */
  constructor(radioCuerpo, apariencia, gestor) {
    const radioExterior = radioCuerpo * (1 + apariencia.espesor);
    const geometria = gestor.registrar(new THREE.SphereGeometry(radioExterior, 48, 32));
    const material = gestor.registrar(
      new THREE.ShaderMaterial({
        uniforms: {
          color: { value: new THREE.Color(apariencia.color) },
          intensidad: { value: apariencia.intensidad },
          radioCuerpo: { value: radioCuerpo },
          radioExterior: { value: radioExterior },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );

    this.malla = new THREE.Mesh(geometria, material);
    this.malla.name = 'atmosfera';
  }

  destruir() {
    this.malla.geometry.dispose();
    this.malla.material.dispose();
    this.malla.removeFromParent();
  }
}

/** Apariencia de la atmósfera de un cuerpo del catálogo, o null si no se dibuja. */
export function aparienciaAtmosfera(datos) {
  if (!datos?.atmosfera) return null;
  return APARIENCIA_ATMOSFERICA[datos.id] ?? null;
}
