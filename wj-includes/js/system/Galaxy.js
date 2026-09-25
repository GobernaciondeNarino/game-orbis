/**
 * Galaxy — el entorno: campo estelar y disco de la Vía Láctea.
 *
 * Dos capas independientes:
 *
 *   · Un cielo esférico con el mapa estelar real (Solar System Scope, CC BY
 *     4.0), pintado por dentro. Da el fondo constante de la escena.
 *   · Un disco de partículas que representa la Vía Láctea vista desde fuera,
 *     visible solo al alejarse mucho. Es DECORATIVO —no es un mapa de
 *     posiciones estelares— y la interfaz lo marca como SIMULACIÓN.
 *
 * Que sea decorativo no quiere decir que sea arbitrario. La ESTRUCTURA sigue lo
 * que se sabe de la Galaxia —una barra central, dos brazos mayores que nacen de
 * sus extremos, dos menores entre ellos y el Sol en un brazo pequeño, a 8,2 kpc
 * del centro—, y el MOVIMIENTO sigue su curva de rotación, casi plana. Cada
 * cifra lleva al lado de dónde sale. Lo inventado son las estrellas concretas:
 * dónde cae cada punto lo decide un generador pseudoaleatorio con semilla.
 */

import * as THREE from 'three';
import { GRADOS, generador } from '../utils/math.js';
import { rutaReducida } from './CelestialBody.js';

/** Quien pide menos movimiento no quiere una galaxia girando. */
const MOVIMIENTO_REDUCIDO = window.matchMedia?.('(prefers-reduced-motion: reduce)');

// ───────────────────────────────────────────────────────── cifras de la Galaxia

/**
 * Distancia del Sol al centro galáctico, en kpc.
 *
 * GRAVITY Collaboration (2019), A&A 625, L10, midiendo la órbita de la estrella
 * S2 alrededor de Sgr A*. Es la misma cifra que muestra el panel galáctico de la
 * interfaz, y la que da Reid et al. (2019, ApJ 885, 131) con máseres —8,15 ±
 * 0,15 kpc— la confirma. Fija la escala de todo el disco: el centro de la
 * Galaxia se coloca a R0 del Sol, que es el origen de la escena.
 */
const R0_KPC = 8.178;

/** Oblicuidad de la eclíptica en J2000 (IAU). */
const OBLICUIDAD_J2000 = 23.4392911 * GRADOS;

/**
 * Dirección en la escena de unas coordenadas ecuatoriales J2000.
 *
 * Primero a la eclíptica, girando la oblicuidad alrededor del eje X, y luego
 * el mismo cambio de ejes que usa Orbit.js —(X, Y, Z) → (X, Z, −Y)—, para que
 * la Galaxia quede en el mismo sistema que las órbitas.
 */
function direccionEcuatorial(alfaGrados, deltaGrados) {
  const alfa = alfaGrados * GRADOS;
  const delta = deltaGrados * GRADOS;
  const x = Math.cos(delta) * Math.cos(alfa);
  const y = Math.cos(delta) * Math.sin(alfa);
  const z = Math.sin(delta);
  const yEcliptica = y * Math.cos(OBLICUIDAD_J2000) + z * Math.sin(OBLICUIDAD_J2000);
  const zEcliptica = -y * Math.sin(OBLICUIDAD_J2000) + z * Math.cos(OBLICUIDAD_J2000);
  return new THREE.Vector3(x, zEcliptica, -yEcliptica).normalize();
}

/**
 * Orientación REAL de la Galaxia respecto a la eclíptica.
 *
 * Polo norte galáctico en α = 192,85948°, δ = +27,12825°, y centro galáctico
 * en α = 266,40499°, δ = −28,93617° (J2000; la definición de la IAU de 1958
 * llevada a J2000, Liu et al. 2011, A&A 526, A16). De ahí salen, sin ajustar
 * nada, las dos cosas que se ven en la escena: el plano galáctico está
 * inclinado 60,19° respecto a la eclíptica, y el centro galáctico queda solo
 * 5,5° por debajo de ella, en longitud eclíptica 266,8°.
 */
const POLO_NORTE_GALACTICO = direccionEcuatorial(192.85948, 27.12825);
const DIRECCION_CENTRO_GALACTICO = direccionEcuatorial(266.40499, -28.93617);

/**
 * Giro de encuadre alrededor del eje de la eclíptica: 150°.
 *
 * Es lo ÚNICO de la orientación que no es real. Con la orientación verdadera,
 * el centro galáctico cae justo detrás de la cámara de la vista galáctica
 * —main.js la coloca mirando desde +Z, y el centro está hacia +Z— y el disco
 * se ve casi de canto: una franja que no deja ver ni los brazos ni la barra.
 * Girando la Galaxia entera alrededor del polo de la eclíptica se conservan la
 * inclinación de 60,19°, la latitud del centro y el sentido de giro; solo
 * cambia la longitud a la que apunta el centro (de 266,8° a unos 57°), que
 * queda arriba a la derecha, lejos, con la barra entera en el encuadre, y el
 * disco se ve en escorzo, a unos 54° de su normal. Se eligió mirando capturas
 * a 120°, 135° y 150°. SIMULACIÓN, como todo el disco.
 */
const GIRO_ENCUADRE = 150 * GRADOS;

