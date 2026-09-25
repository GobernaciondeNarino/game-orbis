<?php
/**
 * ORBIS — Google Analytics 4 por el Measurement Protocol, desde el servidor.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  POR QUÉ NO EL FRAGMENTO DE gtag.js
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Lo habitual es pegar en la página el <script> de googletagmanager.com. Aquí
 * no se puede, y no es una preferencia:
 *
 *   · la regla 2 del proyecto prohíbe cargar código de terceros en el
 *     navegador, y la CSP del .htaccess lo bloquearía;
 *   · gtag.js pone cookies de identificación, y el público de ORBIS son niños.
 *
 * El Measurement Protocol resuelve las dos cosas: el navegador le cuenta a
 * NUESTRO servidor qué ha pasado («ha abierto Marte») y es el servidor quien se
 * lo manda a Google. Ni una línea de código de Google en la página, ni una
 * cookie, y el secreto de la API se queda en el servidor.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  QUÉ SE PIERDE, DICHO CLARAMENTE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   · «Usuarios» se infla: sin cookies, cada visita es alguien nuevo. Sesiones,
 *     eventos, páginas y cuerpos visitados son fiables; usuarios recurrentes,
 *     no. Es el precio de no rastrear a nadie entre visitas.
 *   · La geografía: la petición le llega a Google desde la IP del servidor, así
 *     que país y ciudad serán los del servidor. No se reenvía la IP del
 *     visitante, a propósito.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  LISTA CERRADA DE EVENTOS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El navegador no puede inventar eventos ni parámetros: solo los de EVENTOS, y
 * cada valor se valida. Sin esto, cualquiera podría llenar la propiedad de
 * Analytics de la Gobernación con lo que quisiera usando nuestro secreto.
 *
 * Sintaxis compatible con PHP 7.4.
 */

declare(strict_types=1);

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Catalogo.php';

final class Analitica
{
    const COLECCION = 'https://www.google-analytics.com/mp/collect';
    const DEPURACION = 'https://www.google-analytics.com/debug/mp/collect';

    const ESTADO = 'cache/analitica.json';

    /**
     * Los eventos que se aceptan, y qué parámetros lleva cada uno.
     * El valor de cada parámetro es su validador: una lista cerrada, 'cuerpo'
     * (un id del catálogo) o 'texto' (corto y sin nada raro).
     */
    const EVENTOS = [
        'page_view'       => ['page_title' => 'texto'],
        'ver_cuerpo'      => ['cuerpo' => 'cuerpo'],
        'narracion'       => ['cuerpo' => 'cuerpo', 'motor' => ['servidor', 'navegador']],
        'usar_voz'        => ['motor' => ['navegador', 'servidor']],
        'usar_gestos'     => [],
        'preguntar'       => ['via' => ['catalogo', 'conversacion'], 'cuerpo' => 'cuerpo'],
        'cambiar_escala'  => ['modo' => ['real', 'didactico']],
        'cambiar_seccion' => ['seccion' => ['sistema', 'galaxia', 'cuerpos', 'datos', 'asistente']],
    ];

    /** Qué categorías de dispositivo se aceptan. */
    const DISPOSITIVOS = ['desktop', 'mobile', 'tablet'];

    public static function idMedicion(): ?string
    {
        $v = Config::obtener('GA_ID_MEDICION');
        return is_string($v) && preg_match('/^G-[A-Z0-9]{4,20}$/', $v) === 1 ? $v : null;
    }

    private static function secreto(): ?string
    {
        $v = Config::obtener('GA_SECRETO_API');
        return is_string($v) && trim($v) !== '' ? trim($v) : null;
    }

    /** Con los dos valores puestos se envía; con uno solo, no. */
    public static function activa(): bool
    {
        return self::idMedicion() !== null && self::secreto() !== null;
    }

