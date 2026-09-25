/**
 * Sun — el Sol.
 *
 * Es la única fuente de luz de la escena (un PointLight en el origen) y el
 * único cuerpo que emite en lugar de reflejar, así que no usa el material
 * estándar sino un shader propio con granulación y una corona que lo envuelve.
 *
 * La granulación, las fáculas y los rayos de la corona son DECORATIVOS: no
 * representan fotosferas ni coronas medidas. Se generan con ruido determinista
 * y la interfaz los etiqueta como SIMULACIÓN. Lo que sí es real es la física
 * que imitan —celdas de convección, rotación diferencial, oscurecimiento del
 * limbo, perfil radial de la corona—, y cada ley va citada donde se usa.
 */

import * as THREE from 'three';
import { CelestialBody, rutaReducida } from './CelestialBody.js';
import { EPOCA_J2000 } from './Orbit.js';

/** Quien pide menos movimiento no quiere una superficie hirviendo. */
const MOVIMIENTO_REDUCIDO = window.matchMedia?.('(prefers-reduced-motion: reduce)');

const MS_POR_DIA = 86_400_000;

/**
 * Hasta dónde llega la corona, en radios solares.
 *
 * En luz blanca la corona se sigue fotografiando a varios radios del limbo en
 * los eclipses; más allá de cinco su brillo es ya una millonésima del de la
 * fotosfera y aquí solo añadiría relleno de píxeles. Es el semiancho del
 * rectángulo sobre el que se dibuja.
 */
const EXTENSION_CORONA = 5.0;

/**
 * Elementos del destello de lente: tamaño en píxeles, posición a lo largo del
 * eje óptico (0 = sobre el Sol, 1 = al otro lado del centro de la pantalla) y
 * color. Son los mismos que tenía el Lensflare de three.js al que sustituye.
 */
const ELEMENTOS_DESTELLO = [
  { tamano: 340, distancia: 0, color: 0xffe0b0 },
  { tamano: 42, distancia: 0.42, color: 0xffc078 },
  { tamano: 68, distancia: 0.62, color: 0xff9a3c },
  { tamano: 96, distancia: 0.85, color: 0x7fb2ff },
];

const VERTEX_DESTELLO = /* glsl */ `
  uniform vec2 centro;
  uniform vec2 escala;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Directamente en coordenadas de pantalla: el destello es de la lente, no
    // de la escena, y no tiene profundidad que respetar.
    gl_Position = vec4(position.xy * escala + centro, 0.0, 1.0);
  }
`;

const FRAGMENT_DESTELLO = /* glsl */ `
  uniform sampler2D mapa;
  uniform vec3 color;
  uniform float visibilidad;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(texture2D(mapa, vUv).rgb * color * visibilidad, 1.0);
  }
`;

/**
 * Ruido de valor y mezcla temporal, compartidos por la fotosfera y la corona.
 *
 * Viven en una sola cadena porque las dos capas necesitan exactamente la misma
 * garantía —evolucionar EN SU SITIO, sin arrastrar nada— y tenerla escrita dos
 * veces es la forma segura de que un día deje de ser la misma.
 */
const RUIDO_GLSL = /* glsl */ `
  // Ruido de valor clásico: barato y suficiente para campos suaves.
  float aleatorio(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }

  float ruido(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = aleatorio(i);
    float n100 = aleatorio(i + vec3(1.0, 0.0, 0.0));
    float n010 = aleatorio(i + vec3(0.0, 1.0, 0.0));
    float n110 = aleatorio(i + vec3(1.0, 1.0, 0.0));
    float n001 = aleatorio(i + vec3(0.0, 0.0, 1.0));
    float n101 = aleatorio(i + vec3(1.0, 0.0, 1.0));
    float n011 = aleatorio(i + vec3(0.0, 1.0, 1.0));
    float n111 = aleatorio(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z);
  }

  /**
   * Suma de octavas NORMALIZADA a [0, 1].
   *
   * Sin dividir por la suma de amplitudes, una sola octava daba valores entre
   * 0 y 0,5, y el «- 0.5» con el que se centra el flujo del plasma lo dejaba
   * entero en negativo: el campo no estaba centrado en cero, estaba desplazado
   * un cuarto hacia la misma esquina. No acumulaba —el desplazamiento era
   * constante—, pero el comentario prometía otra cosa. Ahora la media es 0,5
   * sea cual sea el número de octavas, y restar 0,5 centra de verdad.
   */
  float turbulencia(vec3 p, int octavas) {
    float suma = 0.0;
    float amplitud = 0.5;
    float total = 0.0;
    for (int i = 0; i < 4; i++) {
      if (i >= octavas) break;
      suma += amplitud * ruido(p);
      total += amplitud;
      p *= 2.03;
      amplitud *= 0.5;
    }
    return suma / total;
  }

  /**
   * Campos que evolucionan SIN DESPLAZARSE.
   *
   * Sumar el tiempo a la posición es lo evidente y lo equivocado: arrastra el
   * patrón entero en esa dirección y la superficie parece una cinta
   * transportadora. Aquí el tiempo elige el campo de ruido, no lo mueve: se
   * generan dos campos decorrelacionados —el mismo ruido evaluado en zonas muy
   * distintas del espacio— y se funde de uno al siguiente. Cada rasgo aparece,
   * dura y se deshace donde está, como el plasma real.
   *
   * El suavizado 3x²-2x³ en la mezcla evita que se note el salto de un paso al
   * siguiente, que si no aparece como un latido regular.
   */
  float mezclaTemporal(vec3 p, float t, int octavas) {
    float paso = floor(t);
    float x = fract(t);
    vec3 saltoA = vec3(paso * 17.3, paso * 9.1, paso * 23.7);
    vec3 saltoB = saltoA + vec3(17.3, 9.1, 23.7);
    float a = turbulencia(p + saltoA, octavas);
    float b = turbulencia(p + saltoB, octavas);
    return mix(a, b, x * x * (3.0 - 2.0 * x));
  }
`;

