<?php
/**
 * ORBIS — La fuente de conocimiento de cada cuerpo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  QUÉ PROBLEMA RESUELVE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Cada cuerpo tenía tres narraciones fijas en el catálogo y tres curiosidades.
 * Quien volvía a Marte por cuarta vez oía la primera otra vez, palabra por
 * palabra. Eso es un texto que se repite, no una fuente de conocimiento.
 *
 * Aquí cada cuerpo tiene su propio conjunto de ENTRADAS, de dos tipos:
 *
 *   · narraciones: relatos de un minuto que se van alternando al visitarlo;
 *   · datos:       hechos sueltos, cada uno con su fuente, que el asistente
 *                  consulta al conversar, que se dicen tras la narración
 *                  («un dato más…») y que se enseñan en la HUD.
 *
 * Las del catálogo son la base y siguen donde estaban. Desde el panel se
 * añaden más, se corrigen o se retiran. Cuantas más haya, más tarda en
 * repetirse nada.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  POR QUÉ UN ALMACÉN APARTE Y NO REESCRIBIR EL CATÁLOGO
 * ════════════════════════════════════════════════════════════════════════════
 *
 * data/sistema-solar.json está en git. Si el panel lo reescribiera en el
 * servidor, el siguiente «git pull» de Plesk chocaría con esos cambios —o los
 * pisaría—. Lo que se edita desde el panel vive en wj-content/conocimiento/,
 * un archivo por cuerpo, fuera de git y fuera de lo que se sirve por HTTP.
 * Retirar o corregir una entrada del catálogo tampoco lo toca: se guarda aquí
 * como una capa encima, y «restaurar» es borrar esa capa.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  LA REGLA 4, APLICADA A LO QUE ESCRIBE UNA PERSONA
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Ningún dato sin fuente. No hay forma de guardar una entrada sin decir de
 * dónde sale: el campo es obligatorio y se valida aquí, no solo en el
 * formulario. Y un texto con etiquetas HTML se rechaza en lugar de limpiarse:
 * lo que se guarda es lo que se va a decir en voz alta, tal cual.
 *
 * Sintaxis compatible con PHP 7.4.
 */

declare(strict_types=1);

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Catalogo.php';

final class Conocimiento
{
    const CARPETA = 'conocimiento';

    const TIPOS = ['narracion' => 'Narración', 'dato' => 'Dato'];

    /** Temas de un dato. Una lista cerrada: sirve para filtrar y para que el
     *  asistente sepa qué está leyendo. */
    const TEMAS = [
        'estructura'  => 'Estructura e interior',
        'superficie'  => 'Superficie y geología',
        'atmosfera'   => 'Atmósfera y clima',
        'orbita'      => 'Órbita y rotación',
        'origen'      => 'Origen y evolución',
        'exploracion' => 'Exploración y misiones',
        'comparacion' => 'Comparaciones',
        'curiosidad'  => 'Curiosidades',
        'cultura'     => 'Historia y cultura',
    ];

    /** Longitudes. La narración se queda por debajo del tope de api/tts.php
     *  (2.500 caracteres) con margen; un dato es una o dos frases. */
    const LIMITES = [
        'narracion' => [200, 2400],
        'dato'      => [20, 600],
        'fuente'    => [3, 200],
    ];

    /** @var array<string,array> */
    private static $capas = [];

    // ------------------------------------------------------------------------
    // Lectura
    // ------------------------------------------------------------------------

