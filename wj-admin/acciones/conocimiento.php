<?php
/**
 * ORBIS — Acciones de la pestaña de conocimiento.
 *
 * Lo incluye index.php con la sesión y el testigo ya comprobados. Cada acción
 * termina redirigiendo a la ficha del cuerpo, con el aviso en la sesión.
 *
 * Un borrador redactado con IA NO se guarda: se deja en la sesión y aparece en
 * el formulario de «nueva» para revisarlo. Solo el botón de guardar de ese
 * formulario lo publica.
 */

declare(strict_types=1);

if (!defined('ORBIS_PANEL')) {
    http_response_code(403);
    exit;
}

require_once __DIR__ . '/../../wj-includes/lib/Redactor.php';

$cuerpo = (string) ($_POST['cuerpo'] ?? '');
if (preg_match('/^[a-z0-9-]{1,40}$/', $cuerpo) !== 1 || Catalogo::cuerpo($cuerpo) === null) {
    redirigirCon(urlPanel(['pestana' => 'conocimiento']), 'Ese cuerpo no existe.', 'error');
}
$entrada = (string) ($_POST['entrada'] ?? '');
if ($entrada !== '' && preg_match('/^[a-z0-9-]{1,40}$/', $entrada) !== 1) {
    $entrada = '';
}
$volver = function (string $ancla = '') use ($cuerpo): string {
    return urlPanel(['pestana' => 'conocimiento', 'cuerpo' => $cuerpo], $ancla);
};
$campos = [
    'tipo'   => (string) ($_POST['tipo'] ?? 'dato'),
    'tema'   => (string) ($_POST['tema'] ?? 'curiosidad'),
    'texto'  => (string) ($_POST['texto'] ?? ''),
    'fuente' => (string) ($_POST['fuente'] ?? ''),
    'url'    => (string) ($_POST['url'] ?? ''),
];

switch ($accion) {
    case 'con-guardar':
        $formulario = $entrada !== '' ? $entrada : 'nueva-' . ($campos['tipo'] === 'narracion' ? 'narracion' : 'dato');
        [$ok, $errores, $id] = Conocimiento::guardar($cuerpo, $entrada !== '' ? $entrada : null, $campos);
        if (!$ok) {
            redirigirCon(
                $volver($formulario),
                isset($errores['_']) ? (string) $errores['_'] : 'Revisa el formulario: no se ha guardado.',
                'error',
                ['errores' => [$formulario => $errores], 'enviados' => [$formulario => $campos]]
            );
        }
        if ($entrada === '') {
            // Publicado lo que venía de un borrador: el borrador ya no hace falta.
            unset($_SESSION['borradores'][$cuerpo][$campos['tipo']]);
        }
        redirigirCon($volver($id), $entrada === '' ? 'Añadido y publicado.' : 'Cambios guardados.', 'ok');
        break;

    case 'con-varios':
        // Un dato por línea, todos con la misma fuente. Es lo que devuelve la
        // extracción desde un texto, y también sirve para pegar a mano.
        $lineas = array_values(array_filter(array_map('trim', preg_split('/\R/u', $campos['texto']) ?: [])));
        $bien = 0;
        $mal = [];
        $motivo = '';
        foreach ($lineas as $linea) {
            [$ok, $errores] = Conocimiento::guardar($cuerpo, null, ['texto' => $linea, 'tipo' => 'dato'] + $campos);
            if ($ok) {
                $bien++;
            } else {
                $mal[] = $linea;
                $motivo = $motivo !== '' ? $motivo : (string) reset($errores);
            }
        }
        if ($bien > 0) {
            unset($_SESSION['borradores'][$cuerpo]['varios']);
        }
        if ($mal !== []) {
            redirigirCon(
                $volver('varios'),
                sprintf('%d dato(s) añadidos. %d no se guardaron: %s. Siguen en el formulario.', $bien, count($mal), $motivo),
                'error',
                ['errores' => ['varios' => ['texto' => $motivo]], 'enviados' => ['varios' => ['texto' => implode("\n", $mal)] + $campos]]
            );
        }
        redirigirCon($volver('datos'), $bien === 0 ? 'No había ningún dato que añadir.' : $bien . ' dato(s) añadidos y publicados.', $bien === 0 ? 'error' : 'ok');
        break;

    case 'con-retirar':
    case 'con-publicar':
        $ok = Conocimiento::activar($cuerpo, $entrada, $accion === 'con-publicar');
        redirigirCon(
            $volver($entrada),
            $ok ? ($accion === 'con-publicar' ? 'Vuelve a publicarse.' : 'Retirada: ya no se oye ni se enseña.') : 'No se ha podido cambiar.',
            $ok ? 'ok' : 'error'
        );
        break;

    case 'con-borrar':
        // Solo se borra lo que ya está retirado: así borrar son dos pasos y un
        // clic de más no se lleva por delante un texto sin marcha atrás. Las del
        // catálogo no se borran nunca —están en git—: se restauran.
        $actual = Conocimiento::entrada($cuerpo, $entrada);
        if ($actual === null) {
            redirigirCon($volver(), 'Esa entrada no existe.', 'error');
        }
        if ($actual['origen'] === 'panel' && $actual['activa']) {
            redirigirCon($volver($entrada), 'Retírala primero; una entrada publicada no se borra de un clic.', 'error');
        }
        $ok = Conocimiento::borrar($cuerpo, $entrada);
        redirigirCon(
            $volver($actual['origen'] === 'catalogo' ? $entrada : ''),
            $ok ? ($actual['origen'] === 'catalogo' ? 'Restaurada tal como viene en el catálogo.' : 'Borrada.') : 'No se ha podido.',
            $ok ? 'ok' : 'error'
        );
        break;

    case 'con-proponer-narracion':
        $r = Redactor::proponerNarracion($cuerpo);
        if (!$r['ok']) {
            redirigirCon($volver('nueva-narracion'), 'No hay borrador: ' . $r['error'] . '.', 'error');
        }
        $_SESSION['borradores'][$cuerpo]['narracion'] = $r;
        redirigirCon(
            $volver('nueva-narracion'),
            'Borrador redactado con ' . Redactor::nombreProveedor($r['proveedor']) . '. Está en el formulario: revísalo antes de publicarlo.',
            $r['avisos'] === [] ? 'ok' : 'info'
        );
        break;

    case 'con-proponer-datos':
        if (trim($campos['fuente']) === '') {
            redirigirCon($volver('extraer'), 'Di de dónde sale el texto (la fuente): los datos la heredan.', 'error');
        }
        $r = Redactor::proponerDatos($cuerpo, (string) ($_POST['texto_fuente'] ?? ''), $campos['fuente']);
        if (!$r['ok']) {
            redirigirCon($volver('extraer'), 'No hay propuesta: ' . $r['error'] . '.', 'error');
        }
        $r['url'] = $campos['url'];
        $r['tema'] = $campos['tema'];
        $_SESSION['borradores'][$cuerpo]['varios'] = $r;
        redirigirCon($volver('varios'), 'Datos propuestos: están en «Añadir varios». Revísalos antes de publicarlos.', $r['avisos'] === [] ? 'ok' : 'info');
        break;

    case 'con-descartar':
        $que = (string) ($_POST['que'] ?? '');
        unset($_SESSION['borradores'][$cuerpo][$que]);
        redirigirCon($volver(), 'Borrador descartado.', 'info');
        break;

    default:
        redirigirCon($volver(), 'Acción desconocida.', 'error');
}