/**
 * Brazos espirales: espirales logarítmicas de inclinación (pitch) común.
 *
 * El valor medio de decenas de medidas de la inclinación de los brazos de la
 * Vía Láctea ronda los 13° (Vallée 2015, MNRAS 450, 4277). Con cuatro brazos
 * a 90° uno de otro, eso fija la separación entre brazos consecutivos en una
 * misma dirección: un factor exp(π/2 · tan 13°) ≈ 1,44 en radio.
 *
 * Colocando el Sol a medio camino —en escala logarítmica— entre los brazos de
 * Sagitario y de Perseo, que es donde está el brazo de Orión, sale todo lo
 * demás: Escudo–Centauro a unos 4,7 kpc en la dirección del Sol, Sagitario a
 * 6,8, Perseo a 9,8 y Norma–Exterior a 14. Son radios coherentes con los que
 * publican los mapas de máseres (Reid et al. 2019), aunque aquí salen de la
 * geometría y no se han ajustado uno a uno. La DISPOSICIÓN —dos brazos mayores
 * que arrancan de los extremos de la barra, dos menores intercalados y el
 * espolón de Orión entre Sagitario y Perseo— es la del concepto artístico de
 * NASA/JPL-Caltech (R. Hurt, 2008), basado en el sondeo GLIMPSE del Spitzer.
 */
const INCLINACION_BRAZOS = 13 * GRADOS;
const TAN_BRAZOS = Math.tan(INCLINACION_BRAZOS);
const SEPARACION = Math.exp((Math.PI / 2) * TAN_BRAZOS);
const R_SAGITARIO = R0_KPC / Math.sqrt(SEPARACION);

const BRAZOS = [
  // radio: donde el brazo cruza la dirección Sol–centro (φ = 180°).
  { nombre: 'Escudo–Centauro', radio: R_SAGITARIO / SEPARACION, mayor: true, desde: 4.2, hasta: 15 },
  { nombre: 'Sagitario–Carina', radio: R_SAGITARIO, mayor: false, desde: 5.0, hasta: 13 },
  { nombre: 'Perseo', radio: R_SAGITARIO * SEPARACION, mayor: true, desde: 4.2, hasta: 15 },
  { nombre: 'Norma–Exterior', radio: R_SAGITARIO * SEPARACION ** 2, mayor: false, desde: 3.4, hasta: 15.5 },
];

/**
 * Espolón de Orión (el brazo Local): un tramo corto entre Sagitario y Perseo
 * que pasa por el Sol. Se le da una inclinación parecida a la de los brazos y
 * unos cinco kpc de largo, centrados algo por delante del Sol.
 */
const ESPOLON = { radio: 8.3, desde: Math.PI - 0.3, hasta: Math.PI + 0.35, tan: Math.tan(12 * GRADOS) };

/**
 * Barra central. Su extremo cercano apunta 27° por delante de la línea Sol–
 * centro, en el sentido de la rotación (Wegg y Gerhard 2013, MNRAS 435,
 * 1874). La barra larga llega a unos 5 kpc del centro (Wegg, Gerhard y Portail
 * 2015, MNRAS 450, 4050); el bulbo en forma de cacahuete ocupa los 2 kpc
 * interiores. Los dos brazos mayores arrancan, en esta geometría, justo en sus
 * extremos.
 */
const ANGULO_BARRA = Math.PI - 27 * GRADOS;
const SEMILONGITUD_BARRA = 5.0;

/**
 * Disco viejo: exponencial con 2,6 kpc de escala radial y unos 300 pc de
 * escala vertical (Bland-Hawthorn y Gerhard 2016, ARA&A 54, 529). Las
 * estrellas jóvenes de los brazos forman una capa mucho más fina.
 */
const ESCALA_RADIAL = 2.6;
const ESCALA_VERTICAL_VIEJA = 0.3;
const ESCALA_VERTICAL_JOVEN = 0.06;

/**
 * Radio de despeje alrededor del Sol, en kpc.
 *
 * A la distancia de la vista galáctica, un punto a menos de unos 0,35 kpc del
 * Sol se dibujaría encima del Sistema Solar entero y lo taparía. Se dejan
 * fuera por legibilidad; que la vecindad del Sol sea además una cavidad de gas
 * tenue y caliente de unos cientos de pársecs —la Burbuja Local— hace que el
 * hueco no sea un disparate, pero el motivo es el primero. El polvo se aparta
 * más, porque oscurece y taparía las órbitas.
 */
const DESPEJE_ESTRELLAS = 0.35;
const DESPEJE_POLVO = 0.7;

/**
 * Tiempo galáctico: MEDIO MILLÓN DE AÑOS por segundo de pantalla.
 *
 * Es obviamente una aceleración brutal —SIMULACIÓN—, elegida para que el giro
 * se aprecie sin marear: el año galáctico del Sol, 230 millones de años, dura
 * así casi ocho minutos. El disco se dibuja en el sistema que gira con el Sol,
 * de modo que el Sistema Solar se queda quieto en el centro de la pantalla y lo
 * que se ve es lo que se vería desde él: las estrellas interiores adelantan,
 * las exteriores se quedan atrás, y la barra y los brazos se desplazan
 * despacio porque no giran al mismo ritmo que las estrellas.
 */
const MA_POR_SEGUNDO = 0.5;

/**
 * Geometría de la Galaxia, expuesta para tools/pruebas-galaxia.mjs: la prueba
 * reconstruye brazos y orientación con las mismas cifras en lugar de copiarlas.
 */
export const GEOMETRIA_GALACTICA = Object.freeze({
  R0_KPC,
  TAN_BRAZOS,
  BRAZOS,
  ESPOLON,
  DESPEJE_ESTRELLAS,
  DESPEJE_POLVO,
  MA_POR_SEGUNDO,
  POLO_NORTE_GALACTICO,
  DIRECCION_CENTRO_GALACTICO,
  GIRO_ENCUADRE,
});

// Poblaciones de partículas: deciden color, tamaño y cómo giran.
const POB_BULBO = 0;
const POB_DISCO = 1;
const POB_JOVEN = 2;
const POB_HII = 3;
const POB_POLVO = 4;

