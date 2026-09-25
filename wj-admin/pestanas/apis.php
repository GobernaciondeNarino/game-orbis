<?php
/**
 * ORBIS — Pestaña APIs: ElevenLabs, Anthropic y Gemini.
 *
 * Un formulario por servicio, cada uno con «Guardar» y «Guardar y verificar».
 * Verificar hace las peticiones de verdad (ver lib/Verificador.php) y su
 * resultado queda debajo, con la fecha.
 */

declare(strict_types=1);

if (!defined('ORBIS_PANEL')) {
    http_response_code(403);
    exit;
}

require_once __DIR__ . '/../../wj-includes/lib/ElevenLabs.php';
require_once __DIR__ . '/../../wj-includes/lib/Gemini.php';

$ultimas = Verificador::ultimas();
$vozActual = ElevenLabs::vozConfigurada();
$accionFormulario = e(urlPanel(['pestana' => 'apis']));
?>

<h1 class="titulo-pestana">APIs</h1>
<p class="ayuda ayuda--suelta">
  Lo que guardes aquí <strong>manda</strong> sobre las variables de entorno de Plesk y sobre
  <code>wj-config.php</code>. Si un campo tiene un valor escrito también en otro sitio, lo dice
  debajo en ámbar; para volver a ese valor, deja el campo vacío y guarda.
</p>

<!-- ─────────────────────────────── ElevenLabs ─────────────────────────────── -->
<form method="post" action="<?= $accionFormulario ?>" class="tarjeta" id="elevenlabs">
  <?= campoTestigo() ?>
  <h2 class="tarjeta__titulo"><?= e(Ajustes::GRUPOS['voz']['titulo']) ?></h2>
  <p class="ayuda"><?= e(Ajustes::GRUPOS['voz']['nota']) ?></p>

  <?php pintarCamposDe('voz', $erroresCampo, $enviados); ?>

  <div class="campo">
    <p class="campo__etiqueta">Escuchar antes de decidir</p>
    <p class="campo__ayuda">
      Cada una dice la misma frase, con los mismos ajustes que usa la narración de verdad.
      La primera es la que suena ahora en el sitio.
    </p>
    <ul class="voces">
      <li class="voces__una voces__una--actual">
        <span class="voces__nombre">
          Suena ahora: <?= e(explode(' — ', Ajustes::VOCES[$vozActual] ?? $vozActual)[0]) ?>
        </span>
        <audio controls preload="none" src="probar-voz.php?voz=<?= e($vozActual) ?>"
               aria-label="Probar la voz que suena ahora"></audio>
      </li>
      <?php foreach (Ajustes::VOCES as $id => $descripcion):
          if ($id === $vozActual) {
              continue;
          }
      ?>
        <li class="voces__una">
          <span class="voces__nombre"><?= e(explode(' — ', $descripcion)[0]) ?></span>
          <audio controls preload="none" src="probar-voz.php?voz=<?= e($id) ?>"
                 aria-label="Probar la voz <?= e(explode(' — ', $descripcion)[0]) ?>"></audio>
        </li>
      <?php endforeach; ?>
    </ul>
  </div>

  <?php pintarPie(['voz'], $sePuedeGuardar, 'elevenlabs'); ?>
  <?php pintarVerificacion($ultimas['elevenlabs'] ?? null); ?>
</form>

<!-- ─────────────────────────────── Anthropic ─────────────────────────────── -->
<form method="post" action="<?= $accionFormulario ?>" class="tarjeta" id="anthropic">
  <?= campoTestigo() ?>
  <h2 class="tarjeta__titulo"><?= e(Ajustes::GRUPOS['asistente']['titulo']) ?></h2>
  <p class="ayuda"><?= e(Ajustes::GRUPOS['asistente']['nota']) ?></p>
  <?php pintarCamposDe('asistente', $erroresCampo, $enviados); ?>
  <?php pintarPie(['asistente'], $sePuedeGuardar, 'anthropic'); ?>
  <?php pintarVerificacion($ultimas['anthropic'] ?? null); ?>
</form>

<!-- ──────────────────────────────── Gemini ──────────────────────────────── -->
<form method="post" action="<?= $accionFormulario ?>" class="tarjeta" id="gemini">
  <?= campoTestigo() ?>
  <h2 class="tarjeta__titulo"><?= e(Ajustes::GRUPOS['gemini']['titulo']) ?></h2>
  <p class="ayuda"><?= e(Ajustes::GRUPOS['gemini']['nota']) ?></p>

  <div class="mensaje mensaje--aviso">
    <p><strong>Por qué Gemini no habla con los visitantes.</strong> Sus términos
      (<a href="https://ai.google.dev/gemini-api/terms" rel="noopener noreferrer" target="_blank">ai.google.dev/gemini-api/terms</a>,
      en vigor desde marzo de 2026) dicen:</p>
    <blockquote lang="en">«You must be 18 years of age or older to use the APIs. You also will not use
      the Services as part of a website […] that is directed towards or is likely to be accessed by
      individuals under the age of 18.»</blockquote>
    <p>ORBIS es divulgación para niños. Por eso aquí Gemini solo ayuda a quien administra:
      redacta <em>borradores</em> de narraciones desde el conocimiento de cada cuerpo y extrae datos
      de un texto de fuente, y nada se publica sin revisarlo. Si la Gobernación quiere otro uso,
      es una decisión de sus servicios jurídicos, no de esta pantalla.</p>
    <p><strong>Y sobre los datos:</strong> en el plan gratuito Google usa lo que se le envía para
      mejorar sus productos, y pueden leerlo personas. Con facturación activa, no. Aquí solo viaja
      el conocimiento publicado de cada cuerpo, nunca nada de un visitante.</p>
  </div>

  <?php pintarCamposDe('gemini', $erroresCampo, $enviados); ?>
  <?php pintarPie(['gemini'], $sePuedeGuardar, 'gemini'); ?>
  <?php pintarVerificacion($ultimas['gemini'] ?? null); ?>

  <details class="desplegable">
    <summary>Qué más podría hacer Gemini, y por qué no está activado</summary>
    <ul class="lista-ayuda">
      <li><strong>Conversación en tiempo real con voz</strong> (Live API): el navegador se conecta por
        WebSocket con un token efímero que genera el servidor, sin exponer la clave ni cargar código de
        Google. Técnicamente encaja; los términos de arriba lo impiden en un sitio para niños.</li>
      <li><strong>Voz de narración</strong> (gemini-3.8-flash-tts, disponible desde el 22 de septiembre
        de 2026, con español y estilo por instrucciones): sería un respaldo si falla ElevenLabs. Mismo
        impedimento: es un uso de cara al público.</li>
      <li><strong>Búsqueda con Google</strong> para proponer datos con enlaces: no está en el plan
        gratuito y obliga a mostrar las sugerencias de búsqueda de Google junto a la respuesta.</li>
    </ul>
  </details>
</form>
