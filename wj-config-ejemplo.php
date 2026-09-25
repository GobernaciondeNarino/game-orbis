<?php
/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ORBIS — PLANTILLA DE CONFIGURACIÓN DEL SERVIDOR
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Este es el ÚNICO archivo que hay que tocar para configurar ORBIS en el
 *  servidor. Aquí van la clave de ElevenLabs, el código de la voz, la clave de
 *  Anthropic para el asistente, la de Gemini para redactar desde el panel,
 *  Google Analytics y los topes de gasto.
 *
 *  ──────────────────────────────────────────────────────────────────────────
 *  CÓMO USARLO
 *  ──────────────────────────────────────────────────────────────────────────
 *
 *    1. En el servidor, copia este archivo al lado, sin «.example»:
 *
 *         cp wj-config-ejemplo.php wj-config.php
 *
 *       (En el gestor de archivos de Plesk: duplicar y renombrar.)
 *
 *    2. Rellena SOLO lo que quieras fijar desde aquí. Lo que dejes vacío usa el
 *       valor por omisión que ya trae ORBIS, escrito en el comentario de cada
 *       clave.
 *
 *       O NO RELLENES NADA y hazlo todo desde el panel:
 *       https://tu-dominio/wj-admin/ — más cómodo, y lo que se ponga ALLÍ manda
 *       sobre lo que se ponga aquí.
 *
 *  ──────────────────────────────────────────────────────────────────────────
 *  ESTE ARCHIVO ES LA CAPA DE ABAJO, NO LA DE ARRIBA
 *  ──────────────────────────────────────────────────────────────────────────
 *
 *  Lo que se guarde desde el panel de wj-admin GANA a lo que haya aquí. Era al
 *  revés, y el resultado era que copiar esta plantilla —el paso 1 de la
 *  instalación— dejaba medio panel bloqueado y sin poder tocarlo. Un panel de
 *  administración que no puede administrar no protege de nada.
 *
 *  Así que si rellenas algo aquí y luego lo cambias en el panel, manda el
 *  panel. No en silencio: cada campo del panel dice si hay un valor debajo,
 *  dónde está y que no se está usando, y `health.php` dice de dónde sale cada
 *  valor en marcha.
 *
 *  LO ÚNICO QUE EL PANEL NO PUEDE CAMBIAR es su propia clave de entrada,
 *  WJ_ADMIN_CLAVE: esa se fija aquí o en Plesk, y en ningún otro sitio.
 *
 *  Y todas las claves viajan VACÍAS. Ocho traían antes su valor por omisión
 *  rellenado, y para Config un valor escrito es un valor escrito: aparecía en
 *  el panel como algo decidido cuando nadie había decidido nada. Un valor por
 *  omisión no es una decisión, así que ahora vive en el comentario.
 *
 *    3. Comprueba que NO se puede leer desde fuera. Abre en el navegador:
 *
 *         https://tu-dominio/wj-config.php               → tiene que dar 403
 *         https://tu-dominio/wj-includes/api/health.php  → dice qué ha detectado
 *
 *  ──────────────────────────────────────────────────────────────────────────
 *  DÓNDE PONER LAS CLAVES: DOS SITIOS, UNO MEJOR QUE OTRO
 *  ──────────────────────────────────────────────────────────────────────────
 *
 *  Cada valor se busca en este orden y gana el PRIMERO que aparece:
 *
 *    1º  EL PANEL de wj-admin, que guarda en wj-content/ajustes/ajustes.json.
 *        Lo más cómodo, y lo que manda. Fuera de lo que se sirve por HTTP y
 *        fuera del repositorio, igual que este archivo.
 *
 *    2º  VARIABLE DE ENTORNO de Plesk
 *        Dominios → Configuración de PHP → Variables de entorno.
 *        La clave no toca el disco del sitio, así que no puede acabar en una
 *        copia de seguridad descargable ni en un despliegue por FTP. Es la
 *        mejor opción para lo que se ponga UNA vez y no se vaya a cambiar.
 *
 *    3º  ESTE ARCHIVO (wj-config.php)
 *        Perfectamente válido: está en .gitignore y el .htaccess raíz lo
 *        bloquea por nombre. Pero vive en el disco, y cede ante los dos de
 *        arriba.
 *
 *  Si rellenas algo aquí Y hay un valor en el panel, GANA EL PANEL.
 *  `health.php` dice de dónde sale cada valor, y el propio panel avisa campo
 *  por campo de lo que está tapando. Sin ese aviso, esta regla sería la nueva
 *  causa de «lo he cambiado y suena igual».
 *
 *  ──────────────────────────────────────────────────────────────────────────
 *  NUNCA
 *  ──────────────────────────────────────────────────────────────────────────
 *
 *  · No subas wj-config.php al repositorio. Está en .gitignore por algo.
 *  · No copies estos valores a ningún archivo de js/, css/ o data/: todo eso
 *    se sirve al navegador y cualquiera puede leerlo. `bash
 *    tools/comprobar-secretos.sh` lo verifica antes de cada commit.
 *  · Si una clave se te ha escapado alguna vez —un correo, una captura, un
 *    mensaje de chat—, dala por comprometida y genera otra. Rotarla cuesta un
 *    minuto; una clave filtrada la gasta cualquiera.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

