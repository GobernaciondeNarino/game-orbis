<?php
/**
 * ORBIS — Pestaña de inicio: qué falta, cómo está cada servicio y qué se ha
 * añadido al conocimiento. Es lo que hay que mirar al entrar.
 */

declare(strict_types=1);

if (!defined('ORBIS_PANEL')) {
    http_response_code(403);
    exit;
}

$faltan = Ajustes::faltan();
$ultimas = Verificador::ultimas();

// El conocimiento añadido o corregido desde el panel, cuerpo a cuerpo.
$conCambios = [];
foreach (Catalogo::identificadores() as $id) {
    $propias = 0;
    $retiradas = 0;
    foreach (Conocimiento::entradas($id, false) as $e) {
        if ($e['origen'] === 'panel') {
            $propias++;
        }
        if (!$e['activa'] || $e['editada']) {
            $retiradas++;
        }
    }
    if ($propias + $retiradas > 0) {
        $conCambios[$id] = [$propias, $retiradas];
    }
}
?>

<h1 class="titulo-pestana">Inicio</h1>

<?php if ($faltan !== []): ?>
  <section class="tarjeta">
    <h2 class="tarjeta__titulo">Lo que falta por configurar</h2>
    <p class="ayuda">
      ORBIS funciona sin esto —no se cae ni se queda en blanco— pero cada línea
      es algo que ahora mismo no hace.
    </p>
    <ul class="faltan">
      <?php foreach ($faltan as $clave => $campo):
          $grupo = $campo['grupo'];
          $destino = Ajustes::GRUPOS[$grupo]['pestana'] ?? 'apis';
      ?>
        <li class="faltan__una">
          <a class="faltan__ir" href="<?= e(urlPanel(['pestana' => $destino], $clave)) ?>"><?= e($campo['etiqueta']) ?></a>
          <span class="faltan__consecuencia"><?= e($campo['sinEsto']) ?></span>
        </li>
      <?php endforeach; ?>
    </ul>
  </section>
<?php endif; ?>

<section class="tarjeta">
  <h2 class="tarjeta__titulo">Estado de los servicios</h2>
  <p class="ayuda">
    La última verificación de cada uno. «Verificar» hace peticiones de verdad
    —una síntesis corta en el caso de la voz—, así que no se repite sola.
  </p>
  <ul class="servicios">
    <?php foreach (Verificador::SERVICIOS as $servicio => $nombre):
        $r = $ultimas[$servicio] ?? null;
        $destino = $servicio === 'analitica' ? 'analitica' : 'apis';
    ?>
      <li class="servicios__uno servicios__uno--<?= e($r['estado'] ?? 'nunca') ?>">
        <a href="<?= e(urlPanel(['pestana' => $destino], $servicio)) ?>" class="servicios__nombre"><?= e($nombre) ?></a>
        <span class="servicios__estado">
          <?php if ($r === null): ?>
            Sin verificar todavía
          <?php else: ?>
            <?= e(['ok' => 'Funciona', 'aviso' => 'Funciona, con avisos', 'error' => 'No funciona'][$r['estado']] ?? $r['estado']) ?>
            · <?= e(haceCuanto(strtotime((string) $r['fecha']) ?: time())) ?>
          <?php endif; ?>
        </span>
      </li>
    <?php endforeach; ?>
  </ul>
  <p class="ayuda">
    Diagnóstico completo del servidor en
    <a href="../wj-includes/api/health.php?red=1">health.php</a>.
    Clave de este panel: <strong><?= e(SesionAdmin::origenClave()) ?></strong>.
  </p>
</section>

<section class="tarjeta">
  <h2 class="tarjeta__titulo">Conocimiento</h2>
  <?php if ($conCambios === []): ?>
    <p class="ayuda">
      Todos los cuerpos usan todavía solo lo que trae el catálogo: tres narraciones
      y sus curiosidades. En la pestaña <a href="<?= e(urlPanel(['pestana' => 'conocimiento'])) ?>">Conocimiento</a>
      se añaden más, y cuantas más haya, más tarda en repetirse nada.
    </p>
  <?php else: ?>
    <ul class="servicios">
      <?php foreach ($conCambios as $id => [$propias, $cambiadas]): ?>
        <li class="servicios__uno">
          <a class="servicios__nombre" href="<?= e(urlPanel(['pestana' => 'conocimiento', 'cuerpo' => $id])) ?>"><?= e((string) (Catalogo::cuerpo($id)['nombre'] ?? $id)) ?></a>
          <span class="servicios__estado">
            <?= $propias ?> añadida(s) desde el panel<?= $cambiadas ? ' · ' . $cambiadas . ' del catálogo corregida(s) o retirada(s)' : '' ?>
          </span>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>
</section>
