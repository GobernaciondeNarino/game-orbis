<?php
/**
 * ORBIS — Gemini (Google AI Studio), como herramienta EDITORIAL del panel.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  POR QUÉ SOLO EN EL PANEL Y NUNCA DE CARA AL PÚBLICO
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Los términos del Gemini API (https://ai.google.dev/gemini-api/terms, en
 * vigor desde el 23 de marzo de 2026) dicen, literalmente:
 *
 *   «You must be 18 years of age or older to use the APIs. You also will not
 *    use the Services as part of a website, application, or other service
 *    […] that is directed towards or is likely to be accessed by individuals
 *    under the age of 18.»
 *
 * ORBIS es divulgación para niños —el sitio vive en guaguas.narino.gov.co—.
 * Conectar Gemini al asistente que conversa con los visitantes, o a la voz que
 * los narra, es exactamente lo que esa cláusula prohíbe.
 *
 * Y hay un segundo motivo, igual de serio: en el plan gratuito Google usa lo
 * que se le envía —y lo que responde— para mejorar sus productos, y pueden
 * leerlo personas. Las preguntas de un niño, con el nombre que ha dado al
 * entrar, no pueden acabar ahí.
 *
 * Así que aquí Gemini hace lo que sí encaja: ayudar a quien ADMINISTRA —una
 * persona adulta, desde el panel— a redactar. Propone borradores de narración
 * a partir del conocimiento de cada cuerpo y extrae datos de un texto de
 * fuente. Nada se publica sin que esa persona lo revise en el formulario y lo
 * guarde. Y ni siquiera eso funciona hasta marcar la casilla
 * GEMINI_USO_EDITORIAL, que es declarar que se ha leído todo lo anterior.
 *
 * Si la Gobernación decide otra cosa con sus servicios jurídicos, el sitio
 * donde cambiarlo es este archivo; pero no debería cambiarse sin esa decisión.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  DETALLES DE LA API (septiembre de 2026)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   · generateContent por REST. Google recomienda ya la «Interactions API»,
 *     pero generateContent sigue «fully supported» y es una sola petición sin
 *     estado, mientras que la Interactions API guarda cada intercambio en los
 *     servidores de Google por omisión (store=true: 55 días en el plan de pago,
 *     1 en el gratuito). Para redactar un borrador no hace falta ese estado.
 *   · Cabecera x-goog-api-key. Una clave inválida devuelve 400 con
 *     error.details[].reason = API_KEY_INVALID, no 401.
 *   · Desde septiembre de 2026 las claves «estándar» se rechazan: hay que usar
 *     «auth keys», que es lo que crea hoy AI Studio por omisión.
 *   · Sin `temperature` ni `top_p`: se declararon obsoletos el 21 de julio de
 *     2026 y no se mandan.
 *   · gemini-3.8-flash (GA desde el 2 de septiembre de 2026). Los 2.0 están
 *     apagados; los 2.5 solo para quien ya los usaba.
 *
 * Sintaxis compatible con PHP 7.4.
 */

declare(strict_types=1);

require_once __DIR__ . '/Config.php';

final class Gemini
{
    const BASE = 'https://generativelanguage.googleapis.com/v1beta';

    const MODELO = 'gemini-3.8-flash';

    public static function clave(): ?string
    {
        $c = Config::obtener('GEMINI_API_KEY');
        return is_string($c) && trim($c) !== '' ? trim($c) : null;
    }

    public static function modelo(): string
    {
        return (string) Config::obtener('GEMINI_MODELO', 'gemini-3.8-flash');
    }

    /** ¿Se ha declarado el uso solo editorial? Sin eso, no se usa. */
    public static function usoEditorialAceptado(): bool
    {
        return Config::obtener('GEMINI_USO_EDITORIAL') === '1';
    }

    /** Clave puesta Y uso editorial aceptado. */
    public static function disponible(): bool
    {
        return self::clave() !== null && self::usoEditorialAceptado();
    }

