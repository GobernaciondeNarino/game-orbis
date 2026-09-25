# Despliegue de ORBIS en Plesk

Guía completa para publicar ORBIS en un hosting Plesk con Apache y PHP, sin
Node.js en el servidor, sin acceso root y sin procesos en segundo plano.

---

## 1. Requisitos del servidor

| Requisito | Valor | Cómo comprobarlo |
|---|---|---|
| PHP | 8.1 o superior | Plesk → *Dominios* → **Configuración de PHP** |
| Extensión `curl` | activada | `wj-includes/api/health.php` la comprueba |
| Extensión `json` | activada | idem |
| Extensión `openssl` | activada | idem |
| `allow_url_fopen` | no es necesario | ORBIS usa `curl`, no `file_get_contents` remoto |
| Módulos de Apache | `mod_rewrite`, `mod_headers`, `mod_deflate` (y `mod_brotli` si está) | Plesk → *Apache y nginx* |
| Certificado SSL | válido y activo | **Imprescindible**: sin HTTPS no hay cámara ni micrófono |

> **Si el servidor está en PHP 7.4:** el código de `api/` está escrito con
> sintaxis compatible con 7.4 a propósito, así que arrancará. Aun así, PHP 7.4
> lleva sin soporte de seguridad desde noviembre de 2022 y **no se da soporte a
> esa configuración**. Sube a 8.1+ desde el propio panel de Plesk antes de
> publicar: es un desplegable, no requiere migración de código.

---

## 2. Preparar el paquete antes de subirlo

Las copias locales de las librerías y las tipografías se generan en tu equipo,
no en el servidor. En una carpeta de trabajo con Node.js instalado:

```bash
node tools/vendor.mjs three       # wj-includes/externos/three/  (~450 kB)
node tools/vendor.mjs fuentes     # wj-content/assets/fonts/  (~140 kB) + css/fuentes.css
node tools/vendor.mjs mediapipe   # wj-includes/externos/mediapipe/ + wj-content/assets/models/ (~15 MB)
node tools/csp-hash.mjs           # sincroniza el hash CSP del importmap
```

Comprueba que no se cuela ninguna credencial:

```bash
bash tools/comprobar-secretos.sh
```

---

## 3. Subir los archivos

Destino: la raíz del documento del dominio, normalmente
`/var/www/vhosts/<dominio>/httpdocs/`.

### Opción A — Git (recomendada)

Plesk → *Dominios* → **Git** → *Añadir repositorio*:

- URL: `https://github.com/GobernaciondeNarino/game-galaxia.git`
- Rama: la que corresponda
- Ruta de despliegue: `httpdocs`
- Modo: *Despliegue automático*

`vendor/`, `wj-content/assets/fonts/` y `wj-content/assets/models/` están versionados, así que llegan
con el repositorio: los dos modelos de MediaPipe —`hand_landmarker.task` (7,8 MB)
y `face_landmarker.task` (3,8 MB)— incluidos. No hay que subir nada por FTP.

> Este apartado decía lo contrario —que el modelo de manos no estaba en git y
> había que subirlo aparte— y era falso: sí lo está, y lo estaba ya. Seguir esa
> instrucción no rompía nada, pero hacía perder el tiempo.

### Opción B — FTP / Administrador de archivos

Sube **todo** el árbol respetando la estructura. Comprueba especialmente que
llegan los archivos ocultos, que muchos clientes FTP esconden por omisión:

```
.htaccess          el .htaccess raíz          cache/.htaccess
wj-includes/lib/.htaccess  wj-content/logs/.htaccess
```

**Si `.htaccess` no llega, la página funciona pero queda sin HTTPS forzado, sin
CSP y con `wj-config.php` accesible.** Es el error de despliegue más frecuente.

---

## 3 bis. Desplegar en un subdirectorio

ORBIS funciona igual en la raíz de un dominio
(`https://ejemplo.gov.co/`) que en un subdirectorio
(`https://ejemplo.gov.co/juegos/orbis/`). No hay que tocar ni una línea de
código: **todas las rutas internas son relativas al directorio de la
aplicación**, incluidas las del `importmap`.

Para que eso se cumpla hay tres condiciones, y las tres están ya resueltas en
el repositorio. Si alguna vez editas estos archivos, respétalas:

