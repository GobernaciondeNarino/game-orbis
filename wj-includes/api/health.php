<?php
/**
 * ORBIS — Diagnóstico de despliegue.
 *
 * Devuelve en JSON si el servidor reúne lo necesario para la narración con
 * ElevenLabs. Lo consulta la pantalla de arranque del frontend y sirve como
 * prueba de humo tras subir el proyecto a Plesk.
 *
 * NUNCA devuelve la clave de API: solo si está configurada o no.
 *
 * Uso:
 *   GET api/health.php          comprobaciones locales (sin salida a Internet)
 *   GET api/health.php?red=1    añade la prueba de conectividad con ElevenLabs
 *
 * Sintaxis compatible con PHP 7.4 a propósito, para que el diagnóstico se
 * pueda ejecutar incluso en un Plesk que aún no haya migrado a 8.1.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const PHP_MINIMO = '8.1.0';

// Para Config::VOZ_PREDETERMINADA: qué voz se usa si nadie la sustituye.
require_once __DIR__ . '/../lib/Config.php';

/** @var array<int,array<string,mixed>> */
$comprobaciones = [];

/**
 * Registra una comprobación.
 *
 * La etiqueta es lo que ve la persona en la pantalla de arranque; la clave es
 * el identificador estable para el código. Nunca se muestran claves internas
 * en la interfaz.
 *
 * @param string $clave      identificador estable, usado por el frontend
 * @param string $etiqueta   nombre legible, en español
 * @param string $resultado  'ok' | 'aviso' | 'error'
 */
function comprobar(string $clave, string $etiqueta, string $resultado, string $nota): void
{
    global $comprobaciones;
    $comprobaciones[] = [
        'clave'     => $clave,
        'etiqueta'  => $etiqueta,
        'resultado' => $resultado,
        'nota'      => $nota,
    ];
}

// --------------------------------------------------------------------------
// 1. Versión de PHP
// --------------------------------------------------------------------------
$versionOk = version_compare(PHP_VERSION, PHP_MINIMO, '>=');
comprobar(
    'php', 'versión de PHP',
    $versionOk ? 'ok' : 'aviso',
    $versionOk
        ? 'versión soportada'
        : 'ORBIS se prueba en PHP ' . PHP_MINIMO . '+; esta es ' . PHP_VERSION
);

// --------------------------------------------------------------------------
// 2. Extensiones necesarias
//    curl es imprescindible para hablar con ElevenLabs; json y openssl para
//    firmar el hash de caché y verificar TLS.
// --------------------------------------------------------------------------
foreach (['curl' => true, 'json' => true, 'openssl' => true, 'mbstring' => false] as $ext => $critica) {
    $presente = extension_loaded($ext);
    comprobar(
        'ext_' . $ext,
        'extensión ' . $ext,
        $presente ? 'ok' : ($critica ? 'error' : 'aviso'),
        $presente ? 'disponible' : 'no cargada'
    );
}

// --------------------------------------------------------------------------
// 3. Escritura en las cachés
//    No basta con que el directorio exista: en Plesk lo habitual es que exista
//    y pertenezca a otro usuario. Por eso se escribe un archivo de verdad y se
//    borra, en lugar de fiarse de is_writable().
//
//    cache/audio es crítico: sin él cada visita regeneraría el MP3 y la
//    factura de ElevenLabs se dispararía. Los otros tres solo hacen que se
//    repita trabajo ya hecho, así que son avisos.
// --------------------------------------------------------------------------

/**
 * Comprueba que se puede escribir de verdad en un directorio de caché.
 *
 * @param string $relativo  ruta desde la raíz del proyecto
 * @param bool   $critico   si su ausencia rompe algo o solo lo encarece
 */
function comprobarEscritura(string $clave, string $relativo, bool $critico, string $paraQue): void
{
    $gravedad = $critico ? 'error' : 'aviso';
    $ruta = Config::contenido($relativo);

    if (!is_dir($ruta)) {
        @mkdir($ruta, 0755, true);
    }
    if (!is_dir($ruta)) {
        comprobar($clave, 'escritura en ' . $relativo, $gravedad, 'no existe y no se pudo crear — ' . $paraQue);
        return;
    }

    $prueba = $ruta . '/.escritura-' . bin2hex(random_bytes(4));
    $escrito = @file_put_contents($prueba, 'ok') !== false;
    @unlink($prueba);

    comprobar(
        $clave,
        'escritura en ' . $relativo,
        $escrito ? 'ok' : $gravedad,
        $escrito ? 'escribible' : 'escritura denegada (revisa permisos y propietario) — ' . $paraQue
    );
}

