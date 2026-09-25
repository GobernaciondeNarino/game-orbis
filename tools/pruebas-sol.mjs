#!/usr/bin/env node
/**
 * ORBIS — Pruebas del shader de la superficie solar y de su corona.
 *
 * POR QUÉ NO SE COMPARAN CAPTURAS
 * ───────────────────────────────
 * Lo natural sería fotografiar el Sol dos veces y ver si cambió. Se intentó y
 * no vale: con render por software el mismo fotograma no sale igual dos veces
 * —el 99 % de los píxeles difieren incluso con la cámara inmóvil y la animación
 * parada—, así que la comparación da positivo siempre y no prueba nada. Peor
 * aún, comparar los BYTES del PNG es todavía más engañoso: la compresión los
 * revuelve enteros en cuanto cambia un píxel.
 *
 * Lo que sí se puede medir sin ambigüedad es la aritmética del shader, que es
 * donde de verdad está el efecto. El movimiento de la superficie es una función
 * pura del uniforme `tiempo`; comprobar cómo entra ese uniforme en cada campo,
 * y que las constantes del flujo están donde deben, dice más que cualquier
 * captura.
 *
 * QUÉ SE VIGILA
 * ─────────────
 *   · Que nada acumule desplazamiento. Es la trampa en la que ya se cayó una
 *     vez con la rotación diferencial: un desplazamiento que crece sin límite
 *     convierte la superficie en una cinta transportadora. Vale para el flujo
 *     del plasma, para las celdas de la granulación y para los rayos de la
 *     corona: el tiempo puede elegir el campo o mover un punto alrededor de su
 *     sitio, nunca sumarse a la posición donde se muestrea.
 *   · Que el flujo esté centrado en cero de verdad, no solo en apariencia.
 *   · Que la amplitud siga siendo sutil. Subiéndola, el Sol se ondula como agua.
 *   · Que `prefers-reduced-motion` congele el reloj, no que lo ralentice, y que
 *     ese mismo reloj gobierne la corona.
 *   · Que la corona y el destello se liberen, y que el destello no dependa del
 *     color de ningún píxel.
 *
 *   node tools/pruebas-sol.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const fuente = readFileSync(join(RAIZ, 'wj-includes/js/system/Sun.js'), 'utf8');

let fallos = 0;
const comprobar = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`  ${ok ? '✔' : '✘'} ${nombre}${ok ? '' : ` — esperado «${esperado}», obtenido «${real}»`}`);
};

/**
 * Cuerpo de una función GLSL o JS: desde su firma hasta la llave que la cierra.
 * Se cuentan llaves en lugar de buscar la siguiente firma, que dependería del
 * orden en que estén escritas.
 */
function cuerpoDe(firma) {
  const inicio = fuente.indexOf(firma);
  if (inicio < 0) return '';
  const abre = fuente.indexOf('{', inicio);
  let nivel = 0;
  for (let i = abre; i < fuente.length; i++) {
    if (fuente[i] === '{') nivel++;
    else if (fuente[i] === '}' && --nivel === 0) return fuente.slice(abre, i + 1);
  }
  return '';
}

