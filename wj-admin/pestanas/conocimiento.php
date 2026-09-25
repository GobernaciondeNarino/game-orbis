<?php
/**
 * ORBIS — Pestaña de conocimiento: la fuente de conocimiento de cada cuerpo.
 *
 * Subpestañas por categoría —Sol, planetas, planetas enanos, lunas y
 * cinturones— y, dentro, la ficha de cada cuerpo con sus narraciones y sus
 * datos. Lo que viene del catálogo se puede corregir o retirar; lo añadido
 * aquí, además, borrar. Todo con fuente: sin ella no se guarda.
 *
 * Por qué un almacén aparte del catálogo, y cómo se usa lo que se escribe
 * aquí: ver lib/Conocimiento.php.
 */

declare(strict_types=1);

if (!defined('ORBIS_PANEL')) {
    http_response_code(403);
    exit;
}

require_once __DIR__ . '/../../wj-includes/lib/Redactor.php';

const CATEGORIAS = [
    'sol'        => ['titulo' => 'Sol', 'tipos' => ['estrella']],
    'planetas'   => ['titulo' => 'Planetas', 'tipos' => ['planeta']],
    'enanos'     => ['titulo' => 'Planetas enanos', 'tipos' => ['planeta-enano']],
    'lunas'      => ['titulo' => 'Lunas', 'tipos' => ['satelite']],
    'cinturones' => ['titulo' => 'Cinturones', 'tipos' => ['cinturon']],
];

/** Los cuerpos de una categoría, en el orden del catálogo. */
function cuerposDe(string $categoria): array
{
    $salida = [];
    foreach (Catalogo::identificadores() as $id) {
        $c = Catalogo::cuerpo($id);
        if (in_array((string) ($c['tipo'] ?? ''), CATEGORIAS[$categoria]['tipos'], true)) {
            $salida[$id] = $c;
        }
    }
    return $salida;
}

function categoriaDe(array $cuerpo): string
{
    foreach (CATEGORIAS as $clave => $cat) {
        if (in_array((string) ($cuerpo['tipo'] ?? ''), $cat['tipos'], true)) {
            return $clave;
        }
    }
    return 'planetas';
}

// --- Qué se está viendo -------------------------------------------------------
$idCuerpo = (string) ($_GET['cuerpo'] ?? '');
$cuerpoActual = preg_match('/^[a-z0-9-]{1,40}$/', $idCuerpo) === 1 ? Catalogo::cuerpo($idCuerpo) : null;
$categoria = (string) ($_GET['grupo'] ?? '');
if ($cuerpoActual !== null) {
    $categoria = categoriaDe($cuerpoActual);
} elseif (!isset(CATEGORIAS[$categoria])) {
    $categoria = 'sol';
}
$cuerpos = cuerposDe($categoria);
// El Sol es uno solo: no tiene sentido pedir que se elija.
if ($cuerpoActual === null && count($cuerpos) === 1) {
    $idCuerpo = (string) array_key_first($cuerpos);
    $cuerpoActual = $cuerpos[$idCuerpo];
}

$proveedor = Redactor::proveedor();
$borradores = $_SESSION['borradores'][$idCuerpo] ?? [];
$accionFormulario = $cuerpoActual !== null ? e(urlPanel(['pestana' => 'conocimiento', 'cuerpo' => $idCuerpo])) : '';