    /**
     * Pide un texto.
     *
     * @return array{ok:bool,texto:string,error:string,detalle:string,codigo:int}
     */
    public static function generar(string $sistema, string $usuario, int $maxTokens = 4096): array
    {
        if (!self::disponible()) {
            return ['ok' => false, 'texto' => '', 'error' => 'no_disponible', 'detalle' => '', 'codigo' => 0];
        }
        $r = self::peticion('POST', '/models/' . rawurlencode(self::modelo()) . ':generateContent', [
            'systemInstruction' => ['parts' => [['text' => $sistema]]],
            'contents' => [['role' => 'user', 'parts' => [['text' => $usuario]]]],
            // El techo incluye lo que el modelo piensa antes de escribir: con
            // uno bajo, una narración de trescientas palabras salía cortada.
            'generationConfig' => ['maxOutputTokens' => $maxTokens],
        ], 60);

        if ($r['codigo'] !== 200) {
            $m = self::motivoError($r['cuerpo']);
            return ['ok' => false, 'texto' => '', 'error' => $m['clase'], 'detalle' => $m['texto'], 'codigo' => $r['codigo']];
        }
        $d = json_decode($r['cuerpo'], true);
        [$texto, $fin] = self::extraerTexto(is_array($d) ? $d : []);
        if ($texto === '') {
            return [
                'ok' => false, 'texto' => '', 'error' => 'sin_texto',
                'detalle' => $fin !== '' ? 'finishReason ' . $fin : 'respuesta vacía', 'codigo' => 200,
            ];
        }
        return ['ok' => true, 'texto' => $texto, 'error' => '', 'detalle' => $fin, 'codigo' => 200];
    }

    /**
     * El texto de una respuesta de generateContent.
     *
     * Se saltan las partes de pensamiento (`thought: true`): son el
     * razonamiento del modelo, no la respuesta. Función pura, para probarla sin
     * red en tools/pruebas-gemini.php.
     *
     * @return array{0:string,1:string} [texto, finishReason]
     */
    public static function extraerTexto(array $respuesta): array
    {
        $candidato = $respuesta['candidates'][0] ?? null;
        if (!is_array($candidato)) {
            return ['', (string) ($respuesta['promptFeedback']['blockReason'] ?? '')];
        }
        $texto = '';
        foreach ((array) ($candidato['content']['parts'] ?? []) as $parte) {
            if (!empty($parte['thought'])) {
                continue;
            }
            if (isset($parte['text']) && is_string($parte['text'])) {
                $texto .= $parte['text'];
            }
        }
        return [trim($texto), (string) ($candidato['finishReason'] ?? '')];
    }

    /**
     * Qué ha fallado, en palabras, a partir del cuerpo del error. Nunca la clave.
     *
     * @return array{clase:string,texto:string}
     */
    public static function motivoError(string $cuerpo): array
    {
        $d = json_decode($cuerpo, true);
        $e = is_array($d) ? ($d['error'] ?? []) : [];
        $estado = (string) ($e['status'] ?? '');
        $mensaje = mb_substr(str_replace(["\n", "\r"], ' ', (string) ($e['message'] ?? '')), 0, 200);
        $razon = '';
        foreach ((array) ($e['details'] ?? []) as $det) {
            if (isset($det['reason'])) {
                $razon = (string) $det['reason'];
                break;
            }
        }

        $clase = 'error';
        if ($razon === 'API_KEY_INVALID' || stripos($mensaje, 'API key not valid') !== false) {
            $clase = 'clave_invalida';
        } elseif (stripos($mensaje, 'standard') !== false && stripos($mensaje, 'key') !== false) {
            $clase = 'clave_estandar';
        } elseif ($estado === 'PERMISSION_DENIED') {
            $clase = 'sin_permiso';
        } elseif ($estado === 'NOT_FOUND') {
            $clase = 'modelo_desconocido';
        } elseif ($estado === 'RESOURCE_EXHAUSTED') {
            $clase = 'cuota_agotada';
        } elseif ($estado === 'FAILED_PRECONDITION') {
            $clase = 'region_o_facturacion';
        }
        return ['clase' => $clase, 'texto' => trim($estado . ($razon !== '' ? ' ' . $razon : '') . ' ' . $mensaje)];
    }

