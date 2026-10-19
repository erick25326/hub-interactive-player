<?php
/**
 * Los subtítulos de una lección para la TV (Chromecast), sin sesión y con una firma.
 *
 * Transmitiendo, el video lo baja la TV (el receptor de Cast, o el Cast nativo de hub-app)
 * con la URL firmada de Bunny. Para que muestre los subtítulos, el reproductor le pasa en
 * la carga una pista de texto que apunta ACÁ (subtitlesUrlTv de player.php; firma.php trae
 * una nueva con cada renovación). La TV la pide sin la cookie del campus, así que esto no
 * pide sesión: la firma de la URL es el permiso.
 *
 *   GET subtitulos.php?id=<cmid>&e=<vencimiento unix>&s=<firma>
 *   200 text/vtt   el VTT/SRT de "Editar transcripción", como WebVTT estricto
 *   403            la firma no es de este sitio, venció o vence más allá del tope (sin detalle)
 *   404            la actividad o el archivo de subtítulos ya no están
 *   405            otro método (OPTIONS contesta 204, por si algún receptor pregunta antes)
 *
 * 🔴 La firma es HMAC-SHA256 de "cmid|e" con el secreto del plugin (ajuste
 * subtitulossecreto, que crean la instalación y el upgrade y que no se muestra ni se
 * exporta). Se verifica ANTES de mirar la base (ivplayer_subtitulos_tv_valida).
 * 🔴 Decisión: NO se mira si el curso o la actividad están visibles. La firma la emitió
 * player.php (o firma.php) para alguien que pasó require_login y mod/ivplayer:view en ESA
 * actividad, y vence con la firma del video, igual que la URL de Bunny, que tampoco se
 * revoca al ocultar el curso. Mirarlo dejaría sin subtítulos en la TV a quien prueba con
 * una actividad oculta (los docentes la ven; el pedido de la TV no dice quién es) y no
 * protege nada que la URL del video, que viaja junto, no deje ver igual.
 * 🔴 Sin cookies (NO_MOODLE_COOKIES): no arranca ni toca ninguna sesión. Con CORS abierto
 * (Access-Control-Allow-Origin: *): el receptor de Google lo pide desde otro origen.
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

// Sin sesión: la TV no tiene la cookie del campus, y este pedido no tiene que crear ni
// renovar ninguna (ni mandar Set-Cookie a la TV).
define('NO_MOODLE_COOKIES', true);
// Un aviso de depuración antes del VTT lo dejaría ilegible para el receptor.
define('NO_DEBUG_DISPLAY', true);

require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

/**
 * Responde y termina. CORS abierto siempre (también en los errores, para que el receptor
 * pueda leer el estado), sin cookies y sin que se guarde en una caché compartida.
 *
 * @param int $estado Código HTTP.
 * @param string $cuerpo
 */
function ivplayer_subtitulos_responder(int $estado, string $cuerpo = ''): void {
    http_response_code($estado);
    header('Access-Control-Allow-Origin: *');
    header('X-Content-Type-Options: nosniff');
    if ($estado === 200) {
        header('Content-Type: text/vtt; charset=utf-8');
        // Privado y corto: la TV lo baja una vez por carga; una caché compartida (un proxy,
        // la CDN del sitio) no tiene que guardar el texto de una lección paga.
        header('Cache-Control: private, max-age=300');
    } else {
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: no-store');
    }
    header('Content-Length: ' . strlen($cuerpo));
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'HEAD') {
        echo $cuerpo;
    }
    exit;
}

$metodo = $_SERVER['REQUEST_METHOD'] ?? '';
if ($metodo === 'OPTIONS') {
    http_response_code(204);
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
    // Los que Google pide permitir para que el receptor baje la pista.
    header('Access-Control-Allow-Headers: Content-Type, Accept-Encoding, Range');
    header('Access-Control-Max-Age: 600');
    exit;
}
if ($metodo !== 'GET' && $metodo !== 'HEAD') {
    header('Allow: GET, HEAD, OPTIONS');
    ivplayer_subtitulos_responder(405);
}

// 🔴 Primero la firma, sin tocar la base: un pedido sin firma buena no hace buscar nada.
try {
    $cmid = optional_param('id', 0, PARAM_INT);
    $expires = optional_param('e', 0, PARAM_INT);
    $firma = optional_param('s', '', PARAM_ALPHANUMEXT);
    $valida = ivplayer_subtitulos_tv_valida($cmid, $expires, $firma, ivplayer_subtitulos_tv_secreto(), time(),
        ivplayer_subtitulos_tv_tope(ivplayer_bunny_ttl()));
} catch (Throwable $e) {
    $valida = false;
}
if (!$valida) {
    ivplayer_subtitulos_responder(403);
}

try {
    // Que sea un módulo de ESTE plugin (get_coursemodule_from_id con 'ivplayer') y que no se
    // esté borrando. La visibilidad no se mira: ver la decisión arriba.
    $cm = get_coursemodule_from_id('ivplayer', $cmid, 0, false, IGNORE_MISSING);
    $context = ($cm && empty($cm->deletioninprogress)) ? context_module::instance($cm->id, IGNORE_MISSING) : false;
    // El mismo archivo que la transcripción y los subtítulos del celular, normalizado a
    // UTF-8 (ivplayer_subtitulos_texto) y pasado a WebVTT estricto (un SRT incluido).
    $texto = $context ? ivplayer_subtitulos_texto($context) : null;
    $vtt = $texto !== null ? ivplayer_subtitulos_a_vtt($texto) : null;
} catch (Throwable $e) {
    $vtt = null;
}
if ($vtt === null) {
    ivplayer_subtitulos_responder(404);
}
ivplayer_subtitulos_responder(200, $vtt);