const VERTEX = /* glsl */ `
  // <common> define isPerspectiveMatrix(), que necesita <logdepthbuf_vertex>.
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosicion;
  varying vec3 vNormalLocal;
  varying vec3 vHaciaCamara;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosicion = position;
    // La normal SIN transformar: en una esfera apunta desde el centro, así que
    // su componente Y da directamente el seno de la latitud. Es lo que necesita
    // la rotación diferencial, y tiene que ser en el sistema del propio Sol,
    // no en el de la cámara.
    vNormalLocal = normalize(normal);
    vec4 vista = modelViewMatrix * vec4(position, 1.0);
    vHaciaCamara = normalize(-vista.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Después de calcular gl_Position: el fragmento lo lee.
    #include <logdepthbuf_vertex>
  }
`;

/**
 * Fragmento de la superficie solar.
 *
 * Cinco cosas que sí ocurren en el Sol real y que aquí se reproducen:
 *
 *   1. GRANULACIÓN. Celdas de convección de unos mil kilómetros: plasma
 *      caliente que sube por el centro, se enfría y baja por los bordes. De ahí
 *      que cada gránulo sea un polígono brillante separado de sus vecinos por
 *      un surco estrecho y oscuro. Viven entre ocho y veinte minutos, así que
 *      aparecen y se deshacen EN EL SITIO; no se desplazan. El ruido de valor
 *      que había antes daba manchas blandas sin forma de celda; ahora es un
 *      campo celular (Worley, F2 − F1), que dibuja exactamente eso: polígonos
 *      con un borde fino entre ellos.
 *   2. SUPERGRANULACIÓN. Una segunda escala mucho mayor y mucho más lenta,
 *      también celular. Sus bordes son donde se acumula el campo magnético
 *      —la red fotosférica—, y ahí nacen las fáculas.
 *   3. FÁCULAS. Zonas de la red magnética algo más calientes que su entorno.
 *      En luz blanca casi no se ven en el centro del disco y destacan cerca del
 *      limbo, donde el oscurecimiento las deja contra un fondo más apagado. Por
 *      eso su contraste depende de mu y no son un brillo repartido por igual.
 *   4. ROTACIÓN DIFERENCIAL. El Sol no gira como un sólido: no lo es. El
 *      ecuador da una vuelta en unos 24,5 días y las zonas polares tardan unos
 *      34. La malla gira rígida al periodo del catálogo, así que el desfase
 *      —creciente hacia los polos— se aplica aquí, sobre el ritmo.
 *   5. OSCURECIMIENTO DEL LIMBO. El borde del disco se ve MÁS OSCURO, no más
 *      brillante: mirando de canto, la línea de visión sale de la fotosfera a
 *      más altura, donde el plasma está más frío. Es lo primero que se nota en
 *      cualquier fotografía del Sol, y antes estaba justo al revés.
 *
 * El tamaño de los gránulos NO es el real: a escala, cada píxel del disco
 * contendría cientos de ellos y no se vería ninguno. Se agrandan para que la
 * textura se lea, y por eso todo esto es SIMULACIÓN.
 */
