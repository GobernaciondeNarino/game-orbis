#!/usr/bin/env node
/**
 * ORBIS — Pruebas de los cuerpos: atmósferas, relieve, forma, acoplamiento por
 * marea, anillos y cinturones.
 *
 * Casi todo lo que se vigila aquí son ACUERDOS entre piezas que viven en sitios
 * distintos, que es donde se rompen las cosas en silencio:
 *
 *   · Qué cuerpos tienen atmósfera lo dice el catálogo; cómo se ve, atmosfera.js.
 *     Si el catálogo añade una y nadie decide su aspecto, no debe aparecer un
 *     halo de color inventado: debe verse aquí.
 *   · El relieve reutiliza el mapa de color. Al cambiarlo por el de resolución
 *     completa hay que cambiar los dos, y liberar el viejo UNA vez.
 *   · La forma triaxial sale de la procedencia del radio (JPL Horizons). Si
 *     el texto cambia de formato, el cuerpo volvería a ser una esfera sin que
 *     nadie se enterase.
 *   · Los shaders enganchados con onBeforeCompile buscan un trozo de código de
 *     three.js por su nombre. Si un día se renombra, `replace` no encuentra
 *     nada, no falla, y el efecto desaparece. Se comprueba contra el three.js
 *     vendorizado.
 *
 * Como pruebas-galaxia.mjs, importa los módulos de verdad con el three.js
 * vendorizado; los shaders se revisan como texto.
 *
 *   node tools/pruebas-cuerpos.mjs
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (ruta) => readFileSync(join(RAIZ, ruta), 'utf8');

const URL_THREE = pathToFileURL(join(RAIZ, 'wj-includes/externos/three/build/three.module.min.js')).href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(especificador, contexto, siguiente) {
    if (especificador === 'three') return { url: ${JSON.stringify(URL_THREE)}, shortCircuit: true };
    return siguiente(especificador, contexto);
  }
`));

const preferencia = { matches: false };
globalThis.window = { matchMedia: () => preferencia };

const THREE = await import('three');
const importar = (ruta) => import(pathToFileURL(join(RAIZ, ruta)).href);
const { CelestialBody, semiejesTriaxiales, acopladoPorMarea } = await importar('wj-includes/js/system/CelestialBody.js');
const { Earth } = await importar('wj-includes/js/system/Earth.js');
const { Rings } = await importar('wj-includes/js/system/Rings.js');
const { AsteroidBelt } = await importar('wj-includes/js/system/AsteroidBelt.js');
const { APARIENCIA_ATMOSFERICA } = await importar('wj-includes/js/system/atmosfera.js');

const catalogo = JSON.parse(leer('wj-content/data/sistema-solar.json'));
const porId = new Map(catalogo.cuerpos.map((c) => [c.id, c]));

let fallos = 0;
const comprobar = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`  ${ok ? '✔' : '✘'} ${nombre}${ok ? '' : ` — esperado «${esperado}», obtenido «${real}»`}`);
};

/** Gestor de escena falso: registra, y carga texturas «ya descargadas». */
function crearGestor() {
  const texturas = [];
  return {
    texturas,
    registrar: (x) => x,
    cargarTextura: (ruta) => {
      const t = new THREE.Texture();
      t.image = { width: 1, height: 1 };
      t.userData.ruta = ruta;
      t.userData.liberada = 0;
      t.addEventListener('dispose', () => t.userData.liberada++);
      texturas.push(t);
      return t;
    },
  };
}