1. **`index.html` lleva `<base href="./">`** y el `importmap` apunta a
   `./vendor/…`, nunca a `/vendor/…`. Una ruta que empiece por `/` se resuelve
   contra la raíz del dominio y devolverá 404 en cuanto la aplicación no esté
   en la raíz.
2. **`js/utils/rutas.js` deduce la raíz** a partir de la URL de su propio
   módulo. Todo `fetch()` interno pasa por `rutaApp()`; ningún módulo escribe
   una ruta absoluta a mano.
3. **`.htaccess` fuerza `DirectorySlash On`.** Sin la barra final, el navegador
   resuelve `css/`, `js/` y `vendor/` contra el directorio *padre*. Apache
   redirige `…/orbis` a `…/orbis/` por omisión, pero conviene comprobarlo:

   ```
   curl -I https://tu-dominio/juegos/orbis
   → 301 Location: https://tu-dominio/juegos/orbis/
   ```

Sube el árbol completo dentro del subdirectorio, incluido su propio
`.htaccess`. La configuración de Apache es local a esa carpeta: no interfiere
con el resto del sitio.

**Comprobación rápida** una vez subido:

```
https://tu-dominio/juegos/orbis/wj-includes/externos/three/build/three.module.min.js  → 200
https://tu-dominio/juegos/orbis/wj-includes/api/health.php                            → JSON
https://tu-dominio/juegos/orbis/wj-config.php                                         → 403
```

Si el primero devuelve 404, `wj-includes/externos/` no se subió: la pantalla de
arranque lo dirá con esas mismas palabras y con la ruta exacta que falta.

---

## 4. Permisos

```bash
# Lectura para todo el sitio
find httpdocs -type d -exec chmod 755 {} \;
find httpdocs -type f -exec chmod 644 {} \;

# Escritura para la caché de audio y los registros
chmod 775 httpdocs/wj-content/cache/audio httpdocs/wj-content/logs httpdocs/wj-content/ajustes httpdocs/wj-content/conocimiento
```

El propietario debe ser el usuario del suscriptor de Plesk (habitualmente el
mismo con el que corre PHP-FPM). Desde el *Administrador de archivos* de Plesk
esto ya se respeta; por FTP con otro usuario, no siempre.

Verificación rápida: `wj-includes/api/health.php` marca `cache_audio` en verde solo si la
carpeta es realmente escribible por PHP.

---

## 5. Configuración: claves, voz y topes de gasto

Todo lo configurable de ORBIS —las dos claves de API, el código de la voz, el
modelo y los topes de gasto— sale del mismo sitio. **Ningún valor de estos toca
el navegador jamás**: los lee PHP en el servidor y ahí se quedan.

### 5.1 El archivo de configuración

```bash
cp wj-config-ejemplo.php wj-config.php
# edita wj-config.php y rellena lo que necesites
chmod 640 wj-config.php
```

En el *Administrador de archivos* de Plesk: duplicar `wj-config-ejemplo.php` y
renombrar la copia a `wj-config.php`.

La plantilla trae las quince claves comentadas una a una y **todas vacías**. Lo
que dejes vacío usa el valor por omisión que trae ORBIS, escrito en el
comentario de cada clave. Así que **no hace falta rellenar nada**: con
`ELEVENLABS_API_KEY` y `ANTHROPIC_API_KEY`, puestas aquí o desde el panel, ORBIS
funciona entero.

> **Este archivo es la capa de abajo.** Lo que se guarde desde el panel de
> `/wj-admin/` gana a lo que pongas aquí. Ponlo aquí para lo que quieras dejar
> fijado de una vez; usa el panel para lo que vayas a cambiar.

Después **comprueba que está bloqueado**:

```
https://tu-dominio/wj-config.php   →  debe devolver 403
```

Si devuelve una página en blanco o el contenido del archivo, detén el
despliegue y revisa `el .htaccess raíz` y que `AllowOverride` esté habilitado.

### 5.1 bis  El panel: https://tu-dominio/wj-admin/

La forma cómoda de poner las claves y los topes sin abrir un archivo por FTP.
Tiene cinco pestañas, y cada una es una URL que se puede enlazar y recargar
(`?pestana=apis`, `?pestana=conocimiento&cuerpo=marte`…):

