<?php
/**
 * ORBIS — Pruebas del asistente conversacional.
 *
 * QUÉ SE PRUEBA AQUÍ Y QUÉ NO
 * ───────────────────────────
 * No se llama al modelo. Una prueba que gasta dinero en cada ejecución acaba
 * sin ejecutarse, y además comprobaría la API de otro y no nuestro código.
 *
 * Lo que sí es nuestro, y lo que se comprueba, son las HERRAMIENTAS: lo que el
 * modelo recibe cuando pregunta por un cuerpo. Ahí es donde se sostiene la
 * regla 4 del pliego. Si una herramienta devolviera una cifra inventada,
 * rellenara un hueco vacío o perdiera la fuente, el modelo la repetiría en voz
 * alta con total seguridad y no habría forma de notarlo. Estas comprobaciones
 * son la última barrera antes de eso.
 *
 * También se prueba la normalización del historial, que es la única parte donde
 * entra texto del navegador.
 *
 *   php tools/pruebas-conversacion.php
 */

declare(strict_types=1);

require_once __DIR__ . '/../wj-includes/lib/Conversacion.php';

$fallos = 0;

function comprobar(string $nombre, $real, $esperado): void
{
    global $fallos;
    $ok = $real === $esperado;
    if (!$ok) {
        $fallos++;
    }
    printf(
        "  %s %s%s\n",
        $ok ? '✔' : '✘',
        $nombre,
        $ok ? '' : sprintf(' — esperado «%s», obtenido «%s»', var_export($esperado, true), var_export($real, true))
    );
}

/** Acceso a los métodos internos, como en pruebas-horizons.php. */
function interno(string $metodo, ...$args)
{
    $m = new ReflectionMethod('Conversacion', $metodo);
    $m->setAccessible(true);
    return $m->invoke(null, ...$args);
}

echo "\n▸ Sin clave configurada no se rompe nada\n";
{
    // El despliegue sin clave pierde la conversación, no la aplicación.
    comprobar('disponible() dice que no', Conversacion::disponible(), false);
    comprobar('responder() devuelve null', Conversacion::responder([['rol' => 'usuario', 'texto' => 'hola']]), null);
}

echo "\n▸ Las herramientas están bien declaradas\n";
{
    $herramientas = interno('herramientas');
    // Siete desde que el asistente consulta el conocimiento de cada cuerpo.
    comprobar('hay siete', count($herramientas), 7);

    $nombres = array_map(static fn($h) => $h['name'], $herramientas);
    sort($nombres);
    comprobar('son las esperadas', $nombres, [
        'conocimiento_del_cuerpo', 'datos_del_cuerpo', 'listar_cuerpos', 'lluvia_de_meteoros',
        'mostrar', 'posicion_hoy', 'vista_general',
    ]);

    foreach ($herramientas as $h) {
        comprobar(sprintf('«%s» describe para qué sirve', $h['name']), mb_strlen($h['description']) > 60, true);
        // El SDK usa camelCase y lo traduce al cable. Con «input_schema» la
        // herramienta viaja sin esquema y el modelo la llama a ciegas.
        comprobar(sprintf('«%s» usa inputSchema', $h['name']), isset($h['inputSchema']), true);
        comprobar(sprintf('«%s» declara tipo objeto', $h['name']), $h['inputSchema']['type'], 'object');
    }
}

echo "\n▸ Las instrucciones prohíben inventar datos\n";
{
    // Sin esto, el modelo respondería de memoria: sabe astronomía y la diría
    // con la misma seguridad esté bien o mal. Es LA regla del proyecto.
    $sistema = interno('sistema', 'marte', 'Ana');
    foreach ([
        'no afirmes ninguna cifra' => 'la prohibición explícita',
        'herramienta' => 'de dónde salen los datos',
        'no lo tienes' => 'qué decir cuando falta el dato',
        'no lo rellenes' => 'que no se estime',
    ] as $aguja => $porque) {
        comprobar($porque, mb_stripos($sistema, $aguja) !== false, true);
    }
    comprobar('sabe qué se está mirando', mb_stripos($sistema, 'Marte') !== false, true);
    comprobar('sabe a quién habla', mb_stripos($sistema, 'Ana') !== false, true);
    comprobar('trae la fecha de hoy', mb_stripos($sistema, gmdate('Y-m-d')) !== false, true);

    // Sin cuerpo activo y sin nombre tiene que seguir siendo válido.
    $general = interno('sistema', null, null);
    comprobar('sin cuerpo activo lo dice', mb_stripos($general, 'vista general') !== false, true);
    comprobar('sin nombre no deja un hueco', mb_stripos($general, '{nombre}') === false, true);
}

