<?php
/**
 * ORBIS — Pruebas del panel de administración.
 *
 * POR QUÉ IMPORTA
 * ───────────────
 * wj-admin es una URL pública con un formulario que escribe la configuración
 * del servidor y guarda claves de API. Es, con diferencia, la superficie más
 * delicada del proyecto: todo lo demás solo lee.
 *
 * Lo que se prueba aquí es lo que no se ve al usarlo y sí se nota cuando falla:
 *
 *   · Que solo entra en la configuración lo que está en la lista cerrada. Un
 *     campo inventado en el envío no puede acabar en el servidor.
 *   · Que un valor fijado en Plesk o en wj-config.php NO se puede pisar desde
 *     el panel, aunque llegue en el formulario.
 *   · Que la clave del panel no se puede cambiar desde el panel.
 *   · Que un acierto no gasta cupo de intentos, y un fallo sí.
 *   · Que el archivo de ajustes no se queda a medias si algo falla al escribir.
 *   · Que copiar la plantilla NO bloquea ningún campo del panel.
 *
 *   php tools/pruebas-admin.php
 */

declare(strict_types=1);

require_once __DIR__ . '/../wj-includes/lib/Ajustes.php';
require_once __DIR__ . '/../wj-includes/lib/SesionAdmin.php';

// La sesión se arranca ANTES de imprimir nada. PHP no puede mandar la cookie de
// sesión con la salida ya empezada, y sin esto las pruebas de entrada quedaban
// sepultadas bajo ochenta líneas de warnings que no son el fallo de nada: un
// resultado ilegible se acaba mirando por encima, que es justo lo que no puede
// pasar con las pruebas del panel.
SesionAdmin::iniciar();

$fallos = 0;

/**
 * Todo el código del panel en una cadena: el marco, las pestañas y las
 * acciones. Desde que el panel se partió en pestañas, lo que antes estaba en
 * index.php vive repartido, y una prueba que mirase un solo archivo daría por
 * perdido lo que solo se ha mudado.
 */
function fuentesDelPanel(): string
{
    $raiz = dirname(__DIR__) . '/wj-admin/';
    $archivos = array_merge([$raiz . 'index.php'], glob($raiz . 'pestanas/*.php') ?: [], glob($raiz . 'acciones/*.php') ?: []);
    $todo = '';
    foreach ($archivos as $a) {
        $todo .= (string) file_get_contents($a) . "\n";
    }
    return $todo;
}

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
        $ok ? '' : sprintf(' — esperado %s, obtenido %s', var_export($esperado, true), var_export($real, true))
    );
}

// El archivo real del servidor no se toca: se trabaja sobre una copia y se
// devuelve al final.
$ruta = Ajustes::ruta();
$respaldo = is_file($ruta) ? (string) file_get_contents($ruta) : null;
@unlink($ruta);

echo "\n▸ Solo entra lo que está en la lista cerrada\n";
{
    [$ok, $err] = Ajustes::guardar([
        'ORBIS_MODELO'    => 'claude-sonnet-5',
        'CAMPO_INVENTADO' => 'algo',
        'ARCHIVO_CONFIG'  => '/etc/passwd',
    ]);
    comprobar('guarda lo válido', $ok, true);
    comprobar('y solo eso', array_keys(Ajustes::todos()), ['ORBIS_MODELO']);
}

