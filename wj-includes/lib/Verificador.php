<?php
/**
 * ORBIS — Verificación de las APIs desde el panel.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  POR QUÉ NO BASTA CON QUE LA CLAVE ESTÉ PUESTA
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Porque todas las averías de este proyecto con las APIs han sido de las que
 * no se ven desde el formulario:
 *
 *   · una clave de ElevenLabs que leía la lista de voces pero NO tenía permiso
 *     para sintetizar: todo verde, y la narración con la voz del navegador;
 *   · una voz que existía y era un personaje de dibujos animados en inglés;
 *   · un modelo de Anthropic escrito con un punto donde van guiones, que no da
 *     error hasta que alguien pregunta algo.
 *
 * Cada comprobación de aquí hace la petición de verdad, la más barata que
 * responde a esa pregunta concreta, y dice el MOTIVO que da el servicio cuando
 * falla. Cuando hace falta sintetizar para saberlo, se sintetiza una frase
 * corta y se deja en la caché, de modo que el reproductor del panel la sirve
 * al instante y la narración real no vuelve a pagarla.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  EL RESULTADO SE RECUERDA
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El último resultado de cada servicio se guarda junto a los ajustes (fuera de
 * lo que se sirve por HTTP) para que la pestaña de inicio pueda decir «ElevenLabs
 * verificado hace dos horas: correcto» sin volver a gastar una petición.
 *
 * Sintaxis compatible con PHP 7.4.
 */

declare(strict_types=1);

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Ajustes.php';
require_once __DIR__ . '/ElevenLabs.php';
require_once __DIR__ . '/Cache.php';
require_once __DIR__ . '/RateLimiter.php';

final class Verificador
{
    /** Servicios que se pueden verificar, con su nombre para la interfaz. */
    const SERVICIOS = [
        'elevenlabs' => 'ElevenLabs',
        'gemini'     => 'Google AI Studio (Gemini)',
        'anthropic'  => 'Anthropic (Claude)',
        'analitica'  => 'Google Analytics',
    ];

    const ARCHIVO = 'ajustes/verificaciones.json';

    /** @var list<array{clave:string,etiqueta:string,resultado:string,nota:string}> */
    private $comprobaciones = [];

    private function anotar(string $clave, string $etiqueta, string $resultado, string $nota): void
    {
        $this->comprobaciones[] = compact('clave', 'etiqueta', 'resultado', 'nota');
    }

    /**
     * Verifica un servicio y guarda el resultado.
     *
     * @return array{servicio:string,fecha:string,estado:string,comprobaciones:list<array>}
     */
    public static function ejecutar(string $servicio): array
    {
        $v = new self();
        switch ($servicio) {
            case 'elevenlabs':
                $v->elevenlabs();
                break;
            case 'anthropic':
                $v->anthropic();
                break;
            case 'gemini':
                require_once __DIR__ . '/Gemini.php';
                Gemini::verificar(function (string $c, string $e, string $r, string $n) use ($v): void {
                    $v->anotar($c, $e, $r, $n);
                });
                break;
            case 'analitica':
                require_once __DIR__ . '/Analitica.php';
                Analitica::verificar(function (string $c, string $e, string $r, string $n) use ($v): void {
                    $v->anotar($c, $e, $r, $n);
                });
                break;
            default:
                $v->anotar('servicio', 'servicio', 'error', 'No hay verificación para «' . $servicio . '».');
        }

        $resultado = [
            'servicio' => $servicio,
            'fecha' => gmdate('c'),
            'estado' => self::estadoDe($v->comprobaciones),
            'comprobaciones' => $v->comprobaciones,
        ];
        self::guardarUltima($servicio, $resultado);
        return $resultado;
    }

    /** 'error' si algo falla, 'aviso' si algo avisa, 'ok' si todo va. */
    public static function estadoDe(array $comprobaciones): string
    {
        $estado = 'ok';
        foreach ($comprobaciones as $c) {
            if ($c['resultado'] === 'error') {
                return 'error';
            }
            if ($c['resultado'] === 'aviso') {
                $estado = 'aviso';
            }
        }
        return $comprobaciones === [] ? 'aviso' : $estado;
    }

