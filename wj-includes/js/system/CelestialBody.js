/**
 * CelestialBody — un cuerpo del Sistema Solar en la escena.
 *
 * Clase base de planetas, satélites y planetas enanos. Encapsula la esfera, su
 * rotación axial real, su órbita y sus recursos, de modo que destruir un cuerpo
 * libere absolutamente todo lo que creó.
 *
 * La rotación y la traslación salen SIEMPRE de los periodos reales del
 * catálogo. Ningún cuerpo gira «a ojo».
 */

import * as THREE from 'three';
import { GRADOS, DOS_PI } from '../utils/math.js';
import { Orbit, EPOCA_J2000 } from './Orbit.js';
import { CapaAtmosferica, aparienciaAtmosfera } from './atmosfera.js';

const MS_POR_HORA = 3_600_000;

/**
 * Cuerpos cuyo mapa de color sirve también de relieve.
 *
 * El mapa de color se usa como mapa de relieve (bumpMap) en los cuerpos con
 * superficie sólida a la vista: en un mundo sin aire, lleno de cráteres, los
 * cambios de albedo coinciden en buena parte con bordes, paredes y
 * eyecciones, y un relieve suave derivado de ellos da volumen donde antes
 * había una pegatina. NO es topografía medida —ningún píxel se presenta como
 * altura real— y por eso la escala es pequeña.
 *
 * Es una lista de los que SÍ, y no de los que no, porque se ha mirado mapa por
 * mapa. Quedan fuera:
 *   · el Sol, que tiene su propio shader, y la Tierra, que dibuja con su
 *     propio shader de día y noche;
 *   · los gigantes gaseosos y helados, que no tienen superficie sólida: sus
 *     bandas son nubes y un relieve las convertiría en surcos;
 *   · Venus y Titán, cuyas texturas son la capa de nubes y la neblina: lo que
 *     se ve desde fuera es aire, no roca;
 *   · Ceres, cuyo mapa trae impresos los nombres de los cráteres y la
 *     retícula: con relieve se verían grabados en la roca;
 *   · Calisto, Caronte, Tritón y las lunas de Urano, cuyos mapas tienen zonas
 *     que ninguna sonda fotografió, rellenas de negro o de gris liso: el
 *     borde de esas zonas saldría como un acantilado que no existe.
 */
const CON_RELIEVE = new Set([
  'mercurio', 'marte', 'pluton',
  'luna', 'fobos', 'deimos',
  'io', 'europa', 'ganimedes',
  'mimas', 'encelado', 'rea', 'japeto',
]);

/**
 * Intensidad del relieve. Three.js lo calcula con la diferencia del mapa entre
 * píxeles vecinos de la pantalla, así que no depende del tamaño del cuerpo:
 * vale lo mismo para Fobos que para Mercurio.
 */
const ESCALA_RELIEVE = 1.2;

/**
 * Semiejes de un cuerpo irregular, si el catálogo los trae.
 *
 * JPL Horizons publica tres radios para los cuerpos que no son esferas
 * («Radius (km) = 13.1 x 11.1 x 9.3» en Fobos), y tools/datos-jpl.mjs los
 * deja escritos en la procedencia del radio medio, que es su media geométrica.
 * Se leen de ahí: es el mismo dato, con su fuente, y no hace falta copiarlo a
 * otro campo. Si no están, el cuerpo es una esfera: no se inventa una forma.
 *
 * @returns {{a:number, b:number, c:number}|null} semiejes en km, de mayor a menor
 */
export function semiejesTriaxiales(datos) {
  const detalle = datos?.procedencia?.radioMedioKm?.detalle ?? '';
  const m = detalle.match(/semiejes\s+([\d.]+)\s*×\s*([\d.]+)\s*×\s*([\d.]+)\s*km/);
  if (!m) return null;
  const [a, b, c] = m.slice(1, 4).map(Number).sort((x, y) => y - x);
  if (!(a > 0 && b > 0 && c > 0)) return null;
  return { a, b, c };
}

/**
 * ¿Gira acoplado por marea a su planeta?
 *
 * Se decide con los dos periodos del catálogo, no con una lista: un satélite
 * cuya rotación dura lo mismo que su órbita (con un 2 % de margen) enseña
 * siempre la misma cara. El margen está porque el catálogo da para la Luna el
 * periodo sidéreo de rotación y, para la órbita, el de sus elementos
 * osculadores, y difieren un 1,4 %: con los dos por separado, la cara visible
 * de la Luna derivaba casi setenta grados por año simulado.
 */