echo "\n▸ Cada tipo se valida por separado\n";
{
    foreach ([
        ['LIMITE_CONVERSACION_HORA', '60',        true,  'un entero en rango'],
        ['LIMITE_CONVERSACION_HORA', '99999999',  false, 'un entero fuera de rango'],
        ['LIMITE_CONVERSACION_HORA', '-4',        false, 'un negativo'],
        ['LIMITE_CONVERSACION_HORA', 'muchas',    false, 'texto donde va un número'],
        ['ELEVENLABS_VOICE_ID',      'aB9xY',     true,  'un código de voz'],
        ['ELEVENLABS_VOICE_ID',      '../../x',   false, 'un código con barras'],
        ['ELEVENLABS_API_KEY',       str_repeat('k', 40), true,  'una clave con forma de clave'],
        ['ELEVENLABS_API_KEY',       'sk con espacio',    false, 'una clave con un espacio pegado'],
        ['ELEVENLABS_API_KEY',       'corta',             false, 'una clave demasiado corta'],
    ] as [$clave, $valor, $esperado, $que]) {
        [$vale] = Ajustes::validar($clave, $valor);
        comprobar($que, $vale, $esperado);
    }
}

echo "\n▸ El panel manda sobre el entorno y sobre wj-config.php\n";
{
    // ERA AL REVÉS, Y ESA ERA LA REGLA QUE HACÍA INSERVIBLE EL PANEL.
    // El razonamiento de entonces —quien tiene acceso al servidor fija algo y
    // ningún panel web se lo cambia— suena bien hasta que se recuerda que quien
    // rellenó wj-config.php es la MISMA persona que abre el panel. Rellenar ese
    // archivo es el paso 1 de la instalación, así que seguir las instrucciones
    // bastaba para dejar medio formulario en gris.
    putenv('ORBIS_MODELO=claude-opus-5');
    comprobar('el panel gana al entorno', Config::origen('ORBIS_MODELO'), 'panel');
    comprobar('y lo que se usa es lo del panel', Config::obtener('ORBIS_MODELO'), 'claude-sonnet-5');

    // Pero lo de debajo no desaparece: se sigue viendo, que es lo que impide
    // el «lo cambio en Plesk y no pasa nada» por el otro lado.
    comprobar('lo de debajo se sigue viendo', Config::origenes('ORBIS_MODELO'), ['panel', 'entorno']);

    // Y al borrarlo del panel, vuelve a mandar lo de debajo.
    Ajustes::guardar(['ORBIS_MODELO' => '']);
    comprobar('al borrarlo aquí, vuelve el entorno', Config::obtener('ORBIS_MODELO'), 'claude-opus-5');
    putenv('ORBIS_MODELO');

    comprobar('y sin nada, no hay origen', Config::origen('ORBIS_MODELO'), null);
    Ajustes::guardar(['ORBIS_MODELO' => 'claude-sonnet-5']);
}

echo "\n▸ La clave del panel no se puede cambiar desde el panel\n";
{
    comprobar('no está entre los campos editables', isset(Ajustes::CAMPOS['WJ_ADMIN_CLAVE']), false);

    [$ok] = Ajustes::guardar(['WJ_ADMIN_CLAVE' => 'me-la-cambio-yo']);
    comprobar('un envío con ella dentro no la guarda', isset(Ajustes::todos()['WJ_ADMIN_CLAVE']), false);
    comprobar('y sigue valiendo la de antes', SesionAdmin::claveConfigurada(), SesionAdmin::CLAVE_POR_OMISION);
}

echo "\n▸ Un acierto no gasta intentos; un fallo, sí\n";
{
    // Con un solo consumir() antes de comprobar, un administrador que entra y
    // sale cinco veces se quedaba fuera de su propio panel.
    $_SERVER['REMOTE_ADDR'] = '198.51.100.' . random_int(100, 200);
    foreach (glob(dirname(__DIR__) . '/wj-content/cache/limites/*-admin.json') ?: [] as $f) {
        @unlink($f);
    }

    // Entrar regenera el identificador de sesión, y eso no se puede hacer con la
    // salida ya empezada —en consola siempre lo está—. Es una limitación de
    // probar código de sesión desde la línea de órdenes, no un fallo: en el
    // navegador la regeneración sí ocurre, y es lo que impide fijar de antemano
    // el identificador con el que alguien va a entrar. Se silencia ese aviso, y
    // solo mientras dura este bloque.
    $avisos = error_reporting();
    error_reporting($avisos & ~E_WARNING);

    for ($i = 0; $i < 20; $i++) {
        [$ok] = SesionAdmin::entrar(SesionAdmin::CLAVE_POR_OMISION);
        if (!$ok) {
            break;
        }
    }
    comprobar('veinte aciertos seguidos siguen entrando', $ok, true);

    $fallidos = 0;
    while ($fallidos < 20) {
        [$entro, $motivo] = SesionAdmin::entrar('no-es-la-clave');
        $fallidos++;
        if (strpos($motivo, 'Demasiados intentos') !== false) {
            break;
        }
    }
    error_reporting($avisos);

    comprobar('los fallos sí acaban bloqueando', $fallidos <= SesionAdmin::INTENTOS_HORA + 1, true);
    printf("     bloqueado tras %d intentos fallidos (tope: %d)\n", $fallidos, SesionAdmin::INTENTOS_HORA);
}