/**
 * Vértice común a estrellas y polvo: gira cada punto según su población.
 *
 * Todo el movimiento se calcula aquí a partir del uniforme `tiempo`; el búfer
 * de posiciones no se reescribe nunca. Las posiciones van en kpc, en el
 * sistema del disco: plano XZ, +Y hacia el polo norte galáctico, centro en el
 * origen y el Sol en (−R0, 0, 0). Vista desde el polo norte, la Galaxia gira en
 * el sentido de las agujas del reloj.
 *
 * CURVA DE ROTACIÓN. V(R) = V0·R / √(R² + Rc²): es la del potencial
 * logarítmico (Binney y Tremaine, Galactic Dynamics, 2008), sólida en el
 * centro —la velocidad angular es constante, V0/Rc— y plana fuera, con la
 * velocidad angular cayendo como 1/R. V0 = 236 km/s (Reid et al. 2019). Una
 * curva plana es lo que hace que la galaxia gire DIFERENCIALMENTE: el centro
 * da muchas vueltas mientras el borde da una. Con estas dos cifras, la vuelta
 * del Sol sale de unos 215 millones de años, algo menos que los 230 redondos
 * del panel galáctico (NASA): no se fuerza a coincidir, porque cada una sale
 * de su fuente.
 *
 * TRES RITMOS. Las estrellas viejas del disco siguen la curva de rotación. La
 * barra gira como un sólido a su propia velocidad de patrón, unos 39 km/s/kpc
 * (Portail et al. 2017, MNRAS 465, 1621). Los brazos no son objetos sino ondas
 * de densidad: su patrón gira más despacio, unos 25 km/s/kpc (Dias y Lépine
 * 2005, ApJ 629, 825), y las estrellas los atraviesan.
 *
 * POR ESO LAS ESTRELLAS JÓVENES NACEN Y MUEREN. Si las estrellas de los brazos
 * giraran con la curva de rotación, los brazos se enrollarían sobre sí mismos
 * en un par de vueltas: es el «problema del enrollamiento», y es justo lo que
 * la teoría de ondas de densidad resuelve. Las estrellas azules y las regiones
 * HII son jóvenes: nacen en el brazo, se alejan de él con la rotación y se
 * apagan antes de llegar lejos. Aquí igual: cada una tiene un ciclo de vida,
 * nace sobre el brazo del patrón, deriva a la velocidad de su radio y se
 * desvanece; al renacer ya no se ve el salto porque está apagada. El polvo va
 * pegado al patrón: las franjas oscuras son el gas comprimido por la onda.
 */
const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 tono;
  // x: población · y: fase (0–1) · z: tamaño en kpc · w: brillo
  attribute vec4 datos;

  uniform float tiempo;          // millones de años de simulación galáctica
  uniform float segundos;        // segundos reales, para el centelleo
  uniform float unidadesPorKpc;
  uniform float mitadAlturaPx;
  uniform float opacidad;

  varying vec3 vColor;
  varying float vAlfa;

  // 1 km/s/kpc en radianes por millón de años.
  const float KMS_KPC = 0.0010227;
  const float V0 = 236.0;
  const float RC = 1.0;
  const float R0 = ${R0_KPC.toFixed(3)};
  const float OMEGA_BARRA = 39.0 * KMS_KPC;
  const float OMEGA_BRAZOS = 25.0 * KMS_KPC;
  const float VIDA_JOVEN = 16.0;   // Ma: lo que brilla una estrella B temprana
  const float VIDA_HII = 6.0;      // Ma: lo que dura una región HII

  float omega(float R) {
    return V0 * KMS_KPC / sqrt(R * R + RC * RC);
  }

  void main() {
    float poblacion = datos.x;
    float R = length(position.xz);
    float phi0 = atan(-position.z, position.x);

    // Todo se mide respecto al Sol, que así no se mueve de su sitio.
    float omegaSol = omega(R0);
    float giro;
    float vida = 1.0;

    if (poblacion < 0.5) {
      giro = (OMEGA_BARRA - omegaSol) * tiempo;
    } else if (poblacion < 1.5) {
      giro = (omega(R) - omegaSol) * tiempo;
    } else if (poblacion < 3.5) {
      float duracion = poblacion < 2.5 ? VIDA_JOVEN : VIDA_HII;
      float edad = mod(tiempo + datos.y * duracion, duracion);
      // Hasta nacer, su sitio lo lleva el patrón; desde entonces, su radio.
      giro = (OMEGA_BRAZOS - omegaSol) * (tiempo - edad) + (omega(R) - omegaSol) * edad;
      float x = edad / duracion;
      // Se enciende deprisa y se apaga despacio.
      vida = smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.45, 1.0, x));
    } else {
      giro = (OMEGA_BRAZOS - omegaSol) * tiempo;
    }

    // Sentido horario visto desde el polo norte: el ángulo DISMINUYE.
    float phi = phi0 - giro;
    vec3 p = vec3(R * cos(phi), position.y, -R * sin(phi));

    vec4 vista = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * vista;

    // Centelleo sutil. Es DECORATIVO: el centelleo real lo produce la
    // atmósfera terrestre, y desde fuera de la Galaxia no lo habría. Por eso
    // es tan pequeño, y con movimiento reducido se queda quieto con el reloj.
    float centelleo = 1.0 + 0.1 * sin(segundos * (1.3 + 2.4 * fract(datos.y * 7.31)) + 6.2831853 * datos.y);

    float tamano = datos.z * unidadesPorKpc * mitadAlturaPx / max(1e-3, -vista.z);
    // Un punto de menos de un píxel no se puede dibujar más pequeño: se apaga
    // en proporción, o parpadearía al moverse entre píxeles.
    float cobertura = clamp(tamano / 1.5, 0.15, 1.0);
    gl_PointSize = clamp(tamano, 1.0, 64.0);

    vColor = tono;
    vAlfa = opacidad * datos.w * vida * centelleo * cobertura;

    #include <logdepthbuf_vertex>
  }