console.log('\n▸ Atmósferas: cada una del catálogo tiene su aspecto decidido');
{
  const conAtmosfera = catalogo.cuerpos.filter((c) => c.atmosfera).map((c) => c.id);
  console.log(`     en el catálogo: ${conAtmosfera.join(', ')}`);
  const sinDecidir = conAtmosfera.filter((id) => !(id in APARIENCIA_ATMOSFERICA));
  comprobar('ninguna atmósfera del catálogo queda sin decidir', sinDecidir.join(', '), '');
  const inventadas = Object.keys(APARIENCIA_ATMOSFERICA).filter((id) => !porId.get(id)?.atmosfera);
  comprobar('ningún halo para un cuerpo sin atmósfera en el catálogo', inventadas.join(', '), '');
  comprobar('Mercurio, con exosfera, no lleva halo', APARIENCIA_ATMOSFERICA.mercurio, null);
  comprobar('los grosores son finos (menos de un 15 % del radio)',
    Object.values(APARIENCIA_ATMOSFERICA).filter(Boolean).every((a) => a.espesor > 0 && a.espesor < 0.15), true);

  const gestor = crearGestor();
  const venus = new CelestialBody(porId.get('venus'), gestor);
  const mercurio = new CelestialBody(porId.get('mercurio'), gestor);
  const luna = new CelestialBody(porId.get('luna'), gestor);
  comprobar('Venus tiene su capa', Boolean(venus.atmosfera), true);
  comprobar('Mercurio no', Boolean(mercurio.atmosfera), false);
  comprobar('la Luna, sin atmósfera en el catálogo, tampoco', Boolean(luna.atmosfera), false);

  // La Tierra ya no dibuja su propio cascarón: usa el común, y solo uno.
  const tierra = new Earth(porId.get('tierra'), gestor);
  const capas = tierra.ejeInclinado.children.filter((o) => o.name === 'atmosfera');
  comprobar('la Tierra tiene exactamente un halo, el común', capas.length, 1);
  comprobar('con el color que ya tenía', `#${capas[0]?.material.uniforms.color.value.getHexString()}`, '#4a90e2');

  const fuenteAtm = leer('wj-includes/js/system/atmosfera.js');
  comprobar('el halo solo brilla del lado del Sol (en el origen)', /haciaSol = normalize\(-vCentro\)/.test(fuenteAtm), true);
  comprobar('y llega a cero antes del borde de la esfera', /1\.0 - smoothstep\([\d.]+, 1\.0, altura\)/.test(fuenteAtm), true);

  let liberados = 0;
  venus.atmosfera.malla.geometry.addEventListener('dispose', () => liberados++);
  venus.atmosfera.malla.material.addEventListener('dispose', () => liberados++);
  venus.destruir();
  comprobar('destruir() libera la geometría y el material del halo', liberados, 2);
}

console.log('\n▸ Relieve: solo en superficies sólidas, y se cambia con el mapa');
{
  const gestor = crearGestor();
  const conRelieve = (id) => Boolean(new CelestialBody(porId.get(id), gestor).malla.material.bumpMap);
  comprobar('Mercurio tiene relieve', conRelieve('mercurio'), true);
  comprobar('la Luna tiene relieve', conRelieve('luna'), true);
  comprobar('Júpiter, sin superficie sólida, no', conRelieve('jupiter'), false);
  comprobar('Venus, cuyo mapa son nubes, no', conRelieve('venus'), false);
  comprobar('Ceres, con rótulos impresos en el mapa, no', conRelieve('ceres'), false);
  comprobar('Oberón, con medio mapa sin fotografiar, no', conRelieve('oberon'), false);

  const luna = new CelestialBody(porId.get('luna'), gestor);
  const material = luna.malla.material;
  const reducida = material.map;
  comprobar('relieve y color son la MISMA textura', material.bumpMap === reducida, true);
  comprobar('y es la reducida', /@512\.jpg$/.test(reducida.userData.ruta), true);
  luna.mejorarTextura();
  comprobar('al mejorar, el color pasa a la completa', material.map !== reducida && !/@512/.test(material.map.userData.ruta), true);
  comprobar('y el relieve también', material.bumpMap === material.map, true);
  comprobar('la reducida se libera exactamente una vez', reducida.userData.liberada, 1);
  const completa = material.map;
  luna.destruir();
  comprobar('destruir() libera la completa una sola vez', completa.userData.liberada, 1);
}

console.log('\n▸ Forma triaxial: la del catálogo, y solo si está');
{
  const conSemiejes = catalogo.cuerpos.filter((c) => semiejesTriaxiales(c)).map((c) => c.id);
  console.log(`     con semiejes de JPL en el catálogo: ${conSemiejes.join(', ')}`);
  comprobar('Fobos y Deimos los tienen', conSemiejes.includes('fobos') && conSemiejes.includes('deimos'), true);

  const gestor = crearGestor();
  const fobos = new CelestialBody(porId.get('fobos'), gestor);
  const { a, b, c } = semiejesTriaxiales(porId.get('fobos'));
  const medio = Math.cbrt(a * b * c);
  console.log(`     Fobos: ${a} × ${b} × ${c} km · radio medio ${medio.toFixed(2)} km (catálogo ${porId.get('fobos').fisica.radioMedioKm} km)`);
  comprobar('el radio medio del catálogo es la media geométrica', Math.abs(medio - porId.get('fobos').fisica.radioMedioKm) < 0.01, true);
  const escala = fobos.malla.scale;
  comprobar('eje largo en X', Math.abs(escala.x - a / medio) < 1e-9, true);
  comprobar('eje corto en Y, el de giro', Math.abs(escala.y - c / medio) < 1e-9, true);
  comprobar('el volumen no cambia', Math.abs(escala.x * escala.y * escala.z - 1) < 1e-9, true);

  // Haumea es famosa por su forma alargada, pero el catálogo no trae sus
  // semiejes: se queda esfera. No se inventa.
  comprobar('Haumea, sin semiejes en el catálogo, sigue siendo una esfera',
    new CelestialBody(porId.get('haumea'), gestor).malla.scale.equals(new THREE.Vector3(1, 1, 1)), true);
}

