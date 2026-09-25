<?php
/**
 * ORBIS — Recibe un evento de uso y se lo reenvía a Google Analytics 4.
 *
 *   POST api/evento.php
 *   { "nombre": "ver_cuerpo", "cliente": "123456789.1727270000",
 *     "sesion": "1727270000", "params": { "cuerpo": "marte" },
 *     "dispositivo": "mobile", "idioma": "es-CO" }
 *
 * Responde SIEMPRE rápido y sin cuerpo: un 204. El navegador no espera a
 * Google, y medir no puede ralentizar nunca la experiencia.
 *
 * Si Analytics no está configurado, lo dice en una cabecera
 * (X-Orbis-Analitica: inactiva) y el navegador deja de enviar en esa visita.
 *
 * Por qué pasa por aquí y no por gtag.js: ver lib/Analitica.php.
 *
 * Sintaxis compatible con PHP 7.4.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/Config.php';
require_once __DIR__ . '/../lib/Respuesta.php';
require_once __DIR__ . '/../lib/RateLimiter.php';
require_once __DIR__ . '/../lib/Analitica.php';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    Respuesta::error(405, 'metodo_no_permitido', 'Este endpoint solo acepta POST.');
}

if (!Analitica::activa()) {
    header('X-Orbis-Analitica: inactiva');
    http_response_code(204);
    exit;
}
header('X-Orbis-Analitica: activa');

$crudo = file_get_contents('php://input');
if ($crudo === false || $crudo === '' || strlen($crudo) > 2048) {
    http_response_code(400);
    exit;
}
$entrada = json_decode((string) $crudo, true);
if (!is_array($entrada)) {
    http_response_code(400);
    exit;
}

[$evento, $motivo] = Analitica::validar($entrada);
if ($evento === null) {
    // Sin detalle en la respuesta: a quien envía basura no hay que explicarle
    // qué le falta para que pase.
    http_response_code(400);
    exit;
}

// Tope por visitante: una visita normal manda unas decenas de eventos. Esto
// frena a quien intente llenar la propiedad de Analytics con un bucle.
$limitador = new RateLimiter(300, 3600, 'analitica', 200000);
if (!$limitador->consumir()['permitido']) {
    http_response_code(429);
    exit;
}

// La dirección de la página la pone el servidor: el esquema, el dominio y la
// carpeta donde está instalado ORBIS (puede ser un subdirectorio).
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') === '443';
$raiz = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'), 3)), '/') . '/';
$host = preg_replace('/[^A-Za-z0-9.\-:]/', '', (string) ($_SERVER['HTTP_HOST'] ?? ''));
$pagina = ($https ? 'https://' : 'http://') . $host . $raiz;

// Se responde YA y se envía después: con PHP-FPM, fastcgi_finish_request
// cierra la conexión con el navegador y el envío a Google sigue en segundo
// plano. Sin FPM, el envío va antes, con un tiempo de espera corto.
http_response_code(204);
if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
}
Analitica::enviar($evento, $pagina);