`;

/**
 * Estrellas redondas y no cuadradas.
 *
 * Un `THREE.Points` dibuja cada partícula como un CUADRADO —es un sprite
 * alineado a la pantalla— y a tamaños pequeños no se nota, pero en cuanto la
 * cámara se acerca al disco se ven miles de cuadraditos. Ninguna estrella se
 * ve así. Se descartan en el shader los píxeles que caen fuera del círculo:
 * `gl_PointCoord` va de 0 a 1 dentro del sprite, así que la distancia a su
 * centro dice si el píxel está dentro del disco o en la esquina. Y el borde se
 * difumina en lugar de cortarse en escalón, que además de verse mejor evita el
 * dentado de un recorte duro. Sin textura que cargar.
 *
 * Antes esto se inyectaba en el PointsMaterial con onBeforeCompile, y había
 * que vigilar que three.js no renombrase el fragmento donde se colgaba. Con un
 * shader propio el redondeo está escrito aquí y no puede fallar en silencio.
 */
const FRAGMENT_ESTRELLAS = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  varying float vAlfa;
  void main() {
    #include <logdepthbuf_fragment>
    float distanciaAlCentro = length(gl_PointCoord - vec2(0.5));
    if (distanciaAlCentro > 0.5) discard;
    // Núcleo y halo: una estrella no es un disco plano.
    float perfil = smoothstep(0.5, 0.0, distanciaAlCentro);
    perfil *= perfil;
    gl_FragColor = vec4(vColor, vAlfa * perfil);
  }
`;

/**
 * El polvo no suma luz: la quita. Se dibuja con mezcla sustractiva, que en
 * three.js multiplica lo que ya hay pintado por (1 − color), y absorbe más el
 * azul que el rojo, que es lo que hace el polvo interestelar: enrojece.
 */
const FRAGMENT_POLVO = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  varying float vAlfa;
  void main() {
    #include <logdepthbuf_fragment>
    float distanciaAlCentro = length(gl_PointCoord - vec2(0.5));
    if (distanciaAlCentro > 0.5) discard;
    float perfil = smoothstep(0.5, 0.1, distanciaAlCentro);
    gl_FragColor = vec4(vColor * vAlfa * perfil, 1.0);
  }
