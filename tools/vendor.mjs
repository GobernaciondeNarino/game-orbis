#!/usr/bin/env node
/**
 * ORBIS — Vendorizador de dependencias.
 *
 * Descarga a /vendor una copia local de Three.js y sus addons, resolviendo de
 * forma recursiva los imports relativos de cada addon. Se ejecuta SOLO en
 * desarrollo: producción (Plesk/Apache) sirve el resultado como estáticos.
 *
 *   node tools/vendor.mjs            # three + mediapipe
 *   node tools/vendor.mjs three      # solo three
 *   node tools/vendor.mjs fuentes    # solo las fuentes (regenera css/fuentes.css)
 *   node tools/vendor.mjs mediapipe  # solo mediapipe (wasm + modelo)
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// Versiones fijadas. Ver docs/README.md §"Versiones fijadas" para el porqué.
const THREE = '0.184.0';
const MEDIAPIPE = '0.10.35';
const CDN = 'https://unpkg.com';

// Puntos de entrada de addons que usa ORBIS. Sus imports relativos
// (Pass.js, shaders, etc.) se descubren y descargan solos.
const ADDONS = [
  'controls/OrbitControls.js',
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/OutputPass.js',
  'postprocessing/ShaderPass.js',
  'renderers/CSS2DRenderer.js',
  'libs/stats.module.js',
];

let descargados = 0;

async function bajar(url, destino) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  const cuerpo = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, cuerpo);
  descargados++;
  console.log(`  ✓ ${destino.replace(RAIZ + '/', '')} (${(cuerpo.length / 1024).toFixed(0)} kB)`);
  return cuerpo.toString('utf8');
}

/** Extrae las rutas relativas importadas por un módulo ES. */
function importsRelativos(codigo) {
  const rutas = new Set();
  const re = /(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(codigo))) rutas.add(m[1]);
  return [...rutas];
}

/**
 * Descarga un archivo del paquete de Three.js y, recursivamente, todo lo que
 * importe por ruta relativa. Es lo que evita listar a mano las dependencias
 * internas: three.module.min.js importa three.core.min.js, EffectComposer
 * importa Pass.js y CopyShader.js, UnrealBloomPass importa dos shaders más…
 *
 * @param {string} ruta   ruta dentro del paquete, p. ej. 'build/three.module.min.js'
 * @param {Set<string>} vistos  acumulador para no descargar dos veces lo mismo
 */
async function archivoThree(ruta, vistos) {
  if (vistos.has(ruta)) return;
  vistos.add(ruta);

  // examples/jsm/ se vendoriza como addons/ para que el importmap quede corto.
  const destino = ruta.startsWith('examples/jsm/')
    ? join(RAIZ, 'vendor/three/addons', ruta.slice('examples/jsm/'.length))
    : join(RAIZ, 'vendor/three', ruta);

  const codigo = await bajar(`${CDN}/three@${THREE}/${ruta}`, destino);

  for (const rel of importsRelativos(codigo)) {
    await archivoThree(posix.normalize(posix.join(posix.dirname(ruta), rel)), vistos);
  }
}

async function vendorThree() {
  console.log(`\n▸ Three.js r${THREE}`);
  const vistos = new Set();
  await archivoThree('build/three.module.min.js', vistos);
  for (const a of ADDONS) await archivoThree(`examples/jsm/${a}`, vistos);
}

async function vendorMediapipe() {
  console.log(`\n▸ MediaPipe Tasks Vision ${MEDIAPIPE}`);
  const base = `${CDN}/@mediapipe/tasks-vision@${MEDIAPIPE}`;
  await bajar(`${base}/vision_bundle.mjs`, join(RAIZ, 'vendor/mediapipe/vision_bundle.mjs'));
  for (const f of [
    'wasm/vision_wasm_internal.js',
    'wasm/vision_wasm_internal.wasm',
    'wasm/vision_wasm_nosimd_internal.js',
    'wasm/vision_wasm_nosimd_internal.wasm',
  ]) {
    await bajar(`${base}/${f}`, join(RAIZ, 'vendor/mediapipe', f));
  }
  // Modelos, alojados localmente (nunca desde el CDN de Google en producción).
  await bajar(
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    join(RAIZ, 'wj-content/assets/models/hand_landmarker.task'),
  );
  // El de rostro solo se usa para una cosa: distinguir un guiño de un parpadeo,
  // y para eso hacen falta sus «blendshapes». Se descarga cuando se enciende la
  // cámara, no al abrir la página.
  await bajar(
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    join(RAIZ, 'wj-content/assets/models/face_landmarker.task'),
  );
}

/**
 * Fuentes autoalojadas (Oswald + Hind Madurai). Se descargan una sola vez desde
 * Google Fonts en DESARROLLO y se sirven desde assets/fonts/: en producción la
 * página no hace ninguna petición a dominios de terceros.
 */
async function vendorFuentes() {
  console.log('\n▸ Fuentes (Oswald + Hind Madurai, subconjuntos latin y latin-ext)');
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const url =
    'https://fonts.googleapis.com/css2?family=Oswald:wght@200..700' +
    '&family=Hind+Madurai:wght@300;400;600&display=swap';
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();

  // El CSS viene agrupado en bloques comentados por subconjunto: /* latin */ …
  const bloques = css.split(/\/\*\s*([a-z-]+)\s*\*\//i).slice(1);
  const salida = [];
  for (let i = 0; i < bloques.length; i += 2) {
    const subconjunto = bloques[i];
    if (subconjunto !== 'latin' && subconjunto !== 'latin-ext') continue;
    let regla = bloques[i + 1];
    const remoto = regla.match(/https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2/);
    if (!remoto) continue;
    const nombre = regla.match(/font-family:\s*'([^']+)'/)[1].replace(/\s+/g, '');
    const peso = (regla.match(/font-weight:\s*([\d\s]+)/) || [, 'var'])[1].trim().replace(/\s+/g, '-');
    const archivo = `${nombre}-${peso}-${subconjunto}.woff2`;
    await bajar(remoto[0], join(RAIZ, 'wj-content/assets/fonts', archivo));
    salida.push(regla.replace(remoto[0], `../assets/fonts/${archivo}`).trim());
  }
  const cabecera =
    '/* Generado por tools/vendor.mjs — no editar a mano. */\n' +
    '/* Oswald y Hind Madurai — SIL Open Font License 1.1 */\n\n';
  await writeFile(join(RAIZ, 'wj-includes/css/fuentes.css'), cabecera + salida.join('\n\n') + '\n');
  console.log('  ✓ css/fuentes.css');
}

const objetivo = process.argv[2] ?? 'todo';
try {
  if (objetivo === 'todo' || objetivo === 'three') await vendorThree();
  if (objetivo === 'todo' || objetivo === 'fuentes') await vendorFuentes();
  if (objetivo === 'todo' || objetivo === 'mediapipe') await vendorMediapipe();
  console.log(`\n✔ ${descargados} archivo(s) vendorizados.\n`);
} catch (err) {
  console.error(`\n✘ Error vendorizando: ${err.message}\n`);
  process.exit(1);
}
