<?php
/**
 * ORBIS — Lo publicado del conocimiento de un cuerpo.
 *
 *   GET api/conocimiento.php?cuerpo=marte
 *
 * Devuelve sus narraciones y sus datos ACTIVOS, cada uno con su huella —lo que
 * el navegador manda a api/tts.php para pedir el audio de ese texto— y cada
 * dato con su fuente.
 *
 * Es solo lectura y no tiene nada de privado: es lo mismo que se va a oír. Lo
 * que no sale de aquí es la capa interna del panel: las entradas retiradas,
 * los originales que se corrigieron y las fechas.
 *
 * Sintaxis compatible con PHP 7.4.
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/Config.php';
require_once __DIR__ . '/../lib/Respuesta.php';
require_once __DIR__ . '/../lib/Catalogo.php';
require_once __DIR__ . '/../lib/Conocimiento.php';

header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    Respuesta::error(405, 'metodo_no_permitido', 'Este endpoint solo acepta GET.');
}

$id = (string) ($_GET['cuerpo'] ?? '');
if (preg_match('/^[a-z0-9-]{1,40}$/', $id) !== 1) {
    Respuesta::error(400, 'id_invalido', 'El identificador del cuerpo no tiene un formato válido.');
}
if (Catalogo::cuerpo($id) === null) {
    Respuesta::error(404, 'cuerpo_desconocido', 'No hay ningún cuerpo con ese identificador.');
}

$publico = Conocimiento::publico($id);
$cuerpoJson = json_encode(['cuerpo' => $id] + $publico, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

// Una ETag con el contenido: el navegador revalida y, si nada cambió desde el
// panel, recibe un 304 sin cuerpo. Caché corta, porque lo que se edita en el
// panel tiene que verse pronto.
$etag = '"' . substr(hash('sha256', (string) $cuerpoJson), 0, 20) . '"';
header('ETag: ' . $etag);
header('Cache-Control: public, max-age=60');
if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
    http_response_code(304);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
echo $cuerpoJson;