| Pestaña | Qué hay |
|---|---|
| **Inicio** | Lo que falta por configurar, el estado de cada servicio con la fecha de su última verificación, y qué cuerpos tienen conocimiento añadido |
| **APIs** | ElevenLabs, Anthropic y Gemini, cada uno con **Guardar y verificar** |
| **Conocimiento** | La fuente de conocimiento de cada cuerpo, por categorías: Sol, planetas, planetas enanos, lunas (agrupadas por planeta) y cinturones |
| **Analítica** | Google Analytics 4, con verificación y el recuento de envíos del día |
| **Topes de gasto** | Los límites por visitante, los techos diarios y la sal de los contadores |

**Verificar hace peticiones de verdad**, no mira si el campo está relleno. En
ElevenLabs comprueba que la clave vale, que el modelo existe, el saldo del mes,
qué es de verdad la voz configurada (idioma y uso) y, sobre todo, **sintetiza una
frase**: es la única prueba que detecta una clave sin el permiso
`text_to_speech`, el fallo que dejó a ORBIS narrando con la voz del navegador con
todo lo demás en verde. El audio de prueba queda en la caché y se oye en el
reproductor «Suena ahora». En Anthropic pregunta al catálogo de modelos si el
modelo escrito existe, que es como se detecta un `claude-sonnet-4.6` mal escrito.

**Antes de abrir el sitio al público, cambia su clave.** Mientras no lo hagas se
usa `orbis-admin`, que viene escrita en el repositorio: cualquiera que vea el
código la conoce, y el panel avisa en rojo mientras siga puesta.

Se cambia en Plesk (Dominios → Configuración de PHP → Variables de entorno) con
el nombre `WJ_ADMIN_CLAVE`, o en `wj-config.php`. **En ningún otro sitio, y a
propósito:** si el panel pudiera cambiarse su propia clave, quien entrase una vez
con la de por omisión dejaría fuera al administrador de verdad.

Mejor todavía, guarda un hash en lugar de la clave, y así la real no queda
escrita en el disco:

```bash
php -r 'echo password_hash("tu-clave", PASSWORD_DEFAULT), "\n";'
```

**Qué se puede tocar desde el panel: todo menos su propia clave.** Lo que
guardes aquí manda sobre las variables de entorno de Plesk y sobre
`wj-config.php`. Ningún campo aparece bloqueado.

Antes era al revés, y bastaba con rellenar `wj-config.php` —el paso 5.1 de esta
misma guía— para que el panel enseñara esos campos en gris y sin poder tocarlos.
El razonamiento de entonces era que quien tiene acceso al servidor fija un valor
y ningún panel web se lo mueve; el problema es que quien rellenó el archivo es
la misma persona que abre el panel, y ahora quiere cambiar la voz sin entrar por
FTP. Un panel de administración que no puede administrar no protege de nada:
solo obliga a rodearlo.

`WJ_ADMIN_CLAVE` sigue fuera, y ahí sí es a propósito: un panel que puede
reescribir su propia cerradura no es una cerradura.

**Que el panel mande no es silencioso.** Cada campo dice si hay un valor debajo
—en Plesk o en `wj-config.php`—, cuál de los dos está ganando, y que el de abajo
está escrito y no se usa. Al borrar el del panel se vuelve al de abajo, y la
casilla lo dice con esas palabras. Sin ese aviso, la regla nueva sería la nueva
causa de «lo he cambiado y suena igual», solo que por el otro lado.

**Lo que falta por configurar.** Al entrar, el panel lista arriba lo que aún no
está puesto por ninguna de las tres vías, y qué deja de funcionar mientras
falte: la clave de ElevenLabs, la de Anthropic y la sal de los contadores. Cada
línea lleva un enlace a su campo. Lo que ya esté resuelto en Plesk o en
`wj-config.php` no aparece: cuenta como configurado.

**Si el panel no puede escribir, lo dice al entrar y no al guardar.** Los campos
de clave salen siempre vacíos, así que un fallo al guardar obligaría a volver a
pegarlas todas. Cuando `wj-content/ajustes/` no es escribible por el usuario con
el que corre PHP —el caso típico es desplegar con un usuario y servir con
otro— aparece un aviso en rojo con el `chmod` exacto, y el botón de guardar sale
apagado.

Lo que se guarda desde el panel va a `wj-content/ajustes/ajustes.json`, fuera de
lo que se sirve por HTTP y fuera del repositorio. No se reescribe `wj-config.php`
a propósito: generar código PHP desde un formulario web es la forma más corta de
acabar ejecutando lo que alguien escriba en un campo de texto.