/** Una entrada existente, con su formulario de edición y sus botones. */
function pintarEntrada(string $cuerpo, array $e, string $accion, array $errores, array $enviados): void
{
    $err = $errores[$e['id']] ?? [];
    $val = $enviados[$e['id']] ?? $e;
    $esNarracion = $e['tipo'] === 'narracion';
    ?>
    <form method="post" action="<?= $accion ?>" id="<?= e($e['id']) ?>"
          class="entrada<?= $e['activa'] ? '' : ' entrada--retirada' ?>">
      <?= campoTestigo() ?>
      <input type="hidden" name="cuerpo" value="<?= e($cuerpo) ?>">
      <input type="hidden" name="entrada" value="<?= e($e['id']) ?>">
      <input type="hidden" name="tipo" value="<?= e($e['tipo']) ?>">

      <p class="entrada__meta">
        <span class="chip chip--<?= $e['origen'] === 'catalogo' ? 'catalogo' : 'panel' ?>">
          <?= $e['origen'] === 'catalogo' ? 'Catálogo' : 'Añadida aquí' ?>
        </span>
        <?php if (!$e['activa']): ?><span class="chip chip--retirada">Retirada</span><?php endif; ?>
        <?php if ($e['editada']): ?><span class="chip chip--editada">Corregida</span><?php endif; ?>
        <?php if (!$esNarracion): ?><span class="chip"><?= e(Conocimiento::TEMAS[$e['tema']] ?? $e['tema']) ?></span><?php endif; ?>
      </p>

      <label class="campo">
        <span class="campo__etiqueta"><?= $esNarracion ? 'Narración' : 'Dato' ?></span>
        <textarea name="texto" rows="<?= $esNarracion ? 7 : 3 ?>"
                  <?= isset($err['texto']) ? 'aria-invalid="true"' : '' ?>><?= e((string) $val['texto']) ?></textarea>
        <?php if (isset($err['texto'])): ?><span class="campo__error" role="alert">El texto <?= e($err['texto']) ?>.</span><?php endif; ?>
      </label>

      <div class="entrada__fila">
        <?php if (!$esNarracion): ?>
          <label class="campo">
            <span class="campo__etiqueta">Tema</span>
            <select name="tema">
              <?php foreach (Conocimiento::TEMAS as $t => $nombre): ?>
                <option value="<?= e($t) ?>" <?= ($val['tema'] ?? '') === $t ? 'selected' : '' ?>><?= e($nombre) ?></option>
              <?php endforeach; ?>
            </select>
          </label>
        <?php endif; ?>
        <label class="campo">
          <span class="campo__etiqueta">Fuente (obligatoria)</span>
          <input type="text" name="fuente" value="<?= e((string) $val['fuente']) ?>" maxlength="200"
                 <?= isset($err['fuente']) ? 'aria-invalid="true"' : '' ?>>
          <?php if (isset($err['fuente'])): ?><span class="campo__error" role="alert">La fuente <?= e($err['fuente']) ?>.</span><?php endif; ?>
        </label>
        <label class="campo">
          <span class="campo__etiqueta">Enlace (opcional)</span>
          <input type="url" name="url" value="<?= e((string) $val['url']) ?>" maxlength="300" placeholder="https://…">
        </label>
      </div>

      <div class="entrada__acciones">
        <button type="submit" name="accion" value="con-guardar" class="boton">Guardar cambios</button>
        <?php if ($e['activa']): ?>
          <button type="submit" name="accion" value="con-retirar" class="boton boton--tenue">Retirar</button>
        <?php else: ?>
          <button type="submit" name="accion" value="con-publicar" class="boton boton--tenue">Volver a publicar</button>
        <?php endif; ?>
        <?php if ($e['origen'] === 'catalogo' && ($e['editada'])): ?>
          <button type="submit" name="accion" value="con-borrar" class="boton boton--tenue">Restaurar el original</button>
        <?php elseif ($e['origen'] === 'panel' && !$e['activa']): ?>
          <button type="submit" name="accion" value="con-borrar" class="boton boton--peligro">Borrar del todo</button>
        <?php endif; ?>
      </div>
    </form>
    <?php
}

