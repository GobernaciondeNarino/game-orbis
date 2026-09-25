<?php
/**
 * ORBIS — Borradores redactados con IA a partir del conocimiento de un cuerpo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  UN BORRADOR, NUNCA UNA PUBLICACIÓN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Todo lo que sale de aquí va a un formulario del panel, relleno, para que una
 * persona lo lea, lo corrija y lo guarde. No hay ningún camino por el que un
 * texto redactado por un modelo llegue a los visitantes sin pasar por ahí. Es
 * lo que permite usar un modelo de lenguaje sin romper la regla 4: quien firma
 * lo publicado es quien lo guarda.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  EL FILTRO DE CIFRAS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Un modelo de lenguaje sabe mucha astronomía de memoria, y la memoria no tiene
 * fuente y a veces se equivoca. Se le dan las fichas del cuerpo y se le pide que
 * no use nada más; pero pedirlo no es comprobarlo.
 *
 * Así que cada cifra del borrador se busca entre las que SÍ tienen fuente: las
 * del catálogo y las de las fichas. La que no aparece —con un margen del 2 %
 * para redondeos como «unos 1.400.000 km»— se señala en el panel junto al
 * borrador, para que quien revisa la compruebe o la quite. No se bloquea: una
 * conversión honrada (de kelvin a grados, de kilómetros a millones de
 * kilómetros) también sale señalada, y decidir eso es trabajo de una persona.
 *
 * Los números del 1 al 10 sin decimales no se miran: son casi siempre recuentos
 * («dos lunas», «tres veces más grande») y señalarlos todos convertiría el aviso
 * en ruido que se deja de leer.
 *
 * Sintaxis: requiere PHP 8.1 por el SDK de Anthropic, como Conversacion.php.
 */

declare(strict_types=1);

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Catalogo.php';
require_once __DIR__ . '/Conocimiento.php';
require_once __DIR__ . '/Gemini.php';
require_once __DIR__ . '/RateLimiter.php';

final class Redactor
{
    /** Tolerancia del filtro de cifras. */
    const TOLERANCIA = 0.02;

    /** Tope del texto de fuente que se puede pegar para extraer datos. */
    const MAX_TEXTO_FUENTE = 8000;

    /** Quién redacta, según el ajuste y lo que haya configurado. null = nadie. */
    public static function proveedor(): ?string
    {
        $pedido = (string) Config::obtener('REDACTOR_PROVEEDOR', 'auto');
        $anthropic = self::anthropicDisponible();

        if ($pedido === 'gemini') {
            return Gemini::disponible() ? 'gemini' : null;
        }
        if ($pedido === 'anthropic') {
            return $anthropic ? 'anthropic' : null;
        }
        if (Gemini::disponible()) {
            return 'gemini';
        }
        return $anthropic ? 'anthropic' : null;
    }

    public static function nombreProveedor(?string $p): string
    {
        return ['gemini' => 'Gemini', 'anthropic' => 'Claude (Anthropic)'][$p ?? ''] ?? 'ninguno';
    }

    private static function anthropicDisponible(): bool
    {
        $c = Config::obtener('ANTHROPIC_API_KEY');
        return is_string($c) && trim($c) !== '' && is_readable(Config::includes('vendor/autoload.php'));
    }

    // ------------------------------------------------------------------------
    // Encargos
    // ------------------------------------------------------------------------