    /**
     * Valida un evento llegado del navegador.
     *
     * @return array{0:?array,1:string} [evento listo para GA, motivo si no vale]
     */
    public static function validar(array $entrada): array
    {
        $nombre = (string) ($entrada['nombre'] ?? '');
        if (!isset(self::EVENTOS[$nombre])) {
            return [null, 'evento desconocido'];
        }
        $cliente = (string) ($entrada['cliente'] ?? '');
        $sesion = (string) ($entrada['sesion'] ?? '');
        // El mismo formato que usa gtag.js: aleatorio.marca_de_tiempo. Lo genera
        // el navegador en memoria al cargar la página y muere con ella.
        if (preg_match('/^\d{6,12}\.\d{9,11}$/', $cliente) !== 1 || preg_match('/^\d{9,11}$/', $sesion) !== 1) {
            return [null, 'identificadores inválidos'];
        }

        $params = ['session_id' => $sesion, 'engagement_time_msec' => 100];
        $llegados = is_array($entrada['params'] ?? null) ? $entrada['params'] : [];
        foreach (self::EVENTOS[$nombre] as $param => $regla) {
            if (!array_key_exists($param, $llegados)) {
                continue;
            }
            $valor = is_scalar($llegados[$param]) ? (string) $llegados[$param] : '';
            if (is_array($regla)) {
                if (!in_array($valor, $regla, true)) {
                    return [null, 'valor no admitido en ' . $param];
                }
            } elseif ($regla === 'cuerpo') {
                if (preg_match('/^[a-z0-9-]{1,40}$/', $valor) !== 1 || Catalogo::cuerpo($valor) === null) {
                    return [null, 'cuerpo desconocido'];
                }
            } elseif ($regla === 'texto') {
                $valor = mb_substr(trim((string) preg_replace('/[\x00-\x1F<>]/u', '', $valor)), 0, 100);
            }
            $params[$param] = $valor;
        }

        $evento = ['name' => $nombre, 'params' => $params];
        $dispositivo = (string) ($entrada['dispositivo'] ?? '');
        $idioma = (string) ($entrada['idioma'] ?? '');
        $extra = [];
        if (in_array($dispositivo, self::DISPOSITIVOS, true)) {
            $extra['category'] = $dispositivo;
        }
        if (preg_match('/^[a-z]{2}(-[A-Za-z]{2,4})?$/', $idioma) === 1) {
            $extra['language'] = $idioma;
        }
        return [['client_id' => $cliente, 'evento' => $evento, 'device' => $extra], ''];
    }

    /**
     * Envía un evento ya validado. Para page_view añade la URL de la página,
     * que se construye aquí —del propio servidor— y no la manda el navegador.
     */
    public static function enviar(array $validado, string $paginaUrl = ''): int
    {
        if (!self::activa()) {
            return 0;
        }
        $evento = $validado['evento'];
        if ($evento['name'] === 'page_view' && $paginaUrl !== '') {
            $evento['params']['page_location'] = mb_substr($paginaUrl, 0, 100);
        }
        $cuerpo = ['client_id' => $validado['client_id'], 'events' => [$evento]];
        if ($validado['device'] !== []) {
            $cuerpo['device'] = $validado['device'];
        }
        $codigo = self::publicar(self::COLECCION, $cuerpo, 4)['codigo'];
        self::anotar($codigo);
        return $codigo;
    }