console.log('\n▸ El flujo del plasma existe y se genera con mezclaTemporal');
{
  // mezclaTemporal es lo que garantiza que el campo evolucione EN SU SITIO en
  // lugar de desplazarse. Si el flujo se generase con `turbulencia(p + tiempo)`
  // —la forma ingenua— la superficie acabaría corriendo hacia un lado para
  // siempre, que es exactamente el fallo que la rotación diferencial ya provocó.
  comprobar('se declara el campo de flujo', /vec3 flujo = vec3\(/.test(fuente), true);

  const bloque = fuente.slice(fuente.indexOf('vec3 flujo = vec3('), fuente.indexOf('vec3 pSuper'));
  comprobar('sus tres componentes usan mezclaTemporal',
    (bloque.match(/mezclaTemporal\(/g) ?? []).length, 3);
  comprobar('ninguna suma el tiempo a la posición', /pGirado[^;]*\+\s*tiempo/.test(bloque), false);

  // Centrado en cero: si no se restara 0,5, el campo sería siempre positivo y
  // arrastraría todo hacia la misma esquina.
  comprobar('al campo se le resta 0,5', /\)\s*-\s*0\.5;/.test(bloque), true);

  // Y restar 0,5 solo centra si el ruido tiene media 0,5. Con una octava sin
  // normalizar daba valores entre 0 y 0,5, y el flujo quedaba entero en
  // negativo: la resta estaba, el centrado no.
  const turbulencia = cuerpoDe('float turbulencia(vec3 p, int octavas)');
  comprobar('la turbulencia se normaliza por la suma de amplitudes',
    /return\s+suma\s*\/\s*total\s*;/.test(turbulencia), true);
}

console.log('\n▸ La deformación es sutil, y la supergranulación menos que el grano');
{
  const sup = fuente.match(/pSuper = pGirado \+ flujo \* ([\d.]+)/);
  const gra = fuente.match(/pGrano = pGirado \+ flujo \* ([\d.]+)/);
  comprobar('se deforma la supergranulación', sup !== null, true);
  comprobar('se deforma la granulación', gra !== null, true);

  const amplitudSuper = Number(sup?.[1]);
  const amplitudGrano = Number(gra?.[1]);
  const escalaGrano = Number(fuente.match(/ESCALA_GRANO = ([\d.]+)/)?.[1]);
  console.log(`     supergranulación ${amplitudSuper} · granulación ${amplitudGrano}`);

  // Las celdas grandes empujan; no son las empujadas.
  comprobar('la grande se deforma menos que la fina', amplitudSuper < amplitudGrano, true);
  // Por encima de 0,25 la superficie deja de parecer una estrella.
  comprobar('la amplitud se mantiene sutil', amplitudGrano <= 0.25, true);
  comprobar('y no es cero', amplitudGrano > 0, true);
  // El flujo va de -0,5 a 0,5: como mucho desplaza medio flujo × amplitud, y
  // medido en gránulos eso tiene que quedarse por debajo de media celda. Más,
  // y los gránulos se deshilachan en lugar de escurrirse.
  const celdasDesplazadas = 0.5 * amplitudGrano * escalaGrano;
  console.log(`     desplazamiento máximo: ${celdasDesplazadas.toFixed(2)} gránulos`);
  comprobar('el flujo no mueve un gránulo más de media celda', celdasDesplazadas < 0.5, true);
}

console.log('\n▸ Los ritmos conservan su orden: flujo < supergranulación < granulación');
{
  // Un campo de arrastre que cambiara más deprisa que lo arrastrado se vería
  // como ruido, no como corriente; y la supergranulación real vive días,
  // frente a los minutos de un gránulo.
  const flujo = Number(fuente.match(/ritmoFlujo = tiempo \* ([\d.]+)/)?.[1]);
  const grano = Number(fuente.match(/ritmoGrano = tiempo \* ([\d.]+) \* ritmoLatitud/)?.[1]);
  const superg = Number(fuente.match(/ritmoSuper = tiempo \* ([\d.]+) \* ritmoLatitud/)?.[1]);
  console.log(`     flujo ${flujo} · supergranulación ${superg} · granulación ${grano}`);
  comprobar('el flujo va más lento que la supergranulación', flujo < superg, true);
  comprobar('la supergranulación va más lenta que la granulación', superg < grano, true);
}

console.log('\n▸ La granulación es celular y evoluciona EN SU SITIO');
{
  const celdas = cuerpoDe('vec3 celdas(vec3 p, float t)');
  comprobar('existe el campo celular (Worley)', celdas.length > 0, true);

  // La posición de muestreo es p, y solo p: la celda base y la fracción salen
  // de ella sin que el tiempo intervenga.
  comprobar('la celda base sale de p sin tiempo', /floor\(p\)/.test(celdas), true);
  comprobar('la fracción sale de p sin tiempo', /fract\(p\)/.test(celdas), true);
  comprobar('el tiempo no se suma a la posición',
    /\bp\s*[+-]=?\s*t\b|\bt\s*\+\s*p\b|\bf\s*[+-]=?\s*t\b/.test(celdas), false);

  // El tiempo solo puede aparecer dentro de un seno: mueve cada punto en una
  // órbita acotada alrededor de su sitio. Un seno no acumula; una suma, sí.
  const usosDeT = [...celdas.matchAll(/\bt\b/g)].length;
  const dentroDeSeno = [...celdas.matchAll(/sin\([^;]*\bt\b[^;]*\)/g)].length;
  comprobar('el tiempo solo entra dentro de un seno', usosDeT > 0 && usosDeT === dentroDeSeno, true);

  // Vecindario de 3×3×3: con puntos que se acercan al borde de su celda, uno
  // menor deja cortes rectos en el patrón.
  comprobar('recorre un vecindario de 3×3×3',
    (celdas.match(/for \(int [ijk] = -1; [ijk] <= 1; [ijk]\+\+\)/g) ?? []).length, 3);

  // Los surcos son F2 − F1: cero justo en la frontera entre celdas.
  comprobar('los surcos salen de F2 − F1', /frontera = g\.y - g\.x/.test(fuente), true);

  // Y al llamarlo, el primer argumento es una posición: ni tiempo ni ritmo.
  const llamadas = [...fuente.matchAll(/celdas\(([^,]+),\s*([^)]+)\)/g)]
    .filter((m) => !m[1].includes('vec3 p'));
  comprobar('se usa para la granulación y la supergranulación', llamadas.length, 2);
  comprobar('ninguna llamada mete el tiempo en la posición',
    llamadas.some((m) => /tiempo|ritmo/.test(m[1])), false);
}