    // ------------------------------------------------------------------------
    // ElevenLabs
    // ------------------------------------------------------------------------

    private function elevenlabs(): void
    {
        $clave = ElevenLabs::clave();
        if ($clave === null) {
            $this->anotar('clave', 'clave', 'error', 'No hay clave de ElevenLabs. Sin ella se narra con la voz del navegador.');
            return;
        }
        $this->anotar('clave', 'clave', 'ok', 'Configurada (origen: ' . (Config::origen('ELEVENLABS_API_KEY') ?? '—') . ').');

        // 1. ¿Vale la clave? El catálogo de modelos es la petición más barata
        //    que la exige, y no pide ningún permiso concreto.
        $r = ElevenLabs::peticion('GET', '/models', null, 15);
        if ($r['codigo'] === 0) {
            $this->anotar('conexion', 'conexión', 'error', 'El servidor no llega a api.elevenlabs.io (sin salida a Internet o bloqueada).');
            return;
        }
        if ($r['codigo'] !== 200) {
            $m = ElevenLabs::motivo($r['cuerpo']);
            $this->anotar(
                'conexion', 'la clave vale', 'error',
                'ElevenLabs rechaza la clave con un HTTP ' . $r['codigo']
                    . ($m['estado'] . $m['mensaje'] !== '' ? ': ' . trim($m['estado'] . ' ' . $m['mensaje']) : '')
                    . '. Si es «invalid_api_key», genera otra en elevenlabs.io → Profile → API Keys.'
            );
            return;
        }
        $modelos = json_decode($r['cuerpo'], true);
        $modelo = ElevenLabs::modeloConfigurado();
        $existeModelo = false;
        foreach (is_array($modelos) ? $modelos : [] as $mod) {
            if (($mod['model_id'] ?? '') === $modelo) {
                $existeModelo = true;
                break;
            }
        }
        $this->anotar('conexion', 'la clave vale', 'ok', 'ElevenLabs acepta la clave.');
        $this->anotar(
            'modelo', 'modelo de síntesis',
            $existeModelo ? 'ok' : 'error',
            $existeModelo
                ? $modelo . ' existe.'
                : 'ElevenLabs no ofrece ningún modelo «' . $modelo . '». Vuelve a eleven_multilingual_v2.'
        );

        // 2. Cuánto queda del mes. No es imprescindible —hay claves sin permiso
        //    para leer la cuenta y narran perfectamente—, así que si falta el
        //    permiso es un aviso, no un error.
        $s = ElevenLabs::peticion('GET', '/user/subscription', null, 15);
        if ($s['codigo'] === 200) {
            $d = json_decode($s['cuerpo'], true);
            $usados = (int) ($d['character_count'] ?? 0);
            $limite = (int) ($d['character_limit'] ?? 0);
            $quedan = max(0, $limite - $usados);
            $nivel = (string) ($d['tier'] ?? '—');
            $this->anotar(
                'cuenta', 'saldo del mes',
                $limite > 0 && $quedan < 2000 ? 'aviso' : 'ok',
                sprintf(
                    'Plan «%s»: %s de %s caracteres usados; quedan %s. Una narración ronda los 1.200.',
                    $nivel,
                    number_format($usados, 0, ',', '.'),
                    number_format($limite, 0, ',', '.'),
                    number_format($quedan, 0, ',', '.')
                )
            );
        } else {
            $m = ElevenLabs::motivo($s['cuerpo']);
            $this->anotar(
                'cuenta', 'saldo del mes', 'aviso',
                ElevenLabs::esFaltaDePermiso($s['codigo'], $m)
                    ? 'La clave no tiene permiso para leer la cuenta («user_read»). No afecta a la narración; '
                        . 'solo impide ver aquí el saldo.'
                    : 'No se ha podido leer el saldo (HTTP ' . $s['codigo'] . ').'
            );
        }

        // 3. La voz: que exista EN ESTA CUENTA y qué es de verdad.
        $voz = ElevenLabs::vozConfigurada();
        $v = ElevenLabs::peticion('GET', '/voices/' . rawurlencode($voz), null, 15);
        if ($v['codigo'] === 200) {
            $d = json_decode($v['cuerpo'], true);
            $etq = is_array($d['labels'] ?? null) ? $d['labels'] : [];
            $idioma = (string) ($etq['language'] ?? '');
            $uso = (string) ($etq['use_case'] ?? '');
            $noEsNarracion = in_array($uso, ['characters_animation', 'social_media', 'advertisement'], true);
            $this->anotar(
                'voz', 'voz de la narración',
                ($idioma !== '' && $idioma !== 'es') || $noEsNarracion ? 'aviso' : 'ok',
                sprintf(
                    '«%s» (%s)%s%s.',
                    (string) ($d['name'] ?? $voz),
                    $voz,
                    $idioma !== '' ? ' · idioma ' . $idioma : '',
                    $uso !== '' ? ' · uso ' . $uso : ''
                ) . ($noEsNarracion ? ' No está pensada para narrar divulgación.' : '')
                  . ($idioma !== '' && $idioma !== 'es' ? ' No está declarada en español: hablará con otro acento.' : '')
            );
        } elseif ($v['codigo'] === 404) {
            $this->anotar('voz', 'voz de la narración', 'error', 'La voz ' . $voz . ' no existe en esta cuenta de ElevenLabs.');
        } else {
            $m = ElevenLabs::motivo($v['cuerpo']);
            $this->anotar(
                'voz', 'voz de la narración', 'aviso',
                ElevenLabs::esFaltaDePermiso($v['codigo'], $m)
                    ? 'La clave no puede leer las voces («voices_read»); se comprueba sintetizando.'
                    : 'No se ha podido consultar la voz (HTTP ' . $v['codigo'] . ').'
            );
        }

        // 4. La única prueba que de verdad importa: sintetizar. Es la que falló
        //    en producción con todo lo demás en verde. Se usa la frase del
        //    probador y la caché de siempre: si sale bien, el reproductor del
        //    panel la sirve sin volver a pagarla.
        $cache = new Cache();
        $claveCache = $cache->clave(ElevenLabs::FRASE_PRUEBA, $voz, $modelo);
        if ($cache->existe($claveCache)) {
            $this->anotar('sintesis', 'síntesis de voz', 'ok', 'Ya sintetizó esta voz con este modelo: el audio está en la caché y se oye abajo.');
            return;
        }

        $limitador = new RateLimiter(20, 3600, 'pruebavoz', 60);
        if (!$limitador->consumir()['permitido']) {
            $this->anotar('sintesis', 'síntesis de voz', 'aviso', 'No se prueba ahora: demasiadas pruebas en la última hora.');
            return;
        }

        $inicio = microtime(true);
        $sintesis = ElevenLabs::sintetizar(ElevenLabs::FRASE_PRUEBA, $voz, $modelo, 40);
        $segundos = microtime(true) - $inicio;

        if ($sintesis['ok']) {
            $cache->guardar($claveCache, $sintesis['audio']);
            $this->anotar(
                'sintesis', 'síntesis de voz', 'ok',
                sprintf('Sintetiza: %s kB de audio en %.1f s. Escúchalo abajo.', number_format(strlen($sintesis['audio']) / 1024, 0, ',', '.'), $segundos)
            );
            return;
        }

        $remedios = [
            'clave_sin_permiso' => 'La clave NO tiene el permiso «text_to_speech». Es el fallo que hace que todo parezca '
                . 'bien y se oiga la voz del navegador. En elevenlabs.io → API Keys, edita la clave y activa '
                . '«Text to Speech», o crea otra que lo tenga.',
            'clave_invalida'    => 'La clave no vale para sintetizar.',
            'voz_desconocida'   => 'La voz configurada no existe en esta cuenta.',
            'sin_conexion'      => 'No hubo respuesta de ElevenLabs a tiempo.',
            'error_sintesis'    => 'ElevenLabs devolvió un error al sintetizar.',
        ];
        $this->anotar(
            'sintesis', 'síntesis de voz', 'error',
            ($remedios[$sintesis['error']] ?? $remedios['error_sintesis'])
                . ($sintesis['detalle'] !== '' ? ' (HTTP ' . $sintesis['codigo'] . ': ' . $sintesis['detalle'] . ')' : '')
        );
    }