Ocho intentos fallidos por dirección y hora. Los aciertos no gastan cupo, así
que entrar y salir varias veces no deja fuera a nadie.

---

### 5.2 Alternativa para las claves: variables de entorno

Plesk → *Dominios* → **Configuración de PHP** → *Variables de entorno*. Sirve
para cualquiera de los veintiún nombres de la tabla de abajo.

Es mejor sitio para las dos claves de API: no tocan el disco del sitio, así que
no pueden acabar en una copia de seguridad descargable ni viajar en un
despliegue por FTP.

> **La variable de entorno gana al archivo, y el panel gana a las dos.** El
> orden completo es: panel → variable de entorno → `wj-config.php` → el valor
> que trae ORBIS. `wj-includes/api/health.php` dice de dónde sale cada valor en
> marcha, y el panel avisa campo por campo de lo que está tapando.

> Con PHP-FPM puede hacer falta reiniciar el *pool* del dominio para que las
> variables se apliquen (Plesk lo ofrece en la misma pantalla).

### 5.3 Todo lo que se puede configurar

| Nombre | Para qué | Si falta |
|---|---|---|
| `WJ_ADMIN_CLAVE` | **Clave del panel** `/wj-admin/`. Solo aquí o en `wj-config.php` | `orbis-admin`, la del repositorio — **cámbiala** |
| `ELEVENLABS_API_KEY` | Narración hablada y dictado por voz | Narra la voz del navegador, bastante peor |
| `ELEVENLABS_VOICE_ID` | **Código de la voz** de ORBIS | `gbTn1bmCvNgk0QEAVyfM`, «Enrique M. Nieto» |
| `ELEVENLABS_MODEL_ID` | Modelo de síntesis | `eleven_multilingual_v2` |
| `ELEVENLABS_VOCES_PERMITIDAS` | Voces que `wj-includes/api/tts.php` acepta, separadas por comas | Solo la voz activa |
| `ELEVENLABS_STT_MODEL` | Modelo de transcripción | `scribe_v1` |
| `ANTHROPIC_API_KEY` | **Asistente conversacional** | El asistente no conversa; las preguntas del catálogo se siguen respondiendo |
| `ORBIS_MODELO` | Modelo del asistente | `claude-opus-5` |
| `GEMINI_API_KEY` | Gemini, **solo** para redactar borradores desde el panel (ver 5.7) | No se ofrece redactar con Gemini |
| `GEMINI_MODELO` | Modelo de Gemini | `gemini-3.8-flash` |
| `GEMINI_USO_EDITORIAL` | `1` para habilitarlo tras leer sus términos | Gemini no se usa aunque haya clave |
| `REDACTOR_PROVEEDOR` | Quién redacta los borradores: `auto`, `gemini` o `anthropic` | `auto` |
| `GA_ID_MEDICION` | ID de medición de GA4 (`G-…`) | No se mide nada |
| `GA_SECRETO_API` | Secreto del Measurement Protocol | No se mide nada |
| `LIMITE_GENERACIONES_HORA` | Narraciones nuevas por IP y hora | `30` |
| `LIMITE_TRANSCRIPCIONES_HORA` | Transcripciones por IP y hora | `120` |
| `LIMITE_CONVERSACION_HORA` | Respuestas del asistente por IP y hora | `60` |
| `ORBIS_SAL_LIMITES` | Sal con la que se anonimizan las IP de los contadores | Una compartida por todas las instalaciones — **pon una propia** |
| `TOPE_DIARIO_NARRACION` | Narraciones nuevas de **todo el sitio** en 24 h | `500` |
| `TOPE_DIARIO_TRANSCRIPCION` | Transcripciones de todo el sitio en 24 h | `1500` |
| `TOPE_DIARIO_CONVERSACION` | Respuestas del asistente de todo el sitio en 24 h | `400` |

### Dos límites, y hacen falta los dos

`LIMITE_*_HORA` acota lo que gasta **una persona**. `TOPE_DIARIO_*` acota lo que
gasta **el sitio**. Con sesenta conversaciones por IP y hora, diez direcciones
distintas son seiscientas respuestas de un modelo de pago en una tarde: el
límite por IP no lo ve, porque cada una va sobrada de cupo.

