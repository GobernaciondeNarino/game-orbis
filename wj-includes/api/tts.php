<?php
/**
 * ORBIS — Proxy de síntesis de voz (ElevenLabs Text-to-Speech).
 *
 * El navegador NUNCA habla con ElevenLabs. Habla con este archivo, que:
 *
 *   1. valida que el cuerpo pedido existe en data/sistema-solar.json;
 *   2. toma el texto de SU PROPIA copia del catálogo, no del cliente;
 *   3. sirve el MP3 de la caché si ya existe, sin salir a Internet;
 *   4. si no existe, lo genera, lo guarda y lo devuelve;
 *   5. limita las generaciones nuevas por IP.
 *
 * POR QUÉ EL TEXTO NO VIENE DEL CLIENTE. Un endpoint que sintetiza el texto que
 * se le envíe es una pasarela gratuita hacia una API de pago a costa del
 * titular de la cuenta: bastaría con un bucle enviando párrafos para agotar el
 * saldo. Aceptando solo un identificador, el conjunto de textos posibles es
 * finito, conocido y cacheable, y el gasto máximo está acotado por el catálogo.
 *
 * Petición, en cualquiera de las dos formas:
 *   GET  api/tts.php?bodyId=jupiter[&soloCache=1]
 *   POST api/tts.php  con { "bodyId": "jupiter", "voiceId": "…" }
 *
 * `soloCache=1` sirve el audio si ya está generado y devuelve 204 si no lo
 * está, SIN sintetizar ni consumir cupo. Lo usa la precarga de los cuerpos
 * vecinos: precargar no puede costar dinero ni gastar el límite por hora del
 * visitante, que debe quedar para lo que de verdad pide.
 *
 * Se admite GET a propósito: permite usar la URL directamente como src de un
 * <audio>, y con ella el navegador cachea el MP3 un año por su cuenta. Con solo
 * POST, cada reproducción volvería a pedir el archivo al servidor.
 *
 * Respuesta: audio/mpeg, o JSON con { error, mensaje } si algo falla.
 *
 * Sintaxis compatible con PHP 7.4.
 */

declare(strict_types=1);

// El formato del audio (mp3_44100_128) y los ajustes de voz están en
// lib/ElevenLabs.php, junto a la llamada que los usa.

require_once __DIR__ . '/../lib/Config.php';
require_once __DIR__ . '/../lib/ElevenLabs.php';
require_once __DIR__ . '/../lib/Respuesta.php';
require_once __DIR__ . '/../lib/Cache.php';
require_once __DIR__ . '/../lib/RateLimiter.php';
require_once __DIR__ . '/../lib/Catalogo.php';
require_once __DIR__ . '/../lib/Conocimiento.php';
require_once __DIR__ . '/../lib/Asistente.php';
require_once __DIR__ . '/../lib/Respuestas.php';
require_once __DIR__ . '/../lib/Meteoros.php';

header('X-Content-Type-Options: nosniff');

// ---------------------------------------------------------------------------
// 1. Método y cuerpo de la petición
// ---------------------------------------------------------------------------
$metodo = $_SERVER['REQUEST_METHOD'] ?? '';

if ($metodo === 'GET') {
    $peticion = [
        'bodyId' => $_GET['bodyId'] ?? '',
        'frase' => $_GET['frase'] ?? null,
        'atributo' => $_GET['atributo'] ?? null,
        'meteoros' => $_GET['meteoros'] ?? null,
        'nombre' => $_GET['nombre'] ?? null,
        'voiceId' => $_GET['voiceId'] ?? null,
        'variante' => $_GET['variante'] ?? 0,
        'respuesta' => $_GET['respuesta'] ?? null,
        'cuerpo' => $_GET['cuerpo'] ?? null,
        'narracion' => $_GET['narracion'] ?? null,
        'dato' => $_GET['dato'] ?? null,
        'soloCache' => isset($_GET['soloCache']) && $_GET['soloCache'] === '1',
    ];
} elseif ($metodo === 'POST') {
    $crudo = file_get_contents('php://input');
    if ($crudo === false || strlen($crudo) > 4096) {
        Respuesta::error(400, 'peticion_invalida', 'La petición está vacía o es demasiado grande.');
    }
    $peticion = json_decode((string) $crudo, true);
    if (!is_array($peticion)) {
        Respuesta::error(400, 'json_invalido', 'El cuerpo de la petición no es JSON válido.');
    }
} else {
    header('Allow: GET, POST');
    Respuesta::error(405, 'metodo_no_permitido', 'Este endpoint solo acepta GET y POST.');
}