/** El formulario de una entrada nueva, relleno con el borrador si lo hay. */
function pintarNueva(string $cuerpo, string $tipo, string $accion, ?array $borrador, array $errores, array $enviados): void
{
    $clave = 'nueva-' . $tipo;
    $err = $errores[$clave] ?? [];
    $val = $enviados[$clave] ?? ($borrador ? ['texto' => $borrador['texto'], 'fuente' => $borrador['fuente'], 'url' => '', 'tema' => 'curiosidad'] : []);
    $esNarracion = $tipo === 'narracion';
    ?>
    <form method="post" action="<?= $accion ?>" id="<?= e($clave) ?>" class="entrada entrada--nueva">
      <?= campoTestigo() ?>
      <input type="hidden" name="cuerpo" value="<?= e($cuerpo) ?>">
      <input type="hidden" name="tipo" value="<?= e($tipo) ?>">
      <h3 class="entrada__titulo"><?= $esNarracion ? 'Nueva narración' : 'Nuevo dato' ?></h3>

      <?php if ($borrador): ?>
        <div class="mensaje mensaje--aviso">
          <p><strong>Borrador de <?= e(Redactor::nombreProveedor($borrador['proveedor'])) ?>, sin publicar.</strong>
            Léelo entero: quien lo guarda es quien lo firma.</p>
          <?php if ($borrador['avisos'] !== []): ?>
            <ul class="lista-ayuda">
              <?php foreach ($borrador['avisos'] as $a): ?><li><?= e($a) ?></li><?php endforeach; ?>
            </ul>
          <?php else: ?>
            <p>El filtro de cifras no ha encontrado ninguna sin respaldo en las fuentes de este cuerpo.</p>
          <?php endif; ?>
        </div>
      <?php endif; ?>

      <label class="campo">
        <span class="campo__etiqueta"><?= $esNarracion ? 'Texto (entre 200 y 2.400 caracteres; se lee en voz alta)' : 'Texto (una o dos frases)' ?></span>
        <textarea name="texto" rows="<?= $esNarracion ? 8 : 3 ?>" required
                  <?= isset($err['texto']) ? 'aria-invalid="true"' : '' ?>><?= e((string) ($val['texto'] ?? '')) ?></textarea>
        <?php if (isset($err['texto'])): ?><span class="campo__error" role="alert">El texto <?= e($err['texto']) ?>.</span><?php endif; ?>
      </label>
      <div class="entrada__fila">
        <?php if (!$esNarracion): ?>
          <label class="campo">
            <span class="campo__etiqueta">Tema</span>
            <select name="tema">
              <?php foreach (Conocimiento::TEMAS as $t => $nombre): ?>
                <option value="<?= e($t) ?>" <?= ($val['tema'] ?? 'curiosidad') === $t ? 'selected' : '' ?>><?= e($nombre) ?></option>
              <?php endforeach; ?>
            </select>
          </label>
        <?php endif; ?>
        <label class="campo">
          <span class="campo__etiqueta">Fuente (obligatoria)</span>
          <input type="text" name="fuente" value="<?= e((string) ($val['fuente'] ?? '')) ?>" maxlength="200" required
                 placeholder="p. ej. NASA Science — Mars"
                 <?= isset($err['fuente']) ? 'aria-invalid="true"' : '' ?>>
          <?php if (isset($err['fuente'])): ?><span class="campo__error" role="alert">La fuente <?= e($err['fuente']) ?>.</span><?php endif; ?>
        </label>
        <label class="campo">
          <span class="campo__etiqueta">Enlace (opcional)</span>
          <input type="url" name="url" value="<?= e((string) ($val['url'] ?? '')) ?>" maxlength="300" placeholder="https://…">
        </label>
      </div>
      <div class="entrada__acciones">
        <button type="submit" name="accion" value="con-guardar" class="boton">Publicar</button>
        <?php if ($borrador): ?>
          <input type="hidden" name="que" value="<?= e($tipo) ?>">
          <button type="submit" name="accion" value="con-descartar" class="boton boton--tenue" formnovalidate>Descartar el borrador</button>
        <?php endif; ?>
      </div>
    </form>
    <?php
}
?>

<h1 class="titulo-pestana">Conocimiento</h1>

