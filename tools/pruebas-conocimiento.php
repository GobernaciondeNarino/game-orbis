<?php
/**
 * ORBIS — Pruebas de la fuente de conocimiento, del redactor con IA, de Gemini
 * y de Google Analytics. Sin red: todo lo que llamaría a un servicio externo se
 * prueba en sus funciones puras.
 *
 * QUÉ SE VIGILA
 * ─────────────
 *   · Regla 4 aplicada a lo que escribe una persona: nada se guarda sin fuente.
 *   · Que la huella no abra un proxy: solo encuentra textos PUBLICADOS de ESE
 *     cuerpo.
 *   · Que el filtro de cifras del redactor lea bien las cifras en español.
 *   · Que Gemini no se use en NADA de lo que tocan los visitantes: sus términos
 *     lo prohíben en un sitio para menores (ver lib/Gemini.php).
 *   · Que Analytics solo acepte su lista cerrada y no cargue nada de Google.
 *
 *   php tools/pruebas-conocimiento.php
 */

declare(strict_types=1);

require_once __DIR__ . '/../wj-includes/lib/Conocimiento.php';
require_once __DIR__ . '/../wj-includes/lib/Redactor.php';
require_once __DIR__ . '/../wj-includes/lib/Gemini.php';
require_once __DIR__ . '/../wj-includes/lib/Analitica.php';

$fallos = 0;
function comprobar(string $nombre, $real, $esperado): void
{
    global $fallos;
    $ok = $real === $esperado;
    if (!$ok) {
        $fallos++;
    }
    printf("  %s %s%s\n", $ok ? '✔' : '✘', $nombre,
        $ok ? '' : sprintf(' — esperado %s, obtenido %s', var_export($esperado, true), var_export($real, true)));
}

$raiz = dirname(__DIR__);

// Se trabaja sobre un cuerpo real sin tocar lo que el servidor tenga guardado:
// se aparta su archivo y se devuelve al final.
$prueba = 'europa';
$ruta = Conocimiento::ruta($prueba);
$respaldo = is_file($ruta) ? (string) file_get_contents($ruta) : null;
@unlink($ruta);
Conocimiento::olvidar();

echo "\n▸ La base sale del catálogo, y cada entrada trae fuente\n";
{
    $todas = Conocimiento::entradas($prueba);
    $narr = array_filter($todas, fn($e) => $e['tipo'] === 'narracion');
    comprobar('las tres narraciones del catálogo', count($narr), 3);
    comprobar('todas con fuente', count(array_filter($todas, fn($e) => trim($e['fuente']) === '')), 0);
    comprobar('todas de origen catálogo', count(array_filter($todas, fn($e) => $e['origen'] !== 'catalogo')), 0);
    comprobar('un cuerpo inventado no tiene nada', Conocimiento::entradas('planeta-x'), []);
}

echo "\n▸ Nada se guarda sin fuente, ni con etiquetas\n";
{
    $base = ['tipo' => 'dato', 'tema' => 'superficie', 'texto' => 'Bajo su corteza de hielo hay un océano de agua salada.', 'fuente' => 'NASA Science — Europa'];
    [, $e] = Conocimiento::validar(['fuente' => ''] + $base);
    comprobar('sin fuente, error en fuente', isset($e['fuente']), true);
    [, $e] = Conocimiento::validar(['fuente' => '   '] + $base);
    comprobar('con fuente en blanco, también', isset($e['fuente']), true);
    [, $e] = Conocimiento::validar(['texto' => 'Europa <script>alert(1)</script> tiene hielo.'] + $base);
    comprobar('con etiquetas, se rechaza (no se limpia)', isset($e['texto']), true);
    [, $e] = Conocimiento::validar(['texto' => 'Corto.'] + $base);
    comprobar('demasiado corto, se rechaza', isset($e['texto']), true);
    [, $e] = Conocimiento::validar(['url' => 'javascript:alert(1)'] + $base);
    comprobar('un enlace que no es http(s), se rechaza', isset($e['url']), true);
    [$l, $e] = Conocimiento::validar(['tema' => 'inventado'] + $base);
    comprobar('un tema desconocido cae en curiosidad', $l['tema'], 'curiosidad');
    comprobar('y lo demás pasa', $e, []);
}

