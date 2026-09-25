<?php
/**
 * ORBIS — Cliente mínimo de ElevenLabs.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  POR QUÉ UNA CLASE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * La llamada de síntesis estaba copiada en tres sitios —api/tts.php,
 * wj-admin/probar-voz.php y api/health.php— con sus ajustes de voz, su formato
 * de audio y su interpretación de errores. Tres copias que tenían que decir lo
 * mismo y que, en cuanto cambiara una, dejarían de hacerlo: el probador del
 * panel sonaría distinto de la narración real, que es justo lo que existe para
 * evitar. La verificación de la pestaña APIs habría sido la cuarta.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  LO QUE NUNCA SALE DE AQUÍ
 * ════════════════════════════════════════════════════════════════════════════
 *
 * La clave. Ni en los errores ni en el registro: lo que se devuelve es el
 * MOTIVO que da ElevenLabs («missing_permissions», «invalid_api_key»…), que
 * describe lo que le pasa a la clave, no la clave.
 *
 * Sintaxis compatible con PHP 7.4.
 */

declare(strict_types=1);

require_once __DIR__ . '/Config.php';

final class ElevenLabs
{
    const BASE = 'https://api.elevenlabs.io/v1';

    /** Formato del audio. El mismo que trae la caché: cambiarlo la invalidaría. */
    const FORMATO = 'mp3_44100_128';

    const MODELO_PREDETERMINADO = 'eleven_multilingual_v2';

    /**
     * La frase de prueba, la del probador del panel y la de la verificación.
     *
     * Lleva números, un nombre propio y una cifra con separador porque es donde
     * se nota si una voz sirve para ORBIS: leer «1.391.400 kilómetros» en
     * español es exactamente lo que va a tener que hacer todo el día. Es una
     * sola para que las dos compartan la entrada de la caché: lo que sintetiza
     * la verificación lo reproduce el probador sin volver a pagarlo.
     */
    const FRASE_PRUEBA = 'Esto es el Sol. Su diámetro es de 1.391.400 kilómetros, unas ciento nueve veces el de la Tierra.';

    /**
     * Ajustes de voz de TODA la narración.
     *
     * Estabilidad algo por debajo de la mitad para que la voz no suene leída,
     * similitud alta para que no se aleje del timbre elegido y un toque de
     * estilo, poco: esto es divulgación, no un anuncio. Viven aquí y solo aquí
     * para que el probador del panel suene exactamente como la narración.
     */
    const AJUSTES_VOZ = [
        'stability'         => 0.42,
        'similarity_boost'  => 0.78,
        'style'             => 0.15,
        'use_speaker_boost' => true,
    ];

    /** La clave configurada, o null. */
    public static function clave(): ?string
    {
        $clave = Config::obtener('ELEVENLABS_API_KEY');
        return is_string($clave) && trim($clave) !== '' ? trim($clave) : null;
    }

    public static function vozConfigurada(): string
    {
        return (string) Config::obtener('ELEVENLABS_VOICE_ID', Config::VOZ_PREDETERMINADA);
    }

    public static function modeloConfigurado(): string
    {
        return (string) Config::obtener('ELEVENLABS_MODEL_ID', self::MODELO_PREDETERMINADO);
    }

