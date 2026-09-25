<?php
/**
 * Conversacion — el asistente de verdad: se le pregunta cualquier cosa y responde.
 *
 * QUÉ CAMBIA RESPECTO A LO ANTERIOR
 * ─────────────────────────────────
 * Hasta ahora «preguntar» era emparejar la frase con uno de veinte patrones
 * escritos a mano. Funcionaba para las veinte preguntas previstas y para nada
 * más: «¿cuál es más grande, Marte o Mercurio?» o «¿por qué Venus está tan
 * caliente?» no tenían respuesta porque nadie las había previsto. Aquí no hay
 * lista de preguntas: hay un modelo que entiende lo que se le dice.
 *
 * EL PROBLEMA QUE ESO CREA, Y CÓMO SE RESUELVE
 * ────────────────────────────────────────────
 * Un modelo de lenguaje sabe de astronomía y respondería sin ayuda. Pero
 * respondería DE MEMORIA, y una cifra recordada es exactamente lo que el pliego
 * prohíbe: un dato sin fuente que además puede estar mal. La regla 4 no admite
 * excepciones por muy convincente que suene la respuesta.
 *
 * Así que el modelo aquí no aporta datos: aporta comprensión. Los datos los
 * saca llamando a las herramientas de abajo, que leen el mismo catálogo, la
 * misma API de Horizons y el mismo calendario de meteoros que usa el resto de
 * la aplicación. El sistema le prohíbe expresamente afirmar cualquier cifra que
 * no venga de una de ellas, y le obliga a decir «no lo tengo» cuando el
 * catálogo trae null. Lo que el modelo pone es el idioma, el hilo de la
 * conversación y saber qué herramienta hace falta; lo que dice sale del mismo
 * sitio de siempre.
 *
 * TAMBIÉN MUEVE LA ESCENA
 * ───────────────────────
 * `mostrar` y `vista_general` no devuelven datos: devuelven una acción que el
 * navegador ejecuta. Por eso «llévame a Encélado y cuéntame por qué interesa»
 * hace las dos cosas en una sola frase. La escena es parte de la respuesta, no
 * un mando aparte.
 *
 * SIN CLAVE, NO PASA NADA MALO
 * ────────────────────────────
 * Si no hay clave de API configurada, esto devuelve null y quien llama recurre
 * al reconocedor de patrones de siempre, que sigue entero. La aplicación no se
 * queda sin asistente: se queda con el de antes.
 *
 * Requiere PHP 8.1 por el SDK oficial de Anthropic, vendorizado en api/vendor.
 */

declare(strict_types=1);

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Catalogo.php';
require_once __DIR__ . '/Conocimiento.php';
require_once __DIR__ . '/Respuestas.php';
require_once __DIR__ . '/Horizons.php';
require_once __DIR__ . '/Meteoros.php';

final class Conversacion
{
    /** El modelo. Se puede cambiar sin tocar el código con ORBIS_MODELO. */
    const MODELO = 'claude-opus-5';

    /**
     * Cuántos turnos anteriores se envían.
     *
     * Bastante para que «¿y su masa?» se entienda, poco para que una sesión
     * larga no acabe mandando media conversación en cada pregunta. Cada turno
     * que viaja se paga, y el hilo útil de una charla hablada es corto.
     */
    const TURNOS_MEMORIA = 12;

    /** Tope de caracteres por mensaje del usuario. */
    const MAX_CARACTERES = 500;

    /** Vueltas máximas del bucle de herramientas antes de cortar. */
    const MAX_VUELTAS = 6;

    /** @return bool ¿hay clave configurada? */
    public static function disponible(): bool
    {
        return self::clave() !== null && is_readable(self::rutaAutoload());
    }

    private static function clave(): ?string
    {
        $clave = Config::obtener('ANTHROPIC_API_KEY');
        return is_string($clave) && trim($clave) !== '' ? trim($clave) : null;
    }

    private static function rutaAutoload(): string
    {
        return Config::includes('vendor/autoload.php');
    }

