/**
 * SolarSystem — construye la escena completa a partir del catálogo.
 *
 * Este módulo no contiene ni una sola cifra astronómica: todo sale de
 * data/sistema-solar.json. Si un dato cambia, se cambia en el JSON y aquí no
 * se toca nada.
 *
 * Responsabilidades:
 *   · instanciar el Sol, los planetas, los planetas enanos y los satélites;
 *   · colgar cada satélite de su planeta, no del Sol;
 *   · montar anillos y cinturones;
 *   · actualizar todo para una fecha simulada;
 *   · destruirlo todo liberando cada recurso.
 */

import * as THREE from 'three';
import { CelestialBody } from './CelestialBody.js';
import { Sun } from './Sun.js';
import { Earth } from './Earth.js';
import { Rings } from './Rings.js';
import { AsteroidBelt } from './AsteroidBelt.js';
import { Galaxy } from './Galaxy.js';
import { log } from '../utils/debug.js';

const MS_POR_DIA = 86_400_000;

/**
 * ESCALAS.
 *
 * En escala real, una unidad de escena son 1.000 km. Con eso la Tierra mide
 * 6,37 unidades de radio, el Sol 696 y la órbita de Neptuno 4.500.000. Es el
 * Sistema Solar tal cual es, y demuestra algo que ninguna ilustración enseña:
 * que está esencialmente vacío. Navegarlo es incómodo a propósito.
 *
 * En escala didáctica los tamaños y las distancias vienen ya comprimidos desde
 * el catálogo, con las funciones deterministas de tools/construir-datos.mjs.
 */
const KM_POR_UNIDAD_REAL = 1000;
const KM_POR_UA = 149_597_870.7;

export class SolarSystem {
  /**
   * @param {object} catalogo contenido de data/sistema-solar.json
   * @param {import('../core/SceneManager.js').SceneManager} gestor
   */
  constructor(catalogo, gestor) {
    this.catalogo = catalogo;
    this.gestor = gestor;

    this.grupo = new THREE.Group();
    this.grupo.name = 'sistema-solar';

    /** @type {Map<string, CelestialBody>} todos los cuerpos por id */
    this.cuerpos = new Map();
    this.cinturones = [];
    this.anillos = [];

    this._porId = new Map(catalogo.cuerpos.map((c) => [c.id, c]));
    this.escala = 'didactico';
    this._fechaAnterior = null;
    this._seleccionables = null;

    this._construir();
  }

  _construir() {
    const entradas = this.catalogo.cuerpos;

    // 1. El Sol, en el origen. Es la única fuente de luz.
    const datosSol = this._porId.get('sol');
    this.sol = new Sun(datosSol, this.gestor);
    this.cuerpos.set('sol', this.sol);
    this.grupo.add(this.sol.pivote);
    this.grupo.add(this.sol.luzAmbiente);

    // 2. Todo lo que orbita directamente al Sol.
    for (const datos of entradas) {
      if (datos.tipo === 'cinturon' || datos.padre !== 'sol') continue;

      // La Tierra tiene material propio: día, noche, nubes y atmósfera.
      const Clase = datos.id === 'tierra' ? Earth : CelestialBody;
      const cuerpo = new Clase(datos, this.gestor);
      cuerpo.establecerOrbita(
        datos.orbita,
        datos.render.distanciaEscalada,
        new THREE.Color(datos.render.colorEtiqueta ?? '#4FC3F7'),
      );
      this.grupo.add(cuerpo.orbita.objeto);
      this.cuerpos.set(datos.id, cuerpo);

      if (datos.render.anillos) this._anadirAnillos(cuerpo, datos.render.anillos);
    }

    // 3. Los satélites, colgados de su planeta.
    for (const datos of entradas) {
      if (datos.tipo !== 'satelite') continue;

      const padre = this.cuerpos.get(datos.padre);
      if (!padre) {
        log(`Satélite ${datos.id} sin planeta padre (${datos.padre}); se omite.`);
        continue;
      }

      const satelite = new CelestialBody(datos, this.gestor);
      padre.anadirSatelite(
        satelite,
        datos.orbita,
        datos.render.distanciaEscalada,
        new THREE.Color('#5c7a8c'),
      );
      this.cuerpos.set(datos.id, satelite);
    }

    // 4. Cinturones.
    for (const datos of entradas) {
      if (datos.tipo !== 'cinturon') continue;
      const cinturon = new AsteroidBelt(datos, this.gestor);
      this.cinturones.push(cinturon);
      this.grupo.add(cinturon.objeto);
    }

    // 5. Entorno galáctico.
    this.galaxia = new Galaxy(this.gestor, { textura: 'wj-content/assets/textures/estrellas.jpg' });
    this.grupo.add(this.galaxia.objeto);

    // 6. Destello del Sol. El halo se genera en un lienzo, sin archivos. Los
    // cuerpos seleccionables son también los que pueden taparlo.
    this.sol.anadirDestello(() => this.seleccionables);

    log(
      `Sistema construido: ${this.cuerpos.size} cuerpos, ` +
        `${this.anillos.length} sistemas de anillos, ${this.cinturones.length} cinturones.`,
    );
  }

  _anadirAnillos(cuerpo, config) {
    const anillos = new Rings(config, cuerpo.radio, this.gestor);
    // Los anillos siguen el ecuador del planeta, así que cuelgan del nodo
    // inclinado: los de Urano quedan casi verticales, como en la realidad.
    cuerpo.ejeInclinado.add(anillos.objeto);
    cuerpo.capas.push(anillos);
    this.anillos.push(anillos);
  }