echo "\n▸ Añadir, corregir, retirar y restaurar\n";
{
    [$ok, , $nuevo] = Conocimiento::guardar($prueba, null, [
        'tipo' => 'dato', 'tema' => 'superficie',
        'texto' => 'Bajo su corteza de hielo hay un océano de agua salada.', 'fuente' => 'NASA Science — Europa',
    ]);
    comprobar('se añade un dato del panel', $ok, true);
    comprobar('con identificador propio', strpos($nuevo, 'p-') === 0, true);

    [$ok] = Conocimiento::guardar($prueba, 'curiosidad-0', [
        'tipo' => 'dato', 'texto' => 'Una curiosidad del catálogo corregida desde el panel.', 'fuente' => 'Corrección de prueba',
    ]);
    $corregida = Conocimiento::entrada($prueba, 'curiosidad-0');
    comprobar('se corrige una del catálogo', $ok && $corregida['editada'] && strpos($corregida['texto'], 'corregida') !== false, true);
    comprobar('sin tocar el catálogo', strpos((string) file_get_contents($raiz . '/wj-content/data/sistema-solar.json'), 'corregida desde el panel') === false, true);

    Conocimiento::activar($prueba, 'narracion-1', false);
    comprobar('retirar quita la narración de la rotación', count(Conocimiento::narraciones($prueba)), 2);

    Conocimiento::borrar($prueba, 'curiosidad-0');
    comprobar('restaurar devuelve el original', Conocimiento::entrada($prueba, 'curiosidad-0')['editada'], false);
}

echo "\n▸ La huella no abre un proxy\n";
{
    $pub = Conocimiento::publico($prueba);
    $h = $pub['narraciones'][0]['huella'];
    comprobar('encuentra lo publicado de ESE cuerpo', Conocimiento::porHuella($prueba, $h, 'narracion'), $pub['narraciones'][0]['texto']);
    comprobar('no en otro cuerpo', Conocimiento::porHuella('marte', $h, 'narracion'), null);
    comprobar('no como otro tipo', Conocimiento::porHuella($prueba, $h, 'dato'), null);
    comprobar('no una inventada', Conocimiento::porHuella($prueba, '0123456789abcdef', 'narracion'), null);
    comprobar('no una con otro formato', Conocimiento::porHuella($prueba, '../../etc/passwd', 'narracion'), null);

    $retirada = Conocimiento::entrada($prueba, 'narracion-1');
    comprobar('no una retirada', Conocimiento::porHuella($prueba, Conocimiento::huella($retirada['texto']), 'narracion'), null);

    $json = json_encode($pub, JSON_UNESCAPED_UNICODE);
    comprobar('lo público no lleva la capa interna', strpos($json, 'editada') === false && strpos($json, 'creada') === false, true);

    $tts = (string) file_get_contents($raiz . '/wj-includes/api/tts.php');
    comprobar('tts.php resuelve por huella con Conocimiento', substr_count($tts, 'Conocimiento::porHuella('), 2);
}

echo "\n▸ La ruta del almacén no se puede torcer\n";
{
    $lanzo = false;
    try {
        Conocimiento::ruta('../../wj-config');
    } catch (InvalidArgumentException $e) {
        $lanzo = true;
    }
    comprobar('un id con ../ se rechaza', $lanzo, true);
    comprobar('el almacén está denegado por Apache',
        strpos((string) @file_get_contents($raiz . '/wj-content/conocimiento/.htaccess'), 'Require all denied') !== false, true);
    comprobar('y fuera de git', strpos((string) file_get_contents($raiz . '/.gitignore'), 'wj-content/conocimiento/*') !== false, true);
}

echo "\n▸ El filtro de cifras lee español\n";
{
    comprobar('«1.391.400» son millares', Redactor::numerosDe('1.391.400'), [1391400.0]);
    comprobar('«25,38» es decimal', Redactor::numerosDe('25,38'), [25.38]);
    comprobar('«3389.92» a la inglesa, decimal', Redactor::numerosDe('3389.92'), [3389.92]);
    comprobar('un redondeo honrado pasa', Redactor::cifrasSinRespaldo('unos 3.390 km', [3389.92]), []);
    comprobar('una cifra inventada se señala', Redactor::cifrasSinRespaldo('mide 4.100 km', [3389.92]), ['4.100']);
    comprobar('los recuentos pequeños no', Redactor::cifrasSinRespaldo('tiene 2 lunas', []), []);
    comprobar('pero un decimal pequeño sí', Redactor::cifrasSinRespaldo('gravedad de 3,9', [3.71]), ['3,9']);
}

echo "\n▸ Gemini: lectura de respuestas y de errores, sin red\n";
{
    [$t] = Gemini::extraerTexto(['candidates' => [['content' => ['parts' => [
        ['text' => 'pensando…', 'thought' => true], ['text' => 'Hola'], ['text' => ' mundo'],
    ]], 'finishReason' => 'STOP']]]);
    comprobar('se salta el pensamiento y junta el texto', $t, 'Hola mundo');
    [$t, $fin] = Gemini::extraerTexto(['promptFeedback' => ['blockReason' => 'SAFETY']]);
    comprobar('un bloqueo devuelve vacío y el motivo', [$t, $fin], ['', 'SAFETY']);

    $clave = json_encode(['error' => ['code' => 400, 'status' => 'INVALID_ARGUMENT', 'message' => 'API key not valid.',
        'details' => [['reason' => 'API_KEY_INVALID']]]]);
    comprobar('API_KEY_INVALID es clave inválida', Gemini::motivoError($clave)['clase'], 'clave_invalida');
    comprobar('NOT_FOUND es modelo desconocido',
        Gemini::motivoError(json_encode(['error' => ['status' => 'NOT_FOUND', 'message' => 'models/x is not found']]))['clase'], 'modelo_desconocido');
    comprobar('el motivo nunca trae la clave', strpos(Gemini::motivoError($clave)['texto'], 'x-goog') === false, true);

    putenv('GEMINI_API_KEY=clavedepruebadegemini0000');
    comprobar('con clave pero sin casilla, NO está disponible', Gemini::disponible(), false);
    putenv('GEMINI_USO_EDITORIAL=1');
    comprobar('con clave y casilla, sí', Gemini::disponible(), true);
    putenv('GEMINI_API_KEY');
    putenv('GEMINI_USO_EDITORIAL');
}