<nav class="subpestanas" aria-label="Categorías">
  <ul class="subpestanas__lista">
    <?php foreach (CATEGORIAS as $clave => $cat): ?>
      <li>
        <a class="subpestanas__una<?= $clave === $categoria ? ' subpestanas__una--activa' : '' ?>"
           href="<?= e(urlPanel(['pestana' => 'conocimiento', 'grupo' => $clave])) ?>"
           <?= $clave === $categoria ? 'aria-current="page"' : '' ?>><?= e($cat['titulo']) ?></a>
      </li>
    <?php endforeach; ?>
  </ul>
</nav>

<?php if (count($cuerpos) > 1): ?>
  <nav class="cuerpos" aria-label="<?= e(CATEGORIAS[$categoria]['titulo']) ?>">
    <?php
      // Las lunas, agrupadas por su planeta: treinta nombres seguidos no se
      // leen, y lo primero que se busca es «las de Júpiter».
      $porPadre = [];
      foreach ($cuerpos as $id => $c) {
          $porPadre[$categoria === 'lunas' ? (string) ($c['padre'] ?? '') : ''][$id] = $c;
      }
    ?>
    <?php foreach ($porPadre as $padre => $lista): ?>
      <div class="cuerpos__grupo">
        <?php if ($padre !== ''): ?>
          <span class="cuerpos__padre"><?= e((string) (Catalogo::cuerpo($padre)['nombre'] ?? $padre)) ?></span>
        <?php endif; ?>
        <?php foreach ($lista as $id => $c): ?>
          <a class="chip chip--enlace<?= $id === $idCuerpo ? ' chip--activo' : '' ?>"
             href="<?= e(urlPanel(['pestana' => 'conocimiento', 'cuerpo' => $id])) ?>"
             <?= $id === $idCuerpo ? 'aria-current="page"' : '' ?>><?= e((string) ($c['nombre'] ?? $id)) ?></a>
        <?php endforeach; ?>
      </div>
    <?php endforeach; ?>
  </nav>
<?php endif; ?>

<?php if ($cuerpoActual === null): ?>

  <section class="tarjeta">
    <h2 class="tarjeta__titulo">Cómo funciona</h2>
    <p class="ayuda">Elige un cuerpo. Cada uno tiene su propia fuente de conocimiento:</p>
    <ul class="lista-ayuda">
      <li><strong>Narraciones</strong>: relatos de un minuto que se van alternando cada vez que se visita.
        Las tres del catálogo son la base; cada una que se añade aquí alarga la rotación.</li>
      <li><strong>Datos</strong>: hechos sueltos con su fuente. Se dicen tras la narración («un dato
        más…»), el asistente los consulta al conversar y se enseñan en el panel de curiosidades.</li>
    </ul>
    <p class="ayuda">Lo del catálogo se puede corregir o retirar, nunca borrar: está en el repositorio.
      Lo añadido aquí se guarda en <code>wj-content/conocimiento/</code>, fuera de git, así que un
      <code>git pull</code> no lo pisa.</p>
  </section>

<?php else:
    $todas = Conocimiento::entradas($idCuerpo, false);
    $narraciones = array_values(array_filter($todas, function ($x) { return $x['tipo'] === 'narracion'; }));
    $datos = array_values(array_filter($todas, function ($x) { return $x['tipo'] === 'dato'; }));
    $activas = function (array $l): int {
        return count(array_filter($l, function ($x) { return $x['activa']; }));
    };