echo "\n▸ Copiar la plantilla no bloquea ningún campo del panel\n";
{
    // ESTE ERA EL FALLO. El paso 1 de la instalación es «cp
    // wj-config-ejemplo.php wj-config.php», y la plantilla traía rellenados
    // ocho valores por omisión: el modelo de síntesis, el de transcripción y
    // los seis topes de gasto. Para Config, un valor no vacío en wj-config.php
    // es una decisión de quien administra el servidor, así que el panel hacía
    // lo correcto —enseñarlos bloqueados— y quien seguía las instrucciones al
    // pie de la letra se encontraba ocho de trece campos que no dejaban
    // escribir, sin haber decidido nada.
    //
    // Un valor por omisión no es una decisión. Va en el comentario.
    $plantilla = require dirname(__DIR__) . '/wj-config-ejemplo.php';
    $rellenadas = [];
    foreach ($plantilla as $clave => $valor) {
        if ($valor !== '') {
            $rellenadas[] = $clave;
        }
    }
    comprobar('la plantilla viaja entera vacía', $rellenadas, []);

    // Y que siga cubriendo todo lo que el panel ofrece: una clave editable que
    // la plantilla no mencione es una que solo se puede poner desde el panel,
    // sin forma de fijarla en el servidor.
    $sinDocumentar = array_values(array_diff(array_keys(Ajustes::CAMPOS), array_keys($plantilla)));
    comprobar('y menciona todos los campos del panel', $sinDocumentar, []);
}

echo "\n▸ Ningún campo se bloquea, y lo que queda debajo se dice\n";
{
    $panel = fuentesDelPanel();

    // Nada de «disabled» ni de descartar campos al guardar por venir de arriba:
    // eso era exactamente lo que impedía administrar desde el panel.
    comprobar(
        'no queda ningún campo deshabilitado por su origen',
        strpos($panel, "in_array(\$origen, ['entorno', 'wj-config.php'], true)") !== false,
        false
    );
    comprobar('ni la clase de bloqueo', strpos($panel, 'campo--bloqueado') !== false, false);

    // Pero que el panel mande no puede ser invisible: si se cambia wj-config.php
    // y no pasa nada, hemos cambiado un silencio por el contrario.
    comprobar('el panel consulta todos los orígenes', strpos($panel, 'Config::origenes(') !== false, true);
    comprobar('avisa de lo que hay escrito y sin usar', strpos($panel, 'sin usar') !== false, true);
    comprobar('y de qué manda mientras el campo esté vacío', strpos($panel, 'Ahora manda el de') !== false, true);
    comprobar('y lo explica entero una vez arriba', strpos($panel, 'tiene un valor escrito también en otro sitio') !== false, true);

    // El botón de borrar tiene que decir a qué se vuelve al borrar: sin eso,
    // «Borrar la clave guardada» parece que deja el sitio sin clave.
    comprobar('borrar dice a dónde se vuelve', strpos($panel, 'y volver a la de') !== false, true);
}