echo "\n▸ Gemini no toca NADA de lo que usan los visitantes\n";
{
    // Sus términos prohíben usarlo en un sitio al que probablemente accedan
    // menores de 18. Si un día aparece en un endpoint público o en el código
    // del navegador, esta prueba falla antes de que llegue a producción.
    $publicos = array_merge(glob($raiz . '/wj-includes/api/*.php') ?: [], [$raiz . '/wj-includes/lib/Conversacion.php']);
    $conGemini = [];
    foreach ($publicos as $a) {
        if (stripos((string) file_get_contents($a), 'Gemini') !== false) {
            $conGemini[] = basename($a);
        }
    }
    comprobar('ningún endpoint público ni la conversación', $conGemini, []);

    $js = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raiz . '/wj-includes/js'));
    $enJs = [];
    foreach ($js as $f) {
        if (substr($f->getPathname(), -3) === '.js' && stripos((string) file_get_contents($f->getPathname()), 'generativelanguage') !== false) {
            $enJs[] = $f->getFilename();
        }
    }
    comprobar('ni el código del navegador', $enJs, []);
}

echo "\n▸ Analytics: lista cerrada, y nada de Google en la página\n";
{
    $c = '123456789.' . time();
    $s = (string) time();
    [$ok] = Analitica::validar(['nombre' => 'ver_cuerpo', 'cliente' => $c, 'sesion' => $s, 'params' => ['cuerpo' => 'marte']]);
    comprobar('un evento conocido pasa', $ok['evento']['params']['cuerpo'] ?? null, 'marte');
    [$ok] = Analitica::validar(['nombre' => 'comprar', 'cliente' => $c, 'sesion' => $s]);
    comprobar('uno inventado no', $ok, null);
    [$ok] = Analitica::validar(['nombre' => 'ver_cuerpo', 'cliente' => $c, 'sesion' => $s, 'params' => ['cuerpo' => 'planeta-x']]);
    comprobar('un cuerpo que no existe no', $ok, null);
    [$ok] = Analitica::validar(['nombre' => 'cambiar_escala', 'cliente' => $c, 'sesion' => $s, 'params' => ['modo' => 'gigante']]);
    comprobar('un valor fuera de su lista no', $ok, null);
    [$ok] = Analitica::validar(['nombre' => 'page_view', 'cliente' => 'mi-correo@x.com', 'sesion' => $s]);
    comprobar('un identificador con otra forma no', $ok, null);
    [$ok] = Analitica::validar(['nombre' => 'usar_gestos', 'cliente' => $c, 'sesion' => $s, 'params' => ['correo' => 'a@b.c']]);
    comprobar('los parámetros que no están en la lista se tiran', isset($ok['evento']['params']['correo']), false);

    putenv('GA_ID_MEDICION=G-PRUEBA123');
    comprobar('con solo el ID, no está activa', Analitica::activa(), false);
    putenv('GA_SECRETO_API=secretodeprueba123');
    comprobar('con ID y secreto, sí', Analitica::activa(), true);
    putenv('GA_ID_MEDICION');
    putenv('GA_SECRETO_API');

    $pagina = (string) file_get_contents($raiz . '/index.html');
    $js = (string) file_get_contents($raiz . '/wj-includes/js/utils/analitica.js');
    comprobar('index.html no carga gtag.js', stripos($pagina, 'googletagmanager') === false && stripos($pagina, 'gtag(') === false, true);
    comprobar('el módulo del navegador solo habla con ORBIS', stripos($js, 'google-analytics.com') === false && strpos($js, "rutaApi('evento.php')") !== false, true);
    comprobar('y respeta Global Privacy Control', strpos($js, 'globalPrivacyControl') !== false, true);
    comprobar('sin localStorage ni cookies', preg_match('/localStorage|sessionStorage|document\.cookie/', $js), 0);
}

// Se devuelve el archivo del servidor tal y como estaba.
@unlink($ruta);
if ($respaldo !== null) {
    file_put_contents($ruta, $respaldo);
}

echo $fallos ? "\n✘ $fallos comprobación(es) fallida(s)\n\n" : "\n✔ Todas las comprobaciones pasan\n\n";
exit($fallos ? 1 : 0);
