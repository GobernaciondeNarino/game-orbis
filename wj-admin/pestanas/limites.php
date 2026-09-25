<?php
/**
 * ORBIS — Pestaña de topes de gasto y de la sal de los contadores.
 */

declare(strict_types=1);

if (!defined('ORBIS_PANEL')) {
    http_response_code(403);
    exit;
}
?>

<h1 class="titulo-pestana">Topes de gasto</h1>

<form method="post" action="<?= e(urlPanel(['pestana' => 'limites'])) ?>" class="tarjeta" id="gasto">
  <?= campoTestigo() ?>
  <h2 class="tarjeta__titulo"><?= e(Ajustes::GRUPOS['gasto']['titulo']) ?></h2>
  <p class="ayuda"><?= e(Ajustes::GRUPOS['gasto']['nota']) ?></p>
  <?php pintarCamposDe('gasto', $erroresCampo, $enviados); ?>
  <?php pintarPie(['gasto'], $sePuedeGuardar); ?>
</form>
