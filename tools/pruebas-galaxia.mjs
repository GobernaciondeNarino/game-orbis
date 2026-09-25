#!/usr/bin/env node
/**
 * ORBIS — Pruebas del disco de la Vía Láctea.
 *
 * El disco es SIMULACIÓN: dónde cae cada estrella lo decide un generador con
 * semilla. Pero no todo en él es decorativo, y lo que no lo es tiene que estar
 * de acuerdo con el resto de la aplicación y con los datos publicados:
 *
 *   · La distancia del Sol al centro galáctico es la MISMA cifra que enseña el
 *     panel galáctico. Si una cambia y la otra no, la escena y el panel se
 *     contradicen delante del usuario.
 *   · El encuadre de la vista galáctica, en main.js, cuenta con que el centro
 *     esté a 4.950 unidades. Moverlo sin tocar main.js deja la cámara mirando
 *     a otra parte.
 *   · La orientación es la real —60,19° de inclinación, centro galáctico 5,5°
 *     bajo la eclíptica— salvo UN giro de encuadre alrededor del polo de la
 *     eclíptica. Aquí se comprueba que ese giro es lo único que cambia.
 *   · El movimiento vive en el shader: el búfer de posiciones no se toca
 *     después de construirlo, y el movimiento reducido congela el reloj.
 *
 * A diferencia de pruebas-sol.mjs, aquí sí se importa el módulo de verdad: el
 * disco se construye en Node con el three.js vendorizado, sin navegador. Solo
 * el GLSL se revisa como texto.
 *
 *   node tools/pruebas-galaxia.mjs
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (ruta) => readFileSync(join(RAIZ, ruta), 'utf8');

// El navegador resuelve «three» con el importmap de index.html; Node no tiene
// importmap, así que se le enseña el mismo camino.
const URL_THREE = pathToFileURL(join(RAIZ, 'wj-includes/externos/three/build/three.module.min.js')).href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(especificador, contexto, siguiente) {
    if (especificador === 'three') return { url: ${JSON.stringify(URL_THREE)}, shortCircuit: true };
    return siguiente(especificador, contexto);
  }
`));

// El módulo consulta prefers-reduced-motion UNA vez al cargarse y guarda el
// objeto; la prueba cambia `matches` sobre ese mismo objeto.
const preferencia = { matches: false };
globalThis.window = { matchMedia: () => preferencia };

const THREE = await import('three');
const { Galaxy, GEOMETRIA_GALACTICA: G } = await import(
  pathToFileURL(join(RAIZ, 'wj-includes/js/system/Galaxy.js')).href
);
const fuente = leer('wj-includes/js/system/Galaxy.js');

let fallos = 0;
const comprobar = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`  ${ok ? '✔' : '✘'} ${nombre}${ok ? '' : ` — esperado «${esperado}», obtenido «${real}»`}`);
};
const cerca = (a, b, tolerancia) => Math.abs(a - b) <= tolerancia;
const GRADOS = 180 / Math.PI;

const gestor = { registrar: (x) => x, cargarTextura: () => new THREE.Texture() };
const galaxia = new Galaxy(gestor, { textura: null });
const disco = galaxia.disco;
disco.updateMatrixWorld(true);

console.log('\n▸ La escala coincide con el panel galáctico y con el encuadre de main.js');
{
  const panel = leer('wj-includes/js/ui/panels/PanelGalactico.js');
  const r0Panel = Number(panel.match(/distanciaAlCentroKpc:\s*\{\s*valor:\s*([\d.]+)/)?.[1]);
  console.log(`     R0 en el disco ${G.R0_KPC} kpc · en el panel ${r0Panel} kpc`);
  comprobar('R0 es la misma cifra que muestra el panel', G.R0_KPC, r0Panel);

  const main = leer('wj-includes/js/main.js');
  const centroMain = Number(main.match(/centrado a ([\d.]+) unidades/)?.[1].replace('.', ''));
  const distancia = disco.position.length();
  console.log(`     centro galáctico a ${distancia.toFixed(1)} unidades · main.js cuenta con ${centroMain}`);
  comprobar('el centro está donde main.js lo encuadra', cerca(distancia, centroMain, 0.5), true);
  comprobar('esa distancia es R0', cerca(galaxia.unidadesPorKpc * G.R0_KPC, distancia, 1e-6), true);
}

console.log('\n▸ La orientación es la real salvo el giro de encuadre');
{
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(disco.quaternion);
  const haciaCentro = disco.position.clone().normalize();
  const inclinacion = Math.acos(normal.y) * GRADOS;
  const latitudCentro = Math.asin(haciaCentro.y) * GRADOS;
  console.log(`     inclinación ${inclinacion.toFixed(3)}° · latitud del centro ${latitudCentro.toFixed(3)}°`);
  comprobar('el plano galáctico está inclinado 60,19° sobre la eclíptica', cerca(inclinacion, 60.19, 0.02), true);
  comprobar('el centro galáctico queda 5,5° bajo la eclíptica', cerca(latitudCentro, -5.54, 0.05), true);
  comprobar('el polo norte galáctico está del lado norte de la eclíptica', normal.y > 0, true);

  // El Sol (el origen) en el plano del disco: si no, no estaría «en» la Galaxia.
  const alturaSol = disco.position.clone().negate().dot(normal);
  comprobar('el Sol está en el plano galáctico', Math.abs(alturaSol) < 1e-6, true);

  // Solo cambia la longitud: el centro real, girado el encuadre alrededor del
  // polo de la eclíptica, tiene que ser exactamente el de la escena.
  const giro = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), G.GIRO_ENCUADRE);
  const centroGirado = G.DIRECCION_CENTRO_GALACTICO.clone().applyQuaternion(giro);
  const poloGirado = G.POLO_NORTE_GALACTICO.clone().applyQuaternion(giro);
  comprobar('el centro es el real girado alrededor del polo eclíptico', centroGirado.distanceTo(haciaCentro) < 1e-9, true);
  comprobar('el polo es el real girado igual', poloGirado.distanceTo(normal) < 1e-6, true);
}

console.log('\n▸ La vista galáctica ve el disco en escorzo y el centro delante');
{
  // La dirección de la vista general está en CameraRig; main.js aleja a 3.000.
  const rig = leer('wj-includes/js/core/CameraRig.js');
  const [x, y, z] = rig.match(/posicionVistaGeneral = new THREE\.Vector3\(([^)]+)\)/)[1].split(',').map(Number);
  const camara = new THREE.Vector3(x, y, z).normalize().multiplyScalar(3000);
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(disco.quaternion);
  const angulo = Math.acos(Math.abs(camara.clone().normalize().dot(normal))) * GRADOS;
  console.log(`     la cámara ve el disco a ${angulo.toFixed(1)}° de su normal`);
  comprobar('ni de canto ni de frente', angulo > 30 && angulo < 65, true);
  const delante = disco.position.clone().sub(camara).dot(camara.clone().negate().normalize());
  comprobar('el centro galáctico queda delante de la cámara', delante > 0, true);
}

// ── Partículas, en el sistema del disco (kpc) ─────────────────────────────────
function leerLote(puntos) {
  const pos = puntos.geometry.attributes.position.array;
  const col = puntos.geometry.attributes.tono.array;
  const dat = puntos.geometry.attributes.datos.array;
  const lista = [];
  for (let i = 0; i < pos.length / 3; i++) {
    lista.push({
      x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2],
      r: col[i * 3], g: col[i * 3 + 1], b: col[i * 3 + 2],
      poblacion: dat[i * 4],
    });
  }
  return lista;
}
const estrellas = leerLote(galaxia.estrellas);
const polvo = leerLote(galaxia.polvo);
const distanciaAlSol = (p) => Math.hypot(p.x + G.R0_KPC, p.z);

/** Desplazamiento radial con signo hasta el brazo más cercano (negativo: dentro). */
function aBrazoMasCercano(p) {
  const R = Math.hypot(p.x, p.z);
  const phi = Math.atan2(-p.z, p.x);
  let mejor = Infinity;
  for (const brazo of G.BRAZOS) {
    const phiBrazo = Math.PI + Math.log(R / brazo.radio) / G.TAN_BRAZOS;
    let d = (phi - phiBrazo + Math.PI) % (2 * Math.PI);
    if (d < 0) d += 2 * Math.PI;
    d -= Math.PI;
    const s = -R * d * G.TAN_BRAZOS;
    if (Math.abs(s) < Math.abs(mejor)) mejor = s;
  }
  return mejor;
}