    /**
     * Responde a una conversación.
     *
     * @param array $mensajes  [['rol' => 'usuario'|'asistente', 'texto' => …], …]
     * @param string|null $cuerpoActivo  qué se está mirando, para los «y este»
     * @param string|null $nombre        cómo se llama quien pregunta
     * @return array|null ['texto','acciones','fuentes','herramientas'] o null
     */
    public static function responder(array $mensajes, ?string $cuerpoActivo = null, ?string $nombre = null): ?array
    {
        if (!self::disponible()) {
            return null;
        }
        require_once self::rutaAutoload();

        $historial = self::historial($mensajes);
        if ($historial === []) {
            return null;
        }

        $cliente = new Anthropic\Client(apiKey: self::clave());
        $acciones = [];
        $fuentes = [];
        $usadas = [];

        $peticion = [
            'model' => Config::obtener('ORBIS_MODELO', self::MODELO),
            'maxTokens' => 2000,
            'system' => self::sistema($cuerpoActivo, $nombre),
            'tools' => self::herramientas(),
            'messages' => $historial,
            // Es una conversación hablada: se responde rápido y corto. El
            // esfuerzo alto no mejora una respuesta de tres frases sobre datos
            // que ya vienen dados, y sí alarga el silencio antes de oírla.
            'outputConfig' => ['effort' => 'low'],
        ];

        $respuesta = $cliente->messages->create(...$peticion);

        for ($vuelta = 0; $vuelta < self::MAX_VUELTAS; $vuelta++) {
            if ($respuesta->stopReason !== 'tool_use') {
                break;
            }

            $resultados = [];
            foreach ($respuesta->content as $bloque) {
                if (($bloque->type ?? '') !== 'tool_use') {
                    continue;
                }
                $ejecutada = self::ejecutar((string) $bloque->name, (array) $bloque->input);
                $usadas[] = (string) $bloque->name;

                foreach ($ejecutada['acciones'] as $accion) {
                    $acciones[] = $accion;
                }
                foreach ($ejecutada['fuentes'] as $fuente) {
                    if ($fuente !== '' && !in_array($fuente, $fuentes, true)) {
                        $fuentes[] = $fuente;
                    }
                }

                $resultados[] = [
                    'type' => 'tool_result',
                    'toolUseID' => $bloque->id,
                    'content' => json_encode($ejecutada['datos'], JSON_UNESCAPED_UNICODE),
                ];
            }

            if ($resultados === []) {
                break;
            }

            $historial[] = ['role' => 'assistant', 'content' => $respuesta->content];
            $historial[] = ['role' => 'user', 'content' => $resultados];
            $peticion['messages'] = $historial;

            $respuesta = $cliente->messages->create(...$peticion);
        }

        $texto = '';
        foreach ($respuesta->content as $bloque) {
            if (($bloque->type ?? '') === 'text') {
                $texto .= $bloque->text;
            }
        }
        $texto = trim($texto);
        if ($texto === '') {
            return null;
        }

        return [
            'texto' => $texto,
            'acciones' => $acciones,
            'fuentes' => $fuentes,
            'herramientas' => array_values(array_unique($usadas)),
        ];
    }

    /**
     * Convierte el historial del cliente en el formato de la API.
     *
     * Se recorta a los últimos turnos y se descarta cualquier cosa que no sea
     * un turno con rol conocido y texto: el cliente puede mandar lo que quiera
     * y aquí solo entra lo que tiene forma de conversación.
     */
    private static function historial(array $mensajes): array
    {
        $limpios = [];
        foreach ($mensajes as $m) {
            $rol = is_array($m) ? (string) ($m['rol'] ?? '') : '';
            $texto = is_array($m) ? trim((string) ($m['texto'] ?? '')) : '';
            if ($texto === '' || !in_array($rol, ['usuario', 'asistente'], true)) {
                continue;
            }
            $limpios[] = [
                'role' => $rol === 'usuario' ? 'user' : 'assistant',
                'content' => mb_substr($texto, 0, self::MAX_CARACTERES),
            ];
        }

        $limpios = array_slice($limpios, -self::TURNOS_MEMORIA);

        // La API exige que el primero sea del usuario y que los roles alternen.
        while ($limpios !== [] && $limpios[0]['role'] !== 'user') {
            array_shift($limpios);
        }
        return $limpios;
    }