comprobarEscritura('cache_audio', 'cache/audio', true,
    'sin caché, cada visita vuelve a pagar la narración en ElevenLabs');
comprobarEscritura('cache_efemerides', 'cache/efemerides', false,
    'sin caché se consulta JPL Horizons en cada pregunta de posición');
comprobarEscritura('cache_respuestas', 'cache/respuestas', false,
    'sin caché el asistente responde por escrito pero no se le puede oír');
comprobarEscritura('cache_limites', 'cache/limites', false,
    'sin contadores, los topes de gasto por IP no se aplican');

// --------------------------------------------------------------------------
// 4. Clave de ElevenLabs
//    Orden de búsqueda: variable de entorno (recomendado en Plesk) →
//    config/secrets.php. Solo se informa de su presencia.
// --------------------------------------------------------------------------
$clave = Config::obtener('ELEVENLABS_API_KEY');
$origenClave = Config::origen('ELEVENLABS_API_KEY');

comprobar(
    'clave_elevenlabs', 'clave de ElevenLabs',
    $origenClave !== null ? 'ok' : 'aviso',
    $origenClave !== null
        ? 'configurada (origen: ' . $origenClave . ')'
        : 'ausente — la narración usará la voz del navegador'
);

// --------------------------------------------------------------------------
// 4b. Qué voz se está usando, y de dónde sale
//     Un id de voz es público —sin la clave de API no sirve de nada—, así que
//     se puede publicar aquí. Es lo que responde a «he cambiado la voz y suena
//     igual»: puede que una variable de entorno antigua esté ganando al valor
//     del código, o puede que ni siquiera se esté usando ElevenLabs porque
//     falta la clave y todo va con la voz del navegador.
// --------------------------------------------------------------------------
$vozActiva = (string) Config::obtener('ELEVENLABS_VOICE_ID', Config::VOZ_PREDETERMINADA);
$origenVoz = Config::origen('ELEVENLABS_VOICE_ID');
$origenVoz = $origenVoz === 'entorno'
    ? 'variable de entorno ELEVENLABS_VOICE_ID'
    : ($origenVoz ?? 'valor fijado en wj-includes/lib/Config.php');

comprobar(
    'voz_elevenlabs', 'voz de la narración',
    $origenClave === null ? 'aviso' : 'ok',
    $origenClave === null
        ? 'se usaría ' . $vozActiva . ' (origen: ' . $origenVoz . '), pero sin clave de API '
          . 'no se llega a ElevenLabs y suena la voz del navegador'
        : $vozActiva . ' (origen: ' . $origenVoz . ')'
);

// --------------------------------------------------------------------------
// 4c. Asistente conversacional
//     Son dos piezas y fallan por separado: la clave se configura y el SDK se
//     sube. Con la clave puesta y sin wj-includes/vendor —el fallo típico
//     de un despliegue por FTP que se dejó 2.339 archivos por el camino— el
//     asistente devolvería 503 sin que se entienda por qué.
// --------------------------------------------------------------------------
$origenAnthropic = Config::origen('ANTHROPIC_API_KEY');
comprobar(
    'clave_anthropic', 'clave de Anthropic',
    $origenAnthropic !== null ? 'ok' : 'aviso',
    $origenAnthropic !== null
        ? 'configurada (origen: ' . $origenAnthropic . ')'
        : 'ausente — el asistente no conversará; las preguntas del catálogo se siguen respondiendo'
);

$sdk = Config::includes('vendor/autoload.php');
comprobar(
    'sdk_anthropic', 'SDK de Anthropic',
    is_readable($sdk) ? 'ok' : ($origenAnthropic !== null ? 'error' : 'aviso'),
    is_readable($sdk)
        ? 'wj-includes/vendor presente'
        : 'falta wj-includes/vendor — ¿subiste la carpeta completa?'
);

// El modelo también se puede sustituir, y conviene ver cuál está activo antes
// de preguntarse por qué una respuesta salió peor de lo esperado.
comprobar(
    'modelo_asistente', 'modelo del asistente',
    'ok',
    (string) Config::obtener('ORBIS_MODELO', 'claude-opus-5')
        . (Config::origen('ORBIS_MODELO') !== null
            ? ' (origen: ' . Config::origen('ORBIS_MODELO') . ')'
            : ' (valor fijado en wj-includes/lib/Conversacion.php)')
);