declare(strict_types=1);

return [

    // ════════════════════════════════════════════════════════════════════════
    //  0. PANEL DE ADMINISTRACIÓN — https://tu-dominio/wj-admin/
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Clave para entrar en el panel.
     *
     * MIENTRAS ESTÉ VACÍA se usa la de por omisión, «orbis-admin», que viene
     * escrita en el repositorio: cualquiera que vea el código la conoce. El
     * panel avisa en rojo mientras siga así. Cámbiala antes de abrir el sitio.
     *
     * Mejor todavía: guarda aquí un HASH en lugar de la clave, y así la clave
     * real no queda escrita en el disco del servidor ni en una copia de
     * seguridad. Se genera con:
     *
     *     php -r 'echo password_hash("tu-clave", PASSWORD_DEFAULT), "\n";'
     *
     * Y lo mejor de todo: ponla como variable de entorno WJ_ADMIN_CLAVE en
     * Plesk, que ni siquiera toca el disco.
     *
     * Esta es la ÚNICA clave que el panel no puede cambiarse a sí mismo. Si
     * pudiera, quien entrase una vez con la de por omisión dejaría fuera al
     * administrador de verdad.
     */
    'WJ_ADMIN_CLAVE' => '',


    // ════════════════════════════════════════════════════════════════════════
    //  1. NARRACIÓN CON VOZ — ElevenLabs
    //     Sin esto ORBIS funciona igual, pero narra con la voz del navegador,
    //     que es notablemente peor. No es obligatorio; es lo primero que se
    //     nota si falta.
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Clave de la API de ElevenLabs.
     * Se saca en https://elevenlabs.io → Profile → API Key.
     *
     * La misma clave sirve para la narración (api/tts.php) y para transcribir
     * la voz cuando el navegador no sabe hacerlo (api/stt.php, que existe
     * sobre todo para Safari).
     */
    'ELEVENLABS_API_KEY' => '',

    /**
     * CÓDIGO DE LA VOZ con la que habla ORBIS.
     *
     * Déjalo vacío para usar la voz que ya trae ORBIS: «Enrique M. Nieto»
     * (gbTn1bmCvNgk0QEAVyfM), fijada en wj-includes/lib/Config.php.
     *
     * Lo más cómodo es elegirla en el panel de wj-admin, que ofrece las
     * candidatas en español con un botón para OÍR cada una antes de decidir.
     * A mano: https://elevenlabs.io → Voices → elige una → Copiar ID. O:
     *     curl -H "xi-api-key: TU_CLAVE" https://api.elevenlabs.io/v1/voices
     *     php tools/verificar-voz.php   ← qué es de verdad la que hay puesta
     *
     * Un identificador de voz es PÚBLICO: sin la clave de API no sirve para
     * nada, así que no pasa nada porque se vea.
     *
     * Después de cambiarlo, BORRA cache/audio/: los MP3 ya generados siguen
     * ahí con la voz vieja y se seguirían sirviendo tal cual. Es la segunda
     * causa de «he cambiado la voz y suena igual».
     */
    'ELEVENLABS_VOICE_ID' => '',

    /**
     * Modelo de síntesis. Vacío = `eleven_multilingual_v2`, que da la mejor
     * prosodia en español; los «turbo» salen más baratos y suenan más planos.
     */
    'ELEVENLABS_MODEL_ID' => '',

    /**
     * Voces que api/tts.php acepta, separadas por comas.
     *
     * Vacío = solo la voz de arriba. Esto es una cerradura, no una comodidad:
     * impide que alguien pida una voz cualquiera por parámetro y te gaste la
     * cuenta probando el catálogo entero de ElevenLabs.
     */
    'ELEVENLABS_VOCES_PERMITIDAS' => '',

    /**
     * Modelo de transcripción para api/stt.php (dictado por voz en los
     * navegadores sin reconocimiento propio). Vacío = `scribe_v1`.
     */
    'ELEVENLABS_STT_MODEL' => '',


    // ════════════════════════════════════════════════════════════════════════
    //  2. ASISTENTE CONVERSACIONAL — Anthropic
    //     Sin esto, el botón «Asistente» responde 503 con una explicación y
    //     ORBIS sigue contestando las preguntas del catálogo por su cuenta.
    //     La conversación libre —preguntarle lo que sea— necesita la clave.
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Clave de la API de Anthropic.
     * Se saca en https://console.anthropic.com → Settings → API Keys.
     *
     * El asistente NO responde de memoria: cada cifra que dice se la devuelve
     * una de sus seis herramientas leyendo data/sistema-solar.json. Es la
     * regla 4 del proyecto y está probada en tools/pruebas-conversacion.php.
     */
    'ANTHROPIC_API_KEY' => '',

    /**
     * Modelo del asistente. Vacío = el que trae ORBIS.
     * Cámbialo por uno más pequeño si el gasto se dispara; responderá algo
     * peor, pero las herramientas y los datos son exactamente los mismos.
     */
    'ORBIS_MODELO' => '',


    // ════════════════════════════════════════════════════════════════════════
    //  2 bis. GOOGLE AI STUDIO (GEMINI) — herramienta EDITORIAL del panel
    //     Redacta borradores de narraciones a partir del conocimiento de cada
    //     cuerpo y extrae datos de un texto de fuente. NO habla con los
    //     visitantes: sus términos exigen mayoría de edad y prohíben usarlo en
    //     un sitio al que probablemente accedan menores de 18
    //     (https://ai.google.dev/gemini-api/terms). Detalle en lib/Gemini.php.
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Clave de Google AI Studio (aistudio.google.com → Get API key).
     * Desde septiembre de 2026 Google rechaza las claves «estándar»: tienen que
     * ser «auth keys», que es como nacen las que se crean hoy en AI Studio.
     */
    'GEMINI_API_KEY' => '',

    /** Modelo. Vacío = gemini-3.8-flash. Aquí los identificadores SÍ llevan puntos. */
    'GEMINI_MODELO' => '',

    /**
     * '1' para habilitarlo. Sin esto, Gemini no se usa aunque haya clave:
     * ponerlo es declarar que se usa solo desde el panel, por una persona
     * adulta, que lo redactado se revisa antes de publicarse y que se conocen
     * sus condiciones de datos (en el plan gratuito Google usa lo enviado para
     * mejorar sus productos).
     */
    'GEMINI_USO_EDITORIAL' => '',

    /**
     * Quién redacta los borradores: 'auto' (Gemini si está habilitado; si no,
     * Anthropic), 'gemini' o 'anthropic'. Vacío = 'auto'.
     */
    'REDACTOR_PROVEEDOR' => '',


    // ════════════════════════════════════════════════════════════════════════
    //  2 ter. GOOGLE ANALYTICS 4 — por el Measurement Protocol
    //     El SERVIDOR envía los eventos: la página no carga ningún script de
    //     Google ni pone cookies (regla 2 del proyecto). Con los dos valores
    //     puestos se mide; con uno solo, no. Detalle en lib/Analitica.php.
    // ════════════════════════════════════════════════════════════════════════

    /** ID de medición del flujo web, «G-XXXXXXXXXX». */
    'GA_ID_MEDICION' => '',

    /**
     * Secreto de la API del Measurement Protocol (en el mismo flujo web:
     * «Secretos de la API del Measurement Protocol» → Crear). Es una
     * credencial: se queda en el servidor.
     */
    'GA_SECRETO_API' => '',


    // ════════════════════════════════════════════════════════════════════════
    //  3. TOPES DE GASTO
    //     Cuentan por dirección IP y por hora. Existen porque las tres APIs se
    //     pagan por uso: sin ellos, una pestaña con un bucle vacía la cuenta
    //     en una tarde.
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Narraciones NUEVAS por IP y hora. Las que ya están en cache/audio/ no
     * cuentan, y la precarga tampoco: el tope limita el gasto, no el uso.
     *
     * Vacío = 30. Con ese valor una visita normal nunca lo toca. Al llenarse
     * la caché de los 33 cuerpos —lo que pasa una sola vez, en las primeras
     * visitas— el gasto se detiene y se reanuda a la hora siguiente.
     */
    'LIMITE_GENERACIONES_HORA' => '',

    /**
     * Transcripciones por IP y hora (api/stt.php). Vacío = 120: más alto
     * porque cada una cuesta bastante menos que una narración, y son turnos
     * de conversación.
     */
    'LIMITE_TRANSCRIPCIONES_HORA' => '',

    /**
     * Respuestas del asistente por IP y hora (api/chat.php). Vacío = 60. Es el
     * más caro de los tres: cada respuesta puede encadenar varias llamadas a
     * herramientas.
     */
    'LIMITE_CONVERSACION_HORA' => '',

    // ── Techos del SITIO ENTERO, por día ────────────────────────────────
    //
    //  Los tres límites de arriba acotan lo que gasta UNA persona. Estos acotan
    //  lo que gasta el sitio. Hacen falta los dos: con sesenta conversaciones
    //  por IP y hora, diez direcciones distintas son seiscientas respuestas de
    //  un modelo de pago en una tarde, y sin techo nada las frenaba.
    //
    //  NO son un objetivo de uso: son un freno de emergencia. Un día normal no
    //  se acerca. Si se alcanza, algo está pasando —un bucle, un rastreador,
    //  alguien probando— y es mejor que el sitio deje de gastar unas horas a
    //  que siga pagando. Cuando se llega, la interfaz lo dice con esas palabras
    //  y sigue funcionando: la voz pasa a la del navegador y las preguntas del
    //  catálogo se contestan igual.
    //
    //  Vacío = el valor por omisión de cada uno, que es el que dice su
    //  comentario. CERO los desactiva, que no es lo mismo que vacío. Si los
    //  subes, súbelos a sabiendas.

    /**
     * Narraciones NUEVAS de todo el sitio en 24 h. Las cacheadas no cuentan.
     *
     * Vacío = 500, y con eso hay de sobra: el catálogo entero son 33 cuerpos
     * × 3 narraciones, más las frases, y una vez generadas no se vuelven a
     * pagar nunca.
     */
    'TOPE_DIARIO_NARRACION' => '',

    /** Transcripciones de todo el sitio en 24 h. Vacío = 1500. */
    'TOPE_DIARIO_TRANSCRIPCION' => '',

    /**
     * Respuestas del asistente de todo el sitio en 24 h.
     *
     * Vacío = 400. Es el más caro de los tres y el que conviene mirar primero
     * si el gasto sorprende: cada respuesta puede encadenar varias llamadas a
     * herramientas.
     */
    'TOPE_DIARIO_CONVERSACION' => '',

    /**
     * Sal con la que se anonimizan las direcciones IP de los contadores.
     *
     * PONLE ALGO PROPIO. Cualquier texto largo vale:
     *     head -c 32 /dev/urandom | base64
     *
     * También se puede poner desde el panel de wj-admin, que además avisa en
     * rojo mientras siga sin ponerse.
     *
     * Los topes de arriba cuentan por visitante, y ORBIS guarda un hash de la
     * IP en lugar de la IP: así en cache/limites/ no queda una lista de
     * direcciones de quien ha entrado. Pero un hash sin sal —o con la misma sal
     * en todas las instalaciones— se puede deshacer probando: solo hay unos
     * pocos miles de millones de direcciones. Con una sal tuya, el hash no dice
     * nada fuera de este servidor.
     *
     * Cambiarla vacía los contadores en curso. No pasa nada: se rehacen solos.
     */
    'ORBIS_SAL_LIMITES' => '',

];