    // ------------------------------------------------------------------------
    // Anthropic
    // ------------------------------------------------------------------------

    private function anthropic(): void
    {
        $clave = Config::obtener('ANTHROPIC_API_KEY');
        if ($clave === null || trim($clave) === '') {
            $this->anotar('clave', 'clave', 'aviso', 'Sin clave de Anthropic. El asistente usará Gemini si está configurado.');
            return;
        }
        $this->anotar('clave', 'clave', 'ok', 'Configurada (origen: ' . (Config::origen('ANTHROPIC_API_KEY') ?? '—') . ').');

        $sdk = is_readable(Config::includes('vendor/autoload.php'));
        $this->anotar(
            'sdk', 'SDK en el servidor',
            $sdk ? 'ok' : 'error',
            $sdk ? 'wj-includes/vendor presente.' : 'Falta wj-includes/vendor: ¿se subió la carpeta completa?'
        );

        require_once __DIR__ . '/Conversacion.php';
        $modelo = (string) Config::obtener('ORBIS_MODELO', Conversacion::MODELO);

        // El catálogo de modelos responde a las dos preguntas a la vez —¿vale la
        // clave? ¿existe ese modelo?— sin gastar un solo token.
        $ch = curl_init('https://api.anthropic.com/v1/models/' . rawurlencode($modelo));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER     => ['x-api-key: ' . trim($clave), 'anthropic-version: 2023-06-01'],
        ]);
        $cuerpo = curl_exec($ch);
        $codigo = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($codigo === 200) {
            $m = json_decode((string) $cuerpo, true);
            $this->anotar('modelo', 'modelo del asistente', 'ok', 'Confirmado con Anthropic: ' . (string) ($m['display_name'] ?? $modelo) . '.');
        } elseif ($codigo === 404) {
            $this->anotar(
                'modelo', 'modelo del asistente', 'error',
                'Anthropic no conoce ningún modelo «' . $modelo . '». Los identificadores llevan guiones y no '
                    . 'puntos (claude-sonnet-4-6, no claude-sonnet-4.6).'
            );
        } elseif ($codigo === 401) {
            $this->anotar('modelo', 'la clave vale', 'error', 'Anthropic rechaza la clave (HTTP 401).');
        } elseif ($codigo === 0) {
            $this->anotar('modelo', 'conexión', 'error', 'El servidor no llega a api.anthropic.com.');
        } else {
            $this->anotar('modelo', 'modelo del asistente', 'aviso', 'No se ha podido comprobar (HTTP ' . $codigo . ').');
        }
    }

    // ------------------------------------------------------------------------
    // Memoria del último resultado
    // ------------------------------------------------------------------------

    private static function ruta(): string
    {
        return Config::contenido(self::ARCHIVO);
    }

    /** @return array<string,array> por servicio */
    public static function ultimas(): array
    {
        $ruta = self::ruta();
        $d = is_readable($ruta) ? json_decode((string) file_get_contents($ruta), true) : null;
        return is_array($d) ? $d : [];
    }

    private static function guardarUltima(string $servicio, array $resultado): void
    {
        if (!isset(self::SERVICIOS[$servicio])) {
            return;
        }
        $todas = self::ultimas();
        $todas[$servicio] = $resultado;
        $ruta = self::ruta();
        $temporal = $ruta . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($temporal, json_encode($todas, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false) {
            @rename($temporal, $ruta);
        }
        @unlink($temporal);
    }
}
