/**
 * Medición de uso, por el servidor de ORBIS y NUNCA directamente a Google.
 *
 * El navegador le cuenta a api/evento.php qué ha pasado y es el servidor quien
 * se lo manda a Google Analytics con el Measurement Protocol. Así la página no
 * carga ni una línea de código de Google (regla 2 del proyecto, y la CSP lo
 * impediría), no pone cookies, y el secreto de la API se queda en el servidor.
 * El porqué completo está en wj-includes/lib/Analitica.php.
 *
 * LO QUE NO SE GUARDA EN NINGÚN SITIO. El identificador de cliente y el de
 * sesión se inventan al cargar la página y viven en memoria: al recargar, son
 * otros. No hay forma de seguir a nadie de una visita a la siguiente, y es a
 * propósito —el público de ORBIS son niños—.
 *
 * QUIÉN NO ENVÍA NADA:
 *   · los navegadores con Global Privacy Control o «No rastrear» activados;
 *   · cualquiera, si el servidor dice que Analytics no está configurado: la
 *     primera respuesta lo avisa con una cabecera y a partir de ahí se calla.
 *
 * Medir nunca puede molestar: se envía con sendBeacon, que no espera respuesta
 * ni retrasa nada, y cualquier fallo se ignora en silencio.
 */

import { rutaApi } from './rutas.js';

const pideNoSerSeguido = navigator.globalPrivacyControl === true
  || navigator.doNotTrack === '1'
  || window.doNotTrack === '1';

let activa = !pideNoSerSeguido;

/** Número aleatorio de nueve cifras, con la aleatoriedad del sistema. */
function nueveCifras() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100_000_000 + (a[0] % 900_000_000));
}

const ahora = Math.floor(Date.now() / 1000);
// El mismo formato que usa gtag.js («aleatorio.marca_de_tiempo»), que es el que
// entienden los informes de GA4. El servidor lo valida con esa forma exacta.
const cliente = `${nueveCifras()}.${ahora}`;
const sesion = String(ahora);

function dispositivo() {
  const tactil = window.matchMedia?.('(pointer: coarse)')?.matches;
  const lado = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 768);
  if (!tactil) return 'desktop';
  return lado < 600 ? 'mobile' : 'tablet';
}

function cuerpoDelEvento(nombre, params) {
  const idioma = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(navigator.language ?? '') ? navigator.language : '';
  return JSON.stringify({ nombre, cliente, sesion, params, dispositivo: dispositivo(), idioma });
}

/**
 * Empieza la medición con la vista de página. Es la única petición que espera
 * respuesta: de ella sale si Analytics está configurado o no.
 */
export async function iniciarAnalitica() {
  if (!activa) return;
  try {
    const r = await fetch(rutaApi('evento.php'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: cuerpoDelEvento('page_view', { page_title: document.title }),
      keepalive: true,
    });
    if (r.headers.get('X-Orbis-Analitica') === 'inactiva') activa = false;
  } catch {
    // Sin red o sin endpoint: se deja de intentar en esta visita.
    activa = false;
  }
}

/**
 * Cuenta un evento. Solo los de la lista cerrada del servidor (lib/Analitica.php)
 * llegan a Google; cualquier otro se descarta allí.
 */
export function medir(nombre, params = {}) {
  if (!activa) return;
  try {
    const cuerpo = new Blob([cuerpoDelEvento(nombre, params)], { type: 'application/json' });
    if (!navigator.sendBeacon?.(rutaApi('evento.php'), cuerpo)) {
      fetch(rutaApi('evento.php'), { method: 'POST', body: cuerpo, keepalive: true }).catch(() => {});
    }
  } catch {
    // Medir no puede romper nada.
  }
}