  /**
   * Actualiza el sistema entero para una fecha simulada.
   * @param {Date} fecha
   * @param {number} delta segundos reales transcurridos
   */
  actualizar(fecha, delta) {
    this.sol.actualizar(fecha, delta);

    for (const cuerpo of this.cuerpos.values()) {
      if (cuerpo === this.sol) continue;
      if (cuerpo.datos.tipo === 'satelite') continue;   // Los actualiza su planeta.
      cuerpo.actualizar(fecha);
    }

    // Los cinturones avanzan según el tiempo simulado, no el real.
    const diasSimulados = this._fechaAnterior
      ? (fecha.getTime() - this._fechaAnterior.getTime()) / MS_POR_DIA
      : 0;
    for (const cinturon of this.cinturones) cinturon.actualizar(diasSimulados);

    this._fechaAnterior = new Date(fecha.getTime());
  }

  /** Fundido del disco galáctico según lo lejos que esté la cámara. */
  actualizarEntorno(distanciaCamara, delta) {
    this.galaxia.actualizarSegunDistancia(distanciaCamara, delta);
  }

  establecerVisibilidadOrbitas(visible) {
    for (const cuerpo of this.cuerpos.values()) {
      if (cuerpo.datos.tipo === 'satelite') continue;
      cuerpo.establecerVisibilidadOrbitas(visible);
    }
  }

  establecerVisibilidadCinturones(visible) {
    for (const cinturon of this.cinturones) cinturon.establecerVisibilidad(visible);
  }

  /** Mallas que el selector por ratón debe considerar. Se cachea. */
  get seleccionables() {
    if (!this._seleccionables) {
      this._seleccionables = [];
      for (const cuerpo of this.cuerpos.values()) {
        this._seleccionables.push(cuerpo.malla);
      }
    }
    return this._seleccionables;
  }

  obtener(id) {
    return this.cuerpos.get(id);
  }

  /**
   * Cambia entre la escala didáctica y la real.
   *
   * @param {'didactico'|'real'} modo
   * @returns {{modo:string, aviso:string|null}}
   */
  establecerEscala(modo) {
    if (modo === this.escala) return { modo, aviso: null };
    this.escala = modo;

    for (const cuerpo of this.cuerpos.values()) {
      const datos = cuerpo.datos;

      // --- Radio ---------------------------------------------------------
      let radio;
      if (modo === 'real') {
        radio = datos.fisica?.radioMedioKm
          ? datos.fisica.radioMedioKm / KM_POR_UNIDAD_REAL
          : cuerpo.radioBase;
      } else {
        radio = cuerpo.radioBase;
      }
      cuerpo.establecerRadio(radio);

      // --- Semieje de la órbita -------------------------------------------
      if (!cuerpo.orbita) continue;
      let semieje;
      if (modo === 'real') {
        semieje = datos.tipo === 'satelite'
          ? (datos.orbita?.semiejeMayorKm ?? 0) / KM_POR_UNIDAD_REAL
          : ((datos.orbita?.semiejeMayorUA ?? 0) * KM_POR_UA) / KM_POR_UNIDAD_REAL;
      } else {
        semieje = datos.render?.distanciaEscalada ?? cuerpo.orbita.semieje;
      }
      cuerpo.orbita.establecerSemieje(semieje);
    }

    // Los cinturones se dibujan con radios propios; en escala real habría que
    // reconstruir sus cinco mil instancias, así que se ocultan y se declara.
    for (const cinturon of this.cinturones) cinturon.establecerVisibilidad(modo !== 'real');

    return {
      modo,
      aviso: modo === 'real'
        ? 'Escala real: una unidad son 1.000 km. Las distancias son enormes y la ' +
          'mayor parte de la escena está vacía, que es justo como es el Sistema Solar. ' +
          'Los cinturones quedan ocultos en este modo.'
        : 'Escala didáctica: tamaños y distancias comprimidos para poder navegar.',
    };
  }

  /**
   * Pide la textura de resolución completa de un cuerpo y de sus satélites.
   * Se llama al enfocar: es cuando la resolución se nota y cuando el usuario
   * está dispuesto a esperar un instante.
   */
  mejorarTexturas(id) {
    const cuerpo = this.cuerpos.get(id);
    if (!cuerpo) return;
    cuerpo.mejorarTextura?.();
    for (const hijo of cuerpo.hijos) hijo.mejorarTextura?.();
  }

  /** Sube la resolución del fondo estelar. */
  mejorarEntorno() {
    this.galaxia.mejorarCielo();
  }

  /** Ids en el orden en el que aparecen en la tira de navegación. */
  get ordenNavegacion() {
    return this.catalogo.cuerpos.filter((c) => c.tipo !== 'cinturon').map((c) => c.id);
  }

  destruir() {
    for (const cuerpo of this.cuerpos.values()) {
      if (cuerpo.datos.tipo === 'satelite') continue;   // Su planeta los destruye.
      cuerpo.destruir();
    }
    this.cuerpos.clear();

    for (const cinturon of this.cinturones) cinturon.destruir();
    this.cinturones.length = 0;
    this.anillos.length = 0;

    this.galaxia.destruir();
    this.grupo.clear();
    this.grupo.removeFromParent();
    this._seleccionables = null;
  }
}
