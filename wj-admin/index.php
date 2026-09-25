<?php
/**
 * ORBIS — Panel de administración.  https://tu-dominio/wj-admin/
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  QUÉ ES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * La forma de configurar ORBIS sin abrir un archivo por FTP. Lo que se guarda
 * aquí MANDA: por encima de las variables de entorno de Plesk y por encima de
 * wj-config.php. El orden era el contrario, y bastaba con rellenar
 * wj-config.php —el paso 1 de la instalación— para que el panel enseñara esos
 * campos bloqueados. El motivo del cambio está entero en lib/Config.php.
 *
 * A cambio, la regla no puede ser invisible: cada campo dice si hay un valor
 * debajo, dónde está y que no se está usando.
 *
 * LO ÚNICO QUE ESTE PANEL NO PUEDE CAMBIAR es su propia clave de entrada
 * (WJ_ADMIN_CLAVE): no está en Ajustes::CAMPOS y SesionAdmin la lee saltándose
 * la capa del panel. Si pudiera, quien entrase una vez con la clave por
 * omisión dejaría fuera al administrador de verdad.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  PESTAÑAS
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   inicio        lo que falta, avisos, estado de cada servicio
 *   apis          ElevenLabs, Anthropic y Gemini, con verificación de verdad
 *   conocimiento  la fuente de conocimiento de cada cuerpo, por categorías
 *   analitica     Google Analytics 4 por el Measurement Protocol
 *   limites       topes de gasto y la sal de los contadores
 *
 * La pestaña va en la URL (?pestana=…&cuerpo=…): se puede enlazar, recargar y
 * volver atrás sin perder el sitio. Cada una vive en pestanas/, y este archivo
 * solo hace lo común: la sesión, las acciones y el marco.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  SIN JAVASCRIPT, A PROPÓSITO
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Un formulario no lo necesita, y la CSP del proyecto no admite scripts en
 * línea. Las pestañas son enlaces; los formularios, formularios. Es lo que
 * sigue funcionando cuando algo va mal.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  LAS CLAVES NUNCA VUELVEN AL NAVEGADOR
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Los campos de clave salen SIEMPRE vacíos y dicen si hay una guardada. Vacío
 * significa «no la toques»; para quitarla hay una casilla explícita.
 */

declare(strict_types=1);

define('ORBIS_PANEL', true);

require_once __DIR__ . '/../wj-includes/lib/Config.php';
require_once __DIR__ . '/../wj-includes/lib/Ajustes.php';
require_once __DIR__ . '/../wj-includes/lib/SesionAdmin.php';
require_once __DIR__ . '/../wj-includes/lib/Catalogo.php';
require_once __DIR__ . '/../wj-includes/lib/Conocimiento.php';
require_once __DIR__ . '/../wj-includes/lib/Verificador.php';
require_once __DIR__ . '/pestanas/_comun.php';

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

SesionAdmin::iniciar();

const PESTANAS = [
    'inicio'       => 'Inicio',
    'apis'         => 'APIs',
    'conocimiento' => 'Conocimiento',
    'analitica'    => 'Analítica',
    'limites'      => 'Topes de gasto',
];

$pestana = (string) ($_GET['pestana'] ?? 'inicio');
if (!isset(PESTANAS[$pestana])) {
    $pestana = 'inicio';
}

$aviso = '';
$tono = 'info';
$erroresCampo = [];
$enviados = [];
$accion = (string) ($_POST['accion'] ?? '');

// ---------------------------------------------------------------------------
// Salir y entrar
// ---------------------------------------------------------------------------
if ($accion === 'salir') {
    SesionAdmin::salir();
    header('Location: ' . urlPanel());
    exit;
}

if ($accion === 'entrar' && !SesionAdmin::dentro()) {
    [$ok, $motivo] = SesionAdmin::entrar((string) ($_POST['clave'] ?? ''));
    if ($ok) {
        // Redirección tras entrar: el navegador no reenvía la clave al recargar.
        header('Location: ' . urlPanel(['pestana' => $pestana]));
        exit;
    }
    $aviso = $motivo;
    $tono = 'error';
}

$dentro = SesionAdmin::dentro();

// Si el panel no puede escribir, hay que decirlo AL ABRIR y no al guardar:
// los campos de clave salen siempre vacíos, así que un fallo al guardar
// obliga a volver a pegarlas todas.
[$sePuedeGuardar, $porQueNo] = $dentro ? Ajustes::escribible() : [true, ''];

// ---------------------------------------------------------------------------
// Acciones. Todas exigen sesión y el testigo contra CSRF.
// ---------------------------------------------------------------------------
if ($dentro && $accion !== '' && $accion !== 'entrar') {
    if (!SesionAdmin::testigoValido($_POST['testigo'] ?? null)) {
        $aviso = 'La sesión caducó mientras rellenabas el formulario. Vuelve a intentarlo.';
        $tono = 'error';
    } elseif (in_array($accion, ['guardar', 'verificar'], true)) {
        require __DIR__ . '/acciones/ajustes.php';
    } elseif (strpos($accion, 'con-') === 0) {
        require __DIR__ . '/acciones/conocimiento.php';
    }
}