    /**
     * Propone una narración nueva para un cuerpo.
     *
     * @return array{ok:bool,texto:string,fuente:string,avisos:list<string>,proveedor:string,error:string}
     */
    public static function proponerNarracion(string $id): array
    {
        $cuerpo = Catalogo::cuerpo($id);
        if ($cuerpo === null) {
            return self::fallo('ese cuerpo no existe');
        }

        $fichas = Conocimiento::datos($id);
        $catalogo = self::datosDelCatalogo($cuerpo);
        if ($fichas === [] && $catalogo === []) {
            return self::fallo('este cuerpo no tiene fichas ni datos con los que redactar: añade primero algún dato');
        }

        $sistema = 'Eres Ñaño, la voz que presenta ORBIS: una interfaz de divulgación del Sistema Solar para niñas, '
            . 'niños y público general, de la Gobernación de Nariño (Colombia). Redactas UNA narración para escucharse '
            . "en voz alta.\n\n"
            . "REGLAS QUE NO PUEDES SALTARTE:\n"
            . "1. Usa SOLO hechos que estén en las FICHAS o en los DATOS DEL CATÁLOGO. Si algo no está ahí, no lo digas, "
            . "aunque lo sepas: lo que no tiene fuente no se publica.\n"
            . "2. Escribe las cifras con dígitos, como aparecen en las fuentes. Puedes aproximar con «unos» o «casi», "
            . "pero no conviertas unidades ni calcules cifras nuevas. Los recuentos pequeños, en palabras.\n"
            . "3. Entre 130 y 190 palabras. Un solo párrafo de prosa hablada: sin títulos, listas, comillas, emojis ni formato.\n"
            . "4. Español neutro y cercano. Si usas una palabra técnica, explícala en la misma frase.\n"
            . "5. No cites las fuentes en voz alta.\n"
            . "6. Cuenta el cuerpo desde un ángulo DISTINTO al de las narraciones que ya existen, y no empieces como ellas.\n"
            . "7. Termina con una frase que invite a seguir explorando.\n\n"
            . 'Devuelve únicamente el texto de la narración.';

        $usuario = 'CUERPO: ' . (string) ($cuerpo['nombre'] ?? $id) . ' (' . (string) ($cuerpo['tipo'] ?? '') . ")\n\n"
            . "DATOS DEL CATÁLOGO:\n" . ($catalogo === [] ? "(ninguno)\n" : implode("\n", $catalogo) . "\n")
            . "\nFICHAS:\n" . self::listarFichas($fichas)
            . "\nNARRACIONES QUE YA EXISTEN (no las repitas):\n" . self::listarNarraciones($id);

        $r = self::generar($sistema, $usuario);
        if (!$r['ok']) {
            return $r;
        }

        $texto = self::limpiar($r['texto']);
        $fuentes = [];
        foreach ($fichas as $f) {
            $fuentes[$f['fuente']] = true;
        }
        $fuentes[(string) ($cuerpo['fuente'] ?? 'Catálogo de ORBIS')] = true;
        $fuente = self::recortar('Redactada con ' . self::nombreProveedor($r['proveedor']) . ' a partir de: ' . implode('; ', array_keys($fuentes)), 200);

        $avisos = [];
        $palabras = str_word_count(self::sinTildes($texto));
        if ($palabras < 110 || $palabras > 220) {
            $avisos[] = 'Tiene ' . $palabras . ' palabras; se pidieron entre 130 y 190.';
        }
        foreach (self::cifrasSinRespaldo($texto, self::respaldo($cuerpo, $fichas)) as $cifra) {
            $avisos[] = 'La cifra «' . $cifra . '» no aparece en ninguna fuente de este cuerpo: compruébala o quítala.';
        }

        return ['ok' => true, 'texto' => $texto, 'fuente' => $fuente, 'avisos' => $avisos, 'proveedor' => $r['proveedor'], 'error' => ''];
    }

