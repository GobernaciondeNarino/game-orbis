/**
 * Conocimiento publicado de cada cuerpo: narraciones y datos, con su fuente.
 *
 * Lo sirve api/conocimiento.php. Se pide la primera vez que hace falta un
 * cuerpo y se guarda en memoria —solo en memoria: la regla 6 prohíbe
 * localStorage— para el resto de la visita. La narración y la ficha de datos
 * lo usan a la vez; sin este módulo cada una lo pediría por su cuenta.
 *
 * Si el servidor no contesta, se devuelve null y cada quien sigue con lo que
 * trae el catálogo. El conocimiento amplía; nunca puede dejar a nadie sin
 * narración.
 */

import { rutaApi } from './rutas.js';

/** @type {Map<string, Promise<object|null>>} */
const pedidos = new Map();
/** @type {Map<string, object|null>} ya resueltos, para leerlos sin esperar */
const resueltos = new Map();

/** Lo que tarda como mucho antes de rendirse y usar el catálogo. */
const ESPERA_MS = 2500;

/**
 * El conocimiento de un cuerpo: { narraciones: [{texto, huella}],
 * datos: [{texto, fuente, url, tema, huella}] }, o null.
 */
export function cargarConocimiento(id) {
  if (!id) return Promise.resolve(null);
  if (pedidos.has(id)) return pedidos.get(id);

  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), ESPERA_MS);

  const pedido = fetch(`${rutaApi('conocimiento.php')}?cuerpo=${encodeURIComponent(id)}`, { signal: control.signal })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && Array.isArray(d.narraciones) && Array.isArray(d.datos) ? d : null))
    .catch(() => null)
    .then((d) => {
      clearTimeout(temporizador);
      resueltos.set(id, d);
      // Un fallo no se recuerda para siempre: la próxima vez se reintenta.
      if (!d) pedidos.delete(id);
      return d;
    });

  pedidos.set(id, pedido);
  return pedido;
}

/** Lo que ya haya llegado, sin esperar. undefined si aún no se ha pedido. */
export function conocimientoEnMemoria(id) {
  return resueltos.get(id);
}
