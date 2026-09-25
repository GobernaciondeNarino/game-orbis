# ORBIS · Interfaz Galáctica del Sistema Solar

Interfaz holográfica e inmersiva del Sistema Solar completo, con navegación por
**gestos de mano**, **comandos de voz** y **narración en audio**. Se ejecuta
íntegramente en el navegador y se despliega como estáticos sobre Apache: **sin
paso de compilación, sin Node.js en producción y sin procesos en segundo plano**.

> **Estado: las nueve fases completadas.** Escena tridimensional navegable con
> el Sol, los ocho planetas, cinco planetas enanos, diecinueve satélites,
> anillos, cinturones y entorno galáctico; catálogo cuyas cifras proceden de
> JPL Horizons; HUD completa en DOM con sus dos vistas, transición
> interrumpible, anotaciones ancladas a la superficie y arco de datos;
> narración por audio con subtítulos sincronizados; control por gestos con
> MediaPipe; control por voz con parser tolerante a errores de transcripción;
> optimización con las dos escalas y nivel de detalle de texturas; y un
> asistente conversacional que responde preguntas libres sin inventarse un solo
> dato. Consulta el [plan de fases](#plan-de-fases).
>
> **Queda por comprobar a mano**, y no se puede hacer aquí:
> una pasada en **Safari y iPad** —el WebKit de Playwright no arranca en el
> contenedor de desarrollo— y la medición de los **60 fps en hardware real**,
> porque aquí solo hay render por software. Ver
> [`docs/RENDIMIENTO-Y-NAVEGADORES.md`](docs/RENDIMIENTO-Y-NAVEGADORES.md).

---

## Puesta en marcha

Necesitas PHP para probar `api/`; para el frontend basta cualquier servidor
estático.

```bash
git clone https://github.com/GobernaciondeNarino/game-galaxia.git
cd game-galaxia

# Copias locales de Three.js y de las tipografías (solo la primera vez)
node tools/vendor.mjs three
node tools/vendor.mjs fuentes

# Modelo de MediaPipe, ~7,5 MB (necesario a partir de la fase 6)
node tools/vendor.mjs mediapipe

# Servidor de desarrollo, equivalente a lo que hará Apache
php -S localhost:8080
```

Abre <http://localhost:8080>. Verás la pantalla de arranque con el diagnóstico
del entorno. Con `?debug=1` se activa el registro detallado en consola.

Comprobación del backend: <http://localhost:8080/api/health.php>
(añade `?red=1` para probar además la conectividad con ElevenLabs).

---

## Versiones fijadas

| Dependencia | Versión | Por qué esa |
|---|---|---|
| **Three.js** | `r0.184.0` | Es la última versión cuya superficie de API está verificada contra este código. `WebGLRenderer`, `EffectComposer`, `UnrealBloomPass`, `OutputPass` y `CSS2DRenderer` se comportan como espera ORBIS. Se descarta la rama r0.185, publicada después, para no arrastrar cambios de API no verificados a mitad de proyecto. La compilación minificada pesa **356 kB** (≈90 kB con Brotli). |
| **MediaPipe Tasks Vision** | `0.10.35` | Última de la línea `0.10.x`, la que usa la API `FilesetResolver.forVisionTasks()` + `HandLandmarker.createFromOptions()` documentada y estable. La línea `1.0.x` es posterior y reestructura el paquete; migrar a ella es trabajo de la fase 6, no una suposición de partida. |
| **PHP** | `8.1+` | El código de `api/` se escribe en sintaxis compatible con 7.4 para que funcione también en instalaciones de Plesk sin migrar, pero solo se da soporte a 8.1+. Ver `docs/DESPLIEGUE-PLESK.md`. |

Ambas librerías se sirven desde `/vendor`, **nunca desde un CDN de terceros**.
`tools/vendor.mjs` las descarga en desarrollo y resuelve por sí solo los
imports internos de cada addon de Three.js.

---

## Arquitectura

Tres carpetas y una raíz limpia. La regla es la de WordPress y sirve por lo
mismo: quien abre el proyecto sabe a la primera si lo que busca es **motor**,
**contenido** o **administración**, sin conocer el proyecto.

```
index.html            Cáscara: importmap, precargas y contenedores de la HUD
wj-config.php         Claves y ajustes del servidor. NUNCA se versiona
wj-config-ejemplo.php La plantilla comentada de lo anterior
.htaccess             HTTPS, MIME, compresión, caché, CSP y rutas privadas

wj-admin/             Panel de configuración: https://dominio/wj-admin

wj-includes/          EL MOTOR — nada de aquí es contenido
  api/                Endpoints: health · tts · stt · chat · frase ·
                      respuesta · meteoros
  lib/                Clases PHP: Config · Cache · RateLimiter · Catalogo ·
                      Respuestas · Asistente · Conversacion · Horizons ·
                      Meteoros · Respuesta          (no se sirven por HTTP)
  vendor/             Composer: SDK de Anthropic    (no se sirve por HTTP)
  externos/           Three.js y MediaPipe, versión fijada
  css/                fuentes · nucleo (reinicio + fichas) · hud ·
                      animaciones · responsive
  js/
    main.js           Arranque
    core/             App (estado y bus) · Diagnostico · SceneManager ·
                      PostFX · CameraRig · Loop
    system/           SolarSystem · CelestialBody · Orbit · Sun · Rings ·
                      AsteroidBelt · Galaxy
    ui/               HUD · panels/ · Reticula · Subtitulos
    input/            HandTracking · GestureRecognizer · VoiceCommands ·
                      Preguntas · FallbackControls
    audio/            Narrator · SFX
    utils/            dom · rutas · storage (memoria) · debug · math

wj-content/           LO QUE EL SITIO TIENE Y GENERA
  data/               sistema-solar.json (GENERADO, catálogo maestro)
                      fisica-jpl.json (GENERADO desde Horizons)
                      complementos.json · textos.json · comandos-voz.json ·
                      preguntas.json · meteoros.json · asistente.json
  assets/             textures · skybox · models · fonts · sfx
  cache/              audio · efemerides · respuestas · limites
  logs/               Registro propio del backend

tools/                Solo desarrollo. Nunca se sirve
docs/                 Despliegue, gestos y comandos, notas técnicas
```

**Dónde vive cada ruta, y por qué solo ahí.** El mapa de carpetas está en dos
sitios y en ninguno más: `Config::contenido()` e `Config::includes()` en el
backend, y `rutaApi()`, `rutaDatos()`, `rutaMedios()` y `rutaExterna()` en el
frontend. Ningún otro módulo escribe `wj-content/…` a mano. Antes había
literales `'/data/…'` y `'/cache/…'` repartidos por todo el código, y mover una
carpeta obligaba a buscarlos uno por uno con la garantía de dejarse alguno.

### Decisiones técnicas

**Sin empaquetador, por obligación y por conveniencia.** El destino es un Plesk
sin Node.js. El `importmap` de `index.html` resuelve los especificadores
desnudos (`three`, `three/addons/…`) contra `/vendor`, así que el mismo código
que se edita es el que se despliega: no hay *source maps* ni un artefacto
compilado que pueda divergir del fuente.

**Un solo objeto global: `App`.** Vive en `js/core/App.js` y hace de estado de
sesión y bus de eventos. Los subsistemas no se conocen entre sí; se comunican
emitiendo y escuchando eventos (`estado:cuerpoActivo`, `voz:comando`…). Es lo
que permite que un cuerpo seleccionado por gesto, por voz o con el ratón siga
exactamente el mismo camino.

**La HUD es DOM, no textura.** Texto real, seleccionable, accesible a lectores
de pantalla y navegable con Tab. Una HUD dibujada en una textura 3D se ve mejor
en capturas y es inutilizable para quien no ve la pantalla.

**Dos escalas.** La didáctica comprime tamaños y distancias con funciones
deterministas para que el sistema sea navegable. La real usa proporciones
verdaderas —una unidad son 1.000 km— y enseña algo que ninguna ilustración
muestra: que el Sistema Solar está esencialmente vacío. Es incómoda de navegar a
propósito. El rango de profundidad que exige, de 0,011 a 4,5 millones de
unidades, obliga a usar buffer de profundidad logarítmico.

**Funciona en cualquier ruta.** Todas las rutas internas —incluidas las del
`importmap`— son relativas al directorio de la aplicación, y `js/utils/rutas.js`
deduce la raíz de la URL de su propio módulo. ORBIS se puede servir tanto en
`https://ejemplo.gov.co/` como en `https://ejemplo.gov.co/juegos/orbis/` sin
cambiar una línea. Ver `docs/DESPLIEGUE-PLESK.md` §3 bis.

**Los errores dicen de quién es el problema.** El diagnóstico de arranque
distingue un fallo del navegador (WebGL desactivado) de un fallo del despliegue
(falta `vendor/`, MIME mal configurado, PHP apagado) y, en el segundo caso,
muestra la ruta exacta que falta y el comando para arreglarlo. Nunca anuncia
«tu navegador no puede» cuando lo que falla es el servidor.

**Ninguna cifra se escribe a mano.** El catálogo se genera con
`tools/datos-jpl.mjs`, que consulta la API de JPL Horizons y guarda, junto a
cada valor, la línea literal de la que se extrajo. Lo que Horizons no publica
—el radio de Eris, por ejemplo— se toma de literatura citada en
`data/complementos.json`. Lo que no está en ninguna de las dos vale `null` y la
interfaz lo muestra como `SIN DATOS`. Ver `docs/DATOS.md`.

**Órbitas keplerianas reales.** Cada cuerpo se sitúa resolviendo la ecuación de
Kepler con sus seis elementos orbitales referidos a J2000. Si el reloj de la
escena marca una fecha, los planetas están donde estaban ese día — no en una
fase decorativa.

**Lo que se puede probar sin navegador, se prueba.** El reconocedor de gestos y
el parser de voz son módulos de lógica pura, sin DOM ni dispositivos, y tienen
su banco de pruebas en `tools/`. Corren en cada *push* y ya han encontrado tres
errores reales que en una prueba manual con webcam habrían pasado por buenos.

**Accesibilidad comprobada, no supuesta.** `tools/contraste.mjs` calcula la
relación de contraste WCAG de cada pareja texto/fondo de las fichas de diseño y
falla el *push* si alguna baja de 4,5:1. En una interfaz oscura con paneles
translúcidos es facilísimo dejar texto a 2,7:1 que se lee bien en el monitor de
quien lo programó; de hecho pasó, y el verificador lo cazó.

**Estado en memoria, nunca en `localStorage`.** Las preferencias
(`js/utils/storage.js`) duran lo que dure la pestaña. No se deja rastro en el
equipo del visitante.

**Rejilla persistente.** Los paneles laterales y las barras se maquetan una vez
y no se recrean al alternar entre `VISTA DE SISTEMA` y `VISTA DE CUERPO`: solo
cambia el contenido de la zona central. Por eso la transición no parpadea.

### Estrategia de rendimiento en red

El público accederá desde conexiones locales de velocidad desigual, así que la
carga se ha diseñado como un requisito, no como un ajuste posterior:

1. **Un único origen.** Cero peticiones a CDN: sin DNS, sin *handshake* TLS
   adicional, sin depender de que un tercero esté accesible desde la red del
   visitante.
2. **Compresión en Apache.** Brotli con respaldo a gzip para HTML, CSS, JS y
   JSON (`.htaccess` §3). Three.js baja de 356 kB a unos 90 kB.
3. **Caché inmutable de un año** para `vendor/`, tipografías, texturas, modelos
   y audio; revalidación obligatoria para `js/`, `css/` y `data/`, de modo que
   se pueda corregir sin pedir a nadie que vacíe la caché.
4. **Tipografías recortadas.** Solo los subconjuntos `latin` y `latin-ext`, y
   Oswald en su versión variable: 140 kB en total en lugar de casi 400 kB.
5. **Precarga de la ruta crítica** (`preload` de tipografías y datos,
   `modulepreload` de `main.js` y Three.js) para adelantar las peticiones sin
   esperar a que el analizador de CSS las descubra.
6. **Texturas por niveles.** Primero el nivel ligero de 512 px, para que la
   escena sea navegable de inmediato; el mapa completo se cambia durante el
   viaje de cámara, que dura más de un segundo, así que no se percibe. El
   arranque baja de los 42 MB de mapas completos a 718 kB de texturas.

---

## Seguridad

- **Ninguna credencial llega al navegador.** Las dos claves —`ELEVENLABS_API_KEY`
  para la voz y `ANTHROPIC_API_KEY` para el asistente— se leen de las variables
  de entorno de Plesk o, en su defecto, de `wj-config.php`, que está en
  `.gitignore` y bloqueado por `.htaccess`. La plantilla comentada de los diez
  valores configurables es [`wj-config-ejemplo.php`](wj-config-ejemplo.php);
  el procedimiento está en
  [`docs/DESPLIEGUE-PLESK.md` §5](docs/DESPLIEGUE-PLESK.md).
- **`wj-includes/api/health.php` dice qué está configurado y de dónde sale**, nunca su
  valor. Existe porque el fallo más común no es una clave ausente sino una
  variable de entorno antigua ganándole en silencio al archivo que se acaba de
  editar.
- **`wj-includes/api/tts.php` no acepta texto del cliente.** Recibe un `bodyId`, y el texto
  que sintetiza lo toma de su propia copia de `wj-content/data/sistema-solar.json`. Un
  endpoint que sintetizara el texto recibido sería una pasarela gratuita hacia
  una API de pago a costa del titular de la cuenta; así, el conjunto de textos
  posibles es finito, conocido y cacheable, y el gasto está acotado.
- **`wj-includes/api/chat.php` tampoco sintetiza texto del cliente.** La respuesta del
  asistente se guarda bajo un hash en `wj-content/cache/respuestas/` y `wj-includes/api/tts.php` solo
  acepta ese hash: el endpoint de voz nunca dice lo que le manden.
- **Dos límites en los tres endpoints de pago** —narración, transcripción y
  conversación—: uno por IP y hora, y un techo diario del sitio entero. El
  primero acota lo que gasta una persona; el segundo, lo que gasta el sitio, que
  es lo que un límite por IP no ve: con diez direcciones distintas, sesenta
  peticiones por hora cada una son seiscientas. Servir de caché y precargar no
  consumen cupo. Al llegar a un techo se dice cuál de los dos ha sido, porque
  «has preguntado demasiado» y «el sitio ha gastado su día» piden cosas
  distintas de quien lo lee.
- Los contadores guardan un **hash de la IP con una sal propia de la
  instalación**, no la IP: el límite funciona igual y en el disco no queda una
  lista de quién ha entrado. Verificación TLS obligatoria en las llamadas
  salientes. La respuesta cruda de ElevenLabs va al registro, nunca al cliente.
- **CSP sin `unsafe-inline` en los scripts.** El único bloque en línea es el
  `importmap` —los navegadores no admiten import maps externos—, autorizado por
  su hash SHA-256. Si lo modificas, ejecuta `node tools/csp-hash.mjs`.
- `tools/comprobar-secretos.sh` rastrea credenciales en todo lo que se sirve al
  navegador y se ejecuta en cada *push*.

---

## Plan de fases

| Fase | Entregable | Estado |
|---|---|---|
| 0 | Estructura, `index.html` con importmap, `.htaccess`, `wj-includes/api/health.php`, documentación inicial | ✅ Completada |
| 1 | Escena Three.js: Sol, ocho planetas, órbitas, skybox, controles de ratón, bloom | ✅ Completada |
| 2 | `sistema-solar.json` con datos verificados, satélites, anillos y cinturón de asteroides | ✅ Completada |
| 3 | HUD en DOM: elementos persistentes, `VISTA DE SISTEMA`, gráficos y tira de navegación | ✅ Completada |
| 4 | `VISTA DE CUERPO`, transición interrumpible, `CameraRig`, anotaciones y arco de datos | ✅ Completada |
| 5 | `wj-includes/api/tts.php` con caché y límite de peticiones; `Narrator.js` con subtítulos | ✅ Completada |
| 6 | Control por manos con MediaPipe y todos los gestos | ✅ Completada |
| 7 | Control por voz con parser de intenciones y alternativa vía `stt.php` | ✅ Completada |
| 8 | Optimización, pruebas cruzadas de navegador y guía de despliegue | ✅ Completada, salvo la pasada manual en Safari |
| 9 | Asistente conversacional con herramientas, posiciones en vivo de JPL Horizons y navegación adaptada al móvil | ✅ Completada |

La fase 9 no estaba en el plan original. Salió de usar la interfaz: el
«asistente» de la fase 7 respondía una lista cerrada de preguntas, y lo que
hacía falta era poder preguntar cualquier cosa. Entró con ella la consulta de
posiciones en vivo a JPL Horizons, el calendario de lluvias de meteoros, las
texturas reales de diecisiete cuerpos más, la barra fija de navegación del móvil
y la hoja de comandos plegable.

---

## Documentación

- [`docs/DESPLIEGUE-PLESK.md`](docs/DESPLIEGUE-PLESK.md) — subida, permisos,
  variables de entorno y prueba de humo.
- [`docs/GESTOS-Y-COMANDOS.md`](docs/GESTOS-Y-COMANDOS.md) — referencia para la
  persona que usa la interfaz.
- [`docs/DATOS.md`](docs/DATOS.md) — esquema del catálogo y política de rigor.
- [`docs/RENDIMIENTO-Y-NAVEGADORES.md`](docs/RENDIMIENTO-Y-NAVEGADORES.md) —
  qué se descarga, fugas de recursos, resultados por navegador y qué queda por
  comprobar a mano.

## Licencia y créditos

**Idea original y diseño: Jonnathan Bucheli Galindo.** La concepción de ORBIS —qué debía ser esta
interfaz, cómo se navega, cómo se ve y cómo se habla con ella— es suya. Lo que
hay en este repositorio es la construcción de esa idea.

Código de ORBIS: Gobernación de Nariño.
Three.js (MIT), MediaPipe Tasks Vision (Apache-2.0), Oswald y Hind Madurai
(SIL OFL 1.1) y la skill `ui-ux-pro-max` (MIT) conservan sus respectivas
licencias en `wj-includes/externos/`, `wj-content/assets/fonts/` y `.claude/skills/`.