    /**
     * Extrae datos de un texto de fuente que pega quien administra.
     *
     * @return array{ok:bool,texto:string,fuente:string,avisos:list<string>,proveedor:string,error:string}
     *   texto: un dato por línea, listo para «añadir varios».
     */
    public static function proponerDatos(string $id, string $textoFuente, string $fuente): array
    {
        $cuerpo = Catalogo::cuerpo($id);
        if ($cuerpo === null) {
            return self::fallo('ese cuerpo no existe');
        }
        $textoFuente = trim($textoFuente);
        if (mb_strlen($textoFuente) < 80) {
            return self::fallo('pega un fragmento más largo del texto de fuente (al menos un párrafo)');
        }
        if (mb_strlen($textoFuente) > self::MAX_TEXTO_FUENTE) {
            $textoFuente = mb_substr($textoFuente, 0, self::MAX_TEXTO_FUENTE);
        }
        $nombre = (string) ($cuerpo['nombre'] ?? $id);

        $sistema = 'Extraes datos de divulgación para ORBIS, una interfaz del Sistema Solar para niñas, niños y '
            . "público general.\n\nREGLAS:\n"
            . '1. Solo lo que AFIRMA el texto de fuente sobre ' . $nombre . ". Nada de lo que sepas por tu cuenta.\n"
            . "2. Entre 3 y 6 datos. Cada uno en UNA línea, de una o dos frases, en español, entre 20 y 300 caracteres.\n"
            . "3. Conserva las cifras exactas del texto, con dígitos.\n"
            . "4. Sin viñetas, números de orden, comillas ni formato.\n"
            . '5. Si el texto no dice nada sobre ' . $nombre . ', responde exactamente: SIN DATOS';

        $r = self::generar($sistema, "TEXTO DE FUENTE:\n" . $textoFuente);
        if (!$r['ok']) {
            return $r;
        }
        $bruto = trim($r['texto']);
        if (stripos($bruto, 'SIN DATOS') === 0) {
            return self::fallo('el modelo no encontró en ese texto nada sobre ' . $nombre);
        }

        $lineas = [];
        foreach (preg_split('/\R/u', $bruto) ?: [] as $l) {
            $l = self::limpiar((string) preg_replace('/^\s*(?:[-*•·]|\d+[.)])\s*/u', '', $l));
            if (mb_strlen($l) >= 20) {
                $lineas[] = self::recortar($l, 600);
            }
        }
        if ($lineas === []) {
            return self::fallo('la respuesta no traía ningún dato utilizable');
        }

        // Aquí el respaldo es el propio texto pegado: es la fuente declarada.
        $avisos = [];
        foreach (self::cifrasSinRespaldo(implode(' ', $lineas), self::numerosDe($textoFuente)) as $cifra) {
            $avisos[] = 'La cifra «' . $cifra . '» no está en el texto que pegaste: compruébala.';
        }
        return [
            'ok' => true, 'texto' => implode("\n", array_slice($lineas, 0, 6)), 'fuente' => $fuente,
            'avisos' => $avisos, 'proveedor' => $r['proveedor'], 'error' => '',
        ];
    }

    // ------------------------------------------------------------------------
    // Llamada al proveedor
    // ------------------------------------------------------------------------

    /** @return array{ok:bool,texto:string,fuente:string,avisos:list<string>,proveedor:string,error:string} */
    private static function generar(string $sistema, string $usuario): array
    {
        $proveedor = self::proveedor();
        if ($proveedor === null) {
            return self::fallo('no hay ningún proveedor configurado: pon una clave de Anthropic, o una de Gemini con su casilla marcada');
        }

        // Es una herramienta del panel, pero cada borrador se paga: un tope
        // generoso para trabajar y que un botón pulsado en bucle no vacíe nada.
        $limitador = new RateLimiter(30, 3600, 'redaccion', 200);
        if (!$limitador->consumir()['permitido']) {
            return self::fallo('demasiados borradores en la última hora; espera un poco');
        }

        if ($proveedor === 'gemini') {
            $g = Gemini::generar($sistema, $usuario);
            return $g['ok']
                ? ['ok' => true, 'texto' => $g['texto'], 'fuente' => '', 'avisos' => [], 'proveedor' => 'gemini', 'error' => '']
                : self::fallo('Gemini no respondió (' . $g['error'] . ($g['detalle'] !== '' ? ': ' . $g['detalle'] : '') . ')');
        }

        try {
            require_once Config::includes('vendor/autoload.php');
            require_once __DIR__ . '/Conversacion.php';
            $cliente = new Anthropic\Client(apiKey: trim((string) Config::obtener('ANTHROPIC_API_KEY')));
            $respuesta = $cliente->messages->create(
                model: (string) Config::obtener('ORBIS_MODELO', Conversacion::MODELO),
                maxTokens: 4000,
                system: $sistema,
                messages: [['role' => 'user', 'content' => $usuario]],
                // Redactar un párrafo bien hecho merece algo más de esfuerzo que
                // contestar una pregunta en una conversación hablada.
                outputConfig: ['effort' => 'medium'],
            );
        } catch (Throwable $e) {
            return self::fallo('Anthropic no respondió (' . mb_substr($e->getMessage(), 0, 160) . ')');
        }

        // Un modelo puede declinar; se comprueba antes de leer el contenido.
        if (($respuesta->stopReason ?? '') === 'refusal') {
            return self::fallo('Anthropic declinó redactar este borrador');
        }
        $texto = '';
        foreach ($respuesta->content as $bloque) {
            if (($bloque->type ?? '') === 'text') {
                $texto .= $bloque->text;
            }
        }
        return trim($texto) === ''
            ? self::fallo('Anthropic devolvió una respuesta vacía')
            : ['ok' => true, 'texto' => trim($texto), 'fuente' => '', 'avisos' => [], 'proveedor' => 'anthropic', 'error' => ''];
    }