    /**
     * Todas las entradas de un cuerpo, la base del catálogo con la capa del
     * panel encima.
     *
     * El orden es estable —primero las del catálogo en su orden, luego las del
     * panel por fecha de creación— porque de él depende la rotación.
     *
     * @return list<array{id:string,tipo:string,tema:string,texto:string,fuente:string,url:string,origen:string,activa:bool,editada:bool}>
     */
    public static function entradas(string $id, bool $soloActivas = true): array
    {
        $cuerpo = Catalogo::cuerpo($id);
        if ($cuerpo === null) {
            return [];
        }
        $capa = self::capa($id);
        $fuenteCuerpo = (string) ($cuerpo['fuente'] ?? 'Catálogo de ORBIS');

        $lista = [];
        foreach (self::base($cuerpo, $fuenteCuerpo) as $e) {
            $encima = $capa['base'][$e['id']] ?? [];
            $editada = isset($encima['texto']) || isset($encima['fuente']);
            $e['texto'] = (string) ($encima['texto'] ?? $e['texto']);
            $e['fuente'] = (string) ($encima['fuente'] ?? $e['fuente']);
            $e['url'] = (string) ($encima['url'] ?? $e['url']);
            $e['activa'] = (bool) ($encima['activa'] ?? true);
            $e['editada'] = $editada;
            $lista[] = $e;
        }

        $propias = $capa['entradas'];
        uasort($propias, function ($a, $b) {
            return strcmp((string) ($a['creada'] ?? ''), (string) ($b['creada'] ?? ''));
        });
        foreach ($propias as $entradaId => $e) {
            $lista[] = [
                'id'      => (string) $entradaId,
                'tipo'    => (string) ($e['tipo'] ?? 'dato'),
                'tema'    => (string) ($e['tema'] ?? 'curiosidad'),
                'texto'   => (string) ($e['texto'] ?? ''),
                'fuente'  => (string) ($e['fuente'] ?? ''),
                'url'     => (string) ($e['url'] ?? ''),
                'origen'  => 'panel',
                'activa'  => (bool) ($e['activa'] ?? true),
                'editada' => false,
            ];
        }

        if ($soloActivas) {
            $lista = array_values(array_filter($lista, function ($e) {
                return $e['activa'] && trim($e['texto']) !== '';
            }));
        }
        return $lista;
    }

    /** Textos de las narraciones activas, en el orden de rotación. */
    public static function narraciones(string $id): array
    {
        $textos = [];
        foreach (self::entradas($id) as $e) {
            if ($e['tipo'] === 'narracion') {
                $textos[] = $e['texto'];
            }
        }
        return $textos;
    }

    /** Datos activos, con su fuente. */
    public static function datos(string $id): array
    {
        return array_values(array_filter(self::entradas($id), function ($e) {
            return $e['tipo'] === 'dato';
        }));
    }

    /**
     * Huella de un texto: lo que el navegador envía para pedir su audio.
     *
     * Pedir por huella en lugar de por posición evita que el audio y los
     * subtítulos se desacompasen si la lista cambia mientras alguien navega
     * —se retira una narración desde el panel y todas las posiciones se
     * corren una—. Y no abre nada: la huella solo encuentra textos que YA
     * están en el conocimiento de ese cuerpo. Una inventada no encuentra nada.
     */
    public static function huella(string $texto): string
    {
        return substr(hash('sha256', $texto), 0, 16);
    }

    /** El texto activo de ese tipo cuya huella coincide, o null. */
    public static function porHuella(string $id, string $huella, string $tipo): ?string
    {
        if (preg_match('/^[a-f0-9]{16}$/', $huella) !== 1) {
            return null;
        }
        foreach (self::entradas($id) as $e) {
            if ($e['tipo'] === $tipo && self::huella($e['texto']) === $huella) {
                return $e['texto'];
            }
        }
        return null;
    }

    /**
     * Lo que se entrega al navegador: textos, fuentes y huellas. Nada de la
     * capa interna —fechas, entradas retiradas, originales editados—.
     */
    public static function publico(string $id): array
    {
        $narraciones = [];
        $datos = [];
        foreach (self::entradas($id) as $e) {
            $h = self::huella($e['texto']);
            if ($e['tipo'] === 'narracion') {
                $narraciones[] = ['texto' => $e['texto'], 'huella' => $h];
            } else {
                $datos[] = [
                    'texto' => $e['texto'],
                    'fuente' => $e['fuente'],
                    'url' => $e['url'],
                    'tema' => $e['tema'],
                    'huella' => $h,
                ];
            }
        }
        return ['narraciones' => $narraciones, 'datos' => $datos];
    }

    /**
     * La base: lo que ya trae el catálogo, convertido en entradas.
     *
     * Las notas de geología, atmósfera, temperatura y magnetosfera llevan su
     * propia fuente en el catálogo y se respetan. Las narraciones y las
     * curiosidades no la llevan una a una: se les atribuye la del cuerpo, que
     * es de donde salen sus cifras.
     */
    private static function base(array $cuerpo, string $fuenteCuerpo): array
    {
        $lista = [];
        foreach (array_values((array) ($cuerpo['narraciones'] ?? [])) as $i => $texto) {
            $lista[] = self::entradaBase('narracion-' . $i, 'narracion', 'curiosidad', (string) $texto, $fuenteCuerpo);
        }
        foreach (array_values((array) ($cuerpo['curiosidades'] ?? [])) as $i => $texto) {
            $lista[] = self::entradaBase('curiosidad-' . $i, 'dato', 'curiosidad', (string) $texto, $fuenteCuerpo);
        }
        $notas = [
            'geologia'     => 'superficie',
            'atmosfera'    => 'atmosfera',
            'temperatura'  => 'atmosfera',
            'magnetosfera' => 'estructura',
        ];
        foreach ($notas as $campo => $tema) {
            $bloque = $cuerpo[$campo] ?? null;
            if (is_array($bloque) && trim((string) ($bloque['nota'] ?? '')) !== '') {
                $lista[] = self::entradaBase(
                    'nota-' . $campo,
                    'dato',
                    $tema,
                    self::frase((string) $bloque['nota']),
                    (string) ($bloque['fuente'] ?? $fuenteCuerpo)
                );
            }
        }
        return $lista;
    }