export function acopladoPorMarea(datos) {
  if (datos?.tipo !== 'satelite') return false;
  const rotacion = datos.fisica?.periodoRotacionHoras;
  const orbita = datos.orbita?.periodoOrbitalDias;
  if (!rotacion || !orbita) return false;
  return Math.abs(rotacion / (orbita * 24) - 1) < 0.02;
}

/**
 * Ruta del nivel ligero de una textura.
 *
 * El convenio lo fija tools/texturas.mjs: jupiter.jpg → jupiter@512.jpg. La
 * extensión SIEMPRE pasa a .jpg, sea cual sea la del original, porque el nivel
 * ligero lo produce GD recodificando: un PNG de 512 px de una foto pesa cinco
 * veces más que el JPEG equivalente y a ese tamaño no se distingue.
 *
 * Antes esta línea estaba copiada en tres módulos y conservaba la extensión.
 * En cuanto una textura dejó de ser .jpg —Titán, que es un PNG— los tres
 * empezaron a pedir un archivo que no existe.
 */
export function rutaReducida(ruta) {
  return ruta.replace(/\.\w+$/, '@512.jpg');
}

/** Segmentos de la esfera según su tamaño en pantalla. Un satélite de 0,06
 *  unidades no necesita los mismos triángulos que Júpiter. */
function segmentosPara(radioEscena) {
  if (radioEscena >= 3) return [64, 48];
  if (radioEscena >= 1) return [48, 32];
  if (radioEscena >= 0.3) return [32, 24];
  return [24, 16];
}

export class CelestialBody {
  /**
   * @param {object} datos entrada del catálogo data/sistema-solar.json
   * @param {import('../core/SceneManager.js').SceneManager} gestor
   */
  constructor(datos, gestor) {
    this.datos = datos;
    this.id = datos.id;
    this.gestor = gestor;

    /** Radio con el que se construyó la geometría. Nunca cambia. */
    this.radioBase = datos.render.radioEscalado ?? 0.3;
    /** Radio efectivo en la escena. Cambia con el modo de escala. */
    this.radio = this.radioBase;
    this.periodoRotacionHoras = datos.fisica?.periodoRotacionHoras ?? null;
    this.inclinacionAxial = (datos.fisica?.inclinacionAxialGrados ?? 0) * GRADOS;

    /**
     * Nodo que se mueve por la órbita. Los satélites cuelgan de él, de modo
     * que acompañan a su planeta sin recalcular nada.
     */
    this.pivote = new THREE.Object3D();
    this.pivote.name = `pivote-${this.id}`;

    /** Nodo con la inclinación axial aplicada; dentro gira la esfera. */
    this.ejeInclinado = new THREE.Object3D();
    this.ejeInclinado.rotation.z = this.inclinacionAxial;
    this.pivote.add(this.ejeInclinado);

    this.malla = this._crearMalla();
    this.ejeInclinado.add(this.malla);

    this.orbita = null;
    this.capas = [];        // Nubes, luces nocturnas… se destruyen con el cuerpo.
    this.hijos = [];        // Satélites.

    this.acopladoPorMarea = acopladoPorMarea(datos);
    this._aplicarFormaTriaxial();

    // Atmósfera: la presencia la dice el catálogo; el aspecto, atmosfera.js.
    const apariencia = aparienciaAtmosfera(datos);
    if (apariencia) {
      this.atmosfera = new CapaAtmosferica(this.radioBase, apariencia, gestor);
      this.ejeInclinado.add(this.atmosfera.malla);
      this.capas.push(this.atmosfera);
    }
  }