const FRAGMENT_SUPERFICIE = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  uniform sampler2D mapa;
  uniform float tiempo;
  uniform float dias;
  uniform vec3 colorCaliente;
  uniform vec3 colorFrio;
  uniform float tieneMapa;
  uniform float exposicion;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosicion;
  varying vec3 vNormalLocal;
  varying vec3 vHaciaCamara;

  // Ley de rotación diferencial del Sol, en grados por día:
  //   omega(lat) = A + B·sen²(lat) + C·sen⁴(lat)
  // Coeficientes de Snodgrass y Ulrich (1990), medidos siguiendo el patrón de
  // supergranulación. Dan 24,5 días de periodo en el ecuador y unos 34 cerca de
  // los polos, que es la cifra que aparece en cualquier manual.
  const float OMEGA_A = 14.713;
  const float OMEGA_B = -2.396;
  const float OMEGA_C = -1.787;
  // Periodo con el que gira la malla, del catálogo (609 h = 25,38 días).
  const float OMEGA_MALLA = 360.0 / 25.38;

  // Celdas por unidad de escena. Con el radio didáctico de 6 unidades salen
  // unos 48 gránulos por radio y unas 5 supergranulaciones: la proporción real
  // es de unas 30 a 1, pero con ella los gránulos no llegarían al píxel.
  const float ESCALA_GRANO = 8.0;
  const float ESCALA_SUPER = 0.9;

  ${RUIDO_GLSL}

  /**
   * Azar de una celda: cuatro números en [0, 1) que no cambian nunca para esa
   * celda. Tres fijan dónde está su punto y el cuarto, su carácter —ritmo de
   * vida, brillo—.
   */
  vec4 azarCelda(vec3 c) {
    vec4 h = vec4(
      dot(c, vec3(127.1, 311.7, 74.7)),
      dot(c, vec3(269.5, 183.3, 246.1)),
      dot(c, vec3(113.5, 271.9, 124.6)),
      dot(c, vec3(191.3, 47.9, 311.2)));
    return fract(sin(h) * 43758.5453);
  }

  /**
   * Campo celular de Worley que evoluciona EN SU SITIO.
   *
   * Devuelve la distancia al punto más cercano (F1), al segundo (F2) y el azar
   * de la celda ganadora. F2 − F1 vale cero justo en la frontera entre dos
   * celdas: es el surco intergranular.
   *
   * El tiempo NO se suma a la posición de muestreo —la misma trampa de la cinta
   * transportadora—: mueve el punto de cada celda en una órbita pequeña
   * alrededor de su sitio, con fase y ritmo propios. Las fronteras se
   * deforman, los gránulos crecen a costa de sus vecinos y se encogen, pero
   * ninguno viaja: pasado un ciclo, cada celda vuelve a estar donde estaba.
   *
   * El vecindario de 3×3×3 es el mínimo correcto con puntos que pueden
   * acercarse al borde de su celda; con 2×2×2 aparecen cortes rectos.
   */
  vec3 celdas(vec3 p, float t) {
    vec3 base = floor(p);
    vec3 f = fract(p);
    float f1 = 8.0;
    float f2 = 8.0;
    float azar = 0.0;
    for (int k = -1; k <= 1; k++) {
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec3 o = vec3(float(i), float(j), float(k));
          vec4 h = azarCelda(base + o);
          vec3 punto = o + 0.5 + 0.36 * sin(6.2831853 * (h.xyz + t * (0.55 + 0.45 * h.w)));
          vec3 d = punto - f;
          float d2 = dot(d, d);
          if (d2 < f1) {
            f2 = f1;
            f1 = d2;
            azar = h.w;
          } else if (d2 < f2) {
            f2 = d2;
          }
        }
      }
    }
    return vec3(sqrt(f1), sqrt(f2), azar);
  }

  void main() {
    #include <logdepthbuf_fragment>

    // --- Latitud, para modular la convección ---------------------------------
    // En una esfera la normal sin transformar apunta desde el centro, así que
    // su componente Y es directamente el seno de la latitud.
    float senLat = clamp(vNormalLocal.y, -1.0, 1.0);
    float sen2 = senLat * senLat;
    float omega = OMEGA_A + OMEGA_B * sen2 + OMEGA_C * sen2 * sen2;

    vec3 foto = tieneMapa > 0.5 ? texture2D(mapa, vUv).rgb : colorCaliente;

    // NO se cizalla el mapa con la rotación diferencial, y conviene dejar
    // escrito por qué: se intentó y el resultado era un rayado de cientos de
    // bandas. El desfase acumulado entre el ecuador y los polos crece sin
    // límite —a este ritmo, decenas de miles de grados en pocos años— y aplicado
    // sobre una fotografía fija la destroza. El Sol real nunca se ve así porque
    // sus rasgos no duran lo suficiente para arrastrar ese desfase: la
    // granulación se rehace cada diez o veinte minutos. La rotación diferencial
    // es un hecho que se mide siguiendo manchas durante días, no algo que se
    // aprecie en una sola imagen. Por eso se cuenta con palabras, en la
    // narración del Sol, en lugar de dibujarse.
    //
    // Lo que sí depende de la latitud es el RITMO de la convección, que es
    // sutil y no acumula nada.
    vec3 pGirado = vPosicion;
    float ritmoLatitud = omega / OMEGA_A;

    // --- Flujo del plasma ----------------------------------------------------
    // Las celdas ya nacían y se deshacían en su sitio, pero no SE MOVÍAN: la
    // superficie hervía sin correr. Al plasma real le pasan las dos cosas a la
    // vez, porque el gas que sube en el centro de una celda se derrama hacia
    // los lados y arrastra lo que tiene alrededor.
    //
    // Eso se consigue deformando el punto de muestreo con un campo de baja
    // frecuencia —domain warping—: no se desplaza la textura, se dobla el
    // espacio donde se evalúa el ruido. La diferencia importa, y es la misma
    // razón por la que no se cizalla el mapa unas líneas más arriba: un
    // desplazamiento acumula y acaba en cinta transportadora, mientras que este
    // campo se genera con mezclaTemporal y por tanto también evoluciona EN SU
    // SITIO. Por muy larga que sea la sesión, nada se arrastra sin límite.
    //
    // La amplitud es deliberadamente pequeña. Con 0,06 los gránulos se estiran
    // y se escurren unos sobre otros —un cuarto de celda como mucho—;
    // subiéndola, la superficie empieza a ondularse como agua y deja de parecer
    // una estrella.
    float ritmoFlujo = tiempo * 0.006 * ritmoLatitud;
    vec3 flujo = vec3(
      mezclaTemporal(pGirado * 0.28 + vec3(5.2, 1.3, 0.0), ritmoFlujo, 1),
      mezclaTemporal(pGirado * 0.28 + vec3(0.0, 5.2, 1.3), ritmoFlujo, 1),
      mezclaTemporal(pGirado * 0.28 + vec3(1.3, 0.0, 5.2), ritmoFlujo, 1)
    ) - 0.5;

    // La supergranulación se deforma menos que la granulación: las celdas
    // grandes son las que empujan, no las empujadas.
    vec3 pSuper = pGirado + flujo * 0.03;
    vec3 pGrano = pGirado + flujo * 0.06;

    // --- Ritmos --------------------------------------------------------------
    // La granulación se rehace en minutos; la supergranulación, en un día o
    // dos. Aquí ambas van aceleradas, pero conservan el orden: la grande es
    // mucho más lenta, y el flujo que las arrastra, más lento todavía.
    float ritmoGrano = tiempo * 0.07 * ritmoLatitud;
    float ritmoSuper = tiempo * 0.012 * ritmoLatitud;

    // --- Detalle según el tamaño en pantalla --------------------------------
    // Cuántas celdas caben en un píxel. Si caben varias, los surcos ya no se
    // pueden dibujar: solo producirían muaré y parpadeo. Se funden hacia su
    // valor medio y, cuando no queda nada que ver, ni se calculan: el Sol
    // visto desde lejos no paga veintisiete celdas por píxel para nada.
    // (Las derivadas se toman fuera de cualquier rama, como exige GLSL.)
    float huellaGrano = length(fwidth(pGrano * ESCALA_GRANO));
    float huellaSuper = length(fwidth(pSuper * ESCALA_SUPER));
    float detalleGrano = 1.0 - smoothstep(0.35, 0.9, huellaGrano);
    float detalleSuper = 1.0 - smoothstep(0.35, 0.9, huellaSuper);

    // --- Granulación ---------------------------------------------------------
    // Valor medio de un gránulo, para cuando no se ve: así el disco no cambia
    // de brillo al alejarse, solo pierde el grano.
    float grano = 0.8;
    if (detalleGrano > 0.0) {
      vec3 g = celdas(pGrano * ESCALA_GRANO, ritmoGrano);
      float frontera = g.y - g.x;
      // Surco estrecho: un décimo de celda, más lo que ocupe un píxel para que
      // el borde no salga dentado. El píxel se mide con la huella calculada
      // fuera de la rama: una derivada dentro de un if no está definida.
      float surco = smoothstep(0.0, 0.06 + 0.5 * huellaGrano, frontera);
      // Centro más caliente que el borde de la celda, que es por donde baja
      // el plasma ya enfriado.
      float centro = 1.0 - smoothstep(0.1, 0.9, g.x);
      // Cada gránulo sube y baja de brillo a su ritmo: nace, dura y se apaga.
      float vida = 0.86 + 0.14 * sin(6.2831853 * (g.z * 5.3 + ritmoGrano * 0.6));
      float celda = surco * (0.74 + 0.26 * centro) * vida;
      grano = mix(grano, celda, detalleGrano);
    }

    // --- Supergranulación y red magnética -------------------------------------
    float red = 0.0;
    float super_ = 0.5;
    if (detalleSuper > 0.0) {
      vec3 s = celdas(pSuper * ESCALA_SUPER, ritmoSuper);
      float frontera = s.y - s.x;
      // La red ocupa los bordes de la supergranulación, más ancha que el surco
      // de un gránulo porque el campo magnético se reparte a su alrededor.
      red = (1.0 - smoothstep(0.0, 0.22 + huellaSuper, frontera)) * detalleSuper;
      super_ = mix(0.5, 1.0 - s.x, detalleSuper);
    }

    // --- Color de la fotosfera -----------------------------------------------
    // La fotografía del catálogo aporta el tono y las variaciones grandes, pero
    // con el contraste recortado a la mitad: sus manchas oscuras de gran
    // tamaño competían con la granulación y el disco se veía emborronado.
    float lumFoto = dot(foto, vec3(0.2126, 0.7152, 0.0722));
    float lumCaliente = dot(colorCaliente, vec3(0.2126, 0.7152, 0.0722));
    vec3 tono = mix(colorCaliente, foto * (lumCaliente / max(lumFoto, 1e-3)), 0.35);
    float variacion = mix(1.0, lumFoto / lumCaliente, 0.35);

    // Los surcos no son negros: son plasma algo más frío, algo más rojo y
    // bastante más apagado —en luz blanca, un tercio menos de brillo, no un
    // abismo—. Los centros tiran hacia el blanco amarillento, que es el color
    // real del fondo de una celda de convección.
    vec3 base = mix(tono * vec3(0.78, 0.66, 0.58), tono, grano);
    base += vec3(1.0, 0.86, 0.6) * pow(grano, 3.0) * 0.22;
    base *= variacion * (0.92 + 0.16 * super_);

    // El Sol EMITE, no refleja, y tiene que salir del rango normal para que el
    // bloom lo recoja y se vea como una fuente de luz en vez de como una bola
    // de roca caliente. Sin este empuje, el oscurecimiento del limbo —que solo
    // puede restar— dejaba el disco entero apagado y parduzco.
    //
    // La exposición la baja la propia malla cuando el Sol llena el encuadre,
    // como haría el diafragma automático de cualquier cámara: con el disco
    // ocupando toda la pantalla, el bloom sumaba luz de todas partes y lo
    // quemaba en blanco, granulación incluida.
    base *= 1.9 * exposicion;

    // --- Oscurecimiento del limbo -------------------------------------------
    // mu es el coseno del ángulo entre la visual y la normal: 1 en el centro
    // del disco, 0 justo en el borde. La ley cuadrática clásica I(mu)/I(0) =
    // 1 - u1(1-mu) - u2(1-mu)² con u1 = 0,84 y u2 = -0,20 reproduce bien el
    // perfil del Sol en luz visible.
    float mu = clamp(dot(normalize(vNormal), normalize(vHaciaCamara)), 0.0, 1.0);
    float unMenosMu = 1.0 - mu;
    float limbo = 1.0 - 0.84 * unMenosMu + 0.20 * unMenosMu * unMenosMu;
    base *= clamp(limbo, 0.30, 1.0);

    // --- Fáculas -------------------------------------------------------------
    // Siguen la red de la supergranulación y solo destacan hacia el limbo: el
    // contraste crece desde casi cero en el centro del disco hasta un máximo
    // cerca del borde, y se apaga en el borde mismo, donde ya no queda
    // fotosfera que mirar. Se concentran en los cinturones de actividad, por
    // debajo de unos 35° de latitud —la ley de Spörer—, en parches que van y
    // vienen; fuera de ellos queda un resto débil, como las fáculas polares.
    float cercaLimbo = smoothstep(0.8, 0.3, mu) * smoothstep(0.02, 0.14, mu);
    float cinturon = 1.0 - smoothstep(0.5, 0.7, abs(senLat));
    float parches = smoothstep(0.45, 0.7, mezclaTemporal(pSuper * 0.22 + vec3(11.0, 3.0, 7.0), ritmoSuper * 0.5, 1));
    float faculas = red * cercaLimbo * mix(0.25, 1.0, parches * cinturon);
    base *= 1.0 + 0.6 * faculas;

    // Y en el borde mismo, el tono se vuelve más rojizo: ahí la visual atraviesa
    // capas más altas y más frías. Es el mismo motivo del oscurecimiento, visto
    // en color en lugar de en brillo.
    base = mix(base, base * colorFrio, smoothstep(0.45, 0.0, mu) * 0.45);

    gl_FragColor = vec4(base, 1.0);
  }