    /** @return array{codigo:int,cuerpo:string,error:string} */
    public static function peticion(string $metodo, string $ruta, ?array $json = null, int $espera = 20): array
    {
        $clave = self::clave();
        if ($clave === null || !extension_loaded('curl')) {
            return ['codigo' => 0, 'cuerpo' => '', 'error' => $clave === null ? 'sin clave' : 'curl no disponible'];
        }
        $ch = curl_init(self::BASE . $ruta);
        $cabeceras = ['x-goog-api-key: ' . $clave, 'Accept: application/json'];
        $opciones = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $espera,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_CUSTOMREQUEST  => $metodo,
        ];
        if ($json !== null) {
            $cabeceras[] = 'Content-Type: application/json';
            $opciones[CURLOPT_POSTFIELDS] = json_encode($json, JSON_UNESCAPED_UNICODE);
        }
        $opciones[CURLOPT_HTTPHEADER] = $cabeceras;
        curl_setopt_array($ch, $opciones);
        $cuerpo = curl_exec($ch);
        $r = [
            'codigo' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE),
            'cuerpo' => is_string($cuerpo) ? $cuerpo : '',
            'error'  => curl_error($ch),
        ];
        curl_close($ch);
        return $r;
    }

    /**
     * Comprobaciones para la pestaña APIs.
     *
     * @param callable(string,string,string,string):void $anotar
     */
    public static function verificar(callable $anotar): void
    {
        if (self::clave() === null) {
            $anotar('clave', 'clave', 'aviso', 'Sin clave de Google AI Studio. Gemini es opcional: solo ayuda a redactar en el panel.');
            return;
        }
        $anotar('clave', 'clave', 'ok', 'Configurada (origen: ' . (Config::origen('GEMINI_API_KEY') ?? '—') . ').');

        $anotar(
            'uso', 'uso editorial declarado',
            self::usoEditorialAceptado() ? 'ok' : 'aviso',
            self::usoEditorialAceptado()
                ? 'Marcado: se usa solo desde el panel.'
                : 'Sin marcar: aunque la clave valga, Gemini no se usará hasta marcar la casilla.'
        );

        // ¿Vale la clave? La lista de modelos, con un solo elemento, no gasta
        // nada y exige una clave válida.
        $r = self::peticion('GET', '/models?pageSize=1', null, 15);
        if ($r['codigo'] === 0) {
            $anotar('conexion', 'conexión', 'error', 'El servidor no llega a generativelanguage.googleapis.com.');
            return;
        }
        if ($r['codigo'] !== 200) {
            $m = self::motivoError($r['cuerpo']);
            $remedio = [
                'clave_invalida' => ' La clave no vale: genera otra en aistudio.google.com.',
                'clave_estandar' => ' Es una clave «estándar», que Google dejó de aceptar en septiembre de 2026. '
                    . 'Crea una nueva en AI Studio: ya nacen como «auth key».',
                'sin_permiso'    => ' La clave no tiene permiso para el Gemini API.',
            ];
            $anotar('conexion', 'la clave vale', 'error', 'Google rechaza la clave (HTTP ' . $r['codigo'] . ': ' . $m['texto'] . ').' . ($remedio[$m['clase']] ?? ''));
            return;
        }
        $anotar('conexion', 'la clave vale', 'ok', 'Google acepta la clave.');

        $modelo = self::modelo();
        $mr = self::peticion('GET', '/models/' . rawurlencode($modelo), null, 15);
        if ($mr['codigo'] === 200) {
            $d = json_decode($mr['cuerpo'], true);
            $anotar('modelo', 'modelo', 'ok', (string) ($d['displayName'] ?? $modelo) . ' existe.');
        } else {
            $anotar(
                'modelo', 'modelo', 'error',
                'Google no ofrece ningún modelo «' . $modelo . '» (HTTP ' . $mr['codigo'] . '). Déjalo vacío para usar ' . self::MODELO . '.'
            );
            return;
        }

        if (!self::usoEditorialAceptado()) {
            return;
        }

        // La prueba de verdad: una generación mínima. Unos pocos tokens.
        $inicio = microtime(true);
        $g = self::generar('Respondes con una sola palabra.', 'Responde únicamente: listo', 256);
        $segundos = microtime(true) - $inicio;
        $anotar(
            'generacion', 'genera texto',
            $g['ok'] ? 'ok' : 'error',
            $g['ok']
                ? sprintf('Responde en %.1f s («%s»).', $segundos, mb_substr($g['texto'], 0, 40))
                : 'No genera (' . $g['error'] . ($g['detalle'] !== '' ? ': ' . $g['detalle'] : '') . ').'
        );
    }
}