    /**
     * Una petición cualquiera a la API.
     *
     * @return array{codigo:int,tipo:string,cuerpo:string,error:string}
     */
    public static function peticion(
        string $metodo,
        string $ruta,
        ?array $json = null,
        int $espera = 20,
        ?string $clave = null
    ): array {
        $clave = $clave ?? self::clave();
        if (!extension_loaded('curl')) {
            return ['codigo' => 0, 'tipo' => '', 'cuerpo' => '', 'error' => 'curl no disponible'];
        }

        $cabeceras = ['Accept: application/json, audio/mpeg'];
        if ($clave !== null) {
            $cabeceras[] = 'xi-api-key: ' . $clave;
        }

        $ch = curl_init(self::BASE . $ruta);
        $opciones = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $espera,
            CURLOPT_CONNECTTIMEOUT => 10,
            // Verificación TLS obligatoria: sin ella la clave viajaría por un
            // canal que se podría interceptar.
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
        $resultado = [
            'codigo' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE),
            'tipo'   => (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE),
            'cuerpo' => is_string($cuerpo) ? $cuerpo : '',
            'error'  => curl_error($ch),
        ];
        curl_close($ch);
        return $resultado;
    }

    /**
     * El motivo que da ElevenLabs en un error, recortado. Nunca la clave.
     *
     * Llega de varias formas según el error: {detail:{status,message}},
     * {detail:"texto"} o {detail:[{msg}]} en las validaciones.
     */
    public static function motivo(string $cuerpo): array
    {
        $d = json_decode($cuerpo, true);
        $estado = '';
        $mensaje = '';
        if (is_array($d)) {
            $detalle = $d['detail'] ?? null;
            if (is_array($detalle) && isset($detalle['status'])) {
                $estado = (string) $detalle['status'];
                $mensaje = (string) ($detalle['message'] ?? '');
            } elseif (is_array($detalle) && isset($detalle[0]['msg'])) {
                $mensaje = (string) $detalle[0]['msg'];
            } elseif (is_string($detalle)) {
                $mensaje = $detalle;
            }
        }
        $mensaje = mb_substr(str_replace(["\n", "\r"], ' ', $mensaje), 0, 200);
        return ['estado' => $estado, 'mensaje' => $mensaje];
    }

    /**
     * ¿Es un 401 por falta de permiso y no por clave inválida?
     *
     * Son dos causas con remedios que no se parecen en nada. ElevenLabs deja
     * crear claves con permisos sueltos, y una que lee las voces pero no puede
     * sintetizar pasa las comprobaciones de conectividad y falla solo al narrar.
     */
    public static function esFaltaDePermiso(int $codigo, array $motivo): bool
    {
        return $codigo === 401
            && ($motivo['estado'] === 'missing_permissions' || stripos($motivo['mensaje'], 'permission') !== false);
    }

    /**
     * Sintetiza un texto con los ajustes de la narración.
     *
     * @return array{ok:bool,audio:string,codigo:int,error:string,detalle:string}
     *   error: '' | sin_conexion | clave_sin_permiso | clave_invalida | voz_desconocida | error_sintesis
     */
    public static function sintetizar(string $texto, string $voz, string $modelo, int $espera = 45): array
    {
        $r = self::peticion(
            'POST',
            '/text-to-speech/' . rawurlencode($voz) . '?output_format=' . rawurlencode(self::FORMATO),
            ['text' => $texto, 'model_id' => $modelo, 'voice_settings' => self::AJUSTES_VOZ],
            $espera
        );

        if ($r['codigo'] === 0) {
            return ['ok' => false, 'audio' => '', 'codigo' => 0, 'error' => 'sin_conexion', 'detalle' => $r['error']];
        }
        if ($r['codigo'] === 200 && strpos($r['tipo'], 'audio') !== false) {
            return ['ok' => true, 'audio' => $r['cuerpo'], 'codigo' => 200, 'error' => '', 'detalle' => ''];
        }

        $motivo = self::motivo($r['cuerpo']);
        $error = 'error_sintesis';
        if (self::esFaltaDePermiso($r['codigo'], $motivo)) {
            $error = 'clave_sin_permiso';
        } elseif ($r['codigo'] === 401) {
            $error = 'clave_invalida';
        } elseif ($r['codigo'] === 404 || $motivo['estado'] === 'voice_not_found') {
            $error = 'voz_desconocida';
        }
        return [
            'ok' => false,
            'audio' => '',
            'codigo' => $r['codigo'],
            'error' => $error,
            'detalle' => trim($motivo['estado'] . ' ' . $motivo['mensaje']),
        ];
    }
}