`;

/**
 * Vértice de la corona: un rectángulo orientado siempre a la cámara.
 *
 * El giro hacia la cámara se hace aquí y no con un THREE.Sprite porque el
 * Sprite no admite un ShaderMaterial propio. Se toma el centro del Sol en el
 * espacio de la vista y se despliegan las esquinas en el plano de la pantalla;
 * la escala sale de la matriz del modelo, de modo que la corona crece con el
 * Sol cuando se pasa a escala real sin que nadie tenga que acordarse.
 */
const VERTEX_CORONA = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  uniform float extension;

  varying vec2 vRadios;
  varying vec2 vEje;

  void main() {
    vec4 centro = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float escala = length(modelMatrix[0].xyz);
    vec4 vista = centro + vec4(position.xy * escala, 0.0, 0.0);
    gl_Position = projectionMatrix * vista;

    // Coordenadas en radios solares: 1 es el limbo.
    vRadios = position.xy * extension;

    // Eje de giro del Sol proyectado en la pantalla. La corona cuelga del nodo
    // inclinado, cuyo eje Y ES el eje de rotación. Su longitud dice cuánto se
    // ve de canto: cero si se mira desde encima de un polo.
    vec3 ejeMundo = normalize(modelMatrix[1].xyz);
    vEje = (viewMatrix * vec4(ejeMundo, 0.0)).xy;

    #include <logdepthbuf_vertex>
  }
`;