console.log('\n▸ Acoplamiento por marea: la longitud 0 mira al planeta');
{
  comprobar('la Luna está acoplada (pese al 1,4 % entre sus dos periodos)', acopladoPorMarea(porId.get('luna')), true);
  comprobar('Fobos está acoplada', acopladoPorMarea(porId.get('fobos')), true);
  comprobar('un planeta no', acopladoPorMarea(porId.get('marte')), false);

  const gestor = crearGestor();
  for (const [idPadre, idLuna] of [['tierra', 'luna'], ['marte', 'fobos']]) {
    const padre = new CelestialBody(porId.get(idPadre), gestor);
    const satelite = new CelestialBody(porId.get(idLuna), gestor);
    padre.anadirSatelite(satelite, porId.get(idLuna).orbita, porId.get(idLuna).render.distanciaEscalada, new THREE.Color());
    const angulos = [];
    for (const dias of [0, 3.3, 11.7, 250.2]) {
      padre.actualizar(new Date(Date.UTC(2026, 8, 25) + dias * 86_400_000));
      padre.pivote.updateMatrixWorld(true);
      const eje = new THREE.Vector3(1, 0, 0).transformDirection(satelite.malla.matrixWorld);
      const haciaPadre = padre.posicionMundial().sub(satelite.posicionMundial()).normalize();
      angulos.push(THREE.MathUtils.radToDeg(eje.angleTo(haciaPadre)));
    }
    console.log(`     ${idLuna}: ${angulos.map((x) => `${x.toFixed(1)}°`).join(' · ')}`);
    // La Luna se desvía por su libración (excentricidad) y por su inclinación
    // axial de 6,7°; ninguna debería pasar de unos 15°.
    comprobar(`${idLuna} enseña siempre la misma cara a su planeta`, angulos.every((x) => x < 15), true);
  }
}

