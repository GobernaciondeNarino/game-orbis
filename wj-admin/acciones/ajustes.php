<?php
/**
 * ORBIS — Guardar ajustes, y verificar un servicio.
 *
 * Lo incluye index.php con la sesión y el testigo ya comprobados.
 *
 * SOLO SE TOCA LO QUE ESTABA EN EL FORMULARIO
 * ───────────────────────────────────────────
 * Con un único formulario daba igual; con pestañas, no. El guardado anterior
 * recorría TODOS los campos y ponía en blanco los que no llegaban: guardar la
 * pestaña de Analítica habría borrado la voz y los topes de gasto. Cada
 * formulario declara ahora sus grupos, y solo esos se escriben. Es también lo
 * que permite distinguir una casilla desmarcada —no llega nada— de una casilla
 * que no estaba en ese formulario.
 */

declare(strict_types=1);

if (!defined('ORBIS_PANEL')) {
    http_response_code(403);
    exit;
}

$grupos = array_values(array_filter(
    array_map('trim', explode(',', (string) ($_POST['grupos'] ?? ''))),
    function ($g) {
        return isset(Ajustes::GRUPOS[$g]);
    }
));

$entrantes = [];
foreach (Ajustes::CAMPOS as $clave => $campo) {
    if (!in_array($campo['grupo'], $grupos, true)) {
        continue;
    }
    switch ($campo['tipo']) {
        case 'clave':
            // Vacío y sin casilla = no se toca: el campo sale siempre vacío.
            if (!empty($_POST['borrar'][$clave])) {
                $entrantes[$clave] = '';
            } elseif (($_POST[$clave] ?? '') !== '') {
                $entrantes[$clave] = (string) $_POST[$clave];
            }
            break;
        case 'casilla':
            $entrantes[$clave] = isset($_POST[$clave]) ? '1' : '';
            break;
        default:
            $entrantes[$clave] = (string) ($_POST[$clave] ?? '');
    }
}

$servicio = (string) ($_POST['servicio'] ?? '');
$ancla = isset(Verificador::SERVICIOS[$servicio]) ? $servicio : ($grupos[0] ?? '');
// Se vuelve a donde se estaba, incluida la ficha del cuerpo si se guardó desde
// la pestaña de conocimiento.
$cuerpoVuelta = (string) ($_GET['cuerpo'] ?? '');
$volver = urlPanel(
    ['pestana' => $pestana, 'cuerpo' => preg_match('/^[a-z0-9-]{1,40}$/', $cuerpoVuelta) === 1 ? $cuerpoVuelta : null],
    $ancla
);

[$guardado, $errores] = $entrantes === [] ? [true, []] : Ajustes::guardar($entrantes);

if (!$guardado) {
    // Lo escrito vuelve al formulario —salvo las claves, que nunca vuelven—.
    $enviados = [];
    foreach ($entrantes as $clave => $valor) {
        if (Ajustes::CAMPOS[$clave]['tipo'] !== 'clave') {
            $enviados[$clave] = $valor;
        }
    }
    redirigirCon(
        $volver,
        isset($errores['_']) ? (string) $errores['_'] : 'Hay ' . count($errores) . ' campo(s) que revisar. No se ha guardado nada.',
        'error',
        ['errores' => $errores, 'enviados' => $enviados]
    );
}

if ($accion === 'verificar' && isset(Verificador::SERVICIOS[$servicio])) {
    $r = Verificador::ejecutar($servicio);
    $textos = [
        'ok'    => 'funciona.',
        'aviso' => 'funciona, con avisos. Mira el detalle.',
        'error' => 'hay algo que no funciona. Mira el detalle.',
    ];
    redirigirCon(
        $volver,
        ($entrantes !== [] ? 'Guardado. ' : '') . Verificador::SERVICIOS[$servicio] . ': ' . $textos[$r['estado']],
        $r['estado'] === 'error' ? 'error' : ($r['estado'] === 'aviso' ? 'info' : 'ok')
    );
}

redirigirCon($volver, 'Ajustes guardados.', 'ok');