Los techos diarios **no son un objetivo de uso, son un freno de emergencia**. Un
día normal no se acerca. Si se alcanzan, algo está pasando —un bucle, un
rastreador, alguien probando— y es preferible que el sitio deje de gastar unas
horas a que siga pagando. Cuando se llega, ORBIS lo dice con esas palabras y
sigue funcionando: la voz pasa a la del navegador, las narraciones ya guardadas
suenan igual y las preguntas del catálogo se contestan como siempre. Solo se
detiene lo que cuesta dinero.

Los valores por omisión son un punto de partida razonable, no una decisión de
presupuesto: revísalos con la factura de las dos APIs delante. Poner un cero
desactiva ese techo.

`ORBIS_SAL_LIMITES` merece un minuto: los topes cuentan por visitante y ORBIS
guarda un **hash** de la IP en lugar de la IP, para que en `wj-content/cache/limites/` no
quede una lista de quién ha entrado. Un hash sin sal propia se puede deshacer
probando —solo hay unos pocos miles de millones de direcciones—, así que ponle
algo tuyo: `head -c 32 /dev/urandom | base64`.

**Ninguna es obligatoria para que ORBIS arranque.** Sin las dos claves la
interfaz funciona entera: se navega, se lee, se compara y se pregunta al
catálogo. Lo que se pierde es la voz sintetizada y la conversación libre.

### 5.4 Cambiar la voz, y oírla antes

**Entra en `/wj-admin/`, pestaña APIs, tarjeta de ElevenLabs.** Hay un
desplegable con diez voces en español y, debajo, un reproductor por cada una
—el primero, «Suena ahora», es la que está puesta en el sitio, aunque venga de
`wj-config.php` y no sea una de las diez—: todas dicen la misma frase, con los
mismos ajustes que usa la narración de verdad. Escúchalas, elige y pulsa
«Guardar y verificar».

La frase de prueba lleva a propósito una cifra con separadores —«1.391.400
kilómetros»— porque es donde se nota si una voz sirve para esto: leer números en
español es lo que va a hacer todo el día.

Cada prueba se cachea, así que comparar las diez cuesta diez síntesis una vez y
ninguna a partir de la segunda.

**Después de cambiarla, borra `wj-content/cache/audio/`.** Los MP3 ya generados
siguen ahí con la voz anterior y se seguirían sirviendo tal cual.

#### Si quieres otra que no esté en la lista

Las diez del panel son las que encajan con lo que ORBIS hace —español, y uso
declarado de narración o divulgación— filtradas del catálogo de la cuenta. Hay
muchas más. Para usar cualquier otra, pon su identificador en
`ELEVENLABS_VOICE_ID` y **contrástalo antes**:

```bash
php tools/verificar-voz.php
```

Pregunta a ElevenLabs qué es esa voz y avisa si no encaja: idioma distinto del
español, uso declarado de dibujos animados, publicidad o redes sociales, o unos
ajustes de fábrica demasiado interpretados o rápidos.

> **Por qué existe esa herramienta.** ORBIS narró durante meses con
> «Marshal - Toon Character»: un personaje de dibujos animados, en inglés, con
> `style` 0,78 y `speed` 1,2. Nada lo delataba. La síntesis funcionaba, el audio
> llegaba con su 200, la caché lo guardaba y el diagnóstico daba verde. El único
> síntoma era el sonido, y el sonido no lo mira ninguna prueba automática.

Un identificador de voz es público —sin la clave de API no sirve para nada— así
que puede verse sin problema. La clave, no.

---

### 5.5 Rotar una clave

Si una clave se ha visto alguna vez fuera del servidor —un correo, una captura,
un mensaje— dala por comprometida:

1. Genera una nueva en el panel del proveedor y **revoca la anterior**.
2. Cámbiala en la variable de entorno o en `wj-config.php`.
3. `https://tu-dominio/wj-includes/api/health.php?red=1` para confirmar que la nueva vale.

No hay que tocar nada más: la caché de audio sigue sirviendo, porque lo que
guarda son MP3 ya pagados, no la clave.

---

### 5.6 La fuente de conocimiento de cada cuerpo

Pestaña **Conocimiento** del panel. Cada cuerpo tiene su propio conjunto de
entradas, de dos tipos:

- **Narraciones**: relatos de un minuto que se alternan cada vez que se visita
  el cuerpo. Las tres del catálogo son la base; cada una que se añade alarga la
  rotación, y la misma no vuelve a sonar hasta haberlas oído todas.