// ---------------------------------------------------------------------------
// 2. Qué hay que decir
//    Dos vías, y en las dos el TEXTO lo pone el servidor: la narración de un
//    cuerpo del catálogo, o una frase del asistente. El cliente solo elige cuál
//    con un identificador y un número.
// ---------------------------------------------------------------------------
$variante = (int) ($peticion['variante'] ?? 0);
$fraseId = isset($peticion['frase']) ? (string) $peticion['frase'] : '';
$bodyId = isset($peticion['bodyId']) ? (string) $peticion['bodyId'] : '';

$atributo = isset($peticion['atributo']) ? (string) $peticion['atributo'] : '';
$meteoros = isset($peticion['meteoros']) ? (string) $peticion['meteoros'] : '';

if ($meteoros !== '') {
    // Lo que el asistente cuenta al observar una estrella fugaz. Llega una
    // fecha —dos números— y el texto lo compone Meteoros a partir de las
    // lluvias documentadas. El trazo es simulación; esto no.
    if (preg_match('/^(\d{1,2})-(\d{1,2})$/', $meteoros, $partes) !== 1) {
        Respuesta::error(400, 'fecha_invalida', 'La fecha no tiene un formato válido.');
    }
    $mesM = (int) $partes[1];
    $diaM = (int) $partes[2];
    if ($mesM < 1 || $mesM > 12 || $diaM < 1 || $diaM > 31) {
        Respuesta::error(400, 'fecha_invalida', 'La fecha no es válida.');
    }

    $relato = Meteoros::relato($mesM, $diaM);
    if (empty($relato['texto'])) {
        Respuesta::error(404, 'sin_meteoros', 'No hay nada que contar para esa fecha.');
    }
    $texto = $relato['texto'];
    $bodyId = 'meteoros-' . $mesM . '-' . $diaM;
} elseif ($atributo !== '') {
    // Respuesta a una pregunta: dos identificadores, y el texto lo compone
    // Respuestas a partir del catálogo. Igual que en las otras dos vías, el
    // navegador elige QUÉ se dice, nunca CÓMO se dice.
    if (preg_match('/^[a-z]{1,24}$/', $atributo) !== 1) {
        Respuesta::error(400, 'atributo_invalido', 'El atributo no tiene un formato válido.');
    }
    if (preg_match('/^[a-z0-9-]{1,40}$/', $bodyId) !== 1) {
        Respuesta::error(400, 'id_invalido', 'El identificador del cuerpo no tiene un formato válido.');
    }

    $resultado = Respuestas::responder($bodyId, $atributo);
    if ($resultado === null) {
        Respuesta::error(
            404,
            'sin_respuesta',
            'No hay respuesta para esa combinación de cuerpo y atributo.',
            $bodyId . ' / ' . $atributo
        );
    }
    $texto = $resultado['texto'];
    $bodyId = 'respuesta-' . $bodyId . '-' . $atributo;
} elseif (isset($peticion['respuesta']) && $peticion['respuesta'] !== null && $peticion['respuesta'] !== '') {
    // Una respuesta de la conversación, pedida POR SU HASH.
    //
    // Es la única forma de que el asistente hable con la voz buena sin que este
    // endpoint acepte texto del navegador. El texto lo escribió el servidor en
    // api/chat.php y quedó guardado; aquí solo se busca por su huella. Quien no
    // haya pasado por chat.php no tiene ningún hash válido que pedir, y un hash
    // inventado no encuentra archivo: no hay forma de colar texto propio.
    $huella = (string) $peticion['respuesta'];
    if (preg_match('/^[0-9a-f]{32}$/', $huella) !== 1) {
        Respuesta::error(400, 'respuesta_invalida', 'La referencia de la respuesta no tiene un formato válido.');
    }

    $archivo = Config::contenido('cache/respuestas/') . $huella . '.txt';
    if (!is_readable($archivo)) {
        Respuesta::error(404, 'respuesta_desconocida', 'Esa respuesta ya no está disponible.');
    }
    $texto = (string) file_get_contents($archivo);
    if (trim($texto) === '') {
        Respuesta::error(404, 'respuesta_vacia', 'Esa respuesta está vacía.');
    }
    $bodyId = 'conversacion-' . $huella;
} elseif ($fraseId !== '') {
    if (preg_match('/^[a-z-]{1,32}$/', $fraseId) !== 1) {
        Respuesta::error(400, 'frase_invalida', 'El identificador de frase no tiene un formato válido.');
    }

    // El nombre es lo ÚNICO que llega del cliente y acaba dicho en voz alta.
    // Asistente::limpiarNombre lo acota a un puñado de letras; si no pasa, se
    // usa la versión sin nombre en lugar de rechazar la petición.
    $nombre = Asistente::limpiarNombre(
        isset($peticion['nombre']) ? (string) $peticion['nombre'] : null
    );

    // El cliente puede decir a QUÉ cuerpo pertenece la entradilla, pero no de
    // qué tipo es: eso lo resuelve el servidor contra el catálogo. Un cuerpo
    // desconocido no es un error, solo deja la entradilla sin encuadre.
    $tipo = null;
    if (isset($peticion['cuerpo']) && preg_match('/^[a-z0-9-]{1,40}$/', (string) $peticion['cuerpo']) === 1) {
        $cuerpo = Catalogo::cuerpo((string) $peticion['cuerpo']);
        $tipo = isset($cuerpo['tipo']) ? (string) $cuerpo['tipo'] : null;
    }

    $texto = Asistente::frase($fraseId, $nombre, $variante, $tipo);
    if ($texto === null) {
        Respuesta::error(
            404,
            'frase_desconocida',
            'No hay ninguna frase registrada con ese identificador.',
            'frase solicitada: ' . $fraseId
        );
    }
    $bodyId = 'asistente-' . $fraseId;
} else {
    // El identificador tiene un formato conocido: minúsculas, dígitos y guiones.
    if (preg_match('/^[a-z0-9-]{1,40}$/', $bodyId) !== 1) {
        Respuesta::error(400, 'id_invalido', 'El identificador del cuerpo no tiene un formato válido.');
    }

    // La narración sale del CONOCIMIENTO del cuerpo —las del catálogo más las
    // añadidas desde el panel—, y se pide por su huella: si la lista cambia
    // mientras alguien navega, una posición apuntaría a otro texto y el audio
    // dejaría de cuadrar con los subtítulos. La huella solo encuentra textos
    // que ya están en el conocimiento de ESE cuerpo; una inventada, nada. Lo
    // mismo con los datos sueltos que se dicen tras la narración.
    $huellaNarracion = isset($peticion['narracion']) ? (string) $peticion['narracion'] : '';
    $huellaDato = isset($peticion['dato']) ? (string) $peticion['dato'] : '';

    if ($huellaDato !== '') {
        $texto = Conocimiento::porHuella($bodyId, $huellaDato, 'dato');
        $sufijo = 'dato-' . $huellaDato;
    } elseif ($huellaNarracion !== '') {
        $texto = Conocimiento::porHuella($bodyId, $huellaNarracion, 'narracion');
        $sufijo = 'narracion-' . $huellaNarracion;
    } else {
        // Por posición, para clientes que aún no mandan la huella.
        $lista = Conocimiento::narraciones($bodyId);
        $texto = $lista === [] ? null : $lista[(($variante % count($lista)) + count($lista)) % count($lista)];
        $sufijo = 'narracion-' . $variante;
    }

    if ($texto === null) {
        Respuesta::error(
            404,
            'cuerpo_desconocido',
            'No hay narración registrada para ese cuerpo.',
            'bodyId solicitado: ' . $bodyId . ' (' . $sufijo . ')'
        );
    }
}