    private static function entradaBase(string $id, string $tipo, string $tema, string $texto, string $fuente): array
    {
        return [
            'id' => $id, 'tipo' => $tipo, 'tema' => $tema, 'texto' => trim($texto),
            'fuente' => $fuente, 'url' => '', 'origen' => 'catalogo', 'activa' => true, 'editada' => false,
        ];
    }

    /** Las notas del catálogo empiezan a veces en minúscula: son acotaciones. */
    private static function frase(string $t): string
    {
        $t = trim($t);
        if ($t === '') {
            return $t;
        }
        $t = mb_strtoupper(mb_substr($t, 0, 1)) . mb_substr($t, 1);
        return preg_match('/[.!?…]$/u', $t) === 1 ? $t : $t . '.';
    }

    // ------------------------------------------------------------------------
    // Escritura (solo desde el panel)
    // ------------------------------------------------------------------------

    /**
     * Valida los campos de una entrada.
     *
     * @return array{0:array<string,string>,1:array<string,string>} [limpios, errores]
     */
    public static function validar(array $campos): array
    {
        $errores = [];
        $tipo = (string) ($campos['tipo'] ?? '');
        if (!isset(self::TIPOS[$tipo])) {
            $errores['tipo'] = 'tipo desconocido';
            $tipo = 'dato';
        }
        $tema = (string) ($campos['tema'] ?? 'curiosidad');
        if (!isset(self::TEMAS[$tema])) {
            $tema = 'curiosidad';
        }

        $texto = self::normalizar((string) ($campos['texto'] ?? ''));
        [$min, $max] = self::LIMITES[$tipo];
        if (mb_strlen($texto) < $min || mb_strlen($texto) > $max) {
            $errores['texto'] = sprintf('tiene que tener entre %d y %d caracteres (tiene %d)', $min, $max, mb_strlen($texto));
        }
        // Se rechaza, no se limpia: lo que se guarda es lo que se va a decir.
        if (preg_match('/[<>]/', $texto) === 1) {
            $errores['texto'] = 'no puede llevar los signos < ni >';
        }

        $fuente = self::normalizar((string) ($campos['fuente'] ?? ''));
        [$fmin, $fmax] = self::LIMITES['fuente'];
        if (mb_strlen($fuente) < $fmin || mb_strlen($fuente) > $fmax) {
            $errores['fuente'] = 'es obligatoria: di de dónde sale (p. ej. «NASA Science — Mars»)';
        }
        if (preg_match('/[<>]/', $fuente) === 1) {
            $errores['fuente'] = 'no puede llevar los signos < ni >';
        }

        $url = trim((string) ($campos['url'] ?? ''));
        if ($url !== '' && (preg_match('#^https?://[^\s<>"]{4,290}$#i', $url) !== 1)) {
            $errores['url'] = 'tiene que empezar por https:// y no llevar espacios';
        }

        return [
            ['tipo' => $tipo, 'tema' => $tema, 'texto' => $texto, 'fuente' => $fuente, 'url' => $url],
            $errores,
        ];
    }

