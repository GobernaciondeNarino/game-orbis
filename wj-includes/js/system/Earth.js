/**
 * Earth — la Tierra, con día, noche, nubes y atmósfera.
 *
 * Es el único cuerpo que justifica un material propio. Tres motivos:
 *
 *   · el lado nocturno no es negro: se ven las luces de las ciudades, y eso
 *     no se puede hacer con `emissiveMap`, que ilumina también la cara diurna;
 *   · las nubes giran a distinta velocidad que la superficie;
 *   · el borde del disco se tiñe del azul de la atmósfera.
 *
 * Las tres texturas son mapas reales (Solar System Scope, CC BY 4.0). El halo
 * atmosférico sí es un efecto calculado, no una fotografía. El de FUERA del
 * disco ya no es propio: es el mismo de todos los cuerpos con atmósfera
 * (atmosfera.js), con el color y el grosor que la Tierra tenía. Lo que se
 * queda aquí es el tinte azul DENTRO del disco, cerca del limbo, que solo la
 * Tierra dibuja porque solo ella tiene un shader de superficie propio.
 */

import * as THREE from 'three';
import { CelestialBody, rutaReducida } from './CelestialBody.js';
import { DOS_PI } from '../utils/math.js';
import { EPOCA_J2000 } from './Orbit.js';

const MS_POR_HORA = 3_600_000;

const VERTEX = /* glsl */ `
  // <common> define isPerspectiveMatrix(), que necesita <logdepthbuf_vertex>.
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosicionMundo;

  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mundo = modelMatrix * vec4(position, 1.0);
    vPosicionMundo = mundo.xyz;
    gl_Position = projectionMatrix * viewMatrix * mundo;
    // Después de calcular gl_Position: el fragmento lo lee.
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  uniform sampler2D mapaDia;
  uniform sampler2D mapaNoche;
  uniform vec3 posicionLuz;
  uniform vec3 colorAtmosfera;
  uniform float tieneNoche;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosicionMundo;

  void main() {
    #include <logdepthbuf_fragment>

    vec3 haciaLuz = normalize(posicionLuz - vPosicionMundo);
    float incidencia = dot(normalize(vNormal), haciaLuz);

    vec3 dia = texture2D(mapaDia, vUv).rgb;
    vec3 noche = tieneNoche > 0.5 ? texture2D(mapaNoche, vUv).rgb : vec3(0.0);

    // Terminador suave: la transición entre el día y la noche en la Tierra
    // real ocupa unos pocos grados, no es una línea dura.
    float mezcla = smoothstep(-0.12, 0.22, incidencia);

    // La cara iluminada se atenúa hacia el borde según el ángulo de incidencia.
    vec3 color = dia * max(0.06, incidencia);
    // Las luces de las ciudades solo se ven donde no da el Sol.
    color = mix(noche * 1.25, color, mezcla);

    // Halo atmosférico: más intenso en el limbo y solo del lado iluminado.
    vec3 haciaCamara = normalize(cameraPosition - vPosicionMundo);
    float limbo = pow(1.0 - max(0.0, dot(normalize(vNormal), haciaCamara)), 2.5);
    color += colorAtmosfera * limbo * max(0.0, incidencia + 0.25) * 0.75;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export class Earth extends CelestialBody {
  constructor(datos, gestor) {
    super(datos, gestor);

    // Se sustituye el material estándar por el propio.
    this.malla.material.dispose();
    this.malla.material = this._crearMaterial();

    if (datos.render.texturaNubes) this._anadirNubes(datos.render.texturaNubes);
    // El halo exterior lo pone CelestialBody con atmosfera.js.
  }

  _crearMaterial() {
    const render = this.datos.render;
    const tieneNoche = Boolean(render.texturaNoche);

    this.materialSuperficie = this.gestor.registrar(
      new THREE.ShaderMaterial({
        uniforms: {
          // También aquí se empieza por la versión de 512 px; mejorarTextura()
          // sustituye las tres capas al enfocar la Tierra.
          mapaDia: { value: this.gestor.cargarTextura(rutaReducida(render.textura)) },
          mapaNoche: {
            value: tieneNoche ? this.gestor.cargarTextura(rutaReducida(render.texturaNoche)) : null,
          },
          tieneNoche: { value: tieneNoche ? 1 : 0 },
          // El Sol está en el origen de la escena.
          posicionLuz: { value: new THREE.Vector3(0, 0, 0) },
          colorAtmosfera: { value: new THREE.Color('#3f7fd6') },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      }),
    );
    return this.materialSuperficie;
  }

  /**
   * Capa de nubes: una esfera ligeramente mayor, translúcida y con su propia
   * rotación. En la Tierra real las nubes se desplazan respecto al suelo; aquí
   * se les da un periodo un 3 % más corto para que la diferencia se note sin
   * resultar absurda.
   */
  _anadirNubes(ruta) {
    const geometria = this.gestor.registrar(new THREE.SphereGeometry(this.radio * 1.012, 48, 32));
    const textura = this.gestor.cargarTextura(rutaReducida(ruta));
    const material = this.gestor.registrar(
      new THREE.MeshLambertMaterial({
        map: textura,
        alphaMap: textura,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    );

    this.nubes = new THREE.Mesh(geometria, material);
    this.ejeInclinado.add(this.nubes);
  }

  /** Sustituye las tres capas por sus versiones completas. */
  mejorarTextura() {
    const render = this.datos.render;
    if (!render?.textura || this._texturaMejorada) return;
    this._texturaMejorada = true;

    const cambiar = (uniforme, ruta) => {
      const completa = this.gestor.cargarTextura(ruta);
      const aplicar = () => {
        const anterior = this.materialSuperficie.uniforms[uniforme].value;
        this.materialSuperficie.uniforms[uniforme].value = completa;
        if (anterior && anterior !== completa) anterior.dispose();
      };
      let intentos = 0;
      const sondeo = setInterval(() => {
        if (completa.image) { clearInterval(sondeo); aplicar(); }
        else if (++intentos > 100) clearInterval(sondeo);
      }, 100);
    };

    cambiar('mapaDia', render.textura);
    if (render.texturaNoche) cambiar('mapaNoche', render.texturaNoche);

    if (this.nubes && render.texturaNubes) {
      const completa = this.gestor.cargarTextura(render.texturaNubes);
      let intentos = 0;
      const sondeo = setInterval(() => {
        if (completa.image) {
          clearInterval(sondeo);
          const anterior = this.nubes.material.map;
          this.nubes.material.map = completa;
          this.nubes.material.alphaMap = completa;
          this.nubes.material.needsUpdate = true;
          if (anterior && anterior !== completa) anterior.dispose();
        } else if (++intentos > 100) clearInterval(sondeo);
      }, 100);
    }
  }

  actualizar(fecha) {
    super.actualizar(fecha);

    if (this.nubes && this.periodoRotacionHoras) {
      const horas = (fecha.getTime() - EPOCA_J2000) / MS_POR_HORA;
      this.nubes.rotation.y = (DOS_PI * horas) / (this.periodoRotacionHoras * 0.97);
    }
  }

  destruir() {
    if (this.nubes) {
      this.nubes.geometry.dispose();
      // Mapa y alphaMap son la misma textura: se libera una vez.
      this.nubes.material.map?.dispose();
      if (this.nubes.material.alphaMap !== this.nubes.material.map) this.nubes.material.alphaMap?.dispose();
      this.nubes.material.dispose();
      this.nubes.removeFromParent();
    }
    // La atmósfera está en this.capas: la libera la clase base.
    super.destruir();
  }
}
