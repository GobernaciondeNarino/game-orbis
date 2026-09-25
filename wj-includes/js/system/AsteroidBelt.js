/**
 * AsteroidBelt — cinturones de asteroides y de Kuiper.
 *
 * Miles de cuerpos con una sola llamada de dibujo, con geometría instanciada.
 * Las posiciones individuales son DECORATIVAS: no representan asteroides
 * catalogados, y la interfaz lo declara como SIMULACIÓN. Lo que sí es real son
 * los límites de la región, que vienen del catálogo con su fuente.
 *
 * La distribución usa un generador pseudoaleatorio con semilla fija: la misma
 * escena se ve igual en todos los equipos y en todas las recargas, y las
 * capturas de pantalla son reproducibles.
 *
 * TODO EL MOVIMIENTO VA EN EL SHADER. Antes, cada vez que el reloj simulado
 * avanzaba lo suficiente, se recomponían en JavaScript las matrices de las
 * ocho mil instancias de los dos cinturones —a velocidades altas, en cada
 * fotograma— y se subían enteras a la GPU. Ahora cada instancia lleva sus
 * datos fijos (radio, ángulo inicial, velocidad, eje y ritmo de giro, forma)
 * y el vértice calcula dónde está a partir de dos números: los días
 * simulados y las horas de giro. En la CPU no queda ningún bucle.
 */

import * as THREE from 'three';
import { DOS_PI, generador } from '../utils/math.js';

/** Quien pide menos movimiento no quiere piedras dando vueltas sobre sí mismas. */
const MOVIMIENTO_REDUCIDO = window.matchMedia?.('(prefers-reduced-motion: reduce)');

/**
 * Periodos de rotación, en horas.
 *
 * Por debajo de unas 2,2 horas, un asteroide de más de unos cientos de metros
 * —un montón de escombros apenas unido por su gravedad— se deshace: es la
 * «barrera de giro» de Pravec y Harris (2000, Icarus 148, 12). Por encima, la
 * mayoría tarda de pocas horas a un día. Se reparten entre esos dos extremos
 * de forma logarítmica; cuál gira a qué ritmo es SIMULACIÓN.
 */
const PERIODO_MINIMO_H = 2.2;
const PERIODO_MAXIMO_H = 24;

/**
 * Tope de giro por fotograma. A un millón de veces la velocidad real, una
 * piedra de 2,2 horas daría cientos de vueltas entre dos fotogramas y se vería
 * como un parpadeo al azar. Se limita a lo que cabe en un fotograma sin que el
 * giro se vuelva ruido: la más rápida, un tercio de radián.
 */
const HORAS_GIRO_MAX_POR_FOTOGRAMA = (0.33 * PERIODO_MINIMO_H) / DOS_PI;

const ANCLA_VERTICE = '#include <begin_vertex>';

/**
 * Vértice de cada piedra: forma, giro y órbita, por este orden.
 *
 * La forma estira la piedra base por tres ejes; el giro la hace rodar sobre un
 * eje propio (fórmula de Rodrigues) y la órbita la lleva a su sitio en el
 * cinturón. Con flatShading las normales salen de las derivadas en el
 * fragmento, así que no hace falta girarlas aquí.
 */
const CODIGO_VERTICE = /* glsl */ `
  vec3 transformed = position * aForma.xyz;

  float anguloGiro = aForma.w + aGiro.w * horasGiro;
  vec3 eje = aGiro.xyz;
  float c = cos(anguloGiro);
  float s = sin(anguloGiro);
  transformed = transformed * c + cross(eje, transformed) * s + eje * dot(eje, transformed) * (1.0 - c);

  float anguloOrbita = aOrbita.y + aOrbita.z * diasOrbita;
  transformed += vec3(cos(anguloOrbita) * aOrbita.x, aOrbita.w, sin(anguloOrbita) * aOrbita.x);
`;