// --------------------------------------------------------------------------
// 5. wj-config.php no debe ser accesible por HTTP
//
// ESTA COMPROBACIÓN ESTUVO MINTIENDO
// ──────────────────────────────────
// Daba «error» cuando wj-config.php NO existía, y decía que faltaba un
// «config/.htaccess» que ya no existe: la carpeta config/ desapareció al
// reorganizar el proyecto en tres. O sea que una instalación impecable —las
// claves en las variables de entorno de Plesk, que es lo RECOMENDADO, y ningún
// wj-config.php en el disco— daba estado «error» y health.php respondía 503.
// Justo el diagnóstico que se mira cuando algo no va, diciendo que algo no va.
//
// Lo que de verdad importa no es que el archivo exista, sino que si existe no
// se pueda descargar. Eso no se puede probar desde dentro —haría falta una
// petición HTTP a uno mismo—, pero sí se puede comprobar que la regla que lo
// deniega sigue en el .htaccess de la raíz, que es de donde depende.
// --------------------------------------------------------------------------
$rutaConfig = Config::raiz() . '/' . Config::ARCHIVO_CONFIG;
if (!is_file($rutaConfig)) {
    comprobar(
        'config_protegido', 'protección de ' . Config::ARCHIVO_CONFIG,
        'ok',
        'no hay archivo: la configuración sale del entorno o del panel, que es lo recomendado'
    );
} else {
    $reglas = (string) @file_get_contents(Config::raiz() . '/.htaccess');
    $denegado = strpos($reglas, 'FilesMatch "^wj-config') !== false;
    comprobar(
        'config_protegido', 'protección de ' . Config::ARCHIVO_CONFIG,
        $denegado ? 'ok' : 'error',
        $denegado
            ? 'existe y el .htaccess de la raíz lo deniega'
            : 'existe y el .htaccess de la raíz NO lo deniega: las claves quedarían expuestas'
    );
}

// --------------------------------------------------------------------------
// 5 bis. El panel tiene que poder guardar lo que se escriba en él
//
// Sin esto, el panel de wj-admin acepta el formulario, dice «Ajustes
// guardados» —no: fallaba al escribir y lo decía, pero solo DESPUÉS de
// rellenarlo entero— y aquí no aparecía nada. Es el fallo típico de Plesk:
// el despliegue se hace con un usuario y PHP corre con otro.
// --------------------------------------------------------------------------
comprobarEscritura('ajustes_panel', 'ajustes', false,
    'el panel de wj-admin no podrá guardar nada de lo que se escriba en él');
comprobarEscritura('conocimiento_panel', 'conocimiento', false,
    'la pestaña de conocimiento no podrá guardar narraciones ni datos nuevos');

// Analytics: solo si está activo, que es lo que se pregunta al ver datos raros
// en GA4. Nunca el ID ni el secreto: el diagnóstico es público.
require_once __DIR__ . '/../lib/Analitica.php';
comprobar(
    'analitica', 'Google Analytics',
    'ok',
    Analitica::activa()
        ? 'activo: los eventos se envían desde el servidor (Measurement Protocol)'
        : 'inactivo: no se mide nada'
);

// --------------------------------------------------------------------------
// 6. Datos maestros
// --------------------------------------------------------------------------
$rutaDatos = Config::contenido('data/sistema-solar.json');
if (!is_readable($rutaDatos)) {
    comprobar('datos', 'catálogo de datos', 'error', 'data/sistema-solar.json no legible');
} else {
    $datos = json_decode((string) file_get_contents($rutaDatos), true);
    if (!is_array($datos) || !isset($datos['cuerpos'])) {
        comprobar('datos', 'catálogo de datos', 'error', 'JSON inválido o sin la clave "cuerpos"');
    } else {
        $total = count($datos['cuerpos']);
        comprobar(
            'datos',
            'catálogo de datos',
            $total > 0 ? 'ok' : 'aviso',
            $total > 0 ? $total . ' cuerpos catalogados' : 'catálogo vacío (se completa en la fase 2)'
        );
    }
}

// --------------------------------------------------------------------------
// 7. Copias locales de las dependencias del frontend
// --------------------------------------------------------------------------
$vendorThree = Config::includes('externos/three/build/three.module.min.js');
comprobar(
    'vendor_three', 'Three.js en el servidor',
    is_readable($vendorThree) ? 'ok' : 'error',
    is_readable($vendorThree) ? 'Three.js vendorizado' : 'falta vendor/three — ¿subiste la carpeta completa?'
);