// Tope de longitud: el catálogo lo cumple de sobra (150-220 palabras), pero si
// alguien edita una narración a mano, mejor que falle aquí que en la factura.
$LIMITE_CARACTERES = 2500;
if (mb_strlen($texto) > $LIMITE_CARACTERES) {
    Respuesta::error(
        413,
        'texto_demasiado_largo',
        'La narración de ese cuerpo supera el límite configurado.',
        $bodyId . ' tiene ' . mb_strlen($texto) . ' caracteres'
    );
}

// ---------------------------------------------------------------------------
// 3. Voz y modelo
//    El cliente puede pedir una voz concreta, pero solo de una lista blanca:
//    un voiceId libre permitiría usar voces de pago ajenas al proyecto.
//
//    La voz es un identificador público de ElevenLabs, no una credencial: sin
//    la clave de API no sirve para nada. Se cambia desde el panel de wj-admin,
//    con la variable de entorno ELEVENLABS_VOICE_ID o con wj-config.php.
// ---------------------------------------------------------------------------
$vozPredeterminada = Config::obtener('ELEVENLABS_VOICE_ID', Config::VOZ_PREDETERMINADA);
$modelo = Config::obtener('ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2');

$vocesPermitidas = array_filter(array_map(
    'trim',
    explode(',', (string) Config::obtener('ELEVENLABS_VOCES_PERMITIDAS', (string) $vozPredeterminada))
));

