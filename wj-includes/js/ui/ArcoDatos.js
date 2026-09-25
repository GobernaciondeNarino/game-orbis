/**
 * Arco de datos de la VISTA DE CUERPO.
 *
 * Bloque de texto técnico dispuesto en columnas curvadas siguiendo un arco, con
 * aparición escalonada carácter a carácter tipo terminal, como en la segunda
 * imagen de referencia.
 *
 * El contenido es TEXTO REAL Y LEGIBLE: el perfil extendido del cuerpo más sus
 * datos de interés, tal como están en su fuente de conocimiento. No es relleno
 * decorativo ni caracteres aleatorios; quien se pare a leerlo aprende algo.
 *
 * Los datos de interés salen del conocimiento publicado del cuerpo —catálogo más
 * lo añadido desde el panel— y cada uno lleva SU fuente debajo. Antes eran solo
 * las curiosidades del catálogo con una fuente común al final, que valía para
 * las cifras de JPL pero no para una frase sobre los rovers de Marte.
 *
 * La curvatura se consigue desplazando cada línea horizontalmente según su
 * posición vertical, siguiendo un arco de circunferencia. Es más barato que
 * rotar cada carácter y se lee mucho mejor.
 */

import { crear } from '../utils/dom.js';
import { formatearNumero, formatearCientifico } from '../utils/math.js';
import { cargarConocimiento, conocimientoEnMemoria } from '../utils/conocimiento.js';

/** Cuántos datos de interés caben en el arco sin que se vuelva una pared. */
const MAX_DATOS = 5;

const REDUCIR = window.matchMedia?.('(prefers-reduced-motion: reduce)');

/** Milisegundos entre caracteres. Ajustado para que un bloque tarde ~2,5 s. */
const RITMO = 6;

export class ArcoDatos {
  constructor(contenedor) {
    this.lineas = [];
    this._temporizador = null;

    this.cuerpoTexto = crear('div', { class: 'arco__cuerpo' });
    this.panel = crear('aside', {
      class: 'arco',
      'aria-live': 'polite',
      'aria-label': 'Ficha técnica ampliada del cuerpo',
    }, [this.cuerpoTexto]);

    contenedor.append(this.panel);
  }

  /**
   * Compone las líneas de texto a partir del catálogo.
   * @param {object[]|null} datos los del conocimiento publicado, si llegaron
   */
  _componer(cuerpo, datos = null) {
    const lineas = [];
    const dato = (etiqueta, valor, unidad = '') =>
      valor === null || valor === undefined
        ? `${etiqueta.padEnd(22, '·')} SIN DATOS`
        : `${etiqueta.padEnd(22, '·')} ${valor}${unidad ? ' ' + unidad : ''}`;

    lineas.push(`── ${cuerpo.nombre.toUpperCase()} ──`);
    lineas.push('');
    lineas.push(dato('Diámetro', formatearNumero(cuerpo.fisica?.diametroKm), 'km'));
    lineas.push(dato('Masa', formatearCientifico(cuerpo.fisica?.masaKg, 3), 'kg'));
    lineas.push(dato('Densidad', formatearNumero(cuerpo.fisica?.densidadGcm3, 3), 'g/cm³'));
    lineas.push(dato('Gravedad', formatearNumero(cuerpo.fisica?.gravedadMs2, 3), 'm/s²'));
    lineas.push(dato('Vel. escape', formatearNumero(cuerpo.fisica?.velocidadEscapeKms, 3), 'km/s'));
    lineas.push(dato('Rotación', formatearNumero(cuerpo.fisica?.periodoRotacionHoras, 2), 'h'));
    lineas.push(dato('Incl. axial', formatearNumero(cuerpo.fisica?.inclinacionAxialGrados, 2), '°'));
    lineas.push(dato('Albedo', formatearNumero(cuerpo.fisica?.albedoGeometrico, 3)));

    if (cuerpo.orbita) {
      lineas.push('');
      lineas.push(dato('Periodo orbital', formatearNumero(cuerpo.orbita.periodoOrbitalDias, 2), 'd'));
      lineas.push(dato('Excentricidad', formatearNumero(cuerpo.orbita.excentricidad, 4)));
      lineas.push(dato('Inclinación', formatearNumero(cuerpo.orbita.inclinacionGrados, 3), '°'));
    }

    if (cuerpo.temperatura) {
      lineas.push('');
      const t = cuerpo.temperatura;
      if (t.minC !== null && t.maxC !== null) {
        lineas.push(dato('Temperatura', `${formatearNumero(t.minC)} a ${formatearNumero(t.maxC)}`, '°C'));
      } else {
        lineas.push(dato('Temp. media', formatearNumero(t.mediaC), '°C'));
      }
      if (t.nota) lineas.push(`  ${t.nota}`);
    }

    // La nota de temperatura ya está arriba: no se repite como dato.
    const yaDicho = (t) => Boolean(cuerpo.temperatura?.nota)
      && t.toLowerCase().startsWith(cuerpo.temperatura.nota.slice(0, 30).toLowerCase());

    if (datos?.length) {
      const mostrados = datos.filter((d) => !yaDicho(d.texto)).slice(0, MAX_DATOS);
      if (mostrados.length) {
        lineas.push('');
        lineas.push('── DATOS DE INTERÉS ──');
        for (const d of mostrados) {
          // Se parte a 46 caracteres sin romper palabras.
          for (const trozo of partir(`· ${d.texto}`, 46)) lineas.push(trozo);
          for (const trozo of partir(`  ↳ ${d.fuente}`, 46)) lineas.push(trozo);
        }
      }
    } else if (cuerpo.curiosidades?.length) {
      lineas.push('');
      lineas.push('── DATOS DE INTERÉS ──');
      for (const curiosidad of cuerpo.curiosidades) {
        for (const trozo of partir(`· ${curiosidad}`, 46)) lineas.push(trozo);
      }
    }

    lineas.push('');
    lineas.push(`Fuente: ${cuerpo.fuente ?? 'sin declarar'}`);
    return lineas;
  }