console.log('\n▸ Anillos: iluminados, con la sombra del planeta, y liberados');
{
  const gestor = crearGestor();
  const saturno = porId.get('saturno');
  const anillos = new Rings(saturno.render.anillos, 3, gestor, saturno.fisica.albedoGeometrico);
  const u = anillos.material.uniforms;
  comprobar('ya no es un material sin luz', anillos.material.isShaderMaterial && !anillos.material.isMeshBasicMaterial, true);
  comprobar('la tira sigue haciendo de alphaMap', u.alphaMap.value === u.mapa.value && u.mapa.value !== null, true);
  comprobar('los de Saturno son fotografía, no SIMULACIÓN', anillos.esSimulacion, false);
  comprobar('el albedo del planeta sale del catálogo', u.albedoPlaneta.value, saturno.fisica.albedoGeometrico);

  const uv = anillos.malla.geometry.attributes.uv;
  const pos = anillos.malla.geometry.attributes.position;
  let uvOk = true;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    const esperado = (r - anillos.interno) / (anillos.externo - anillos.interno);
    if (Math.abs(uv.getX(i) - esperado) > 1e-5) uvOk = false;
  }
  comprobar('U sigue siendo la distancia normalizada al centro', uvOk, true);

  const urano = new Rings(porId.get('urano').render.anillos, 2, gestor);
  comprobar('los de Urano, sin mapa, siguen siendo SIMULACIÓN', urano.esSimulacion, true);

  const fuenteAnillos = leer('wj-includes/js/system/Rings.js');
  comprobar('la sombra lanza un rayo hacia el Sol contra la esfera del planeta',
    /float b = dot\(aCentro, haciaSol\);/.test(fuenteAnillos) && /b > 0\.0 \? smoothstep\(radio/.test(fuenteAnillos), true);
  comprobar('hay retrodispersión y dispersión hacia delante',
    /oposicion = 1\.0 \+/.test(fuenteAnillos) && /adelante = pow\(max\(-cosFase/.test(fuenteAnillos), true);

  const mapa = u.mapa.value;
  anillos.destruir();
  comprobar('destruir() libera la tira una sola vez (mapa y alphaMap)', mapa.userData.liberada, 1);

  // Y la sombra de los anillos sobre el planeta, enganchada al material.
  const planeta = new CelestialBody(saturno, gestor);
  const nuevos = new Rings(saturno.render.anillos, planeta.radio, gestor, 0.47);
  planeta.recibirSombraDeAnillos(nuevos);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  planeta.malla.material.onBeforeCompile(shader);
  comprobar('el planeta recibe la sombra de los anillos', /luzTrasAnillos\(\)/.test(shader.fragmentShader), true);
  comprobar('multiplicando solo la luz directa',
    /reflectedLight\.directDiffuse \*= luzAnillos/.test(shader.fragmentShader), true);
  comprobar('con la tira de los anillos', shader.uniforms.mapaAnillos.value === nuevos.mapa, true);
}

console.log('\n▸ Los enganches de onBeforeCompile existen en este three.js');
{
  // Si three.js renombra uno de estos trozos, el `replace` no encuentra nada y
  // el efecto desaparece sin un solo error. Por eso se comprueban aquí.
  const vertice = THREE.ShaderLib.standard.vertexShader;
  const fragmento = THREE.ShaderLib.standard.fragmentShader;
  for (const ancla of ['#include <common>', '#include <begin_vertex>']) {
    comprobar(`el vértice estándar tiene «${ancla}»`, vertice.includes(ancla), true);
  }
  for (const ancla of ['#include <common>', '#include <lights_fragment_end>']) {
    comprobar(`el fragmento estándar tiene «${ancla}»`, fragmento.includes(ancla), true);
  }
}

console.log('\n▸ Cinturones: piedras irregulares que giran, todo en el shader');
{
  const gestor = crearGestor();
  const datos = porId.get('cinturon-asteroides');
  const cinturon = new AsteroidBelt(datos, gestor);
  const g = cinturon.malla.geometry;
  comprobar('una instancia por asteroide del catálogo', g.instanceCount, datos.render.instancias);
  comprobar('cada instancia lleva órbita, giro y forma',
    ['aOrbita', 'aGiro', 'aForma'].every((n) => g.attributes[n]?.count === datos.render.instancias), true);

  const giro = g.attributes.aGiro.array;
  let periodosOk = true;
  for (let i = 0; i < datos.render.instancias; i++) {
    const periodo = (2 * Math.PI) / giro[i * 4 + 3];
    if (periodo < 2.2 - 1e-6 || periodo > 24 + 1e-6) periodosOk = false;
  }
  comprobar('periodos entre la barrera de 2,2 h y un día', periodosOk, true);

  const forma = g.attributes.aForma.array;
  let esferas = 0;
  for (let i = 0; i < datos.render.instancias; i++) {
    if (forma[i * 4] === forma[i * 4 + 1] && forma[i * 4] === forma[i * 4 + 2]) esferas++;
  }
  comprobar('ninguna piedra es una esfera escalada', esferas, 0);

  const versiones = ['aOrbita', 'aGiro', 'aForma'].map((n) => g.attributes[n].version);
  for (let i = 0; i < 50; i++) cinturon.actualizar(0.5);
  comprobar('avanzar no reescribe ningún búfer',
    ['aOrbita', 'aGiro', 'aForma'].every((n, k) => g.attributes[n].version === versiones[k]), true);
  comprobar('los días simulados llegan al shader', cinturon.uniformes.diasOrbita.value, 25);

  const antes = cinturon.uniformes.horasGiro.value;
  cinturon.actualizar(1000);
  const salto = cinturon.uniformes.horasGiro.value - antes;
  comprobar('a velocidad enorme el giro se acota por fotograma (no es ruido)', salto > 0 && salto < 1, true);

  preferencia.matches = true;
  const giroQuieto = cinturon.uniformes.horasGiro.value;
  const dias = cinturon.uniformes.diasOrbita.value;
  for (let i = 0; i < 10; i++) cinturon.actualizar(0.5);
  comprobar('con movimiento reducido el giro se congela', cinturon.uniformes.horasGiro.value, giroQuieto);
  comprobar('pero la órbita sigue al reloj simulado', cinturon.uniformes.diasOrbita.value, dias + 5);
  preferencia.matches = false;

  let liberados = 0;
  g.addEventListener('dispose', () => liberados++);
  cinturon.malla.material.addEventListener('dispose', () => liberados++);
  cinturon.destruir();
  comprobar('destruir() libera geometría y material', liberados, 2);
  comprobar('sigue siendo SIMULACIÓN', cinturon.esSimulacion, true);
}

console.log(fallos ? `\n✘ ${fallos} comprobación(es) fallida(s)\n` : '\n✔ Todas las comprobaciones pasan\n');
process.exit(fallos ? 1 : 0);