/**
 * Fragmento de la corona.
 *
 * PERFIL RADIAL. El brillo de la corona en luz blanca cae con la distancia
 * según la fórmula de Baumbach (1937), que sigue en cualquier manual de física
 * solar:
 *
 *     I(r) ∝ 0,0532·r^-2,5 + 1,425·r^-7 + 2,565·r^-17     (r en radios solares)
 *
 * Los dos últimos términos son la corona interior, que cae muy deprisa; el
 * primero, la cola que llega lejos. Tal cual, a dos radios ya vale medio
 * centésimo de lo que vale en el limbo y no se vería nada. Las fotografías de
 * eclipse resuelven lo mismo con un filtro radial que comprime el rango; aquí
 * se hace igual, elevando el perfil a 0,45. La FORMA es la de Baumbach; el
 * brillo absoluto no puede serlo, porque la corona real es un millón de veces
 * más débil que el disco y fuera de un eclipse no se ve.
 *
 * RAYOS. Los serpentinas (streamers) son estructuras radiales: nacen anchas
 * sobre las regiones activas y se afilan hacia fuera. Se dibujan con ruido
 * que depende SOLO del ángulo —así cada rasgo es una recta que sale del Sol—
 * con un exponente que crece con el radio, que es lo que las estrecha. Se
 * agrupan hacia el ecuador solar, como en los eclipses cercanos al mínimo,
 * con penachos finos y débiles en los polos. Evolucionan despacio y EN SU
 * SITIO, con la misma mezcla temporal que la fotosfera. SIMULACIÓN.
 */
const FRAGMENT_CORONA = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  uniform float tiempo;
  uniform float extension;
  uniform float intensidad;
  uniform vec3 colorInterior;
  uniform vec3 colorExterior;

  varying vec2 vRadios;
  varying vec2 vEje;

  ${RUIDO_GLSL}

  // Valor de Baumbach en el limbo, para normalizar el perfil a 1 en r = 1.
  const float BAUMBACH_LIMBO = 0.0532 + 1.425 + 2.565;

  void main() {
    #include <logdepthbuf_fragment>

    // Dentro del disco la corona queda oculta por la propia esfera (prueba de
    // profundidad); se acota a 1 para no evaluar potencias disparatadas.
    float r = max(length(vRadios), 1.0);
    vec2 direccion = normalize(vRadios + vec2(1e-6, 0.0));

    float baumbach = 0.0532 * pow(r, -2.5) + 1.425 * pow(r, -7.0) + 2.565 * pow(r, -17.0);
    float perfil = pow(baumbach / BAUMBACH_LIMBO, 0.45);

    // --- Orientación respecto al eje solar -----------------------------------
    float proyeccion = clamp(length(vEje), 0.0, 1.0);
    vec2 eje = proyeccion > 1e-3 ? vEje / length(vEje) : vec2(0.0, 1.0);
    float polar = abs(dot(direccion, eje));        // 1 hacia los polos aparentes
    float ecuatorial = smoothstep(0.25, 0.95, 1.0 - polar);
    // Mirando desde encima de un polo todo el limbo es ecuador: el sesgo se
    // desvanece en lugar de marcar una dirección que no existe.
    float pesoSerpentinas = mix(1.0, mix(0.3, 1.0, ecuatorial), proyeccion);
    float pesoPenachos = mix(0.5, 1.0 - ecuatorial, proyeccion);

    // --- Rayos radiales -------------------------------------------------------
    // Ruido evaluado sobre un círculo: depende del ángulo y de nada más, y da
    // la vuelta sin costura.
    float t = tiempo * 0.02;
    float anchas = mezclaTemporal(vec3(direccion * 2.3, 3.7), t, 2);
    float finas = mezclaTemporal(vec3(direccion * 6.0, 8.1), t * 1.4, 1);
    float afilado = mix(1.5, 3.5, smoothstep(1.0, 3.5, r));
    float serpentinas = pow(anchas, afilado) * 1.1;
    float penachos = pow(finas, afilado + 1.5) * 0.45;
    float rayos = 0.6 + serpentinas * pesoSerpentinas + penachos * pesoPenachos;

    // Sin silueta: el brillo llega a cero ANTES del borde del rectángulo. Con
    // mezcla aditiva, lo que vale cero no suma nada y el contorno no existe.
    float borde = 1.0 - smoothstep(extension * 0.45, extension * 0.98, length(vRadios));

    vec3 color = mix(colorInterior, colorExterior, smoothstep(1.0, 3.0, r));
    gl_FragColor = vec4(color * perfil * rayos * borde * intensidad, 1.0);
  }