$voz = !empty($peticion['voiceId']) ? (string) $peticion['voiceId'] : (string) $vozPredeterminada;
if ($voz !== $vozPredeterminada && !in_array($voz, $vocesPermitidas, true)) {
    $voz = (string) $vozPredeterminada;
}

$clave = Config::obtener('ELEVENLABS_API_KEY');

// ---------------------------------------------------------------------------
// 4. Caché: si ya existe, se sirve sin tocar ElevenLabs ni el limitador
// ---------------------------------------------------------------------------
$cache = new Cache();
$claveCache = $cache->clave($texto, $voz, (string) $modelo);

if ($cache->existe($claveCache)) {
    $cache->servir($claveCache, true);
    exit;
}

// Precarga: si no estaba en caché, se responde «todavía no» y se termina. Sin
// llamada saliente, sin gasto y sin consumir cupo.
if (!empty($peticion['soloCache'])) {
    http_response_code(204);
    header('Cache-Control: no-store');
    header('X-Orbis-Cache: miss');
    exit;
}

// A partir de aquí hace falta generar, así que hace falta la clave de API.
if ($clave === null || $clave === '') {
    Respuesta::error(
        503,
        'sin_credencial',
        'La narración con voz no está configurada en este servidor. Se usará la voz del navegador.',
        'ELEVENLABS_API_KEY ausente'
    );
}
if ($voz === '') {
    Respuesta::error(
        503,
        'sin_voz',
        'No hay ninguna voz configurada para la narración.',
        'ELEVENLABS_VOICE_ID ausente'
    );
}

// ---------------------------------------------------------------------------
// 5. Límite de generaciones nuevas por IP
// ---------------------------------------------------------------------------
$limitador = new RateLimiter(
    Config::entero('LIMITE_GENERACIONES_HORA', 30),
    3600,
    'narracion',
    Config::entero('TOPE_DIARIO_NARRACION', 500)
);
$cupo = $limitador->consumir();

header('X-Orbis-Cupo-Restante: ' . $cupo['restantes']);