?>

  <section class="tarjeta ficha">
    <h2 class="tarjeta__titulo"><?= e((string) ($cuerpoActual['nombre'] ?? $idCuerpo)) ?></h2>
    <p class="ayuda">
      <?= $activas($narraciones) ?> narración(es) y <?= $activas($datos) ?> dato(s) publicados.
      Con <?= max(1, $activas($narraciones)) ?> narraciones, la misma no vuelve a sonar hasta la
      visita <?= max(1, $activas($narraciones)) + 1 ?>.
      <a href="../wj-includes/api/conocimiento.php?cuerpo=<?= e($idCuerpo) ?>">Ver lo publicado</a>.
    </p>
  </section>

  <section class="tarjeta" id="narraciones">
    <h2 class="tarjeta__titulo">Narraciones</h2>
    <?php foreach ($narraciones as $n) { pintarEntrada($idCuerpo, $n, $accionFormulario, $erroresCampo, $enviados); } ?>

    <?php pintarNueva($idCuerpo, 'narracion', $accionFormulario, $borradores['narracion'] ?? null, $erroresCampo, $enviados); ?>

    <form method="post" action="<?= $accionFormulario ?>" class="entrada entrada--ia">
      <?= campoTestigo() ?>
      <input type="hidden" name="cuerpo" value="<?= e($idCuerpo) ?>">
      <h3 class="entrada__titulo">Proponer una narración con IA</h3>
      <?php if ($proveedor === null): ?>
        <p class="ayuda">No hay ningún proveedor disponible. Hace falta una clave de Anthropic, o una de
          Gemini con su casilla de uso editorial marcada, en la pestaña
          <a href="<?= e(urlPanel(['pestana' => 'apis'])) ?>">APIs</a>.</p>
      <?php else: ?>
        <p class="ayuda">
          <?= e(Redactor::nombreProveedor($proveedor)) ?> redacta un borrador usando <strong>solo</strong>
          los datos publicados de este cuerpo y los del catálogo, desde un ángulo distinto al de las
          narraciones que ya existen. Aparece arriba, en «Nueva narración», sin publicar; cada cifra que
          no esté en ninguna fuente sale señalada.
        </p>
        <button type="submit" name="accion" value="con-proponer-narracion" class="boton boton--secundario">Proponer un borrador</button>
      <?php endif; ?>
    </form>
  </section>

  <section class="tarjeta" id="datos">
    <h2 class="tarjeta__titulo">Datos</h2>
    <?php foreach ($datos as $d) { pintarEntrada($idCuerpo, $d, $accionFormulario, $erroresCampo, $enviados); } ?>

    <?php pintarNueva($idCuerpo, 'dato', $accionFormulario, null, $erroresCampo, $enviados); ?>

    <?php
      $varios = $borradores['varios'] ?? null;
      $valVarios = $enviados['varios'] ?? ($varios ? ['texto' => $varios['texto'], 'fuente' => $varios['fuente'], 'url' => $varios['url'] ?? '', 'tema' => $varios['tema'] ?? 'curiosidad'] : []);
      $errVarios = $erroresCampo['varios'] ?? [];
    ?>
    <form method="post" action="<?= $accionFormulario ?>" class="entrada entrada--nueva" id="varios">
      <?= campoTestigo() ?>
      <input type="hidden" name="cuerpo" value="<?= e($idCuerpo) ?>">
      <h3 class="entrada__titulo">Añadir varios datos de la misma fuente</h3>
      <?php if ($varios): ?>
        <div class="mensaje mensaje--aviso">
          <p><strong>Propuesta de <?= e(Redactor::nombreProveedor($varios['proveedor'])) ?>, sin publicar.</strong>
            Borra las líneas que no quieras antes de publicar.</p>
          <?php if ($varios['avisos'] !== []): ?>
            <ul class="lista-ayuda"><?php foreach ($varios['avisos'] as $a): ?><li><?= e($a) ?></li><?php endforeach; ?></ul>
          <?php endif; ?>
        </div>
      <?php endif; ?>
      <label class="campo">
        <span class="campo__etiqueta">Un dato por línea</span>
        <textarea name="texto" rows="6" required <?= isset($errVarios['texto']) ? 'aria-invalid="true"' : '' ?>><?= e((string) ($valVarios['texto'] ?? '')) ?></textarea>
        <?php if (isset($errVarios['texto'])): ?><span class="campo__error" role="alert">Alguna línea <?= e($errVarios['texto']) ?>.</span><?php endif; ?>
      </label>
      <div class="entrada__fila">
        <label class="campo">
          <span class="campo__etiqueta">Tema</span>
          <select name="tema">
            <?php foreach (Conocimiento::TEMAS as $t => $nombre): ?>
              <option value="<?= e($t) ?>" <?= ($valVarios['tema'] ?? 'curiosidad') === $t ? 'selected' : '' ?>><?= e($nombre) ?></option>
            <?php endforeach; ?>
          </select>
        </label>
        <label class="campo">
          <span class="campo__etiqueta">Fuente de todos (obligatoria)</span>
          <input type="text" name="fuente" value="<?= e((string) ($valVarios['fuente'] ?? '')) ?>" maxlength="200" required>
        </label>
        <label class="campo">
          <span class="campo__etiqueta">Enlace (opcional)</span>
          <input type="url" name="url" value="<?= e((string) ($valVarios['url'] ?? '')) ?>" maxlength="300" placeholder="https://…">
        </label>
      </div>
      <div class="entrada__acciones">
        <button type="submit" name="accion" value="con-varios" class="boton">Publicar todos</button>
        <?php if ($varios): ?>
          <input type="hidden" name="que" value="varios">
          <button type="submit" name="accion" value="con-descartar" class="boton boton--tenue" formnovalidate>Descartar la propuesta</button>
        <?php endif; ?>
      </div>
    </form>

    <?php if ($proveedor !== null): ?>
      <form method="post" action="<?= $accionFormulario ?>" class="entrada entrada--ia" id="extraer">
        <?= campoTestigo() ?>
        <input type="hidden" name="cuerpo" value="<?= e($idCuerpo) ?>">
        <h3 class="entrada__titulo">Extraer datos de un texto de fuente, con IA</h3>
        <p class="ayuda">Pega un fragmento de una fuente fiable —la página de la NASA sobre este cuerpo, un
          artículo—. <?= e(Redactor::nombreProveedor($proveedor)) ?> saca de tres a seis datos que el texto
          <em>afirma</em> y los deja en «Añadir varios» para revisarlos.</p>
        <label class="campo">
          <span class="campo__etiqueta">Texto de la fuente (hasta <?= number_format(Redactor::MAX_TEXTO_FUENTE, 0, ',', '.') ?> caracteres)</span>
          <textarea name="texto_fuente" rows="6" required></textarea>
        </label>
        <div class="entrada__fila">
          <label class="campo">
            <span class="campo__etiqueta">Tema</span>
            <select name="tema">
              <?php foreach (Conocimiento::TEMAS as $t => $nombre): ?>
                <option value="<?= e($t) ?>"><?= e($nombre) ?></option>
              <?php endforeach; ?>
            </select>
          </label>
          <label class="campo">
            <span class="campo__etiqueta">De dónde sale (obligatorio)</span>
            <input type="text" name="fuente" maxlength="200" required placeholder="p. ej. NASA Science — Jupiter">
          </label>
          <label class="campo">
            <span class="campo__etiqueta">Enlace (opcional)</span>
            <input type="url" name="url" maxlength="300" placeholder="https://…">
          </label>
        </div>
        <button type="submit" name="accion" value="con-proponer-datos" class="boton boton--secundario">Proponer datos</button>
      </form>
    <?php endif; ?>
  </section>

<?php endif; ?>

<form method="post" action="<?= e(urlPanel(['pestana' => 'conocimiento', 'cuerpo' => $idCuerpo !== '' ? $idCuerpo : null])) ?>" class="tarjeta" id="redaccion">
  <?= campoTestigo() ?>
  <h2 class="tarjeta__titulo"><?= e(Ajustes::GRUPOS['redaccion']['titulo']) ?></h2>
  <p class="ayuda"><?= e(Ajustes::GRUPOS['redaccion']['nota']) ?> Ahora redacta: <strong><?= e(Redactor::nombreProveedor($proveedor)) ?></strong>.</p>
  <?php pintarCamposDe('redaccion', $erroresCampo, $enviados); ?>
  <?php pintarPie(['redaccion'], $sePuedeGuardar); ?>
</form>