$modeloManos = Config::contenido('assets/models/hand_landmarker.task');
comprobar(
    'modelo_manos', 'modelo de detección de manos',
    is_readable($modeloManos) ? 'ok' : 'aviso',
    is_readable($modeloManos)
        ? 'hand_landmarker.task presente'
        : 'ausente — el control por gestos quedará desactivado'
);

// --------------------------------------------------------------------------
// 8. Conectividad con ElevenLabs (solo con ?red=1)
//    Se hace bajo demanda para no gastar una salida a Internet en cada carga.
// --------------------------------------------------------------------------
if (isset($_GET['red']) && $_GET['red'] === '1') {
    if (!extension_loaded('curl')) {
        comprobar('red_elevenlabs', 'conexión con ElevenLabs', 'error', 'curl no está disponible');
    } else {
        $ch = curl_init('https://api.elevenlabs.io/v1/models');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 8,
            CURLOPT_SSL_VERIFYPEER => true,   // Verificación TLS obligatoria.
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER     => $clave ? ['xi-api-key: ' . $clave] : [],
        ]);
        $cuerpo1 = curl_exec($ch);
        $codigo = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $errorCurl = curl_error($ch);
        curl_close($ch);

        // Con un código que no es 200 ni 401, «respuesta HTTP 400» a secas no
        // dice nada y no hay adónde ir. ElevenLabs manda un motivo en el cuerpo
        // —«invalid_api_key», «detected_unusual_activity»…— y ese motivo NO es
        // un secreto: es lo que le pasa a la clave, no la clave. Se recorta y se
        // enseña, que es lo que convierte un número en algo accionable.
        $motivoApi = '';
        $detalle1 = json_decode((string) $cuerpo1, true);
        if (is_array($detalle1)) {
            $bruto = $detalle1['detail']['message']
                ?? $detalle1['detail']['status']
                ?? (is_string($detalle1['detail'] ?? null) ? $detalle1['detail'] : '');
            if (is_string($bruto) && $bruto !== '') {
                $motivoApi = ': ' . mb_substr(str_replace(["\n", "\r"], ' ', $bruto), 0, 160);
            }
        }

        if ($codigo === 200) {
            comprobar('red_elevenlabs', 'conexión con ElevenLabs', 'ok', 'API alcanzable y clave válida');

            // Llegar y que la clave valga NO basta: ElevenLabs deja crear claves
            // con permisos sueltos, y una que lee la lista de voces pero no
            // puede sintetizar pasa esta comprobación y falla al narrar. Se
            // pregunta por el permiso concreto, sin gastar caracteres: basta con
            // que la API conteste algo distinto de «te falta el permiso».
            $ch2 = curl_init('https://api.elevenlabs.io/v1/text-to-speech/' . Config::VOZ_PREDETERMINADA);
            curl_setopt_array($ch2, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 12,
                CURLOPT_POST           => true,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_HTTPHEADER     => ['xi-api-key: ' . $clave, 'Content-Type: application/json'],
                // Un solo carácter: lo mínimo que la API acepta.
                CURLOPT_POSTFIELDS     => json_encode(['text' => '.', 'model_id' => 'eleven_multilingual_v2']),
            ]);
            $cuerpo2 = curl_exec($ch2);
            $codigo2 = (int) curl_getinfo($ch2, CURLINFO_RESPONSE_CODE);
            curl_close($ch2);

            $detalle = json_decode((string) $cuerpo2, true);
            $sinPermiso = $codigo2 === 401
                && (($detalle['detail']['status'] ?? '') === 'missing_permissions'
                    || stripos((string) ($detalle['detail']['message'] ?? ''), 'permission') !== false);

            comprobar(
                'permiso_sintesis',
                'permiso para sintetizar voz',
                $sinPermiso ? 'error' : 'ok',
                $sinPermiso
                    ? 'la clave NO tiene el permiso «text_to_speech»: se llega a ElevenLabs pero no se '
                      . 'puede narrar. Actívalo en el panel de ElevenLabs o genera otra clave que lo tenga'
                    : 'la clave puede sintetizar'
            );
        } elseif ($codigo === 401) {
            comprobar(
                'red_elevenlabs',
                'conexión con ElevenLabs',
                'error',
                'API alcanzable pero la clave es inválida' . $motivoApi
            );
        } elseif ($codigo > 0) {
            // Un 4xx aquí es la clave, no la red: la petición llegó y la
            // rechazaron. Se marca como error, no como aviso, porque sin esto
            // la narración no funciona y un «aviso» invita a ignorarlo.
            comprobar(
                'red_elevenlabs',
                'conexión con ElevenLabs',
                $codigo >= 400 && $codigo < 500 ? 'error' : 'aviso',
                'la API rechaza la clave con un HTTP ' . $codigo . $motivoApi
                    . ($motivoApi === '' ? ' (sin motivo en la respuesta)' : '')
            );
        } else {
            // No se expone el mensaje crudo de curl para no filtrar rutas internas.
            comprobar(
                'red_elevenlabs',
                'conexión con ElevenLabs',
                'error',
                'sin salida a Internet' . ($errorCurl !== '' ? ' (fallo de conexión)' : '')
            );
        }
    }

    // ----------------------------------------------------------------------
    // 8 bis. ¿Existe de verdad el modelo del asistente? (solo con ?red=1)
    //
    // UN MODELO MAL ESCRITO NO SE NOTA HASTA QUE ALGUIEN PREGUNTA ALGO.
    // Los identificadores llevan guiones y no puntos —claude-sonnet-4-6, no
    // claude-sonnet-4.6— y el error de teclearlo con punto es tan fácil de
    // cometer como imposible de ver: la clave está, el SDK está, el
    // diagnóstico daba verde entero, y el asistente devuelve 404 a la primera
    // pregunta. Preguntar al catálogo de modelos cuesta una petición y no
    // gasta ni un token.
    // ----------------------------------------------------------------------
    // Se carga aquí dentro y no arriba: solo hace falta con ?red=1, y el resto
    // del diagnóstico tiene que seguir respondiendo aunque falte el SDK.
    require_once __DIR__ . '/../lib/Conversacion.php';

    $claveAnthropic = Config::obtener('ANTHROPIC_API_KEY');
    $modelo = (string) Config::obtener('ORBIS_MODELO', Conversacion::MODELO);

    if (extension_loaded('curl') && $claveAnthropic !== null && $claveAnthropic !== '') {
        $ch3 = curl_init('https://api.anthropic.com/v1/models/' . rawurlencode($modelo));
        curl_setopt_array($ch3, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER     => [
                'x-api-key: ' . $claveAnthropic,
                'anthropic-version: 2023-06-01',
            ],
        ]);
        $cuerpo3 = curl_exec($ch3);
        $codigo3 = (int) curl_getinfo($ch3, CURLINFO_RESPONSE_CODE);
        curl_close($ch3);

        if ($codigo3 === 200) {
            $m = json_decode((string) $cuerpo3, true);
            comprobar(
                'modelo_existe', 'el modelo del asistente existe', 'ok',
                'confirmado con Anthropic: ' . (string) ($m['display_name'] ?? $modelo)
            );
        } elseif ($codigo3 === 404) {
            comprobar(
                'modelo_existe', 'el modelo del asistente existe', 'error',
                sprintf(
                    'Anthropic no conoce ningún modelo «%s». Revísalo: los identificadores llevan '
                        . 'guiones y no puntos (claude-sonnet-4-6, no claude-sonnet-4.6). Mientras siga '
                        . 'así, el asistente falla en cuanto alguien le pregunta algo',
                    $modelo
                )
            );
        } elseif ($codigo3 === 401) {
            comprobar(
                'modelo_existe', 'el modelo del asistente existe', 'error',
                'la clave de Anthropic no vale: no se ha podido comprobar el modelo'
            );
        } else {
            comprobar(
                'modelo_existe', 'el modelo del asistente existe', 'aviso',
                'no se ha podido comprobar (HTTP ' . $codigo3 . ')'
            );
        }
    }
}

// --------------------------------------------------------------------------
// Veredicto
// --------------------------------------------------------------------------
$hayError = false;
$hayAviso = false;
foreach ($comprobaciones as $c) {
    if ($c['resultado'] === 'error') {
        $hayError = true;
    } elseif ($c['resultado'] === 'aviso') {
        $hayAviso = true;
    }
}

$estado = $hayError ? 'error' : ($hayAviso ? 'aviso' : 'ok');
http_response_code($hayError ? 503 : 200);

echo json_encode([
    'aplicacion'     => 'ORBIS',
    'version'        => '0.1.0',
    'estado'         => $estado,
    'php'            => ['version' => PHP_VERSION, 'minimo' => PHP_MINIMO],
    'comprobaciones' => $comprobaciones,
    'sugerencia'     => $hayError
        ? 'Revisa docs/DESPLIEGUE-PLESK.md, apartado «Resolución de problemas».'
        : null,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