`;

export class Sun extends CelestialBody {
  constructor(datos, gestor) {
    super(datos, gestor);

    // La malla estándar sobra: se sustituye por la de shader.
    this.malla.geometry.dispose();
    this.malla.material.dispose();
    this.ejeInclinado.remove(this.malla);

    this.malla = this._crearSuperficie();
    this.malla.userData.cuerpo = this;
    this.ejeInclinado.add(this.malla);

    this.corona = this._crearCorona();
    // La corona cuelga del eje inclinado, no del pivote: así hereda la escala
    // del Sol al cambiar a escala real —antes se quedaba del tamaño didáctico,
    // enterrada dentro de un Sol cien veces mayor— y el shader puede leer el
    // eje de giro para orientar los rayos. No gira con la fotosfera porque es
    // hermana de la malla, no hija; y la orientación hacia la cámara la pone el
    // propio shader.
    this.ejeInclinado.add(this.corona);

    /**
     * Única fuente de luz del Sistema Solar.
     *
     * Sin atenuación (decay 0) a propósito: en la escala didáctica Neptuno
     * está a 195 unidades y con atenuación física realista quedaría negro. La
     * intensidad se ajusta para que los planetas queden expuestos, no
     * quemados: con el bloom encima, pasarse de luz los convierte en manchas
     * blancas sin textura.
     */
    this.luz = new THREE.PointLight(0xfff3d6, 1.9, 0, 0);
    this.pivote.add(this.luz);

    this.luzAmbiente = new THREE.AmbientLight(0x2a3d52, 0.16);  // Un mínimo para que la cara nocturna no sea negro puro.

    this._tiempo = 0;
  }

  _crearSuperficie() {
    const geometria = this.gestor.registrar(new THREE.SphereGeometry(this.radio, 96, 64));
    const tieneMapa = Boolean(this.datos.render.textura);

    this.materialSuperficie = this.gestor.registrar(
      new THREE.ShaderMaterial({
        uniforms: {
          // Como el resto de cuerpos, el Sol arranca con la textura reducida.
          mapa: { value: tieneMapa ? this.gestor.cargarTextura(rutaReducida(this.datos.render.textura)) : null },
          tieneMapa: { value: tieneMapa ? 1 : 0 },
          tiempo: { value: 0 },
          // Días transcurridos en la SIMULACIÓN, no en el reloj de pared: la
          // rotación diferencial tiene que ir al mismo ritmo que la escena, que
          // corre a la velocidad de tiempo que el usuario haya elegido.
          dias: { value: 0 },
          colorCaliente: { value: new THREE.Color('#ffb547') },
          colorFrio: { value: new THREE.Color('#ff7a18') },
          exposicion: { value: 1 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT_SUPERFICIE,
      }),
    );

    const malla = new THREE.Mesh(geometria, this.materialSuperficie);
    const centro = new THREE.Vector3();
    // Se calcula aquí, justo antes de dibujar y con la cámara del render, y no
    // en actualizar(), que no conoce la cámara. Es una cuenta de un vector.
    malla.onBeforeRender = (_r, _e, camara) => {
      malla.getWorldPosition(centro);
      const distancia = Math.max(1e-6, centro.distanceTo(camara.position));
      const mitadCampo = Math.tan(THREE.MathUtils.degToRad(camara.fov ?? 50) / 2);
      // Radio aparente en medias alturas de pantalla: 0,5 en la vista de
      // enfoque del Sol, que se deja tal cual; a partir de ahí se cierra.
      const radioAparente = this.radio / distancia / mitadCampo;
      this.materialSuperficie.uniforms.exposicion.value =
        1 - 0.45 * THREE.MathUtils.smoothstep(radioAparente, 0.6, 1.6);
    };
    return malla;
  }

  /**
   * Corona.
   *
   * La primera versión era una esfera mayor con un shader de limbo. Se
   * descartó: por muy suave que sea el degradado, la esfera tiene una silueta,
   * y esa silueta se ve como un disco recortado alrededor del Sol. La segunda
   * fue un Sprite con un degradado radial pintado en un lienzo: sin silueta,
   * pero inmóvil e idéntico en todas las direcciones, que es lo único que la
   * corona real nunca es.
   *
   * Esta es un rectángulo orientado a la cámara con un shader en coordenadas
   * polares: perfil radial de Baumbach y rayos que salen del Sol y cambian
   * despacio. Sigue sin silueta —el brillo llega a cero antes del borde— y
   * sigue costando dos triángulos.
   */
  _crearCorona() {
    const geometria = this.gestor.registrar(new THREE.PlaneGeometry(2, 2));
    this.materialCorona = this.gestor.registrar(
      new THREE.ShaderMaterial({
        uniforms: {
          tiempo: { value: 0 },
          extension: { value: EXTENSION_CORONA },
          intensidad: { value: 1.0 },
          // Blanco cálido cerca del limbo y más pálido hacia fuera: la corona
          // en luz blanca es luz de la fotosfera dispersada por electrones, del
          // mismo color que el disco. Se templa hacia el ámbar solo para que no
          // desentone con la fotosfera estilizada de la escena.
          colorInterior: { value: new THREE.Color('#ffc27a') },
          colorExterior: { value: new THREE.Color('#ffe2bd') },
        },
        vertexShader: VERTEX_CORONA,
        fragmentShader: FRAGMENT_CORONA,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    const rectangulo = new THREE.Mesh(geometria, this.materialCorona);
    rectangulo.name = 'corona';
    // El rectángulo mide 2×2: escalado así, su semiancho son EXTENSION_CORONA
    // radios solares.
    rectangulo.scale.setScalar(this.radioBase * EXTENSION_CORONA);
    rectangulo.renderOrder = -1;
    return rectangulo;
  }

  /**
   * Genera el halo del destello en un lienzo: un degradado radial con alfa.
   *
   * Es preferible a cargar un PNG por dos motivos: no añade una petición de red
   * y, sobre todo, no hay riesgo de usar por error una textura opaca —una
   * imagen sin canal alfa aparece como un cuadrado de color sobre la escena—.
   */
  _crearHalo(tamano = 256) {
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = tamano;
    const ctx = lienzo.getContext('2d');

    const centro = tamano / 2;
    const degradado = ctx.createRadialGradient(centro, centro, 0, centro, centro, centro);
    // El degradado se apaga hacia NEGRO, no hacia naranja transparente. El
    // destello se mezcla en modo aditivo y, con esa mezcla, un píxel de alfa 0
    // pero color naranja sigue sumando luz: aparecería un cuadrado sólido
    // alrededor del halo. Apagando también el color, el borde suma cero.
    degradado.addColorStop(0.0, 'rgba(255, 246, 224, 1)');
    degradado.addColorStop(0.16, 'rgba(255, 214, 150, 0.85)');
    degradado.addColorStop(0.42, 'rgba(180, 100, 35, 0.30)');
    degradado.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = degradado;
    ctx.fillRect(0, 0, tamano, tamano);

    const textura = new THREE.CanvasTexture(lienzo);
    textura.colorSpace = THREE.SRGBColorSpace;
    return this.gestor.registrar(textura);
  }

  /**
   * Destello de lente. Es un efecto de cámara, no un fenómeno del Sol: se
   * añade porque forma parte del lenguaje visual de la interfaz de referencia.
   *
   * POR QUÉ NO ES EL LENSFLARE DE THREE.JS. Aquel decide si el destello se ve
   * pintando un cuadradito magenta en la posición de la luz con prueba de
   * profundidad y leyendo después el color de esos píxeles. Con el búfer de
   * profundidad logarítmico de esta escena esa prueba no puede salir nunca
   * bien —compara una profundidad lineal con una logarítmica—, así que lo que
   * acababa leyendo era el color de la fotosfera en el centro del disco, y la
   * visibilidad salía de una cuenta sobre ese color. Con la granulación
   * hirviendo, el destello se encendía y se apagaba de un fotograma a otro y a
   * ratos tapaba el Sol entero con un halo blanco.
   *
   * Este decide con geometría, que no depende de ningún píxel:
   *   · si el Sol está delante de la cámara y dentro del encuadre;
   *   · si algún cuerpo se interpone en la visual hasta su centro (un rayo
   *     contra las esferas de los cuerpos, que son pocas y baratas);
   *   · y cuánto ocupa el Sol en pantalla. Un destello es el reflejo de una
   *     fuente casi puntual dentro de la lente: con el disco llenando media
   *     pantalla deja de tener sentido y, sobre todo, taparía la fotosfera
   *     justo cuando se la está mirando.
   *
   * @param {() => THREE.Object3D[]} obtenerOcluyentes mallas que pueden tapar
   *   el Sol; se piden en cada fotograma porque cambian con la escala.
   */
  anadirDestello(obtenerOcluyentes = () => []) {
    const halo = this._crearHalo();
    this.haloDestello = halo;
    this._obtenerOcluyentes = obtenerOcluyentes;

    const geometria = this.gestor.registrar(new THREE.PlaneGeometry(2, 2));
    const grupo = new THREE.Group();
    grupo.name = 'destello';

    ELEMENTOS_DESTELLO.forEach((elemento, indice) => {
      const material = this.gestor.registrar(
        new THREE.ShaderMaterial({
          uniforms: {
            mapa: { value: halo },
            color: { value: new THREE.Color(elemento.color) },
            centro: { value: new THREE.Vector2() },
            escala: { value: new THREE.Vector2() },
            visibilidad: { value: 0 },
          },
          vertexShader: VERTEX_DESTELLO,
          fragmentShader: FRAGMENT_DESTELLO,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      const malla = new THREE.Mesh(geometria, material);
      malla.frustumCulled = false;
      // Encima de todo y el primero antes que los demás: es el que calcula la
      // posición de los cuatro en su onBeforeRender, con la cámara del render.
      malla.renderOrder = 1e6 + indice;
      malla.userData.elemento = elemento;
      grupo.add(malla);
    });

    grupo.children[0].onBeforeRender = (renderizador, _escena, camara) =>
      this._colocarDestello(renderizador, camara);

    this.pivote.add(grupo);
    this.destello = grupo;
    this._visibilidadDestello = 0;
    this._ultimoDestello = performance.now();
    return grupo;
  }

  _colocarDestello(renderizador, camara) {
    const aux = (this._auxDestello ??= {
      mundo: new THREE.Vector3(),
      vista: new THREE.Vector3(),
      pantalla: new THREE.Vector3(),
      direccion: new THREE.Vector3(),
      marco: new THREE.Vector4(),
      rayo: new THREE.Raycaster(),
    });

    this.pivote.getWorldPosition(aux.mundo);
    aux.vista.copy(aux.mundo).applyMatrix4(camara.matrixWorldInverse);
    aux.pantalla.copy(aux.mundo).project(camara);

    let objetivo = 0;
    if (aux.vista.z < 0) {
      // Dentro del encuadre, con un fundido en el último tramo hacia el borde.
      const fuera = Math.max(Math.abs(aux.pantalla.x), Math.abs(aux.pantalla.y));
      const enEncuadre = 1 - THREE.MathUtils.smoothstep(fuera, 0.85, 1.05);

      // Radio aparente del Sol en unidades de pantalla (1 = media altura).
      const distancia = aux.vista.length();
      const mitadCampo = Math.tan(THREE.MathUtils.degToRad(camara.fov ?? 50) / 2);
      const radioAparente = this.radio / Math.max(1e-6, distancia) / mitadCampo;
      const puntual = 1 - THREE.MathUtils.smoothstep(radioAparente, 0.06, 0.25);

      objetivo = enEncuadre * puntual;

      if (objetivo > 0) {
        aux.direccion.copy(aux.mundo).sub(camara.position).normalize();
        aux.rayo.set(camara.position, aux.direccion);
        aux.rayo.far = Math.max(0, distancia - this.radio);
        const ocluyentes = this._obtenerOcluyentes?.() ?? [];
        for (const malla of ocluyentes) {
          if (malla === this.malla || !malla.visible) continue;
          if (aux.rayo.intersectObject(malla, false).length) {
            objetivo = 0;
            break;
          }
        }
      }
    }

    // Transición breve en tiempo real: un planeta que cruza por delante apaga
    // el destello en un par de décimas, no de golpe.
    const ahora = performance.now();
    const paso = Math.min(0.1, (ahora - this._ultimoDestello) / 1000);
    this._ultimoDestello = ahora;
    this._visibilidadDestello += (objetivo - this._visibilidadDestello) * Math.min(1, paso * 10);

    renderizador.getCurrentViewport(aux.marco);
    const ancho = Math.max(1, aux.marco.z);
    const alto = Math.max(1, aux.marco.w);
    for (const malla of this.destello.children) {
      const { tamano, distancia } = malla.userData.elemento;
      const u = malla.material.uniforms;
      // Los reflejos secundarios se reparten por el eje óptico —la recta que
      // une la fuente con el centro de la imagen—, que es como se comporta una
      // lente real.
      u.centro.value.set(
        aux.pantalla.x - aux.pantalla.x * 2 * distancia,
        aux.pantalla.y - aux.pantalla.y * 2 * distancia,
      );
      u.escala.value.set((tamano / alto) * (alto / ancho), tamano / alto);
      u.visibilidad.value = this._visibilidadDestello;
    }
  }

  /**
   * Sustituye la textura de la fotosfera por la de resolución completa.
   *
   * Se sobrescribe porque el Sol no dibuja con `material.map` sino con un
   * ShaderMaterial propio: la textura va a un uniforme. La espera —cargar,
   * sondear, aplicar una sola vez— la pone la clase base.
   */
  mejorarTextura() {
    this._conTexturaCompleta((completa) => {
      const anterior = this.materialSuperficie.uniforms.mapa.value;
      this.materialSuperficie.uniforms.mapa.value = completa;
      if (anterior && anterior !== completa) anterior.dispose();
    });
  }

  actualizar(fecha, delta = 0) {
    super.actualizar(fecha);

    // Con movimiento reducido la superficie se congela: sigue teniendo toda su
    // textura, pero deja de hervir. El pliego exige respetar la preferencia en
    // cualquier animación nueva, y una superficie que bulle es exactamente eso.
    // El mismo reloj gobierna la corona: sus rayos también se quedan quietos.
    if (!MOVIMIENTO_REDUCIDO?.matches) this._tiempo += delta;

    if (this.materialSuperficie) {
      this.materialSuperficie.uniforms.tiempo.value = this._tiempo;
      // La rotación diferencial va con la fecha simulada, no con el reloj de
      // pared: si el usuario acelera el tiempo, el ecuador tiene que adelantar
      // a los polos más deprisa, igual que hace todo lo demás en la escena.
      this.materialSuperficie.uniforms.dias.value =
        (fecha.getTime() - EPOCA_J2000) / MS_POR_DIA;
    }

    // La corona ya no late: sus rayos cambian despacio, que es lo que hace la
    // real. Una pulsación del conjunto quedaría de dibujo animado.
    if (this.materialCorona) {
      this.materialCorona.uniforms.tiempo.value = this._tiempo;
    }
  }

  destruir() {
    if (this.destello) {
      // Los cuatro elementos comparten geometría: se libera una sola vez.
      this.destello.children[0]?.geometry.dispose();
      for (const malla of this.destello.children) malla.material.dispose();
      this.destello.removeFromParent();
    }
    this.haloDestello?.dispose();
    this.corona.geometry.dispose();
    this.corona.material.dispose();
    this.corona.removeFromParent();
    this.luz.removeFromParent();
    this.luzAmbiente.removeFromParent();
    super.destruir();
  }
}