    /**
     * Las instrucciones. Aquí es donde se sostiene la regla 4.
     *
     * El tono importa —esto se oye en voz alta, no se lee— pero lo que no se
     * negocia es la prohibición de aportar cifras de memoria. Un modelo sabe
     * cuánto pesa Júpiter; el problema es que a veces se equivoca y siempre lo
     * dice con la misma seguridad, y aquí una cifra sin fuente es una mentira
     * aunque acierte.
     */
    private static function sistema(?string $cuerpoActivo, ?string $nombre): string
    {
        $activo = 'ninguno; está en la vista general';
        if ($cuerpoActivo !== null) {
            $cuerpo = Catalogo::cuerpo($cuerpoActivo);
            if ($cuerpo !== null) {
                $activo = sprintf('%s (identificador «%s»)', (string) $cuerpo['nombre'], $cuerpoActivo);
            }
        }

        $partes = [];
        // Te llamas Ñaño y ORBIS es lo que presentas, no lo que eres. El saludo
        // inicial ya lo dice —«Soy Ñaño y te presento a ORBIS», en
        // wj-content/data/asistente.json— y si aquí siguiera poniendo «eres
        // ORBIS», a la primera pregunta de «¿tú quién eres?» se contradiría.
        $partes[] = 'Te llamas Ñaño y acompañas a quien visita ORBIS, una interfaz '
            . 'tridimensional del Sistema Solar. ORBIS es la interfaz; tú eres quien la '
            . 'presenta y la va contando. Hablas en español y te oyen en voz alta.';

        $partes[] = "REGLA QUE NO PUEDES SALTARTE NUNCA:\n"
            . "No afirmes NINGUNA cifra, medida, fecha ni dato astronómico que no te haya devuelto una de tus herramientas en esta misma conversación. "
            . "Sabes mucha astronomía de memoria y aquí eso no vale: la memoria no tiene fuente y a veces se equivoca. "
            . "Si te preguntan un dato, llama a la herramienta. "
            . "Si la herramienta devuelve null o dice que no hay dato, di que no lo tienes y que prefieres no inventarlo. "
            . "No lo rellenes con lo que recuerdes ni con una estimación.\n"
            . "Sí puedes explicar con tus palabras POR QUÉ ocurre algo, siempre que la explicación no dependa de cifras que no te hayan dado. "
            . "Distinguir eso es tu trabajo: «Venus está más caliente que Mercurio por el efecto invernadero de su atmósfera» es explicar; "
            . "«Venus está a 464 grados» es un dato y necesita herramienta.";

        $partes[] = "CÓMO HABLAS:\n"
            . "Dos o tres frases. Esto se escucha, y un párrafo hablado se hace eterno. "
            . "Nada de listas ni de markdown: se leen en voz alta y suenan fatal. "
            . "Di las cifras como las diría una persona: «unos mil trescientos millones de kilómetros», no la cifra con todos sus dígitos. "
            . "Si has usado un dato del catálogo, menciona de dónde sale una sola vez y de pasada; no repitas la fuente en cada frase.";

        $partes[] = "MOVER LA ESCENA:\n"
            . "Cuando te pidan ver algo, o cuando lo que cuentas se entienda mejor mirándolo, usa «mostrar» y sigue hablando. "
            . "No anuncies que vas a moverte ni describas el movimiento: quien pregunta lo está viendo. "
            . "Si te piden algo que no está en el catálogo —una estrella lejana, una galaxia, un exoplaneta— dilo claramente: "
            . "esta interfaz solo tiene los cuerpos del Sistema Solar que salen de «listar_cuerpos».";

        $partes[] = 'Ahora mismo se está mirando: ' . $activo . '.';
        $partes[] = 'Fecha de hoy: ' . gmdate('Y-m-d') . '.';

        if ($nombre !== null && $nombre !== '') {
            $partes[] = 'Quien pregunta se llama ' . $nombre . '. Puedes llamarle por su nombre de vez en cuando, sin abusar.';
        }

        return implode("\n\n", $partes);
    }