console.log('\n▸ Las fáculas siguen la red y solo destacan hacia el limbo');
{
  // En luz blanca las fáculas casi no se ven en el centro del disco. Si su
  // brillo no dependiera de mu, serían una red luminosa uniforme que el Sol
  // real no enseña.
  comprobar('dependen de la red de la supergranulación', /faculas = red \*/.test(fuente), true);
  comprobar('y de la cercanía al limbo', /cercaLimbo = smoothstep\([^;]*mu\)/.test(fuente), true);
}

console.log('\n▸ El movimiento reducido CONGELA el reloj, no lo ralentiza');
{
  // Medido en Chromium: con prefers-reduced-motion el uniforme se queda en
  // 0,000 después de seis segundos, frente a 1,667 sin la preferencia.
  comprobar('el reloj solo avanza sin la preferencia',
    /if \(!MOVIMIENTO_REDUCIDO\?\.matches\) this\._tiempo \+= delta;/.test(fuente), true);
  comprobar('la consulta se declara una sola vez',
    (fuente.match(/matchMedia\?\.\(/g) ?? []).length, 1);
  // La corona usa el MISMO reloj: si tuviera uno propio, podría seguir
  // moviéndose con la preferencia activada.
  comprobar('la corona toma el reloj congelable',
    /materialCorona\.uniforms\.tiempo\.value = this\._tiempo;/.test(fuente), true);
}

console.log('\n▸ Sigue sin cizallarse el mapa con la rotación diferencial');
{
  // El comentario que explica por qué no se hace vale más que el código que no
  // está: sin él, alguien lo intentaría otra vez.
  comprobar('el aviso sigue escrito', /NO se cizalla el mapa con la rotación/.test(fuente), true);
  comprobar('las constantes de Snodgrass siguen ahí', /OMEGA_A = 14\.713/.test(fuente), true);
}

console.log('\n▸ La corona: perfil de Baumbach, sin silueta y liberada al destruir');
{
  const crear = cuerpoDe('_crearCorona() {');
  comprobar('es un ShaderMaterial registrado en el gestor',
    /this\.gestor\.registrar\(\s*new THREE\.ShaderMaterial\(/.test(crear), true);
  comprobar('se mezcla en modo aditivo', /blending: THREE\.AdditiveBlending/.test(crear), true);
  comprobar('no escribe profundidad', /depthWrite: false/.test(crear), true);
  comprobar('la geometría también se registra',
    /this\.gestor\.registrar\(new THREE\.PlaneGeometry/.test(crear), true);

  // Los coeficientes de Baumbach (1937): si alguien los «ajusta», el perfil
  // deja de ser el publicado.
  comprobar('usa el perfil radial de Baumbach',
    /0\.0532 \* pow\(r, -2\.5\) \+ 1\.425 \* pow\(r, -7\.0\) \+ 2\.565 \* pow\(r, -17\.0\)/.test(fuente), true);

  // Sin silueta: el brillo tiene que llegar a cero antes del borde del
  // rectángulo, o se ve el cuadrado.
  const borde = fuente.match(/borde = 1\.0 - smoothstep\(extension \* ([\d.]+), extension \* ([\d.]+)/);
  comprobar('el brillo se apaga antes del borde', borde !== null && Number(borde[2]) < 1, true);

  // Los rayos dependen solo de la dirección, no del radio: así son radiales.
  comprobar('los rayos se muestrean solo con la dirección',
    /mezclaTemporal\(vec3\(direccion \*/.test(fuente), true);

  const destruir = cuerpoDe('destruir() {');
  comprobar('destruir() libera la geometría de la corona', /this\.corona\.geometry\.dispose\(\)/.test(destruir), true);
  comprobar('destruir() libera el material de la corona', /this\.corona\.material\.dispose\(\)/.test(destruir), true);
}

console.log('\n▸ El destello de lente no depende del color de ningún píxel');
{
  // El Lensflare de three.js decide su visibilidad leyendo píxeles tras una
  // prueba de profundidad que, con el búfer logarítmico, nunca sale bien: con
  // la granulación hirviendo, parpadeaba y a ratos tapaba el Sol de blanco.
  comprobar('no se usa el Lensflare de three.js', /Lensflare/.test(fuente.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), false);
  comprobar('se oculta cuando el Sol llena la pantalla', /radioAparente/.test(cuerpoDe('_colocarDestello(renderizador, camara) {')), true);
  comprobar('un cuerpo delante lo apaga', /intersectObject\(/.test(cuerpoDe('_colocarDestello(renderizador, camara) {')), true);
  const destruir = cuerpoDe('destruir() {');
  comprobar('destruir() libera sus materiales', /malla\.material\.dispose\(\)/.test(destruir), true);
}

console.log(fallos ? `\n✘ ${fallos} comprobación(es) fallida(s)\n` : '\n✔ Todas las comprobaciones pasan\n');
process.exit(fallos ? 1 : 0);