$flash = $dentro ? tomarFlash() : [];
if ($aviso === '' && isset($flash['texto'])) {
    $aviso = (string) $flash['texto'];
    $tono = (string) ($flash['tono'] ?? 'info');
}
if (isset($flash['errores']) && is_array($flash['errores'])) {
    $erroresCampo = $flash['errores'];
}
if (isset($flash['enviados']) && is_array($flash['enviados'])) {
    $enviados = $flash['enviados'];
}
?>
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title><?= e(PESTANAS[$pestana]) ?> · ORBIS · Administración</title>
<link rel="icon" href="../wj-content/assets/orbis.svg" type="image/svg+xml">
<link rel="stylesheet" href="../wj-includes/css/fuentes.css">
<link rel="stylesheet" href="../wj-includes/css/nucleo.css">
<link rel="stylesheet" href="panel.css">
</head>
<body class="admin">

<a class="saltar" href="#contenido">Saltar al contenido</a>

<header class="admin__cabecera">
  <p class="admin__marca">ORBIS</p>
  <p class="admin__subtitulo">Administración</p>
  <?php if ($dentro): ?>
    <form method="post" class="admin__salir">
      <?= campoTestigo() ?>
      <button type="submit" name="accion" value="salir" class="boton boton--tenue">Salir</button>
    </form>
  <?php endif; ?>
</header>

<?php if ($dentro): ?>
  <nav class="pestanas" aria-label="Secciones del panel">
    <ul class="pestanas__lista">
      <?php foreach (PESTANAS as $id => $nombre): ?>
        <li>
          <a class="pestanas__una<?= $id === $pestana ? ' pestanas__una--activa' : '' ?>"
             href="<?= e(urlPanel(['pestana' => $id])) ?>"
             <?= $id === $pestana ? 'aria-current="page"' : '' ?>><?= e($nombre) ?></a>
        </li>
      <?php endforeach; ?>
    </ul>
  </nav>
<?php endif; ?>

<main class="admin__cuerpo" id="contenido">

<?php if ($aviso !== ''): ?>
  <p class="mensaje mensaje--<?= e($tono) ?>" role="<?= $tono === 'error' ? 'alert' : 'status' ?>" tabindex="-1" id="mensaje">
    <?= e($aviso) ?>
  </p>
<?php endif; ?>

<?php if (!$dentro): ?>

  <form method="post" class="tarjeta tarjeta--entrada" action="<?= e(urlPanel(['pestana' => $pestana !== 'inicio' ? $pestana : null])) ?>">
    <h1 class="tarjeta__titulo">Entrar</h1>
    <p class="ayuda">
      La clave se fija en las variables de entorno de Plesk (<code>WJ_ADMIN_CLAVE</code>)
      o en <code>wj-config.php</code>. No se puede cambiar desde aquí.
    </p>
    <label class="campo">
      <span class="campo__etiqueta">Clave de administración</span>
      <input type="password" name="clave" autocomplete="current-password" required autofocus>
    </label>
    <button type="submit" name="accion" value="entrar" class="boton">Entrar</button>
  </form>

<?php else: ?>

  <?php if (SesionAdmin::esPorOmision()): ?>
    <div class="mensaje mensaje--error" role="alert">
      <strong>Estás usando la clave por omisión</strong>, la que viene escrita en el
      repositorio: cualquiera que vea el código la conoce. Ponle una propia en
      Plesk (Dominios → Configuración de PHP → Variables de entorno) con el nombre
      <code>WJ_ADMIN_CLAVE</code>, o en <code>wj-config.php</code>. Mejor aún, guarda ahí
      el resultado de <code>password_hash()</code> en lugar de la clave en claro.
    </div>
  <?php endif; ?>

  <?php if (!$sePuedeGuardar): ?>
    <div class="mensaje mensaje--error" role="alert">
      <strong>Este panel no puede guardar nada</strong>: <?= e($porQueNo) ?>.
      Todo lo que escribas aquí se perderá al pulsar Guardar.
      <br><br>
      Hay que dar permiso de escritura a <code>wj-content/ajustes/</code> y a
      <code>wj-content/conocimiento/</code> para el usuario con el que corre PHP.
      En Plesk, desde el gestor de archivos, o por SSH:
      <br><code>chmod 775 wj-content/ajustes/ wj-content/conocimiento/</code>
      <br><br>
      Pasa cuando el despliegue se hace con un usuario y PHP corre con otro.
    </div>
  <?php endif; ?>

  <?php require __DIR__ . '/pestanas/' . $pestana . '.php'; ?>

<?php endif; ?>

</main>

<footer class="admin__pie">
  <p>ORBIS · Interfaz Galáctica del Sistema Solar</p>
  <p>Idea y diseño original: <strong>Jonnathan Bucheli Galindo</strong></p>
  <p>Gobernación de Nariño</p>
</footer>

</body>
</html>