- **Datos**: hechos sueltos, cada uno con su fuente. Se dicen tras la narración
  («un dato más…»), aparecen en la ficha del cuerpo con su fuente debajo, y el
  asistente conversacional los consulta con una herramienta propia.

**Ninguna entrada se guarda sin fuente**: el campo es obligatorio y se valida en
el servidor. Lo del catálogo se puede **corregir** o **retirar**, nunca borrar
—está en el repositorio— y «Restaurar el original» deshace la corrección. Lo
añadido en el panel se puede borrar, pero solo después de retirarlo: borrar
son dos pasos a propósito.

Todo se guarda en `wj-content/conocimiento/`, **un archivo por cuerpo, fuera de
git**. Si el panel reescribiera `data/sistema-solar.json`, el siguiente
`git pull` de Plesk chocaría con esos cambios o los pisaría.

**Borradores con IA.** En cada cuerpo, «Proponer un borrador» redacta una
narración nueva usando solo sus datos publicados y los del catálogo, desde un
ángulo distinto al de las que ya existen; y «Extraer datos de un texto de
fuente» saca de tres a seis datos de un fragmento que se pegue. El resultado
**nunca se publica solo**: aparece en el formulario, con un aviso por cada cifra
que no esté en ninguna fuente de ese cuerpo, para revisarlo, corregirlo y
guardarlo. Redacta Claude (Anthropic) o Gemini, según `REDACTOR_PROVEEDOR`.

### 5.7 Gemini (Google AI Studio): por qué solo en el panel