`;

/**
 * Resplandor del disco: la luz que NO se resuelve en estrellas.
 *
 * Casi toda la luz de una galaxia vista desde fuera es un resplandor continuo
 * —cientos de miles de millones de estrellas que no se distinguen una a una—,
 * y sobre él destacan las pocas brillantes y las regiones HII. Con puntos solo
 * no hay forma de dibujarlo: harían falta cientos de miles, o manchas enormes
 * superpuestas que costarían más relleno que todo el Sistema Solar.
 *
 * Así que se evalúa la densidad directamente, en un único plano en el disco:
 * para cada píxel, su radio y su ángulo dicen a qué distancia está de cada
 * brazo —en una espiral logarítmica eso es una cuenta cerrada—, de la barra y
 * del centro. Es la MISMA geometría con la que se reparten los puntos, escrita
 * una sola vez en JavaScript y copiada aquí como constantes. Barato, sin
 * dentado a ninguna distancia, y gira igual que ellos: la barra a su ritmo y
 * los brazos con el patrón, en el sistema que gira con el Sol.
 *
 * Como el resplandor de las franjas de polvo es más débil, el polvo se resta
 * aquí también: los puntos oscuros apagan las estrellas y este apaga la luz de
 * fondo en el mismo sitio.
 */
const VERTEX_RESPLANDOR = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vPlano;
  void main() {
    vPlano = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_RESPLANDOR = /* glsl */ `
  // <common> trae PI.
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform float tiempo;
  uniform float opacidad;
  uniform vec3 colorBulbo;
  uniform vec3 colorDisco;
  uniform vec3 colorBrazos;

  varying vec2 vPlano;

  const float KMS_KPC = 0.0010227;
  const float R0 = ${R0_KPC.toFixed(3)};
  const float OMEGA_BARRA = 39.0 * KMS_KPC;
  const float OMEGA_BRAZOS = 25.0 * KMS_KPC;
  const float TAN_BRAZOS = ${TAN_BRAZOS.toFixed(5)};
  const float ANGULO_BARRA = ${ANGULO_BARRA.toFixed(5)};
  const float ESCALA_RADIAL = ${ESCALA_RADIAL.toFixed(2)};

  float omega(float R) {
    return 236.0 * KMS_KPC / sqrt(R * R + 1.0);
  }

  // Desplazamiento radial CON SIGNO desde un brazo: negativo hacia dentro.
  // En una espiral logarítmica, a radio fijo, el brazo cruza en un único
  // ángulo (módulo 2π); la diferencia angular por R·tan(pitch) es la distancia
  // en radio.
  float aBrazo(float R, float phi, float radioRef, float tanPitch) {
    float phiBrazo = PI + log(R / radioRef) / tanPitch;
    float d = mod(phi - phiBrazo + PI, 2.0 * PI) - PI;
    return -R * d * tanPitch;
  }

  // Brillo de un brazo y cuánto polvo hay en su borde interior.
  vec2 brazo(float R, float phi, float radioRef, float desde, float hasta, float intensidad) {
    float s = aBrazo(R, phi, radioRef, TAN_BRAZOS);
    float ancho = 0.2 + 0.035 * R;
    float tramo = smoothstep(desde - 0.4, desde + 0.6, R) * (1.0 - smoothstep(hasta - 2.0, hasta, R));
    float luz = exp(-0.5 * (s / ancho) * (s / ancho)) * tramo * intensidad;
    float franja = (s + 0.75 * ancho) / (0.3 * ancho);
    float polvo = exp(-0.5 * franja * franja) * tramo * step(3.0, R);
    return vec2(luz, polvo);
  }

  void main() {
    #include <logdepthbuf_fragment>

    float R = max(length(vPlano), 1e-4);
    float phi = atan(-vPlano.y, vPlano.x);
    float omegaSol = omega(R0);

    // --- Bulbo y barra: giran como un sólido --------------------------------
    float phiBarra = phi + (OMEGA_BARRA - omegaSol) * tiempo - ANGULO_BARRA;
    float a = R * cos(phiBarra);
    float b = R * sin(phiBarra);
    float bulbo = 1.2 * exp(-0.5 * ((a / 1.0) * (a / 1.0) + (b / 0.45) * (b / 0.45)))
                + 0.25 * (1.0 - smoothstep(3.6, 5.2, abs(a))) * exp(-0.5 * (b / 0.28) * (b / 0.28))
                + 0.6 * exp(-R / 0.25);

    // --- Disco viejo: exponencial y liso ------------------------------------
    // Empieza pronto: sin él, entre la barra y los brazos quedaba un foso
    // oscuro que la Galaxia no tiene.
    float disco = 0.9 * exp(-R / ESCALA_RADIAL) * smoothstep(0.4, 2.2, R);

    // --- Brazos, con el patrón ----------------------------------------------
    float phiPatron = phi + (OMEGA_BRAZOS - omegaSol) * tiempo;
    vec2 total = vec2(0.0);
${BRAZOS.map((b) => `    total += brazo(R, phiPatron, ${b.radio.toFixed(4)}, ${b.desde.toFixed(2)}, ${b.hasta.toFixed(2)}, ${b.mayor ? '0.18' : '0.11'});`).join('\n')}

    // Espolón de Orión: tramo corto alrededor del Sol, sin franja de polvo.
    float sEspolon = aBrazo(R, phiPatron, ${ESPOLON.radio.toFixed(2)}, ${ESPOLON.tan.toFixed(5)});
    float dEspolon = mod(phiPatron, 2.0 * PI) - PI;
    float tramoEspolon = smoothstep(${(ESPOLON.desde - Math.PI - 0.12).toFixed(3)}, ${(ESPOLON.desde - Math.PI + 0.12).toFixed(3)}, dEspolon)
                       * (1.0 - smoothstep(${(ESPOLON.hasta - Math.PI - 0.12).toFixed(3)}, ${(ESPOLON.hasta - Math.PI + 0.12).toFixed(3)}, dEspolon));
    total.x += 0.09 * exp(-0.5 * (sEspolon / 0.25) * (sEspolon / 0.25)) * tramoEspolon;

    float polvo = clamp(total.y, 0.0, 1.0);
    vec3 color = colorBulbo * bulbo
               + (colorDisco * disco + colorBrazos * total.x) * (1.0 - 0.55 * polvo);

    // Borde exterior difuso y despeje alrededor del Sol, como en los puntos.
    float borde = 1.0 - smoothstep(14.0, 16.5, R);
    float despeje = smoothstep(${(DESPEJE_ESTRELLAS * 0.6).toFixed(2)}, ${(DESPEJE_ESTRELLAS * 1.4).toFixed(2)}, length(vPlano - vec2(-R0, 0.0)));

    gl_FragColor = vec4(color * borde * despeje * opacidad, 1.0);
  }