if (!$cupo['permitido']) {
    header('Retry-After: ' . $cupo['esperaSegundos']);
    // Se distingue quién ha llegado al tope. Decirle a alguien «has pedido
    // demasiadas» cuando quien se ha pasado es el sitio entero es mentira, y
    // además le hace creer que la culpa es suya y que esperando un rato se
    // arregla, cuando puede faltar un día.
    $porElSitio = ($cupo['motivo'] ?? null) === 'tope_diario';
    Respuesta::error(
        429,
        'limite_alcanzado',
        $porElSitio
            ? 'Hoy ya se ha alcanzado el máximo de narraciones nuevas de todo el sitio. '
                . 'Se seguirá oyendo con la voz del navegador; las ya guardadas suenan igual que siempre.'
            : 'Se ha alcanzado el límite de narraciones nuevas por hora. Vuelve a intentarlo más tarde; '
                . 'mientras tanto se usará la voz del navegador.',
        $porElSitio ? 'tope diario del sitio' : 'cupo por IP agotado'
    );
}

// ---------------------------------------------------------------------------
// 6. Llamada a ElevenLabs
//    La síntesis y la lectura de sus errores viven en lib/ElevenLabs.php: eran
//    la misma llamada copiada aquí, en el probador del panel y en el
//    diagnóstico, con los mismos ajustes de voz que tenían que coincidir.
// ---------------------------------------------------------------------------
if (!extension_loaded('curl')) {
    Respuesta::error(503, 'sin_curl', 'El servidor no puede realizar la síntesis de voz.', 'extensión curl ausente');
}

$sintesis = ElevenLabs::sintetizar($texto, $voz, (string) $modelo);

if (!$sintesis['ok']) {
    // Un 401 tiene DOS causas muy distintas y el remedio no se parece en nada:
    // o la clave no vale, o vale pero le falta un permiso. Distinguirlo aquí
    // ahorra buscar el problema en el sitio equivocado durante horas. La
    // respuesta cruda del tercero NO se devuelve: va al registro, recortada.
    $mensajes = [
        'sin_conexion'      => 'No se pudo contactar con el servicio de voz. Se usará la voz del navegador.',
        'clave_sin_permiso' => 'La clave de voz configurada no tiene permiso para sintetizar. Se usará la voz del '
            . 'navegador. En el panel de ElevenLabs, activa el permiso «text_to_speech» de esa '
            . 'clave, o genera otra que lo tenga.',
        'clave_invalida'    => 'La clave de voz configurada no es válida. Se usará la voz del navegador.',
        'voz_desconocida'   => 'La voz configurada no existe en la cuenta de ElevenLabs. Se usará la voz del navegador.',
        'error_sintesis'    => 'El servicio de voz devolvió un error. Se usará la voz del navegador.',
    ];
    Respuesta::error(
        502,
        $sintesis['error'],
        $mensajes[$sintesis['error']] ?? $mensajes['error_sintesis'],
        'HTTP ' . $sintesis['codigo'] . ' — ' . $sintesis['detalle']
    );
}

$respuesta = $sintesis['audio'];

// ---------------------------------------------------------------------------
// 7. Guardar y servir
// ---------------------------------------------------------------------------
if (!$cache->guardar($claveCache, (string) $respuesta)) {
    // No poder cachear es grave —cada visita volvería a pagar—, pero no motivo
    // para no entregar el audio ya generado.
    Respuesta::registrar('error', 'No se pudo guardar en caché ' . $claveCache . ' (¿permisos de cache/audio?)');

    header('Content-Type: audio/mpeg');
    header('Content-Length: ' . strlen((string) $respuesta));
    header('Cache-Control: no-store');
    header('X-Orbis-Cache: error');
    echo $respuesta;
    exit;
}

Respuesta::registrar('info', 'Generada narración de ' . $bodyId . ' (' . mb_strlen($texto) . ' caracteres)');
$cache->servir($claveCache, false);