  /**
   * Forma real de los cuerpos irregulares.
   *
   * Los semiejes vienen de JPL Horizons a través del catálogo (ver
   * semiejesTriaxiales). La malla se estira dividiendo cada uno por el radio
   * medio —su media geométrica, que es como el catálogo lo calculó—, así que el
   * volumen es el de la esfera de antes y el radio del catálogo sigue siendo
   * cierto.
   *
   * Orientación: el eje largo en X local, el corto en Y —el de giro— y el
   * intermedio en Z. Un cuerpo acoplado por marea gira sobre su eje corto y
   * apunta el largo hacia su planeta, que es exactamente lo que hace Fobos; el
   * acoplamiento (en actualizar) se encarga de que X mire al planeta. Las
   * texturas de estos cuerpos son mapas en longitud y latitud, y el elipsoide
   * conserva la dirección de cada punto desde el centro, así que el mapa sigue
   * en su sitio.
   */
  _aplicarFormaTriaxial() {
    const semiejes = semiejesTriaxiales(this.datos);
    if (!semiejes) return;
    const medio = Math.cbrt(semiejes.a * semiejes.b * semiejes.c);
    this.malla.scale.set(semiejes.a / medio, semiejes.c / medio, semiejes.b / medio);
    this.semiejes = semiejes;
  }

  /** Cuerpos con superficie sólida a la vista y un mapa completo que la muestre. */
  get tieneRelieve() {
    return Boolean(this.datos.render?.textura) && CON_RELIEVE.has(this.id);
  }