console.log('\n▸ Poblaciones: barra vieja y amarilla, brazos jóvenes y azules, HII rosadas');
{
  const media = (lista) => {
    const s = lista.reduce((a, p) => [a[0] + p.r, a[1] + p.g, a[2] + p.b], [0, 0, 0]);
    return s.map((v) => v / lista.length);
  };
  const por = (n) => estrellas.filter((p) => p.poblacion === n);
  const [bulbo, disco_, jovenes, hii] = [0, 1, 2, 3].map(por);
  const total = estrellas.length;
  console.log(`     barra y bulbo ${bulbo.length} · disco ${disco_.length} · brazos ${jovenes.length} · HII ${hii.length}`);
  comprobar('están las cuatro poblaciones', [bulbo, disco_, jovenes, hii].every((l) => l.length > total * 0.03), true);

  const [rb, , bb] = media(bulbo);
  const [rj, , bj] = media(jovenes);
  const [rh, gh, bh] = media(hii);
  comprobar('el bulbo es más rojo que azul (estrellas viejas)', rb > bb * 1.3, true);
  comprobar('los brazos son más azules que rojos (estrellas jóvenes)', bj > rj, true);
  comprobar('las regiones HII son rosadas (rojo por encima de verde y azul)', rh > gh && rh > bh, true);

  // Lo que caracteriza a un brazo es que sus estrellas están EN el brazo.
  const cerca_ = jovenes.filter((p) => Math.abs(aBrazoMasCercano(p)) < 0.8).length / jovenes.length;
  console.log(`     ${(cerca_ * 100).toFixed(0)} % de las estrellas jóvenes a menos de 0,8 kpc de un brazo`);
  comprobar('las estrellas jóvenes siguen los brazos', cerca_ > 0.75, true);
}