    /** Colapsa espacios y saltos: una narración se lee de corrido. */
    private static function normalizar(string $t): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', $t));
    }

    /**
     * Crea una entrada nueva o modifica una existente.
     *
     * @return array{0:bool,1:array<string,string>,2:string} [guardado, errores, id]
     */
    public static function guardar(string $id, ?string $entradaId, array $campos): array
    {
        if (Catalogo::cuerpo($id) === null) {
            return [false, ['_' => 'ese cuerpo no existe'], ''];
        }
        [$limpio, $errores] = self::validar($campos);
        if ($errores !== []) {
            return [false, $errores, (string) $entradaId];
        }

        $capa = self::capa($id);
        $ahora = gmdate('c');

        if ($entradaId !== null && $entradaId !== '' && self::esBase($id, $entradaId)) {
            // Corregir una del catálogo: se guarda encima, el original no se toca.
            $capa['base'][$entradaId] = array_merge($capa['base'][$entradaId] ?? [], [
                'texto' => $limpio['texto'],
                'fuente' => $limpio['fuente'],
                'url' => $limpio['url'],
                'editada' => $ahora,
            ]);
        } elseif ($entradaId !== null && $entradaId !== '' && isset($capa['entradas'][$entradaId])) {
            $capa['entradas'][$entradaId] = array_merge($capa['entradas'][$entradaId], $limpio, ['editada' => $ahora]);
        } else {
            $entradaId = 'p-' . bin2hex(random_bytes(4));
            $capa['entradas'][$entradaId] = array_merge($limpio, ['activa' => true, 'creada' => $ahora]);
        }

        if (!self::escribir($id, $capa)) {
            return [false, ['_' => 'no se pudo escribir ' . self::ruta($id) . ' (revisa permisos)'], $entradaId];
        }
        return [true, [], $entradaId];
    }

    /** Activa o retira una entrada (de la base o del panel). */
    public static function activar(string $id, string $entradaId, bool $activa): bool
    {
        $capa = self::capa($id);
        if (self::esBase($id, $entradaId)) {
            $capa['base'][$entradaId]['activa'] = $activa;
        } elseif (isset($capa['entradas'][$entradaId])) {
            $capa['entradas'][$entradaId]['activa'] = $activa;
        } else {
            return false;
        }
        return self::escribir($id, $capa);
    }

    /**
     * Borra una entrada del panel, o devuelve una del catálogo a su estado
     * original. Las del catálogo no se pueden borrar: están en git.
     */
    public static function borrar(string $id, string $entradaId): bool
    {
        $capa = self::capa($id);
        if (self::esBase($id, $entradaId)) {
            unset($capa['base'][$entradaId]);
        } elseif (isset($capa['entradas'][$entradaId])) {
            unset($capa['entradas'][$entradaId]);
        } else {
            return false;
        }
        return self::escribir($id, $capa);
    }

    /** Una entrada concreta (activa o no), o null. */
    public static function entrada(string $id, string $entradaId): ?array
    {
        foreach (self::entradas($id, false) as $e) {
            if ($e['id'] === $entradaId) {
                return $e;
            }
        }
        return null;
    }

    private static function esBase(string $id, string $entradaId): bool
    {
        $cuerpo = Catalogo::cuerpo($id);
        if ($cuerpo === null) {
            return false;
        }
        foreach (self::base($cuerpo, '') as $e) {
            if ($e['id'] === $entradaId) {
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------------------
    // Almacén
    // ------------------------------------------------------------------------

    public static function ruta(string $id): string
    {
        // El id se valida SIEMPRE antes de formar la ruta: es lo que impide
        // salirse de la carpeta aunque algún día llegue del cliente.
        if (preg_match('/^[a-z0-9-]{1,40}$/', $id) !== 1) {
            throw new InvalidArgumentException('Identificador de cuerpo inválido.');
        }
        return Config::contenido(self::CARPETA . '/' . $id . '.json');
    }

    /** @return array{entradas:array,base:array} */
    private static function capa(string $id): array
    {
        if (isset(self::$capas[$id])) {
            return self::$capas[$id];
        }
        $vacia = ['entradas' => [], 'base' => []];
        $ruta = self::ruta($id);
        $d = is_readable($ruta) ? json_decode((string) file_get_contents($ruta), true) : null;
        if (!is_array($d)) {
            return self::$capas[$id] = $vacia;
        }
        return self::$capas[$id] = [
            'entradas' => is_array($d['entradas'] ?? null) ? $d['entradas'] : [],
            'base' => is_array($d['base'] ?? null) ? $d['base'] : [],
        ];
    }

    /** Escritura atómica: temporal y renombrado, como los ajustes. */
    private static function escribir(string $id, array $capa): bool
    {
        $ruta = self::ruta($id);
        $dir = dirname($ruta);
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            return false;
        }
        $temporal = $ruta . '.' . bin2hex(random_bytes(4)) . '.tmp';
        $json = json_encode(
            ['cuerpo' => $id, 'actualizado' => gmdate('c')] + $capa,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );
        if (@file_put_contents($temporal, $json, LOCK_EX) === false || !@rename($temporal, $ruta)) {
            @unlink($temporal);
            return false;
        }
        self::$capas[$id] = $capa;
        return true;
    }

    /** Para las pruebas: olvida lo leído. */
    public static function olvidar(): void
    {
        self::$capas = [];
    }
}