Los términos del Gemini API, en vigor desde marzo de 2026, exigen mayoría de
edad y prohíben usarlo *«as part of a website […] that is directed towards or is
likely to be accessed by individuals under the age of 18»*
([ai.google.dev/gemini-api/terms](https://ai.google.dev/gemini-api/terms)).
ORBIS es divulgación para niños, así que Gemini **no habla con los visitantes**:
ni conversa, ni narra, ni transcribe. Solo ayuda a quien administra a redactar
borradores, y ni eso hasta marcar la casilla `GEMINI_USO_EDITORIAL`. Una prueba
(`tools/pruebas-conocimiento.php`) falla si Gemini aparece en algún endpoint
público o en el código del navegador.

Dos cosas más que conviene saber: en el **plan gratuito** Google usa lo que se
le envía para mejorar sus productos y pueden leerlo personas (con facturación
activa, no); y desde **septiembre de 2026** solo acepta claves de tipo *auth key*,
que es como nacen hoy las que se crean en AI Studio.

Si la Gobernación quisiera otro uso —conversación por voz en tiempo real, voz de
narración—, técnicamente encaja, pero es una decisión de sus servicios
jurídicos. El sitio donde cambiarlo es `wj-includes/lib/Gemini.php`.

### 5.8 Google Analytics 4

Pestaña **Analítica**: el ID de medición (`G-…`) y un secreto del Measurement
Protocol (en GA4: Administrar → Flujos de datos → tu flujo web → *Secretos de la
API del Measurement Protocol*).

**La página no carga ningún script de Google ni pone cookies.** El navegador le
cuenta a `wj-includes/api/evento.php` qué ha pasado y es el servidor quien se lo
manda a Google. Así se respeta la regla 2 del proyecto —nada de terceros en el
navegador— y la CSP no hay que tocarla. Solo se aceptan ocho eventos de una
lista cerrada (`page_view`, `ver_cuerpo`, `narracion`, `usar_voz`,
`usar_gestos`, `preguntar`, `cambiar_escala`, `cambiar_seccion`); cualquier otro
se descarta. Los navegadores con *Global Privacy Control* o «No rastrear» no
envían nada.

Lo que se pierde, dicho claro: sin cookies, **cada visita cuenta como un usuario
nuevo**, así que «Usuarios» sale inflado —sesiones, eventos y cuerpos visitados
sí son fiables—, y **país y ciudad serán los del servidor**, porque la IP del
visitante no se reenvía.

«Guardar y verificar» pasa un evento por el validador de Google y envía uno real,
`orbis_prueba`: si en uno o dos minutos no aparece en GA4 → Informes → Tiempo
real, el secreto o el ID no son de ese flujo (Google responde 204 aunque el
secreto no valga, así que esa es la única comprobación definitiva).

## 6. Prueba de humo

En este orden:

1. **`https://tu-dominio/wj-includes/api/health.php`**
   Debe devolver JSON con `"estado": "ok"` o `"aviso"`. Cualquier `"error"`
   aparece detallado en `comprobaciones`.

2. **`https://tu-dominio/wj-includes/api/health.php?red=1`**
   Añade la prueba de conectividad y de validez de la clave con ElevenLabs.

2 bis. **`https://tu-dominio/wj-includes/api/tts.php?bodyId=tierra`**
   Debe devolver `audio/mpeg`. La primera vez tarda unos segundos —la está
   generando—; la segunda es instantánea y trae la cabecera
   `X-Orbis-Cache: hit`. Con `&soloCache=1` no genera nada: devuelve el audio
   si ya existe y `204` si no, y es lo que usa la precarga.

2 ter. **El asistente conversacional.** Desde una terminal:
   ```bash
   curl -sS -X POST https://tu-dominio/wj-includes/api/chat.php \
        -H 'Content-Type: application/json' \
        -d '{"turnos":[{"rol":"usuario","texto":"¿Cuánto mide Marte?"}]}'
   ```
   Debe devolver JSON con un campo `texto`. Un **503** con
   `asistente_no_configurado` significa que falta `ANTHROPIC_API_KEY` o la
   carpeta `wj-includes/vendor`; `wj-includes/api/health.php` distingue cuál de las dos.

   Y comprueba lo que de verdad importa: que la cifra que responda **coincida
   con `wj-content/data/sistema-solar.json`**. El asistente no responde de memoria, cada
   dato se lo devuelve una herramienta leyendo el catálogo. Si alguna vez
   contesta algo que no está ahí, es un fallo grave, no un detalle.

3. **`http://tu-dominio/`** (sin la ese)
   Debe redirigir a `https://` con un 301.

4. **`https://tu-dominio/wj-config.php`** → 403
   **`https://tu-dominio/wj-content/cache/audio/`** → 403
   **`https://tu-dominio/wj-content/ajustes/ajustes.json`** → 403

5. **`https://tu-dominio/`**
   La pantalla de arranque debe mostrar todos los chequeos en verde o ámbar.
   Uno solo en rojo impide continuar.

6. **Consola del navegador (F12).** Cero errores. En particular, ningún
   `Failed to load module script: … MIME type of "text/plain"`.

7. **Pestaña Red.** `three.module.min.js` debe llegar con
   `content-encoding: br` (o `gzip`) y `cache-control: …immutable`.

---

## 7. Resolución de problemas

| Síntoma | Causa habitual | Solución |
|---|---|---|
| `Failed to load module script … MIME type of "text/plain"` | Apache no reconoce `.js` o `.mjs` | Falta `.htaccess`, o `AllowOverride None`. Pide a soporte `AllowOverride All` en el vhost |
| `Failed to resolve module specifier "three"` | `wj-includes/externos/three/` no llegó al servidor | Vuelve a subir la carpeta completa |
| Todo devuelve 404 y las rutas apuntan al directorio *padre* | Se visitó la URL sin barra final y Apache no redirigió | Comprueba `DirectorySlash On` y que `.htaccess` llegó; entra con la barra final |
| El `importmap` busca en `/vendor/` en vez de en el subdirectorio | Alguien cambió las rutas del `importmap` a absolutas | Vuelve a `./vendor/…` y ejecuta `node tools/csp-hash.mjs` |
| La pantalla de arranque se queda en «Comprobando datos del sistema» | `wj-content/data/sistema-solar.json` no legible o con JSON inválido | Revisa permisos (644) y valida el JSON |
| `cache_audio: escritura denegada` | Propietario o permisos incorrectos | `chmod 775 wj-content/cache/audio` con el propietario correcto |
| El navegador bloquea el importmap (`Refused to execute inline script`) | El hash de la CSP no coincide con `index.html` | `node tools/csp-hash.mjs` y vuelve a subir `.htaccess` |
| La cámara no arranca | Sin HTTPS, o falta `Permissions-Policy` | Activa el certificado; comprueba que `.htaccess` llegó |
| Un modelo da 404 | `hand_landmarker.task` o `face_landmarker.task` no llegaron al servidor | `node tools/vendor.mjs mediapipe` y comprueba que `wj-content/assets/models/` se desplegó entero |
| El guiño no funciona pero las manos sí | falta `face_landmarker.task`; se avisa en el panel de entradas | mismo remedio; entretanto, el puño y la voz siguen deteniendo la narración |
| Error 500 en `api/*.php` | Versión de PHP o extensión ausente | Mira el registro de errores del dominio en Plesk |
| El asistente responde 503 `asistente_no_configurado` | Falta `ANTHROPIC_API_KEY`, o falta `wj-includes/vendor/` | `wj-includes/api/health.php` dice cuál de las dos: mira `clave_anthropic` y `sdk_anthropic` |
| Se cambió la voz y sigue sonando la anterior | Un valor guardado en el panel gana al del archivo, o la caché sirve los MP3 viejos | `wj-includes/api/health.php` → `voz_elevenlabs` dice el origen, y el panel dice campo por campo qué está tapando; luego borra `wj-content/cache/audio/` |
| El asistente falla en cuanto se le pregunta algo, pero el diagnóstico está en verde | `ORBIS_MODELO` mal escrito. Los identificadores llevan **guiones, no puntos**: `claude-sonnet-4-6`, no `claude-sonnet-4.6` | `wj-includes/api/health.php?red=1` → `modelo_existe` lo pregunta al catálogo de Anthropic y dice si ese modelo no existe |
| `red_elevenlabs` responde un HTTP 4xx | La API rechaza la clave. El motivo lo manda ElevenLabs en la respuesta | `health.php?red=1` lo enseña literal (`invalid_api_key`, `detected_unusual_activity`…). Si es la clave, genera otra en elevenlabs.io |
| El asistente responde por escrito pero no se le oye | `wj-content/cache/respuestas/` no escribible | `wj-includes/api/health.php` → `cache_respuestas`; `chmod 775` con el propietario correcto |
| Las preguntas de posición tardan mucho | `wj-content/cache/efemerides/` no escribible: se llama a JPL en cada una | `wj-includes/api/health.php` → `cache_efemerides` |
| Los topes de gasto no se aplican | `wj-content/cache/limites/` no escribible: sin contadores no hay límite | `wj-includes/api/health.php` → `cache_limites`. **Revísalo antes de abrir al público** |

### Registros

- Errores de PHP: Plesk → *Dominios* → **Registros**.
- Errores propios de ORBIS: `wj-content/logs/` (no accesible por HTTP).

---

## 8. Actualizar una instalación existente

```bash
git pull                       # o vuelve a subir por FTP
node tools/csp-hash.mjs        # si tocaste el importmap
```

`js/`, `css/` y `data/` se sirven con `no-cache, must-revalidate`, así que los
cambios se ven sin vaciar la caché del navegador. `vendor/` y `assets/` van con
caché de un año: si cambias una textura, cambia también su nombre de archivo.

**Nunca hace falta borrar `wj-content/cache/audio/`** salvo que edites el texto de una
narración: el nombre de cada MP3 es el hash del texto, la voz y el modelo, de
modo que un texto nuevo genera un archivo nuevo y el antiguo queda huérfano.
Un borrado periódico de huérfanos es opcional.

### Coste de la narración

Las 33 narraciones suman unos 33.000 caracteres. Se generan **una sola vez**,
la primera vez que alguien visita cada cuerpo, y a partir de ahí se sirven de
`wj-content/cache/audio/`. El gasto en ElevenLabs no crece con las visitas, solo con los
textos: si editas una narración, esa —y solo esa— se vuelve a generar.

El límite por IP (`LIMITE_GENERACIONES_HORA`, 30 por omisión) solo cuenta las
generaciones nuevas. Servir un audio cacheado no consume cupo, y la precarga de
los cuerpos vecinos usa `soloCache=1`, que tampoco.

### Precalentar la caché antes de abrir al público

Recomendable si esperas visitas simultáneas el primer día: así nadie espera a
que se sintetice.

```bash
for id in $(php -r 'require "wj-includes/lib/Catalogo.php"; echo implode(" ", Catalogo::identificadores());'); do
  curl -s -o /dev/null -w "%{http_code} $id\n" "https://tu-dominio/wj-includes/api/tts.php?bodyId=$id"
  sleep 2
done
```

Ejecútalo desde el propio servidor o sube temporalmente
`LIMITE_GENERACIONES_HORA`; con el límite por omisión se detendría en el
trigésimo cuerpo.