    private static function fallo(string $motivo): array
    {
        return ['ok' => false, 'texto' => '', 'fuente' => '', 'avisos' => [], 'proveedor' => '', 'error' => $motivo];
    }

    // ------------------------------------------------------------------------
    // Material que se le da al modelo
    // ------------------------------------------------------------------------

    /**
     * Los datos medidos del catálogo, en frases cortas con su fuente.
     *
     * @return list<string>
     */
    private static function datosDelCatalogo(array $c): array
    {
        $f = (array) ($c['fisica'] ?? []);
        $o = (array) ($c['orbita'] ?? []);
        $t = (array) ($c['temperatura'] ?? []);
        $proc = (array) ($c['procedencia'] ?? []);
        $fuenteDe = function (string $campo, string $porOmision) use ($proc): string {
            return (string) ($proc[$campo]['fuente'] ?? $porOmision);
        };
        $general = (string) ($c['fuente'] ?? 'Catálogo de ORBIS');

        $lineas = [];
        $anadir = function (string $etiqueta, $valor, string $unidad, string $fuente) use (&$lineas): void {
            if ($valor === null || $valor === '' || !is_numeric($valor)) {
                return;
            }
            $lineas[] = '- ' . $etiqueta . ': ' . self::formatear((float) $valor) . ($unidad !== '' ? ' ' . $unidad : '') . ' (' . $fuente . ')';
        };

        $anadir('Radio medio', $f['radioMedioKm'] ?? null, 'km', $fuenteDe('radioMedioKm', $general));
        $anadir('Diámetro', $f['diametroKm'] ?? null, 'km', $fuenteDe('diametroKm', $general));
        $anadir('Gravedad en superficie', $f['gravedadMs2'] ?? null, 'm/s²', $fuenteDe('gravedadMs2', $general));
        $anadir('Densidad', $f['densidadGcm3'] ?? null, 'g/cm³', $fuenteDe('densidadGcm3', $general));
        $anadir('Periodo de rotación', $f['periodoRotacionHoras'] ?? null, 'horas', $fuenteDe('periodoRotacionHoras', $general));
        $anadir('Inclinación del eje', $f['inclinacionAxialGrados'] ?? null, 'grados', $fuenteDe('inclinacionAxialGrados', $general));
        $anadir('Velocidad de escape', $f['velocidadEscapeKms'] ?? null, 'km/s', $fuenteDe('velocidadEscapeKms', $general));
        // El semieje en kilómetros de un satélite es su distancia al PLANETA;
        // el de un planeta, al Sol. Confundirlos pondría a Marte «a 228
        // millones de kilómetros de su planeta».
        if (($c['tipo'] ?? '') === 'satelite') {
            $anadir('Distancia media a su planeta', $o['semiejeMayorKm'] ?? null, 'km', $general);
        } else {
            $anadir('Distancia media al Sol', $o['semiejeMayorUA'] ?? null, 'UA', $general);
            $anadir('Distancia media al Sol', $o['semiejeMayorKm'] ?? null, 'km', $general);
        }
        $anadir('Duración del año', $o['periodoOrbitalDias'] ?? null, 'días', $general);
        $anadir('Temperatura media', $t['mediaC'] ?? null, '°C', (string) ($t['fuente'] ?? $general));
        $anadir('Temperatura mínima', $t['minC'] ?? null, '°C', (string) ($t['fuente'] ?? $general));
        $anadir('Temperatura máxima', $t['maxC'] ?? null, '°C', (string) ($t['fuente'] ?? $general));
        return $lineas;
    }

    private static function listarFichas(array $fichas): string
    {
        if ($fichas === []) {
            return "(ninguna)\n";
        }
        $salida = '';
        foreach ($fichas as $i => $f) {
            $salida .= '[' . ($i + 1) . '] ' . $f['texto'] . ' (Fuente: ' . $f['fuente'] . ")\n";
        }
        return $salida;
    }