    /** Las herramientas. Todas leen los mismos datos que el resto de ORBIS. */
    private static function herramientas(): array
    {
        return [
            [
                'name' => 'listar_cuerpos',
                'description' => 'Devuelve TODOS los cuerpos que existen en esta interfaz, con su identificador, '
                    . 'nombre, tipo y de quién dependen. Úsala cuando no sepas si algo está en el catálogo o '
                    . 'necesites el identificador exacto de un cuerpo para las demás herramientas.',
                'inputSchema' => ['type' => 'object', 'properties' => (object) [], 'required' => []],
            ],
            [
                'name' => 'datos_del_cuerpo',
                'description' => 'Todo lo que el catálogo sabe de un cuerpo: tamaño, masa, gravedad, densidad, '
                    . 'temperatura, atmósfera, geología, magnetosfera, órbita, satélites, curiosidades y la fuente. '
                    . 'Los campos con null son datos que NO se tienen: dilo, no los rellenes.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => ['type' => 'string', 'description' => 'Identificador del cuerpo, por ejemplo «marte» o «encelado».'],
                    ],
                    'required' => ['id'],
                ],
            ],
            [
                'name' => 'conocimiento_del_cuerpo',
                'description' => 'Los datos de divulgación publicados sobre un cuerpo, cada uno con SU fuente: hechos '
                    . 'sobre su historia, su superficie, su exploración, comparaciones y curiosidades que no son '
                    . 'cifras del catálogo. Úsala cuando pregunten «qué tiene de especial», «cuéntame algo» o algo '
                    . 'que datos_del_cuerpo no responde. Si cuentas uno, di de dónde sale.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => ['type' => 'string', 'description' => 'Identificador del cuerpo.'],
                    ],
                    'required' => ['id'],
                ],
            ],
            [
                'name' => 'posicion_hoy',
                'description' => 'Dónde está un cuerpo HOY según JPL Horizons: distancia real a la Tierra, si se '
                    . 'acerca o se aleja, y sus coordenadas en el cielo. Es lo único que no está en el catálogo '
                    . 'porque cambia cada día. No sirve para la Tierra, que es el punto desde el que se mide.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => ['type' => 'string', 'description' => 'Identificador del cuerpo.'],
                    ],
                    'required' => ['id'],
                ],
            ],
            [
                'name' => 'lluvia_de_meteoros',
                'description' => 'Qué lluvia de meteoros está activa hoy, con sus fechas, su tasa, de qué cometa '
                    . 'proceden sus restos y su radiante.',
                'inputSchema' => ['type' => 'object', 'properties' => (object) [], 'required' => []],
            ],
            [
                'name' => 'mostrar',
                'description' => 'Lleva la cámara hasta un cuerpo y lo pone en pantalla. Úsala cuando te pidan ver '
                    . 'algo o cuando lo que cuentas se entienda mejor mirándolo.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => ['type' => 'string', 'description' => 'Identificador del cuerpo que hay que mostrar.'],
                    ],
                    'required' => ['id'],
                ],
            ],
            [
                'name' => 'vista_general',
                'description' => 'Aleja la cámara hasta ver el Sistema Solar entero. Úsala cuando pidan volver, '
                    . 'salir, o ver el conjunto.',
                'inputSchema' => ['type' => 'object', 'properties' => (object) [], 'required' => []],
            ],
        ];
    }

    /**
     * Ejecuta una herramienta.
     *
     * @return array ['datos' => mixed, 'acciones' => array, 'fuentes' => string[]]
     */
    private static function ejecutar(string $nombre, array $entrada): array
    {
        $vacio = ['datos' => null, 'acciones' => [], 'fuentes' => []];
        $id = isset($entrada['id']) ? (string) $entrada['id'] : '';

        switch ($nombre) {
            case 'listar_cuerpos':
                $lista = [];
                foreach (Catalogo::identificadores() as $cid) {
                    $c = Catalogo::cuerpo($cid);
                    $lista[] = [
                        'id' => $cid,
                        'nombre' => $c['nombre'] ?? $cid,
                        'tipo' => $c['tipo'] ?? null,
                        'orbita_a' => $c['padre'] ?? null,
                    ];
                }
                return ['datos' => $lista, 'acciones' => [], 'fuentes' => []];

            case 'datos_del_cuerpo': {
                $c = Catalogo::cuerpo($id);
                if ($c === null) {
                    return ['datos' => ['error' => 'No existe ningún cuerpo con ese identificador en el catálogo.'],
                            'acciones' => [], 'fuentes' => []];
                }
                // Se quita lo que solo sirve para dibujar: texturas, colores y
                // escalas de la escena no son datos y solo gastarían contexto.
                unset($c['render'], $c['texturas'], $c['anotaciones'], $c['narraciones']);
                return [
                    'datos' => $c,
                    'acciones' => [],
                    'fuentes' => [(string) ($c['fuente'] ?? '')],
                ];
            }

            case 'conocimiento_del_cuerpo': {
                if (Catalogo::cuerpo($id) === null) {
                    return ['datos' => ['error' => 'No existe ningún cuerpo con ese identificador en el catálogo.'],
                            'acciones' => [], 'fuentes' => []];
                }
                // Solo los datos: las narraciones son relatos largos que ya se
                // oyen al visitar el cuerpo, y mandarlas gastaría contexto para
                // que el asistente acabara repitiéndolas.
                $datos = [];
                $fuentes = [];
                foreach (Conocimiento::datos($id) as $d) {
                    $datos[] = ['tema' => $d['tema'], 'texto' => $d['texto'], 'fuente' => $d['fuente']];
                    $fuentes[] = $d['fuente'];
                }
                return [
                    'datos' => $datos === [] ? ['nota' => 'No hay datos publicados para este cuerpo.'] : $datos,
                    'acciones' => [],
                    'fuentes' => array_values(array_unique($fuentes)),
                ];
            }

            case 'posicion_hoy': {
                $e = Horizons::efemerides($id);
                if ($e === null) {
                    return ['datos' => ['error' => 'No se ha podido consultar la posición. Puede que sea la Tierra, '
                        . 'que es el origen de coordenadas, o que no haya conexión con JPL Horizons.'],
                        'acciones' => [], 'fuentes' => []];
                }
                return ['datos' => $e, 'acciones' => [], 'fuentes' => [(string) $e['fuente']]];
            }

            case 'lluvia_de_meteoros': {
                $r = Meteoros::relato((int) gmdate('n'), (int) gmdate('j'));
                return ['datos' => $r, 'acciones' => [], 'fuentes' => [(string) ($r['fuente'] ?? '')]];
            }

            case 'mostrar': {
                $c = Catalogo::cuerpo($id);
                if ($c === null) {
                    return ['datos' => ['error' => 'Ese cuerpo no está en la interfaz, así que no se puede mostrar.'],
                            'acciones' => [], 'fuentes' => []];
                }
                return [
                    'datos' => ['mostrado' => $c['nombre'] ?? $id],
                    'acciones' => [['tipo' => 'mostrar', 'cuerpo' => $id]],
                    'fuentes' => [],
                ];
            }

            case 'vista_general':
                return [
                    'datos' => ['hecho' => true],
                    'acciones' => [['tipo' => 'vista_general']],
                    'fuentes' => [],
                ];
        }

        return $vacio;
    }
}
