<?php
/**
 * ORBIS — Piezas comunes de las pestañas del panel.
 *
 * Este archivo y los de las pestañas NO se abren solos: los incluye index.php
 * después de comprobar la sesión. Si alguien pide su URL directamente, la
 * constante no existe y no se hace nada —además, el .htaccess de esta carpeta
 * lo deniega—. Son dos cerraduras porque un panel que escribe la
 * configuración del servidor no se puede quedar con una sola.
 */

declare(strict_types=1);

if (!defined('ORBIS_PANEL')) {
    http_response_code(403);
    exit;
}

/** Escapa para HTML. Se usa en TODO lo que se imprime. */
function e(?string $t): string
{
    return htmlspecialchars((string) $t, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** URL del panel con una consulta. Relativa: el panel puede vivir en un subdirectorio. */
function urlPanel(array $consulta = [], string $ancla = ''): string
{
    $consulta = array_filter($consulta, function ($v) {
        return $v !== null && $v !== '';
    });
    return 'index.php' . ($consulta ? '?' . http_build_query($consulta) : '') . ($ancla !== '' ? '#' . $ancla : '');
}

/**
 * Deja un aviso para la próxima página y redirige a ella.
 *
 * Es el patrón POST → redirección → GET: tras guardar, recargar la página no
 * reenvía el formulario —ni la clave que se acabara de pegar—, y el aviso
 * aparece una sola vez.
 */
function redirigirCon(string $url, string $texto, string $tono = 'ok', array $extra = []): void
{
    $_SESSION['flash'] = ['texto' => $texto, 'tono' => $tono] + $extra;
    header('Location: ' . $url);
    exit;
}

/** El aviso pendiente, y se olvida. */
function tomarFlash(): array
{
    $f = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return is_array($f) ? $f : [];
}

function campoTestigo(): string
{
    return '<input type="hidden" name="testigo" value="' . e(SesionAdmin::testigo()) . '">';
}

/**
 * Un campo de ajustes, con su etiqueta, su ayuda y lo que tiene debajo.
 *
 * @param array $errores   errores de validación por clave
 * @param array $enviados  lo que se escribió (salvo claves), para no perderlo
 *                         cuando la validación falla
 */
function pintarCampo(string $clave, array $campo, array $errores = [], array $enviados = []): void
{
    $guardado = Ajustes::obtener($clave);
    $idError = 'e-' . strtolower($clave);
    $error = $errores[$clave] ?? null;
    $describe = $error ? ' aria-invalid="true" aria-describedby="' . e($idError) . '"' : '';

    // TODOS los sitios donde hay un valor, en orden de mando. El panel manda,
    // pero lo de debajo tiene que verse: si no, se cambia wj-config.php, no pasa
    // nada, y no hay forma de saber por qué.
    $origenes = Config::origenes($clave);
    $debajo = array_values(array_diff($origenes, ['panel']));
    $mandaElPanel = in_array('panel', $origenes, true);

    // Un campo vacío no significa «sin valor»: manda lo de debajo, o el valor
    // que trae ORBIS. Decir cuál evita rellenar campos «por si acaso».
    $ejemplo = $debajo !== []
        ? 'ahora manda el valor de ' . $debajo[0]
        : (isset($campo['omision']) ? $campo['omision'] . ' (el que trae ORBIS)' : '');
    $valor = array_key_exists($clave, $enviados) ? (string) $enviados[$clave] : (string) $guardado;
    ?>
    <div class="campo<?= $campo['tipo'] === 'casilla' ? ' campo--casilla' : '' ?>">
      <?php if ($campo['tipo'] === 'casilla'): ?>
        <label class="casilla casilla--grande">
          <input type="checkbox" id="<?= e($clave) ?>" name="<?= e($clave) ?>" value="1" <?= $valor === '1' ? 'checked' : '' ?><?= $describe ?>>
          <span><?= e($campo['etiqueta']) ?></span>
        </label>
      <?php else: ?>
        <label class="campo__etiqueta" for="<?= e($clave) ?>"><?= e($campo['etiqueta']) ?></label>
      <?php endif; ?>

      <?php if ($campo['tipo'] === 'clave'): ?>
        <input type="password" id="<?= e($clave) ?>" name="<?= e($clave) ?>" autocomplete="off"
               placeholder="<?= $guardado !== null ? 'guardada — escribe para cambiarla' : e($ejemplo !== '' ? $ejemplo : 'sin configurar') ?>"<?= $describe ?>>
        <?php if ($guardado !== null): ?>
          <label class="casilla">
            <input type="checkbox" name="borrar[<?= e($clave) ?>]" value="1">
            <span>Borrar la guardada aquí<?= $debajo !== [] ? ' y volver a la de ' . e($debajo[0]) : '' ?></span>
          </label>
        <?php endif; ?>

      <?php elseif ($clave === 'ELEVENLABS_VOICE_ID'): ?>
        <?php
          $actual = $valor;
          if ($debajo === []) {
              $sinElegir = 'La que trae ORBIS — ' . (Ajustes::VOCES[Config::VOZ_PREDETERMINADA] ?? Config::VOZ_PREDETERMINADA);
          } elseif ($actual === '') {
              // Sin nada elegido aquí, lo efectivo ES lo de debajo: se nombra.
              $efectivo = (string) Config::obtener($clave, Config::VOZ_PREDETERMINADA);
              $sinElegir = 'Sin elegir aquí — suena ' . (Ajustes::VOCES[$efectivo] ?? $efectivo) . ' (de ' . $debajo[0] . ')';
          } else {
              // Con algo elegido aquí, lo efectivo es ESTO: atribuirlo a
              // wj-config.php sería decir lo contrario de la verdad.
              $sinElegir = 'Sin elegir aquí — volver a la de ' . $debajo[0];
          }
        ?>
        <select id="<?= e($clave) ?>" name="<?= e($clave) ?>"<?= $describe ?>>
          <option value=""><?= e($sinElegir) ?></option>
          <?php foreach (Ajustes::VOCES as $id => $descripcion): ?>
            <option value="<?= e($id) ?>" <?= $actual === $id ? 'selected' : '' ?>><?= e($descripcion) ?></option>
          <?php endforeach; ?>
          <?php if ($actual !== '' && !isset(Ajustes::VOCES[$actual])): ?>
            <option value="<?= e($actual) ?>" selected><?= e($actual) ?> — escrita a mano</option>
          <?php endif; ?>
        </select>

      <?php elseif ($campo['tipo'] === 'opcion'): ?>
        <select id="<?= e($clave) ?>" name="<?= e($clave) ?>"<?= $describe ?>>
          <?php foreach ($campo['opciones'] as $opcion => $texto): ?>
            <option value="<?= e($opcion) ?>" <?= ($valor !== '' ? $valor : ($campo['omision'] ?? '')) === $opcion ? 'selected' : '' ?>><?= e($texto) ?></option>
          <?php endforeach; ?>
        </select>

      <?php elseif ($campo['tipo'] === 'entero'): ?>
        <input type="number" id="<?= e($clave) ?>" name="<?= e($clave) ?>"
               min="<?= (int) $campo['min'] ?>" max="<?= (int) $campo['max'] ?>" inputmode="numeric"
               value="<?= e($valor) ?>" placeholder="<?= e($ejemplo) ?>"<?= $describe ?>>

      <?php elseif ($campo['tipo'] === 'texto'): ?>
        <input type="text" id="<?= e($clave) ?>" name="<?= e($clave) ?>" autocomplete="off"
               value="<?= e($valor) ?>" placeholder="<?= e($ejemplo) ?>"<?= $describe ?>>
      <?php endif; ?>

      <?php if ($error): ?>
        <p class="campo__error" id="<?= e($idError) ?>" role="alert"><?= e($error) ?></p>
      <?php endif; ?>

      <?php if (($campo['ayuda'] ?? '') !== ''): ?>
        <p class="campo__ayuda"><?= e($campo['ayuda']) ?></p>
      <?php endif; ?>

      <?php if ($debajo !== []): ?>
        <p class="campo__ayuda campo__ayuda--debajo">
          <?php if ($mandaElPanel): ?>
            Manda esto. Debajo hay otro valor en <strong><?= e(implode(' y en ', $debajo)) ?></strong>, sin usar.
          <?php else: ?>
            Ahora manda el de <strong><?= e($debajo[0]) ?></strong>.
          <?php endif; ?>
        </p>
      <?php endif; ?>
    </div>
    <?php
}

/** Los campos de un grupo, sin el <form> alrededor. */
function pintarCamposDe(string $grupo, array $errores = [], array $enviados = []): void
{
    foreach (Ajustes::porGrupo()[$grupo] ?? [] as $clave => $campo) {
        pintarCampo($clave, $campo, $errores, $enviados);
    }
}

/**
 * Botones de guardar, y de verificar si el grupo tiene un servicio detrás.
 * El formulario lleva la lista de grupos que contiene: es lo que permite saber
 * que una casilla desmarcada significa «desmarcada» y no «no estaba aquí».
 */
function pintarPie(array $grupos, bool $sePuedeGuardar, ?string $servicio = null): void
{
    ?>
    <input type="hidden" name="grupos" value="<?= e(implode(',', $grupos)) ?>">
    <div class="tarjeta__pie">
      <button type="submit" name="accion" value="guardar" class="boton" <?= $sePuedeGuardar ? '' : 'disabled' ?>>Guardar</button>
      <?php if ($servicio !== null): ?>
        <button type="submit" name="accion" value="verificar" class="boton boton--secundario" <?= $sePuedeGuardar ? '' : 'disabled' ?>>
          Guardar y verificar
        </button>
        <input type="hidden" name="servicio" value="<?= e($servicio) ?>">
      <?php endif; ?>
    </div>
    <?php
}

/** El resultado de la última verificación de un servicio. */
function pintarVerificacion(?array $r): void
{
    if (!$r) {
        return;
    }
    $cuando = strtotime((string) ($r['fecha'] ?? '')) ?: time();
    $estados = ['ok' => 'Todo correcto', 'aviso' => 'Funciona, con avisos', 'error' => 'Hay algo que no funciona'];
    ?>
    <div class="verificacion verificacion--<?= e($r['estado']) ?>" role="status">
      <p class="verificacion__titulo">
        <?= e($estados[$r['estado']] ?? $r['estado']) ?>
        <span class="verificacion__fecha">· verificado <?= e(haceCuanto($cuando)) ?></span>
      </p>
      <ul class="verificacion__lista">
        <?php foreach ($r['comprobaciones'] as $c): ?>
          <li class="verificacion__una verificacion__una--<?= e($c['resultado']) ?>">
            <span class="verificacion__marca" aria-hidden="true"><?= ['ok' => '✔', 'aviso' => '!', 'error' => '✘'][$c['resultado']] ?? '·' ?></span>
            <span class="verificacion__que"><?= e($c['etiqueta']) ?></span>
            <span class="verificacion__nota"><?= e($c['nota']) ?></span>
          </li>
        <?php endforeach; ?>
      </ul>
    </div>
    <?php
}

/** «hace 3 minutos», «hace 2 horas», «el 12/09 a las 10:04». */
function haceCuanto(int $marca): string
{
    $s = max(0, time() - $marca);
    if ($s < 60) {
        return 'hace un momento';
    }
    if ($s < 3600) {
        $m = (int) floor($s / 60);
        return 'hace ' . $m . ($m === 1 ? ' minuto' : ' minutos');
    }
    if ($s < 86400) {
        $h = (int) floor($s / 3600);
        return 'hace ' . $h . ($h === 1 ? ' hora' : ' horas');
    }
    return 'el ' . date('d/m', $marca) . ' a las ' . date('H:i', $marca);
}