export class AsteroidBelt {
  /**
   * @param {object} datos entrada de tipo «cinturon» del catálogo
   */
  constructor(datos, gestor, { semilla = 20260820 } = {}) {
    this.datos = datos;
    this.gestor = gestor;
    this.esSimulacion = true;

    const interno = datos.render.radioInternoEscalado;
    const externo = datos.render.radioExternoEscalado;
    const total = datos.render.instancias ?? 3000;
    const esKuiper = datos.id.includes('kuiper');
    const aleatorio = generador(semilla);

    const geometria = gestor.registrar(this._crearPiedra(aleatorio));
    geometria.instanceCount = total;

    const orbita = new Float32Array(total * 4);
    const giro = new Float32Array(total * 4);
    const forma = new Float32Array(total * 4);
    const eje = new THREE.Vector3();

    for (let i = 0; i < total; i++) {
      // Distribución radial sesgada hacia el centro del cinturón, que es como
      // se reparten de verdad los asteroides entre las lagunas de Kirkwood.
      const t = (aleatorio() + aleatorio()) / 2;
      const radio = interno + (externo - interno) * t;
      const angulo = aleatorio() * DOS_PI;

      // Dispersión vertical proporcional al radio: el cinturón es un toro
      // grueso, no un disco plano.
      const altura = (aleatorio() - 0.5) * (externo - interno) * (esKuiper ? 0.35 : 0.18);
      const tamano = (esKuiper ? 0.09 : 0.06) * (0.35 + aleatorio() * 1.3);

      orbita[i * 4] = radio;
      orbita[i * 4 + 1] = angulo;
      // Tercera ley de Kepler: cuanto más lejos, más despacio. Radianes por
      // día simulado, con la misma constante que antes.
      orbita[i * 4 + 2] = 0.35 / Math.pow(radio, 1.5);
      orbita[i * 4 + 3] = altura;

      // Eje de giro al azar sobre la esfera y periodo entre la barrera de
      // giro y un día, repartido en escala logarítmica.
      eje.set(aleatorio() * 2 - 1, aleatorio() * 2 - 1, aleatorio() * 2 - 1);
      if (eje.lengthSq() < 1e-6) eje.set(0, 1, 0);
      eje.normalize();
      const periodo = PERIODO_MINIMO_H * Math.pow(PERIODO_MAXIMO_H / PERIODO_MINIMO_H, aleatorio());
      giro[i * 4] = eje.x;
      giro[i * 4 + 1] = eje.y;
      giro[i * 4 + 2] = eje.z;
      giro[i * 4 + 3] = DOS_PI / periodo;          // radianes por hora

      // Forma: ninguno es una esfera. Uno o dos ejes más cortos que el largo,
      // hasta algo más de la mitad; y una fase inicial para que no arranquen
      // todos orientados igual.
      forma[i * 4] = tamano;
      forma[i * 4 + 1] = tamano * (0.55 + aleatorio() * 0.4);
      forma[i * 4 + 2] = tamano * (0.7 + aleatorio() * 0.3);
      forma[i * 4 + 3] = aleatorio() * DOS_PI;
    }

    geometria.setAttribute('aOrbita', new THREE.InstancedBufferAttribute(orbita, 4));
    geometria.setAttribute('aGiro', new THREE.InstancedBufferAttribute(giro, 4));
    geometria.setAttribute('aForma', new THREE.InstancedBufferAttribute(forma, 4));

    this.uniformes = {
      diasOrbita: { value: 0 },
      horasGiro: { value: 0 },
    };

    const material = gestor.registrar(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(datos.render.color ?? '#8A8175'),
        roughness: 1,
        metalness: 0,
        flatShading: true,
      }),
    );
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniformes);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aOrbita;
          attribute vec4 aGiro;
          attribute vec4 aForma;
          uniform float diasOrbita;
          uniform float horasGiro;`)
        .replace(ANCLA_VERTICE, CODIGO_VERTICE);
    };

    // Un Mesh con geometría instanciada, no un InstancedMesh: no hace falta
    // ninguna matriz por instancia, porque el shader lo calcula todo.
    this.malla = new THREE.Mesh(geometria, material);
    // La esfera envolvente de la geometría es la de UNA piedra en el origen:
    // no sirve para descartar el cinturón entero.
    this.malla.frustumCulled = false;
    this.malla.name = datos.id;

    this._dias = 0;
    this._horasGiro = 0;
  }

  /**
   * Piedra base: un icosaedro —veinte caras, las mismas que antes: con ocho mil
   * instancias, subdividirlo una vez cuadruplicaba los triángulos de los
   * cinturones para piedras que casi nunca pasan de unos píxeles— con cada
   * vértice empujado hacia dentro o hacia fuera. El desplazamiento depende de la POSICIÓN del
   * vértice y no de su índice: la geometría repite los vértices en cada cara,
   * y si dos copias del mismo punto se movieran distinto la piedra se
   * agrietaría.
   */
  _crearPiedra(aleatorio) {
    const base = new THREE.IcosahedronGeometry(1, 0);
    const posicion = base.attributes.position;
    const desplazamientos = new Map();
    const v = new THREE.Vector3();
    for (let i = 0; i < posicion.count; i++) {
      v.fromBufferAttribute(posicion, i);
      const clave = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
      if (!desplazamientos.has(clave)) desplazamientos.set(clave, 0.72 + aleatorio() * 0.42);
      v.multiplyScalar(desplazamientos.get(clave));
      posicion.setXYZ(i, v.x, v.y, v.z);
    }
    base.computeVertexNormals();

    const geometria = new THREE.InstancedBufferGeometry();
    geometria.index = base.index;
    for (const [nombre, atributo] of Object.entries(base.attributes)) geometria.setAttribute(nombre, atributo);
    base.dispose();
    return geometria;
  }

  get objeto() {
    return this.malla;
  }

  /**
   * Hace avanzar el cinturón: solo dos uniformes.
   *
   * La órbita sigue al reloj simulado, como los planetas, también con
   * movimiento reducido: es la simulación, que el usuario controla y puede
   * pausar. El giro de cada piedra sobre sí misma es una animación añadida, y
   * esa sí se congela con la preferencia.
   */
  actualizar(deltaSimuladoDias) {
    if (!deltaSimuladoDias) return;
    this._dias += deltaSimuladoDias;
    this.uniformes.diasOrbita.value = this._dias;

    if (!MOVIMIENTO_REDUCIDO?.matches) {
      const horas = Math.abs(deltaSimuladoDias) * 24;
      this._horasGiro += Math.sign(deltaSimuladoDias) * Math.min(horas, HORAS_GIRO_MAX_POR_FOTOGRAMA);
      this.uniformes.horasGiro.value = this._horasGiro;
    }
  }

  establecerVisibilidad(visible) {
    this.malla.visible = visible;
  }

  destruir() {
    this.malla.geometry.dispose();
    this.malla.material.dispose();
    this.malla.removeFromParent();
  }
}
