<?php
/**
 * ORBIS — Pestaña de Google Analytics 4.
 *
 * Por qué por el Measurement Protocol y no con gtag.js: ver lib/Analitica.php.
 */

declare(strict_types=1);

if (!defined('ORBIS_PANEL')) {
    http_response_code(403);
    exit;
}

require_once __DIR__ . '/../../wj-includes/lib/Analitica.php';

$ultimas = Verificador::ultimas();
$estado = Analitica::estado();
$hoy = ($estado['dia'] ?? '') === gmdate('Y-m-d');
$nombresEventos = [
    'page_view'       => 'Cada vez que se abre ORBIS.',
    'ver_cuerpo'      => 'Qué cuerpo se abre (cuerpo).',
    'narracion'       => 'Cuándo empieza una narración y con qué voz (cuerpo, motor).',
    'usar_voz'        => 'Se activa el micrófono.',
    'usar_gestos'     => 'Se activa la cámara para los gestos.',
    'preguntar'       => 'Se hace una pregunta (via: catálogo o conversación, cuerpo).',
    'cambiar_escala'  => 'Se cambia entre escala didáctica y real (modo).',
    'cambiar_seccion' => 'Se cambia de sección en la barra (seccion).',
];
?>

<h1 class="titulo-pestana">Analítica</h1>

<form method="post" action="<?= e(urlPanel(['pestana' => 'analitica'])) ?>" class="tarjeta" id="analitica">
  <?= campoTestigo() ?>
  <h2 class="tarjeta__titulo"><?= e(Ajustes::GRUPOS['analitica']['titulo']) ?></h2>
  <p class="ayuda"><?= e(Ajustes::GRUPOS['analitica']['nota']) ?></p>
  <?php pintarCamposDe('analitica', $erroresCampo, $enviados); ?>
  <?php pintarPie(['analitica'], $sePuedeGuardar, 'analitica'); ?>
  <?php pintarVerificacion($ultimas['analitica'] ?? null); ?>
</form>

<section class="tarjeta">
  <h2 class="tarjeta__titulo">Seguimiento de los envíos</h2>
  <?php if (!Analitica::activa()): ?>
    <p class="ayuda">Analytics no está activo: no se envía nada.</p>
  <?php else: ?>
    <ul class="servicios">
      <li class="servicios__uno">
        <span class="servicios__nombre">Eventos enviados hoy</span>
        <span class="servicios__estado"><?= (int) ($hoy ? ($estado['enviados'] ?? 0) : 0) ?></span>
      </li>
      <li class="servicios__uno<?= $hoy && ($estado['fallidos'] ?? 0) > 0 ? ' servicios__uno--error' : '' ?>">
        <span class="servicios__nombre">Envíos fallidos hoy</span>
        <span class="servicios__estado"><?= (int) ($hoy ? ($estado['fallidos'] ?? 0) : 0) ?></span>
      </li>
      <?php if (!empty($estado['ultimoFallo'])): ?>
        <li class="servicios__uno servicios__uno--aviso">
          <span class="servicios__nombre">Último fallo</span>
          <span class="servicios__estado">
            HTTP <?= (int) $estado['ultimoFallo']['codigo'] ?> ·
            <?= e(haceCuanto(strtotime((string) $estado['ultimoFallo']['fecha']) ?: time())) ?>
          </span>
        </li>
      <?php endif; ?>
    </ul>
  <?php endif; ?>
</section>

<section class="tarjeta">
  <h2 class="tarjeta__titulo">Qué se mide, y qué no</h2>
  <p class="ayuda">
    <strong>Sin script de Google en la página y sin cookies.</strong> El navegador le cuenta a
    ORBIS qué ha pasado y es el servidor quien se lo manda a Google con el Measurement Protocol.
    La regla 2 del proyecto prohíbe cargar código de terceros, y el público son niños.
  </p>
  <ul class="lista-ayuda">
    <?php foreach (Analitica::EVENTOS as $nombre => $_): ?>
      <li><code><?= e($nombre) ?></code> — <?= e($nombresEventos[$nombre] ?? '') ?></li>
    <?php endforeach; ?>
  </ul>
  <p class="ayuda">
    <strong>Lo que se pierde, dicho claro:</strong> sin cookies cada visita cuenta como un
    usuario nuevo, así que «Usuarios» sale inflado; sesiones, eventos y cuerpos visitados sí son
    fiables. Y país y ciudad serán los del servidor, porque la IP del visitante no se reenvía.
    Los navegadores con <em>Global Privacy Control</em> o «No rastrear» activado no envían nada.
  </p>
</section>