console.log('\n▸ El Sol, en el espolón de Orión, entre Sagitario y Perseo');
{
  const sagitario = G.BRAZOS.find((b) => b.nombre.startsWith('Sagitario')).radio;
  const perseo = G.BRAZOS.find((b) => b.nombre.startsWith('Perseo')).radio;
  console.log(`     en la dirección del Sol: Sagitario ${sagitario.toFixed(2)} · Sol ${G.R0_KPC} · Perseo ${perseo.toFixed(2)} kpc`);
  comprobar('Sagitario por dentro y Perseo por fuera', sagitario < G.R0_KPC && G.R0_KPC < perseo, true);
  const espolon = G.ESPOLON.radio * Math.exp((Math.PI - Math.PI) * G.ESPOLON.tan);
  comprobar('el espolón pasa a menos de 0,2 kpc del Sol', Math.abs(espolon - G.R0_KPC) < 0.2, true);
  comprobar('y el Sol está dentro de su tramo', G.ESPOLON.desde < Math.PI && Math.PI < G.ESPOLON.hasta, true);
}

console.log('\n▸ Despeje alrededor del Sol y polvo en el borde interior de los brazos');
{
  const cercaDelSol = estrellas.filter((p) => p.poblacion !== 0 && distanciaAlSol(p) < G.DESPEJE_ESTRELLAS - 0.2);
  comprobar('ninguna estrella encima del Sistema Solar', cercaDelSol.length, 0);
  comprobar('ningún grumo de polvo cerca del Sol', polvo.filter((p) => distanciaAlSol(p) < G.DESPEJE_POLVO).length, 0);

  const desplazamientos = polvo.map(aBrazoMasCercano);
  const dentro = desplazamientos.filter((s) => s < 0).length / desplazamientos.length;
  console.log(`     ${(dentro * 100).toFixed(0)} % del polvo por dentro de su brazo`);
  comprobar('el polvo va en el borde interior, no en el exterior', dentro > 0.85, true);
}

console.log('\n▸ La rotación vive en el shader y sigue una curva casi plana');
{
  // Curva del potencial logarítmico, con las cifras escritas en el GLSL.
  const V0 = Number(fuente.match(/const float V0 = ([\d.]+);/)?.[1]);
  const RC = Number(fuente.match(/const float RC = ([\d.]+);/)?.[1]);
  const velocidad = (R) => (V0 * R) / Math.sqrt(R * R + RC * RC);
  const omega = (R) => V0 / Math.sqrt(R * R + RC * RC);
  console.log(`     V(5) ${velocidad(5).toFixed(0)} · V(8,2) ${velocidad(8.178).toFixed(0)} · V(12) ${velocidad(12).toFixed(0)} km/s`);
  comprobar('V0 es la de Reid et al. (2019)', V0, 236);
  comprobar('plana fuera del bulbo (±5 % entre 5 y 15 kpc)',
    [5, 8.178, 12, 15].every((R) => cerca(velocidad(R), V0, V0 * 0.05)), true);
  comprobar('sólida en el centro (velocidad angular casi constante)', omega(0.2) / omega(0) > 0.97, true);
  comprobar('gira en sentido horario visto desde el norte (el ángulo disminuye)',
    /float phi = phi0 - giro;/.test(fuente), true);

  // Nada de reescribir el búfer: se comprueba con la versión del atributo.
  const atributo = galaxia.estrellas.geometry.attributes.position;
  const version = atributo.version;
  for (let i = 0; i < 60; i++) galaxia.actualizarSegunDistancia(3000, 1 / 60);
  comprobar('el búfer de posiciones no se toca al animar', atributo.version, version);

  const antes = galaxia.materialEstrellas.uniforms.tiempo.value;
  galaxia.actualizarSegunDistancia(3000, 0.1);
  const paso = galaxia.materialEstrellas.uniforms.tiempo.value - antes;
  comprobar('el reloj avanza MA_POR_SEGUNDO por segundo', cerca(paso, 0.1 * G.MA_POR_SEGUNDO, 1e-9), true);
  comprobar('las tres capas comparten el mismo reloj',
    [galaxia.materialPolvo, galaxia.materialResplandor].every(
      (m) => m.uniforms.tiempo.value === galaxia.materialEstrellas.uniforms.tiempo.value), true);
}