    /** @return array{codigo:int,cuerpo:string} */
    private static function publicar(string $base, array $cuerpo, int $espera): array
    {
        $url = $base . '?measurement_id=' . rawurlencode((string) self::idMedicion())
            . '&api_secret=' . rawurlencode((string) self::secreto());
        if (!extension_loaded('curl')) {
            return ['codigo' => 0, 'cuerpo' => ''];
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($cuerpo, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $espera,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $r = curl_exec($ch);
        $codigo = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return ['codigo' => $codigo, 'cuerpo' => is_string($r) ? $r : ''];
    }

    // ------------------------------------------------------------------------
    // Seguimiento de los envíos, para la pestaña del panel
    // ------------------------------------------------------------------------

    /** Cuenta envíos del día y guarda el último fallo. Sin datos de nadie. */
    private static function anotar(int $codigo): void
    {
        $ruta = Config::contenido(self::ESTADO);
        $e = self::estado();
        $hoy = gmdate('Y-m-d');
        if (($e['dia'] ?? '') !== $hoy) {
            $e = ['dia' => $hoy, 'enviados' => 0, 'fallidos' => 0, 'ultimoFallo' => $e['ultimoFallo'] ?? null];
        }
        if ($codigo >= 200 && $codigo < 300) {
            $e['enviados']++;
            $e['ultimoEnvio'] = gmdate('c');
        } else {
            $e['fallidos']++;
            $e['ultimoFallo'] = ['fecha' => gmdate('c'), 'codigo' => $codigo];
        }
        @file_put_contents($ruta, json_encode($e), LOCK_EX);
    }

    public static function estado(): array
    {
        $ruta = Config::contenido(self::ESTADO);
        $d = is_readable($ruta) ? json_decode((string) file_get_contents($ruta), true) : null;
        return is_array($d) ? $d : [];
    }

    // ------------------------------------------------------------------------
    // Verificación desde el panel
    // ------------------------------------------------------------------------

    /** @param callable(string,string,string,string):void $anotar */
    public static function verificar(callable $anotar): void
    {
        $id = self::idMedicion();
        $bruto = Config::obtener('GA_ID_MEDICION');
        if ($id === null) {
            $anotar(
                'id', 'ID de medición', $bruto ? 'error' : 'aviso',
                $bruto ? 'No tiene forma de ID de GA4: empieza por «G-» seguido de letras y números.' : 'Sin ID de medición: no se envía nada.'
            );
            return;
        }
        $anotar('id', 'ID de medición', 'ok', $id . '.');
        if (self::secreto() === null) {
            $anotar('secreto', 'secreto de la API', 'error', 'Falta el secreto del Measurement Protocol: sin él Google descarta los eventos.');
            return;
        }
        $anotar('secreto', 'secreto de la API', 'ok', 'Configurado (origen: ' . (Config::origen('GA_SECRETO_API') ?? '—') . ').');

        // 1. El validador de Google: dice si el evento está bien formado. NO
        //    comprueba el secreto —es una limitación suya—, así que se envía
        //    además uno real.
        $prueba = [
            'client_id' => '1234567.' . time(),
            'events' => [['name' => 'orbis_prueba', 'params' => ['session_id' => (string) time(), 'engagement_time_msec' => 100]]],
        ];
        $v = self::publicar(self::DEPURACION, $prueba, 8);
        if ($v['codigo'] === 0) {
            $anotar('conexion', 'conexión', 'error', 'El servidor no llega a www.google-analytics.com.');
            return;
        }
        $mensajes = json_decode($v['cuerpo'], true)['validationMessages'] ?? null;
        if (is_array($mensajes) && $mensajes === []) {
            $anotar('formato', 'formato de los eventos', 'ok', 'El validador de Google acepta los eventos de ORBIS.');
        } else {
            $primero = is_array($mensajes) && isset($mensajes[0]['description']) ? (string) $mensajes[0]['description'] : 'respuesta HTTP ' . $v['codigo'];
            $anotar('formato', 'formato de los eventos', 'error', 'El validador de Google protesta: ' . mb_substr($primero, 0, 200));
            return;
        }

        // 2. Un envío real. Google responde 204 aunque el secreto no valga —no
        //    confirma nada—, así que la comprobación final es mirar en GA4.
        $real = self::publicar(self::COLECCION, $prueba, 8);
        self::anotar($real['codigo']);
        $anotar(
            'envio', 'envío real',
            $real['codigo'] >= 200 && $real['codigo'] < 300 ? 'ok' : 'error',
            $real['codigo'] >= 200 && $real['codigo'] < 300
                ? 'Enviado el evento «orbis_prueba». Compruébalo en GA4 → Informes → Tiempo real en uno o dos minutos: '
                    . 'si no aparece, el secreto o el ID no son de ese flujo.'
                : 'Google respondió HTTP ' . $real['codigo'] . '.'
        );
    }
}