  /**
   * Muestra la ficha de un cuerpo con la aparición escalonada.
   *
   * Si el conocimiento del cuerpo aún no ha llegado, se pinta con lo del
   * catálogo y se vuelve a pintar cuando llega —casi siempre en unas decenas
   * de milisegundos, antes de que la escritura haya llegado a esa parte—.
   */
  mostrar(cuerpo) {
    this.detener();
    this.cuerpoMostrado = cuerpo;
    if (!cuerpo) return;

    const conocido = conocimientoEnMemoria(cuerpo.id);
    this._pintar(cuerpo, conocido?.datos ?? null);
    if (conocido === undefined) {
      cargarConocimiento(cuerpo.id).then((llegado) => {
        if (llegado?.datos?.length && this.cuerpoMostrado === cuerpo) this._pintar(cuerpo, llegado.datos);
      });
    }
  }

  _pintar(cuerpo, datos) {
    this.detener();
    const lineas = this._componer(cuerpo, datos);
    this.cuerpoTexto.replaceChildren();
    this.lineas = [];

    lineas.forEach((texto, indice) => {
      const nodo = crear('p', {
        class: 'arco__linea',
        dataset: { tipo: texto.startsWith('──') ? 'titulo' : 'dato' },
      });
      // La curvatura: cada línea se desplaza según su distancia al centro del
      // bloque, siguiendo un arco. Sin esto sería una columna recta.
      const centro = (lineas.length - 1) / 2;
      const t = (indice - centro) / centro;
      nodo.style.setProperty('--desplazamiento', `${(1 - Math.cos(t * 0.9)) * 46}px`);
      this.cuerpoTexto.append(nodo);
      this.lineas.push({ nodo, texto });
    });

    if (REDUCIR?.matches) {
      for (const { nodo, texto } of this.lineas) nodo.textContent = texto;
      return;
    }

    this._escribir();
  }

  /** Escribe carácter a carácter, línea a línea. */
  _escribir() {
    let indiceLinea = 0;
    let indiceCaracter = 0;

    const paso = () => {
      if (indiceLinea >= this.lineas.length) {
        this._temporizador = null;
        return;
      }

      const { nodo, texto } = this.lineas[indiceLinea];
      // Se escriben varios caracteres por tic: uno a uno resultaría lentísimo
      // en un bloque de ochocientos caracteres.
      indiceCaracter = Math.min(texto.length, indiceCaracter + 3);
      nodo.textContent = texto.slice(0, indiceCaracter);

      if (indiceCaracter >= texto.length) {
        nodo.dataset.completa = 'si';
        indiceLinea++;
        indiceCaracter = 0;
      }

      this._temporizador = setTimeout(paso, RITMO);
    };

    paso();
  }

  detener() {
    if (this._temporizador) clearTimeout(this._temporizador);
    this._temporizador = null;
  }

  establecerVisible(visible) {
    this.panel.dataset.oculto = visible ? 'no' : 'si';
    if (!visible) this.detener();
  }

  destruir() {
    this.detener();
    this.panel.remove();
  }
}

/** Parte un texto en líneas de como mucho `ancho` caracteres, sin cortar palabras. */
function partir(texto, ancho) {
  const palabras = texto.split(' ');
  const lineas = [];
  let actual = '';

  for (const palabra of palabras) {
    if ((actual + ' ' + palabra).trim().length > ancho) {
      if (actual) lineas.push(actual);
      actual = actual ? `  ${palabra}` : palabra;
    } else {
      actual = actual ? `${actual} ${palabra}` : palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}