echo "\n▸ El desplegable de voces no miente sobre cuál está sonando\n";
{
    // Decía «La que trae ORBIS» aunque wj-config.php tuviera otra puesta. Con el
    // panel mandando, un desplegable en blanco significa «aquí no he elegido»,
    // no «suena la de por omisión»: son cosas distintas y hay que decir cuál.
    $panel = fuentesDelPanel();
    comprobar('nombra la que suena de verdad', strpos($panel, 'Sin elegir aquí — suena') !== false, true);
    comprobar('y de dónde sale', strpos($panel, "' (de ' . \$debajo[0] . ')'") !== false, true);

    // Y solo la nombra cuando de verdad es la de debajo. Con una elegida en el
    // panel, la efectiva es ESA: nombrarla y atribuirla a wj-config.php sería
    // decir exactamente lo contrario de lo que pasa.
    comprobar(
        'con una elegida aquí, no se la atribuye a wj-config.php',
        strpos($panel, "'Sin elegir aquí — volver a la de ' . \$debajo[0]") !== false,
        true
    );
}

echo "\n▸ El panel avisa ANTES de rellenar si no va a poder guardar\n";
{
    // Guardar solo fallaba DESPUÉS de rellenar el formulario entero, y como los
    // campos de clave salen siempre vacíos, el reintento obligaba a volver a
    // pegar las dos claves. Es el fallo típico de Plesk: el despliegue se hace
    // con un usuario y PHP corre con otro.
    $temporal = sys_get_temp_dir() . '/orbis-pruebas-' . bin2hex(random_bytes(4));

    [$ok, $motivo] = Ajustes::escribibleEn($temporal . '/ajustes/ajustes.json');
    comprobar('sin carpeta, no se puede', $ok, false);
    comprobar('y lo dice con esas palabras', $motivo, 'la carpeta no existe');

    mkdir($temporal . '/ajustes', 0775, true);
    [$ok] = Ajustes::escribibleEn($temporal . '/ajustes/ajustes.json');
    comprobar('con la carpeta escribible, sí', $ok, true);

    // El archivo real del servidor tiene que poder escribirse aquí y ahora, o
    // las pruebas de más arriba no habrían significado nada.
    [$ok] = Ajustes::escribible();
    comprobar('y el almacén de verdad es escribible', $ok, true);

    @rmdir($temporal . '/ajustes');
    @rmdir($temporal);

    comprobar('el aviso está en el panel', strpos($panel, 'no puede guardar nada') !== false, true);
    comprobar('y apaga el botón de guardar', strpos($panel, "\$sePuedeGuardar ? '' : 'disabled'") !== false, true);
}

echo "\n▸ El panel lista lo que falta por configurar\n";
{
    // «Almacenar la información que está faltante» empieza por saber cuál es.
    putenv('ELEVENLABS_API_KEY');
    putenv('ANTHROPIC_API_KEY');
    Ajustes::guardar(['ELEVENLABS_API_KEY' => '', 'ANTHROPIC_API_KEY' => '']);

    $faltan = array_keys(Ajustes::faltan());
    comprobar('la clave de voz aparece como pendiente', in_array('ELEVENLABS_API_KEY', $faltan, true), true);
    comprobar('la del asistente también', in_array('ANTHROPIC_API_KEY', $faltan, true), true);

    // Cada pendiente dice qué se pierde, no solo cómo se llama el campo.
    foreach (Ajustes::faltan() as $clave => $campo) {
        comprobar(sprintf('«%s» explica qué se pierde sin ella', $clave), $campo['sinEsto'] !== '', true);
    }

    // Y lo que YA está resuelto más arriba no puede figurar como pendiente:
    // un aviso que pide algo que ya está puesto deja de leerse.
    // Sin el prefijo de verdad: tools/comprobar-secretos.sh rastrea la FORMA de
    // una clave por el código del servidor, y hace bien en no distinguir entre
    // una inventada para una prueba y una de verdad olvidada.
    putenv('ANTHROPIC_API_KEY=' . str_repeat('k', 40));
    comprobar(
        'lo fijado en el entorno no figura como pendiente',
        isset(Ajustes::faltan()['ANTHROPIC_API_KEY']),
        false
    );
    putenv('ANTHROPIC_API_KEY');
}