  _crearMalla() {
    const [anchoSeg, altoSeg] = segmentosPara(this.radio);
    const geometria = this.gestor.registrar(
      new THREE.SphereGeometry(this.radio, anchoSeg, altoSeg),
    );

    const render = this.datos.render;
    const material = this.gestor.registrar(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(render.color ?? '#9aa0a6'),
        roughness: 0.92,
        metalness: 0.0,
      }),
    );

    // NIVEL DE DETALLE. En el arranque se carga la versión de 512 px, no la de
    // 2048: las diecisiete texturas del sistema pasan de unos 8 MB a 1,3 MB, y
    // en una conexión lenta esa es la diferencia entre esperar medio minuto y
    // poder navegar de inmediato. La versión completa se pide solo cuando el
    // usuario enfoca ese cuerpo, que es cuando se nota.
    if (render.textura) {
      const textura = this.gestor.cargarTextura(rutaReducida(render.textura));
      material.map = textura;
      material.color.set('#ffffff');
      // El mismo mapa como relieve, en los cuerpos con superficie a la vista.
      // Es la MISMA textura, no una copia: no cuesta ni un byte más.
      if (this.tieneRelieve) {
        material.bumpMap = textura;
        material.bumpScale = ESCALA_RELIEVE;
      }
      material.needsUpdate = true;
      this.texturaReducida = textura;
    }

    const malla = new THREE.Mesh(geometria, material);
    malla.name = this.id;
    // Referencia inversa: el selector por ratón necesita saber a qué cuerpo
    // pertenece el triángulo que ha tocado.
    malla.userData.cuerpo = this;
    return malla;
  }

  /**
   * Sustituye la textura reducida por la de resolución completa.
   *
   * Es idempotente y no bloquea: si ya se pidió, no hace nada; si la descarga
   * falla, se queda la reducida, que es peor pero no rompe nada. La reducida se
   * libera solo cuando la nueva ya está en la GPU, para que no haya un
   * fotograma con el cuerpo en gris.
   */
  mejorarTextura() {
    this._conTexturaCompleta((completa) => {
      const material = this.malla.material;
      const anterior = material.map;
      material.map = completa;
      // El relieve sale del mismo mapa: si se quedara en el reducido, la luz y
      // el color irían a resoluciones distintas —y la reducida no se podría
      // liberar, porque el relieve la seguiría usando—.
      if (material.bumpMap) material.bumpMap = completa;
      material.needsUpdate = true;
      // Una sola vez: color y relieve compartían la misma textura.
      if (anterior && anterior !== completa) anterior.dispose();
      this.texturaReducida = null;
    });
  }

  /**
   * Carga la textura de resolución completa y llama a `aplicar` cuando llega.
   *
   * La espera vivía duplicada aquí y en Sun.js, que la sobrescribe entera solo
   * porque el Sol no aplica la textura a `material.map` sino a un uniforme de
   * su shader. Lo que cambia es esa línea; todo lo demás —el guardián de una
   * sola vez, la carga y el sondeo— era idéntico.
   *
   * Hay sondeo y no solo un evento porque el TextureLoader de Three NO emite
   * «load» sobre la textura: rellena `image` y ya está. Se escuchan los dos y
   * el guardián `hecho` impide que se aplique dos veces si llegan ambos, que
   * es lo que pasaba antes.
   */
  _conTexturaCompleta(aplicar) {
    const ruta = this.datos.render?.textura;
    if (!ruta || this._texturaMejorada) return;
    this._texturaMejorada = true;

    const completa = this.gestor.cargarTextura(ruta);
    let hecho = false;
    const unaVez = () => {
      if (hecho) return;
      hecho = true;
      aplicar(completa);
    };

    if (completa.image) { unaVez(); return; }

    completa.addEventListener?.('load', unaVez);
    let intentos = 0;
    const sondeo = setInterval(() => {
      if (completa.image) {
        clearInterval(sondeo);
        unaVez();
      } else if (++intentos > 100) {
        clearInterval(sondeo);   // 10 s: se queda la reducida.
      }
    }, 100);
  }

  /**
   * Sombra de los anillos sobre el planeta.
   *
   * Es la otra mitad de la sombra que ya proyecta el planeta sobre sus anillos
   * (Rings.js), y la más reconocible de Saturno: una franja oscura, con la
   * estructura de los anillos, cruzando el disco. Para cada punto de la
   * superficie se sigue el rayo hacia el Sol hasta el plano de los anillos; si
   * lo corta entre el radio interior y el exterior, se mira en la tira de la
   * textura cuánto tapan ahí y se resta esa fracción de la luz directa. La luz
   * ambiente no se toca: la sombra no es un agujero negro.
   *
   * Se engancha al MeshStandardMaterial con onBeforeCompile para no perder su
   * iluminación. Los uniformes van por material, y three.js vuelve a llamar a
   * onBeforeCompile para cada material nuevo aunque comparta programa.
   *
   * @param {import('./Rings.js').Rings} anillos
   */
  recibirSombraDeAnillos(anillos) {
    const material = this.malla.material;
    if (!material?.isMeshStandardMaterial) return;

    const uniformes = {
      mapaAnillos: { value: anillos.mapa },
      tieneMapaAnillos: { value: anillos.mapa ? 1 : 0 },
      opacidadAnillos: { value: anillos.material.uniforms.opacidad.value },
      radioInternoAnillos: { value: anillos.interno },
      radioExternoAnillos: { value: anillos.externo },
    };

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniformes);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vPosicionAnillos;
          varying vec3 vCentroAnillos;
          varying vec3 vEjeAnillos;
          varying float vEscalaAnillos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vPosicionAnillos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vCentroAnillos = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          // El eje de giro del planeta es la normal del plano de sus anillos.
          vEjeAnillos = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
          vEscalaAnillos = length(modelMatrix[0].xyz);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D mapaAnillos;
          uniform float tieneMapaAnillos;
          uniform float opacidadAnillos;
          uniform float radioInternoAnillos;
          uniform float radioExternoAnillos;
          varying vec3 vPosicionAnillos;
          varying vec3 vCentroAnillos;
          varying vec3 vEjeAnillos;
          varying float vEscalaAnillos;

          // Fracción de la luz del Sol que atraviesa los anillos hasta aquí.
          float luzTrasAnillos() {
            vec3 haciaSol = normalize(-vPosicionAnillos);
            float paralelo = dot(haciaSol, vEjeAnillos);
            if (abs(paralelo) < 1e-4) return 1.0;
            float t = dot(vCentroAnillos - vPosicionAnillos, vEjeAnillos) / paralelo;
            // El plano de los anillos queda al otro lado: no hay nada que tape.
            if (t <= 0.0) return 1.0;
            vec3 cruce = vPosicionAnillos + haciaSol * t;
            float r = length(cruce - vCentroAnillos) / vEscalaAnillos;
            if (r < radioInternoAnillos || r > radioExternoAnillos) return 1.0;
            vec2 uvAnillo = vec2((r - radioInternoAnillos) / (radioExternoAnillos - radioInternoAnillos), 0.5);
            float tapa = opacidadAnillos;
            if (tieneMapaAnillos > 0.5) {
              vec4 texel = texture2D(mapaAnillos, uvAnillo);
              tapa *= texel.a * texel.g;
            }
            return 1.0 - tapa;
          }`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          float luzAnillos = luzTrasAnillos();
          reflectedLight.directDiffuse *= luzAnillos;
          reflectedLight.directSpecular *= luzAnillos;`);
    };
    material.needsUpdate = true;
  }

  /** Conecta el cuerpo a una órbita construida a partir de sus elementos. */
  establecerOrbita(elementos, semiejeEscena, colorLinea) {
    this.orbita = new Orbit(elementos, semiejeEscena);
    this.orbita.crearLinea({ color: colorLinea });
    this.orbita.nodoPeriastro.add(this.pivote);
    return this.orbita;
  }

  /** Añade un satélite, que pasa a orbitar este cuerpo. */
  anadirSatelite(cuerpo, elementos, semiejeEscena, colorLinea) {
    cuerpo.establecerOrbita(elementos, semiejeEscena, colorLinea);
    this.pivote.add(cuerpo.orbita.objeto);
    this.hijos.push(cuerpo);
  }

  /**
   * Actualiza posición y rotación para una fecha simulada.
   * @param {Date} fecha
   */
  actualizar(fecha) {
    if (this.orbita) {
      this.orbita.posicionEn(fecha, this.pivote.position);
    }

    if (this.acopladoPorMarea && this.orbita) {
      // Acoplamiento por marea: la longitud 0 —el centro del mapa, +X local,
      // el mismo convenio que usa latLonAVector para las anotaciones— mira al
      // planeta. Es la definición de la IAU del meridiano cero de los
      // satélites síncronos: el punto medio bajo el planeta.
      //
      // Se usa la anomalía MEDIA y no la verdadera: el satélite gira a ritmo
      // uniforme mientras recorre una órbita excéntrica a ritmo variable, y
      // esa diferencia es la libración en longitud. La Luna la tiene, y así
      // aparece sola.
      this.malla.rotation.y = this.orbita.anomaliaMediaEn(fecha) + Math.PI;
    } else if (this.periodoRotacionHoras) {
      // Fase absoluta desde J2000: la rotación no depende de cuántos
      // fotogramas se hayan dibujado, así que pausar y reanudar no la desplaza.
      const horas = (fecha.getTime() - EPOCA_J2000) / MS_POR_HORA;
      this.malla.rotation.y = (DOS_PI * horas) / this.periodoRotacionHoras;
    }

    for (const capa of this.capas) capa.actualizar?.(fecha);
    for (const hijo of this.hijos) hijo.actualizar(fecha);
  }

  /**
   * Cambia el radio efectivo del cuerpo.
   *
   * Se reescala la malla en lugar de reconstruir la geometría: crear treinta y
   * tres esferas nuevas en cada cambio de escala provocaría un tirón y dejaría
   * las anteriores para el recolector.
   */
  establecerRadio(nuevo) {
    if (!nuevo || nuevo === this.radio) return;
    this.radio = nuevo;
    this.ejeInclinado.scale.setScalar(nuevo / this.radioBase);
  }

  /** Posición del cuerpo en coordenadas de mundo. */
  posicionMundial(destino = new THREE.Vector3()) {
    return this.pivote.getWorldPosition(destino);
  }

  establecerVisibilidadOrbitas(visible) {
    this.orbita?.establecerVisibilidadLinea(visible);
    for (const hijo of this.hijos) hijo.establecerVisibilidadOrbitas(visible);
  }

  /** Objetos que el selector por ratón debe considerar. */
  recogerSeleccionables(destino = []) {
    destino.push(this.malla);
    for (const hijo of this.hijos) hijo.recogerSeleccionables(destino);
    return destino;
  }

  destruir() {
    for (const hijo of this.hijos) hijo.destruir();
    this.hijos.length = 0;

    for (const capa of this.capas) capa.destruir?.();
    this.capas.length = 0;

    this.malla.geometry.dispose();
    const materiales = Array.isArray(this.malla.material) ? this.malla.material : [this.malla.material];
    // Un Set: el mapa de color y el de relieve son la misma textura, y se
    // libera una vez.
    const texturas = new Set();
    for (const material of materiales) {
      for (const valor of Object.values(material)) {
        if (valor && valor.isTexture) texturas.add(valor);
      }
      for (const uniforme of Object.values(material.uniforms ?? {})) {
        if (uniforme?.value?.isTexture) texturas.add(uniforme.value);
      }
    }
    for (const textura of texturas) textura.dispose();
    for (const material of materiales) material.dispose();
    this.malla.removeFromParent();

    this.orbita?.destruir();
    this.pivote.removeFromParent();
  }
}