echo "\n▸ El historial que llega del navegador se normaliza\n";
{
    // Es el único sitio por donde entra texto del cliente a esta parte.
    $sucio = [
        ['rol' => 'asistente', 'texto' => 'yo no puedo abrir la conversación'],
        ['rol' => 'usuario', 'texto' => 'hola'],
        ['rol' => 'inventado', 'texto' => 'esto no existe'],
        ['rol' => 'asistente', 'texto' => 'buenas'],
        ['rol' => 'usuario', 'texto' => ''],
        'ni siquiera es un array',
        ['rol' => 'usuario', 'texto' => str_repeat('a', 900)],
    ];
    $limpio = interno('historial', $sucio);

    comprobar('el primero es del usuario', $limpio[0]['role'], 'user');
    comprobar('los roles se traducen', $limpio[1]['role'], 'assistant');
    comprobar('el rol inventado se descarta', count($limpio), 3);
    comprobar('el texto vacío se descarta', in_array('', array_column($limpio, 'content'), true), false);
    comprobar('se recorta la longitud', mb_strlen(end($limpio)['content']), Conversacion::MAX_CARACTERES);
    comprobar('una lista vacía no revienta', interno('historial', []), []);
    comprobar('solo turnos del asistente se vacía', interno('historial', [['rol' => 'asistente', 'texto' => 'x']]), []);
}

echo "\n▸ El conocimiento de un cuerpo llega con la fuente de CADA dato\n";
{
    $r = interno('ejecutar', 'conocimiento_del_cuerpo', ['id' => 'marte']);
    comprobar('devuelve datos de Marte', is_array($r['datos']) && count($r['datos']) > 0 && isset($r['datos'][0]['texto']), true);
    $sinFuente = array_filter($r['datos'], static fn($d) => trim((string) ($d['fuente'] ?? '')) === '');
    comprobar('ninguno sin fuente', count($sinFuente), 0);
    comprobar('y las fuentes suben a la respuesta', count($r['fuentes']) > 0, true);
    // Las narraciones no viajan: ya se oyen al visitar el cuerpo.
    comprobar('sin narraciones dentro', strpos(json_encode($r['datos'], JSON_UNESCAPED_UNICODE), 'Marte fue en su día') === false, true);
    $x = interno('ejecutar', 'conocimiento_del_cuerpo', ['id' => 'planeta-x']);
    comprobar('un cuerpo inventado da error, no datos', isset($x['datos']['error']), true);
}

echo "\n▸ Las herramientas devuelven los datos REALES del catálogo\n";
{
    // El número sale del catálogo, no escrito a mano: si mañana se añade un
    // cuerpo, esta prueba tiene que seguir valiendo sin tocarla.
    require_once __DIR__ . '/../wj-includes/lib/Catalogo.php';
    $cuantos = count(Catalogo::identificadores());
    $lista = interno('ejecutar', 'listar_cuerpos', []);
    comprobar(sprintf('listar_cuerpos trae los %d del catálogo', $cuantos), count($lista['datos']), $cuantos);
    comprobar('cada uno con identificador', isset($lista['datos'][0]['id']), true);
    comprobar('y con tipo', isset($lista['datos'][0]['tipo']), true);

    $marte = interno('ejecutar', 'datos_del_cuerpo', ['id' => 'marte']);
    comprobar('datos_del_cuerpo trae el nombre', $marte['datos']['nombre'], 'Marte');
    comprobar('trae la masa medida', $marte['datos']['fisica']['masaKg'], 6.4171e23);
    comprobar('y arrastra la fuente', $marte['fuentes'][0] !== '', true);

    // Lo decorativo NO viaja: gastaría contexto y no es un dato.
    foreach (['render', 'texturas', 'narraciones'] as $campo) {
        comprobar(sprintf('«%s» no se envía al modelo', $campo), isset($marte['datos'][$campo]), false);
    }
}