echo "\n▸ La sal de los contadores se puede poner desde el panel\n";
{
    // Estaba solo en wj-config.php: quien configurara desde el panel no se
    // enteraba de que existe y se quedaba con la de por omisión, que es la
    // misma en todas las instalaciones —o sea, ninguna—.
    comprobar('es un campo editable', isset(Ajustes::CAMPOS['ORBIS_SAL_LIMITES']), true);
    comprobar('y es secreta: el panel no la devuelve', Ajustes::CAMPOS['ORBIS_SAL_LIMITES']['tipo'], 'clave');

    // Se genera con «head -c 32 /dev/urandom | base64», que produce «+/=».
    [$vale] = Ajustes::validar('ORBIS_SAL_LIMITES', 'Yk9wZjJxN3RSbUx4VjhlQTN6RGg1Sg==');
    comprobar('acepta una sal en base64', $vale, true);
    [$vale] = Ajustes::validar('ORBIS_SAL_LIMITES', 'corta');
    comprobar('y no una demasiado corta', $vale, false);

    // Las claves de API no la heredan: su patrón sigue siendo el estricto.
    [$vale] = Ajustes::validar('ELEVENLABS_API_KEY', 'sk con espacio');
    comprobar('el patrón laxo no se contagia a las claves', $vale, false);
}

echo "\n▸ El almacén está fuera de lo que se sirve\n";
{
    comprobar('vive bajo wj-content/ajustes', strpos(Ajustes::ruta(), '/wj-content/ajustes/') !== false, true);

    $htaccess = (string) @file_get_contents(dirname(Ajustes::ruta()) . '/.htaccess');
    comprobar('con su .htaccess', strpos($htaccess, 'Require all denied') !== false, true);

    $raiz = (string) file_get_contents(dirname(__DIR__) . '/.htaccess');
    comprobar('y bloqueado también desde la raíz', strpos($raiz, 'wj-content/(cache|logs|ajustes|conocimiento)/') !== false, true);

    $gitignore = (string) file_get_contents(dirname(__DIR__) . '/.gitignore');
    comprobar('y fuera del repositorio', strpos($gitignore, 'wj-content/ajustes/*') !== false, true);
}

echo "\n▸ La voz por omisión es de narración en español\n";
{
    // ORBIS venía con «Marshal - Toon Character»: personaje de dibujos
    // animados, en INGLÉS, con style 0,78 y speed 1,2. Estuvo meses ahí porque
    // nada lo delataba: la síntesis funcionaba y el audio llegaba. Solo se oía.
    //
    // Esta comprobación no llama a ElevenLabs —una prueba con red acaba sin
    // ejecutarse— sino que exige que la voz por omisión esté entre las
    // candidatas, que son las que se filtraron del catálogo por idioma español
    // y uso de narración o divulgación. Para contrastarla en vivo está
    // tools/verificar-voz.php.
    comprobar(
        'la voz por omisión está entre las candidatas',
        isset(Ajustes::VOCES[Config::VOZ_PREDETERMINADA]),
        true
    );
    comprobar(
        'y no es la de dibujos animados de antes',
        Config::VOZ_PREDETERMINADA !== 'lE5ZJB6jGeeuvSNxOvs2',
        true
    );

    // La voz vieja no puede volver por la puerta de atrás: si alguien la
    // pusiera en la lista de candidatas, el desplegable la ofrecería y el
    // probador la sintetizaría.
    comprobar(
        'ni figura entre las que ofrece el panel',
        isset(Ajustes::VOCES['lE5ZJB6jGeeuvSNxOvs2']),
        false
    );

    comprobar('hay varias candidatas para comparar', count(Ajustes::VOCES) >= 5, true);
}