console.log('\n▸ El movimiento reducido CONGELA el reloj, no lo ralentiza');
{
  comprobar('la consulta se declara una sola vez', (fuente.match(/matchMedia\?\.\(/g) ?? []).length, 1);
  preferencia.matches = true;
  const antes = galaxia.materialEstrellas.uniforms.tiempo.value;
  const centelleo = galaxia.materialEstrellas.uniforms.segundos.value;
  for (let i = 0; i < 30; i++) galaxia.actualizarSegunDistancia(3000, 0.1);
  comprobar('el giro se queda quieto', galaxia.materialEstrellas.uniforms.tiempo.value, antes);
  comprobar('el centelleo también', galaxia.materialEstrellas.uniforms.segundos.value, centelleo);
  comprobar('pero el disco sigue visible', galaxia.disco.visible, true);
  preferencia.matches = false;
}

console.log('\n▸ Aparece y desaparece con la distancia, y el reloj solo corre mientras se ve');
{
  for (let i = 0; i < 200; i++) galaxia.actualizarSegunDistancia(3000, 0.05);
  comprobar('lejos, se funde hasta 0,75', cerca(galaxia.materialEstrellas.uniforms.opacidad.value, 0.75, 1e-3), true);
  for (let i = 0; i < 200; i++) galaxia.actualizarSegunDistancia(100, 0.05);
  comprobar('cerca, desaparece', galaxia.disco.visible, false);
  const quieto = galaxia.materialEstrellas.uniforms.tiempo.value;
  for (let i = 0; i < 20; i++) galaxia.actualizarSegunDistancia(100, 0.1);
  comprobar('oculto, el reloj no avanza (el Sol sigue en Orión al volver)',
    galaxia.materialEstrellas.uniforms.tiempo.value, quieto);

  // En escala real el centro galáctico caería dentro de la órbita de
  // Mercurio: el disco no debe aparecer por mucho que se aleje la cámara.
  galaxia.establecerDiscoPermitido(false);
  for (let i = 0; i < 200; i++) galaxia.actualizarSegunDistancia(3_000_000, 0.05);
  comprobar('en escala real no aparece aunque la cámara esté lejísimos', galaxia.disco.visible, false);
  galaxia.establecerDiscoPermitido(true);
  const sistema = leer('wj-includes/js/system/SolarSystem.js');
  comprobar('y el cambio de escala lo pide', /this\.galaxia\.establecerDiscoPermitido\(modo !== 'real'\)/.test(sistema), true);
}

console.log('\n▸ Contrato: SIMULACIÓN, estrellas redondas y todo se libera');
{
  comprobar('esSimulacion', galaxia.esSimulacion, true);
  comprobar('las estrellas se declaran redondas', galaxia.materialEstrellas.userData.redondeado, true);
  comprobar('mejorarCielo() sigue existiendo', typeof galaxia.mejorarCielo, 'function');

  const recursos = new Set();
  galaxia.grupo.traverse((o) => {
    if (o.geometry) recursos.add(o.geometry);
    if (o.material) recursos.add(o.material);
  });
  let liberados = 0;
  for (const r of recursos) r.addEventListener('dispose', () => liberados++);
  galaxia.destruir();
  console.log(`     ${liberados} de ${recursos.size} geometrías y materiales liberados`);
  comprobar('destruir() libera todas las geometrías y materiales', liberados, recursos.size);
}

console.log(fallos ? `\n✘ ${fallos} comprobación(es) fallida(s)\n` : '\n✔ Todas las comprobaciones pasan\n');
process.exit(fallos ? 1 : 0);