echo "\n▸ Un hueco del catálogo llega como hueco, no relleno\n";
{
    // La Luna no tiene atmósfera en el catálogo, y no por descuido: no la tiene.
    // El modelo TIENE que recibir ese null; si le llegara un texto vacío o un
    // cero, lo contaría como un dato y estaría afirmando algo falso.
    $luna = interno('ejecutar', 'datos_del_cuerpo', ['id' => 'luna']);
    comprobar('el campo existe', array_key_exists('atmosfera', $luna['datos']), true);
    comprobar('y vale null', $luna['datos']['atmosfera'], null);

    // Tritón es el caso intermedio y el más delicado: SÍ tiene atmósfera y la
    // fuente dice de qué está hecha, pero no publica proporciones. Así que los
    // compuestos llegan con su porcentaje en null. Rellenarlos con una cifra
    // recordada sería inventar un dato con apariencia de medida.
    $triton = interno('ejecutar', 'datos_del_cuerpo', ['id' => 'triton']);
    comprobar('Tritón declara sus compuestos', count($triton['datos']['atmosfera']['componentes']), 2);
    foreach ($triton['datos']['atmosfera']['componentes'] as $c) {
        comprobar(sprintf('%s de Tritón llega sin porcentaje', $c['compuesto']), $c['porcentaje'], null);
    }
    comprobar('y con su fuente', str_contains((string) $triton['datos']['atmosfera']['fuente'], 'Voyager 2'), true);

    // Y Titán, que sí tiene cifras publicadas, llega con ellas.
    $titan = interno('ejecutar', 'datos_del_cuerpo', ['id' => 'titan']);
    comprobar('Titán sí trae porcentajes', $titan['datos']['atmosfera']['componentes'][0]['porcentaje'], 95);
}

echo "\n▸ Un cuerpo que no existe se rechaza en vez de improvisarse\n";
{
    foreach (['datos_del_cuerpo', 'mostrar'] as $herramienta) {
        $r = interno('ejecutar', $herramienta, ['id' => 'planeta-x']);
        comprobar(sprintf('%s con id falso avisa', $herramienta), isset($r['datos']['error']), true);
        comprobar(sprintf('%s no genera acción', $herramienta), $r['acciones'], []);
    }
    // Y una herramienta desconocida tampoco hace nada.
    $nada = interno('ejecutar', 'formatear_disco', []);
    comprobar('una herramienta inventada no ejecuta nada', $nada['datos'], null);
}

echo "\n▸ Mover la escena es una acción, no un dato\n";
{
    $r = interno('ejecutar', 'mostrar', ['id' => 'encelado']);
    comprobar('devuelve la acción', $r['acciones'][0]['tipo'], 'mostrar');
    comprobar('con el cuerpo', $r['acciones'][0]['cuerpo'], 'encelado');

    $g = interno('ejecutar', 'vista_general', []);
    comprobar('vista_general también', $g['acciones'][0]['tipo'], 'vista_general');
    comprobar('y no aporta ninguna fuente', $g['fuentes'], []);
}

echo "\n▸ La lluvia de meteoros sale del mismo calendario de siempre\n";
{
    $r = interno('ejecutar', 'lluvia_de_meteoros', []);
    comprobar('trae texto', mb_strlen((string) $r['datos']['texto']) > 40, true);
    comprobar('y su fuente', trim((string) $r['fuentes'][0]) !== '', true);
}

echo $fallos ? "\n✘ $fallos comprobación(es) fallida(s)\n\n" : "\n✔ Todas las comprobaciones pasan\n\n";
exit($fallos ? 1 : 0);