    private static function listarNarraciones(string $id): string
    {
        $salida = '';
        foreach (Conocimiento::narraciones($id) as $i => $n) {
            // Solo el arranque: basta para no repetir el comienzo ni el hilo, y
            // mandar las tres enteras duplica el coste de cada borrador.
            $salida .= '- «' . mb_substr($n, 0, 220) . "…»\n";
        }
        return $salida === '' ? "(ninguna)\n" : $salida;
    }

    // ------------------------------------------------------------------------
    // Filtro de cifras
    // ------------------------------------------------------------------------

    /**
     * Todas las cifras con fuente de un cuerpo: las del catálogo, estén donde
     * estén, y las que aparecen en el texto de sus fichas y narraciones.
     *
     * @return list<float>
     */
    public static function respaldo(array $cuerpo, array $fichas): array
    {
        $numeros = [];
        array_walk_recursive($cuerpo, function ($v, $k) use (&$numeros): void {
            if (is_int($v) || is_float($v)) {
                $numeros[] = (float) $v;
            } elseif (is_string($v) && $k !== 'id') {
                foreach (self::numerosDe($v) as $n) {
                    $numeros[] = $n;
                }
            }
        });
        foreach ($fichas as $f) {
            foreach (self::numerosDe((string) ($f['texto'] ?? '')) as $n) {
                $numeros[] = $n;
            }
        }
        return $numeros;
    }

    /**
     * Las cifras de un texto en español.
     *
     * «1.391.400» son un millón y pico, no uno coma tres: en español el punto
     * separa millares y la coma, decimales. Una cifra con punto y exactamente
     * tres dígitos detrás se lee como millares; con otro número de dígitos,
     * como decimal a la inglesa, que es como vienen algunas notas de JPL.
     *
     * @return list<float>
     */
    public static function numerosDe(string $texto): array
    {
        preg_match_all('/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+\.\d+|\d+/u', $texto, $m);
        $salida = [];
        foreach ($m[0] as $crudo) {
            $salida[] = self::aNumero($crudo);
        }
        return $salida;
    }

    private static function aNumero(string $crudo): float
    {
        if (preg_match('/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/', $crudo) === 1) {
            return (float) str_replace(['.', ','], ['', '.'], $crudo);
        }
        return (float) str_replace(',', '.', $crudo);
    }

    /**
     * Las cifras de un texto que no aparecen, ni aproximadas, en el respaldo.
     *
     * @param list<float> $respaldo
     * @return list<string> tal como están escritas en el texto
     */
    public static function cifrasSinRespaldo(string $texto, array $respaldo): array
    {
        preg_match_all('/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+\.\d+|\d+/u', $texto, $m);
        $sueltas = [];
        foreach ($m[0] as $crudo) {
            $valor = self::aNumero($crudo);
            // Recuentos pequeños: casi siempre «dos lunas», «tres veces».
            if ($valor >= 1 && $valor <= 10 && strpbrk($crudo, '.,') === false) {
                continue;
            }
            $encontrada = false;
            foreach ($respaldo as $r) {
                $referencia = abs($r);
                if ($referencia == 0.0 ? $valor == 0.0 : abs(abs($valor) - $referencia) / $referencia <= self::TOLERANCIA) {
                    $encontrada = true;
                    break;
                }
            }
            if (!$encontrada && !in_array($crudo, $sueltas, true)) {
                $sueltas[] = $crudo;
            }
        }
        return $sueltas;
    }

    // ------------------------------------------------------------------------
    // Utilidades de texto
    // ------------------------------------------------------------------------

    /** Quita comillas envolventes, formato y saltos: un párrafo hablado. */
    private static function limpiar(string $t): string
    {
        $t = str_replace(['**', '__', '#', '`'], '', $t);
        $t = trim((string) preg_replace('/\s+/u', ' ', $t));
        return trim($t, " \t\"'«»“”");
    }

    private static function recortar(string $t, int $max): string
    {
        return mb_strlen($t) <= $max ? $t : rtrim(mb_substr($t, 0, $max - 1)) . '…';
    }

    private static function sinTildes(string $t): string
    {
        return strtr($t, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ñ' => 'n', 'ü' => 'u',
            'Á' => 'A', 'É' => 'E', 'Í' => 'I', 'Ó' => 'O', 'Ú' => 'U', 'Ñ' => 'N']);
    }

    private static function formatear(float $v): string
    {
        $decimales = abs($v) >= 100 || floor($v) == $v ? 0 : 2;
        return number_format($v, $decimales, ',', '.');
    }
}