echo "\n▸ El probador de voz no es una puerta abierta\n";
{
    $probador = (string) file_get_contents(dirname(__DIR__) . '/wj-admin/probar-voz.php');
    comprobar('exige sesión del panel', strpos($probador, 'SesionAdmin::dentro()') !== false, true);
    comprobar('solo acepta voces candidatas', strpos($probador, 'isset(Ajustes::VOCES[$voz])') !== false, true);
    comprobar('la frase es fija, no llega del cliente', strpos($probador, "\$_GET['texto']") === false, true);
    comprobar('lleva su propio tope de gasto', strpos($probador, "'pruebavoz'") !== false, true);
    comprobar('y cachea, para no pagar dos veces lo mismo', strpos($probador, '$cache->existe(') !== false, true);

    // El endpoint PÚBLICO no puede haberse ampliado para esto: si aceptara
    // cualquier voz, cualquiera recorrería el catálogo a costa de la cuenta.
    $tts = (string) file_get_contents(dirname(__DIR__) . '/wj-includes/api/tts.php');
    comprobar(
        'api/tts.php sigue con su lista blanca',
        strpos($tts, 'ELEVENLABS_VOCES_PERMITIDAS') !== false && strpos($tts, 'Ajustes::VOCES') === false,
        true
    );
}

echo "\n▸ El panel no devuelve nunca una clave guardada\n";
{
    // Un campo de contraseña relleno con el valor real lo entrega a cualquiera
    // que mire el código de la página.
    $panel = fuentesDelPanel();
    comprobar(
        'los campos de clave salen sin value',
        preg_match('/type="password"[^>]*value=/', $panel),
        0
    );
    comprobar('y hay una casilla explícita para borrarlas', strpos($panel, 'name="borrar[') !== false, true);
}

echo "\n▸ Toda constante de clase que se usa existe\n";
{
    // PHP no lo comprueba al cargar el archivo: una constante que no existe es
    // un error fatal en el momento de usarla. Así se escapó
    // «ElevenLabs::FRASE_PRUEBA», que solo se leía en el paso de síntesis de la
    // verificación, justo el que no se ejercita sin red. Se busca en todo el
    // PHP del servidor cualquier «Clase::CONSTANTE» de una clase de
    // wj-includes/lib y se comprueba que está definida.
    $archivos = [];
    foreach (['wj-includes', 'wj-admin'] as $raiz) {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(__DIR__ . "/../$raiz", FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->getExtension() === 'php') $archivos[] = $f->getPathname();
        }
    }
    $usadas = [];
    foreach ($archivos as $archivo) {
        preg_match_all('/\b([A-Z][A-Za-z]+)::([A-Z][A-Z0-9_]+)\b/', (string) file_get_contents($archivo), $m, PREG_SET_ORDER);
        foreach ($m as [, $clase, $constante]) {
            if (!is_file(__DIR__ . "/../wj-includes/lib/$clase.php")) continue;
            $usadas["$clase::$constante"] = basename($archivo);
        }
    }
    $faltan = [];
    foreach ($usadas as $nombre => $donde) {
        [$clase] = explode('::', $nombre);
        require_once __DIR__ . "/../wj-includes/lib/$clase.php";
        if (!defined($nombre)) $faltan[] = "$nombre (en $donde)";
    }
    comprobar('se han encontrado usos que revisar (' . count($usadas) . ')', count($usadas) >= 8, true);
    comprobar('ninguna falta' . ($faltan ? ': ' . implode(', ', $faltan) : ''), $faltan, []);
}

// Se devuelve el archivo del servidor tal y como estaba.
@unlink($ruta);
if ($respaldo !== null) {
    file_put_contents($ruta, $respaldo);
}

echo $fallos ? "\n✘ $fallos comprobación(es) fallida(s)\n\n" : "\n✔ Todas las comprobaciones pasan\n\n";
exit($fallos ? 1 : 0);