`;

export class Galaxy {
  constructor(gestor, { textura = null, radio = 9000, particulas = 26000, polvo = 7000, semilla = 31415 } = {}) {
    this.gestor = gestor;
    this.grupo = new THREE.Group();
    this.grupo.name = 'entorno-galactico';
    this.esSimulacion = true;

    this.cielo = this._crearCielo(textura, radio);
    this.grupo.add(this.cielo);

    /**
     * Escala del disco. El centro galáctico se coloca a radio × 0,55 = 4.950
     * unidades del Sol —el encuadre de la vista galáctica, en main.js, cuenta
     * con esa distancia—, y esa distancia ES R0. Con eso, un kpc son unas 605
     * unidades y el disco, de unos 15 kpc de radio, llega a unas 9.000.
     */
    this.distanciaCentro = radio * 0.55;
    this.unidadesPorKpc = this.distanciaCentro / R0_KPC;

    this._opacidad = 0;
    this._tiempo = 0;
    this._segundos = 0;

    this.disco = this._crearDisco(particulas, polvo, semilla);
    this.grupo.add(this.disco);
  }

  _crearCielo(textura, radio) {
    const geometria = this.gestor.registrar(new THREE.SphereGeometry(radio, 48, 32));
    const material = this.gestor.registrar(
      new THREE.MeshBasicMaterial({
        side: THREE.BackSide,     // Se ve desde dentro.
        depthWrite: false,
        color: textura ? 0xffffff : 0x0a1628,
      }),
    );

    if (textura) {
      // El cielo ocupa toda la pantalla al fondo: la versión de 512 px basta
      // hasta que el resto de la escena está lista.
      material.map = this.gestor.cargarTextura(rutaReducida(textura));
      this.rutaCieloCompleta = textura;
      // El fondo estelar no debe competir con la escena: se atenúa.
      material.color.setScalar(0.55);
    }

    const malla = new THREE.Mesh(geometria, material);
    malla.name = 'cielo-estelar';
    malla.renderOrder = -1;
    return malla;
  }

  /**
   * Disco galáctico: barra, bulbo, disco viejo, cuatro brazos, el espolón de
   * Orión, regiones HII y franjas de polvo.
   */
  _crearDisco(totalEstrellas, totalPolvo, semilla) {
    const aleatorio = generador(semilla);
    const normal = () => {
      // Box–Muller: suma de dos uniformes no da una campana decente.
      const u = Math.max(1e-9, aleatorio());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * aleatorio());
    };

    const estrellas = new Lote(totalEstrellas);
    const polvo = new Lote(totalPolvo);
    const color = new THREE.Color();

    const COLOR_BULBO = new THREE.Color('#ffd49a');   // gigantes K viejas: amarillo anaranjado
    const COLOR_DISCO = new THREE.Color('#fff0dc');   // población vieja del disco: blanco cálido
    const COLOR_JOVEN = new THREE.Color('#9cc2ff');   // estrellas O y B: azuladas
    const COLOR_HII = new THREE.Color('#ff8fb8');     // hidrógeno ionizado (Hα + Hβ): rosado
    // Absorción por canal: más en azul que en rojo.
    const ABSORCION = new THREE.Color(0.55, 0.7, 0.9);

    const lejosDelSol = (x, z, despeje) => Math.hypot(x + R0_KPC, z) > despeje;

    // --- Bulbo y barra: población vieja, gira como un sólido --------------------
    const ejeBarra = [Math.cos(ANGULO_BARRA), -Math.sin(ANGULO_BARRA)];
    const perpBarra = [-ejeBarra[1], ejeBarra[0]];
    const enBarra = Math.round(totalEstrellas * 0.17);
    for (let i = 0; i < enBarra; i++) {
      const esBulbo = i < enBarra * 0.62;
      // El bulbo es gordo y corto; la barra larga, fina y hasta los 5 kpc.
      const a = esBulbo
        ? THREE.MathUtils.clamp(normal() * 1.1, -3.2, 3.2)
        : (aleatorio() * 2 - 1) * SEMILONGITUD_BARRA * Math.sqrt(aleatorio());
      const b = normal() * (esBulbo ? 0.5 : 0.22);
      const h = normal() * (esBulbo ? 0.38 : 0.12);
      const x = a * ejeBarra[0] + b * perpBarra[0];
      const z = a * ejeBarra[1] + b * perpBarra[1];
      color.copy(COLOR_BULBO).lerp(COLOR_DISCO, aleatorio() * 0.35);
      estrellas.anadir(x, h, z, color, POB_BULBO, aleatorio(),
        0.05 + aleatorio() * 0.05, 0.22 + 0.3 * aleatorio() ** 2);
    }

    // --- Disco viejo: exponencial, liso, sigue la curva de rotación ------------
    const enDisco = Math.round(totalEstrellas * 0.3);
    for (let i = 0; i < enDisco; ) {
      // Densidad superficial exp(−R/Rd): el radio sigue R·exp(−R/Rd), que es
      // una gamma de orden 2 (suma de dos exponenciales).
      const R = -ESCALA_RADIAL * Math.log(Math.max(1e-9, aleatorio() * aleatorio()));
      if (R < 2.5 || R > 16) continue;
      const phi = aleatorio() * Math.PI * 2;
      const x = R * Math.cos(phi);
      const z = -R * Math.sin(phi);
      if (!lejosDelSol(x, z, DESPEJE_ESTRELLAS)) continue;
      color.copy(COLOR_DISCO).lerp(COLOR_BULBO, aleatorio() * 0.4);
      estrellas.anadir(x, normal() * ESCALA_VERTICAL_VIEJA, z, color, POB_DISCO, aleatorio(),
        0.045 + aleatorio() * 0.05, 0.16 + 0.34 * aleatorio() ** 3);
      i++;
    }

    // --- Brazos: estrellas jóvenes, regiones HII y polvo ------------------------
    // Los mayores tienen más estrellas —en el infrarrojo del Spitzer son los
    // únicos que destacan también en población vieja— y el espolón de Orión,
    // bastante menos.
    const pesos = BRAZOS.map((b) => (b.mayor ? 1.35 : 0.8));
    const pesoEspolon = 0.3;
    const pesoTotal = pesos.reduce((a, b) => a + b, 0) + pesoEspolon;

    /** Punto de un brazo: radio sobre la espiral, desplazado a lo ancho. */
    const puntoEnBrazo = (brazo, ancho = 1, desplazamiento = 0) => {
      // Más estrellas hacia dentro, con la escala del disco joven (algo más
      // larga que la del viejo).
      const L = 3.5;
      const extension = 1 - Math.exp(-(brazo.hasta - brazo.desde) / L);
      const Rc = brazo.desde - L * Math.log(1 - aleatorio() * extension);
      const phi = Math.PI + Math.log(Rc / brazo.radio) / TAN_BRAZOS;
      // Anchura del brazo: crece con el radio, de unos 0,35 kpc dentro a 0,7 fuera.
      const sigma = (0.2 + 0.035 * Rc) * ancho;
      const R = Rc * (1 + desplazamiento) + normal() * sigma;
      return { R, phi: phi + normal() * 0.03 };
    };

    const puntoEnEspolon = (ancho = 1) => {
      const phi = ESPOLON.desde + aleatorio() * (ESPOLON.hasta - ESPOLON.desde);
      const Rc = ESPOLON.radio * Math.exp((phi - Math.PI) * ESPOLON.tan);
      return { R: Rc + normal() * 0.22 * ancho, phi };
    };

    const elegirBrazo = () => {
      let u = aleatorio() * pesoTotal;
      for (let k = 0; k < BRAZOS.length; k++) {
        u -= pesos[k];
        if (u <= 0) return BRAZOS[k];
      }
      return null;   // El espolón.
    };

    const enBrazos = Math.round(totalEstrellas * 0.45);
    for (let i = 0; i < enBrazos; ) {
      const brazo = elegirBrazo();
      const { R, phi } = brazo ? puntoEnBrazo(brazo) : puntoEnEspolon();
      const x = R * Math.cos(phi);
      const z = -R * Math.sin(phi);
      if (!lejosDelSol(x, z, DESPEJE_ESTRELLAS)) continue;
      color.copy(COLOR_JOVEN).lerp(COLOR_DISCO, aleatorio() * 0.45);
      const brillante = aleatorio() < 0.06;
      estrellas.anadir(x, normal() * ESCALA_VERTICAL_JOVEN, z, color, POB_JOVEN, aleatorio(),
        brillante ? 0.1 + aleatorio() * 0.06 : 0.05 + aleatorio() * 0.05,
        brillante ? 0.8 : 0.25 + 0.4 * aleatorio() ** 2);
      i++;
    }

    // Regiones HII: grupos de puntos que comparten fase, así que cada región
    // nace, brilla y se apaga entera.
    while (estrellas.cuenta < totalEstrellas) {
      const brazo = elegirBrazo();
      const { R, phi } = brazo ? puntoEnBrazo(brazo, 0.5) : puntoEnEspolon(0.5);
      const cx = R * Math.cos(phi);
      const cz = -R * Math.sin(phi);
      if (!lejosDelSol(cx, cz, DESPEJE_ESTRELLAS + 0.2)) continue;
      const fase = aleatorio();
      const miembros = Math.min(totalEstrellas - estrellas.cuenta, 3 + Math.floor(aleatorio() * 5));
      for (let m = 0; m < miembros; m++) {
        color.copy(COLOR_HII).lerp(COLOR_JOVEN, aleatorio() * 0.15);
        estrellas.anadir(cx + normal() * 0.06, normal() * 0.03, cz + normal() * 0.06, color, POB_HII,
          fase, 0.07 + aleatorio() * 0.07, 0.3 + aleatorio() * 0.25);
      }
    }

    // Franjas de polvo: en el borde INTERIOR de los brazos, que es donde la
    // onda de densidad comprime el gas antes de que forme estrellas.
    while (polvo.cuenta < totalPolvo) {
      const brazo = elegirBrazo();
      if (!brazo) continue;   // El espolón es demasiado estrecho para su franja.
      const { R, phi } = puntoEnBrazo(brazo, 0.35, -0.045);
      const x = R * Math.cos(phi);
      const z = -R * Math.sin(phi);
      if (R < 3 || !lejosDelSol(x, z, DESPEJE_POLVO)) continue;
      polvo.anadir(x, normal() * 0.04, z, ABSORCION, POB_POLVO, aleatorio(),
        0.22 + aleatorio() * 0.18, (brazo.mayor ? 0.2 : 0.14) * (0.5 + aleatorio()));
    }

    const disco = new THREE.Group();
    disco.name = 'disco-galactico';

    this.materialEstrellas = this._crearMaterial(FRAGMENT_ESTRELLAS, THREE.AdditiveBlending);
    this.materialPolvo = this._crearMaterial(FRAGMENT_POLVO, THREE.SubtractiveBlending);

    this.estrellas = this._crearPuntos(estrellas, this.materialEstrellas, 'estrellas');
    this.polvo = this._crearPuntos(polvo, this.materialPolvo, 'polvo');
    this.resplandor = this._crearResplandor();
    // El polvo tiene que pintarse DESPUÉS de las estrellas y del resplandor
    // para poder oscurecerlos: la mezcla sustractiva solo resta de lo que ya
    // hay pintado.
    this.resplandor.renderOrder = -0.5;
    this.estrellas.renderOrder = 0;
    this.polvo.renderOrder = 0.5;
    disco.add(this.resplandor, this.estrellas, this.polvo);

    /**
     * Colocación.
     *
     * El Sistema Solar está en el brazo de Orión, a R0 del centro: el disco se
     * desplaza para que la escena quede en esa posición, con el Sol en su
     * plano. Los ejes del disco se construyen con las direcciones reales del
     * centro y del polo norte galácticos (+X local hacia el centro, +Y hacia
     * el polo), giradas solo por el encuadre. Con +Y en el polo norte, el giro
     * horario del shader es el de verdad: visto desde el norte galáctico, la
     * Vía Láctea gira en el sentido de las agujas del reloj.
     */
    const encuadre = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), GIRO_ENCUADRE);
    const haciaCentro = DIRECCION_CENTRO_GALACTICO.clone().applyQuaternion(encuadre);
    const polo = POLO_NORTE_GALACTICO.clone().applyQuaternion(encuadre);
    // Las dos direcciones ya son perpendiculares; se fuerza para que el
    // redondeo de las constantes no deje la base torcida.
    polo.addScaledVector(haciaCentro, -polo.dot(haciaCentro)).normalize();
    const tercerEje = new THREE.Vector3().crossVectors(haciaCentro, polo);
    disco.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(haciaCentro, polo, tercerEje));
    disco.position.copy(haciaCentro).multiplyScalar(this.distanciaCentro);
    disco.scale.setScalar(this.unidadesPorKpc);
    disco.visible = false;      // Solo aparece al alejar mucho la cámara.
    return disco;
  }

  _crearResplandor() {
    const geometria = this.gestor.registrar(new THREE.PlaneGeometry(33, 33, 1, 1));
    // PlaneGeometry nace en XY; el disco está en XZ.
    geometria.rotateX(-Math.PI / 2);
    this.materialResplandor = this.gestor.registrar(
      new THREE.ShaderMaterial({
        uniforms: {
          tiempo: { value: 0 },
          opacidad: { value: 0 },
          colorBulbo: { value: new THREE.Color('#ffc987') },
          colorDisco: { value: new THREE.Color('#ffe6c4') },
          colorBrazos: { value: new THREE.Color('#a9c8ff') },
        },
        vertexShader: VERTEX_RESPLANDOR,
        fragmentShader: FRAGMENT_RESPLANDOR,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        // Se ve igual desde el norte que desde el sur galáctico.
        side: THREE.DoubleSide,
      }),
    );
    const plano = new THREE.Mesh(geometria, this.materialResplandor);
    plano.name = 'disco-galactico-resplandor';
    return plano;
  }

  _crearMaterial(fragmentShader, blending) {
    const material = this.gestor.registrar(
      new THREE.ShaderMaterial({
        uniforms: {
          tiempo: { value: 0 },
          segundos: { value: 0 },
          unidadesPorKpc: { value: this.unidadesPorKpc },
          mitadAlturaPx: { value: 400 },
          opacidad: { value: 0 },
        },
        vertexShader: VERTEX,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending,
        // three.js solo admite la mezcla sustractiva con alfa premultiplicado:
        // resta dst × color, sin mirar el alfa. El shader del polvo ya entrega
        // el color multiplicado por su opacidad, así que es lo que hace falta.
        premultipliedAlpha: blending === THREE.SubtractiveBlending,
      }),
    );
    // Constancia de que las estrellas son redondas: el shader lo hace por
    // construcción, y así lo puede comprobar quien lo mire desde fuera.
    material.userData.redondeado = true;
    return material;
  }

  _crearPuntos(lote, material, nombre) {
    const geometria = this.gestor.registrar(new THREE.BufferGeometry());
    geometria.setAttribute('position', new THREE.BufferAttribute(lote.posiciones, 3));
    geometria.setAttribute('tono', new THREE.BufferAttribute(lote.colores, 3));
    geometria.setAttribute('datos', new THREE.BufferAttribute(lote.datos, 4));
    // La esfera envolvente se calcula con las posiciones de partida; el giro
    // no cambia el radio de nadie, así que sigue valiendo.
    geometria.computeBoundingSphere();

    const puntos = new THREE.Points(geometria, material);
    puntos.name = `disco-galactico-${nombre}`;
    // El tamaño de un punto depende de la altura REAL del búfer donde se
    // dibuja, que con el post-procesado a media resolución no es la de la
    // ventana. Se lee justo antes de dibujar.
    const marco = new THREE.Vector4();
    puntos.onBeforeRender = (renderizador) => {
      renderizador.getCurrentViewport(marco);
      material.uniforms.mitadAlturaPx.value = marco.w / 2;
    };
    return puntos;
  }

  /**
   * El disco galáctico solo tiene sentido cuando la cámara se aleja lo
   * suficiente como para que el Sistema Solar sea un punto. Aparecer y
   * desaparecer con un fundido evita el parpadeo.
   *
   * Aquí avanza también el reloj galáctico, y solo mientras el disco se ve: así
   * el Sol sigue en el brazo de Orión cada vez que se vuelve a la vista
   * galáctica, en lugar de haber derivado durante los minutos en que nadie
   * miraba. Con movimiento reducido el reloj no avanza: el disco se queda
   * quieto, sin centelleo, pero entero.
   */
  actualizarSegunDistancia(distanciaCamara, delta) {
    const objetivo = distanciaCamara > 700 ? 1 : 0;
    const actual = this._opacidad;
    const nueva = actual + (objetivo * 0.75 - actual) * Math.min(1, delta * 2.2);

    this._opacidad = nueva;
    this.disco.visible = nueva > 0.01;

    if (this.disco.visible && !MOVIMIENTO_REDUCIDO?.matches) {
      this._segundos += delta;
      this._tiempo += delta * MA_POR_SEGUNDO;
    }

    for (const material of [this.materialEstrellas, this.materialPolvo, this.materialResplandor]) {
      material.uniforms.opacidad.value = nueva;
      material.uniforms.tiempo.value = this._tiempo;
      if (material.uniforms.segundos) material.uniforms.segundos.value = this._segundos;
    }
  }

  /** Sustituye el cielo por su versión completa, ya con la escena en marcha. */
  mejorarCielo() {
    if (!this.rutaCieloCompleta || this._mejorado) return;
    this._mejorado = true;

    const completa = this.gestor.cargarTextura(this.rutaCieloCompleta);
    let intentos = 0;
    const sondeo = setInterval(() => {
      if (completa.image) {
        clearInterval(sondeo);
        const anterior = this.cielo.material.map;
        this.cielo.material.map = completa;
        this.cielo.material.needsUpdate = true;
        if (anterior && anterior !== completa) anterior.dispose();
      } else if (++intentos > 150) clearInterval(sondeo);
    }, 100);
  }

  get objeto() {
    return this.grupo;
  }

  destruir() {
    for (const hijo of [this.cielo, this.resplandor, this.estrellas, this.polvo]) {
      hijo.geometry.dispose();
      hijo.material.map?.dispose();
      hijo.material.dispose();
    }
    this.grupo.clear();
    this.grupo.removeFromParent();
  }
}

/**
 * Búfer de partículas que se va llenando: posición (kpc), color y los cuatro
 * datos que lee el shader. Evita tres arrays paralelos y un índice que llevar
 * a mano en cada bucle.
 */
class Lote {
  constructor(capacidad) {
    this.posiciones = new Float32Array(capacidad * 3);
    this.colores = new Float32Array(capacidad * 3);
    this.datos = new Float32Array(capacidad * 4);
    this.cuenta = 0;
  }

  anadir(x, y, z, color, poblacion, fase, tamano, brillo) {
    const i = this.cuenta++;
    const p = this.posiciones;
    const c = this.colores;
    const d = this.datos;
    p[i * 3] = x;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = z;
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
    d[i * 4] = poblacion;
    d[i * 4 + 1] = fase;
    d[i * 4 + 2] = tamano;
    d[i * 4 + 3] = brillo;
  }
}
