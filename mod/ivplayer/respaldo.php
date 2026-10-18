<?php
/**
 * Red de seguridad: registra que una lección de Bunny pasa a Vimeo y confirma que se puede.
 *
 * Lo llama el reproductor (src/respaldo.js) cuando el video de Bunny no se puede
 * reproducir por una falla del CDN, ANTES de recargar player.php con ?origen=vimeo. Si
 * esto no contesta ok, el reproductor no salta y muestra el cartel de siempre.
 *
 *   POST cmid, sesskey, causa, codigo, detalle
 *   200 { ok: true, registrado }   registrado: false sólo si la clase del evento todavía
 *                                  no está en el mapa de Moodle (falta el upgrade)
 *   4xx { ok: false, motivo }      motivo: 'sesion' (401: se cerró la sesión o el sesskey
 *                                  ya no vale), 'permiso' (403), 'actividad' (404),
 *                                  'metodo' (405), 'causa' (400: no es una falla del CDN),
 *                                  'apagado' (409: el ajuste apagado, la actividad sin ID
 *                                  de Vimeo o que ya no reproduce Bunny)
 *   500 { ok: false, motivo: 'error' }
 *
 * 🔴 Con la sesión cerrada contesta 'sesion' y el reproductor NO salta: muestra el cartel
 * para volver a ingresar. Saltar sin sesión era ver el video con Vimeo sin que se guarde
 * nada (ni avance, ni respuestas, ni finalización: progress, answer y complete la piden).
 * 🔴 Sin conexión con el campus no se llega acá y tampoco salta: es la señal del alumno, no
 * Bunny, y recargar mostraría la página de error del navegador adentro del video.
 * 🔴 Las mismas condiciones que player.php para respetar ?origen=vimeo
 * (ivplayer_respaldo_vimeo): nunca se registra un salto que la lección después ignora.
 * 🔴 Siempre JSON (AJAX_SCRIPT), también con la sesión vencida: nunca la página del login.
 * A diferencia de firma.php, cuenta como actividad del alumno (sin NO_SESSION_UPDATE): se
 * llama una vez, con el alumno usando la lección, y así Moodle cierra en este mismo pedido
 * una sesión vencida por inactividad (y se contesta 'sesion').
 */

// AJAX_SCRIPT: sin redirección al login (require_login tira la excepción, que se
// atrapa acá) y sin la página de error HTML de Moodle.
define('AJAX_SCRIPT', true);
// Un aviso de depuración antes del JSON lo dejaría ilegible.
define('NO_DEBUG_DISPLAY', true);

require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

/**
 * Responde en JSON, sin caché, y termina.
 *
 * @param int $estado Código HTTP.
 * @param array $cuerpo
 */
function ivplayer_respaldo_responder(int $estado, array $cuerpo): void {
    http_response_code($estado);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($cuerpo, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// Sólo POST: el sesskey no viaja en una URL (quedaría en los registros del servidor).
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    ivplayer_respaldo_responder(405, ['ok' => false, 'motivo' => 'metodo']);
}

$cmid = optional_param('cmid', 0, PARAM_INT);
if ($cmid <= 0) {
    ivplayer_respaldo_responder(404, ['ok' => false, 'motivo' => 'actividad']);
}

try {
    $cm = get_coursemodule_from_id('ivplayer', $cmid, 0, false, IGNORE_MISSING);
    $course = $cm ? $DB->get_record('course', ['id' => $cm->course]) : false;
    $ivplayer = $cm ? $DB->get_record('ivplayer', ['id' => $cm->instance]) : false;
} catch (Throwable $e) {
    ivplayer_respaldo_responder(500, ['ok' => false, 'motivo' => 'error']);
}
if (!$cm || !$course || !$ivplayer) {
    ivplayer_respaldo_responder(404, ['ok' => false, 'motivo' => 'actividad']);
}

// Los mismos controles que player.php (curso + módulo + permiso de ver), más el sesskey.
// Sin entrar como invitado sola ($autologinguest = false): sin nadie adentro,
// require_login tira la excepción y se contesta 'sesion'.
try {
    require_login($course, false, $cm, false, true);
} catch (moodle_exception $e) {
    // require_login_exception también sale por un curso oculto o una actividad que ya no
    // se ve: sólo es "volvé a ingresar" si de verdad no hay nadie adentro.
    if (!isloggedin() || isguestuser()) {
        ivplayer_respaldo_responder(401, ['ok' => false, 'motivo' => 'sesion']);
    }
    ivplayer_respaldo_responder(403, ['ok' => false, 'motivo' => 'permiso']);
}
$context = context_module::instance($cm->id);
try {
    require_capability('mod/ivplayer:view', $context);
} catch (moodle_exception $e) {
    ivplayer_respaldo_responder(403, ['ok' => false, 'motivo' => 'permiso']);
}
try {
    require_sesskey();
} catch (moodle_exception $e) {
    // El sesskey de la página ya no es el de la sesión (se cerró y se volvió a ingresar
    // en otra pestaña): para el alumno es lo mismo, volver a cargar la lección.
    ivplayer_respaldo_responder(401, ['ok' => false, 'motivo' => 'sesion']);
}

// Sólo las fallas del CDN (ivplayer_respaldo_datos): por la firma no se salta.
$datos = ivplayer_respaldo_datos(
    optional_param('causa', '', PARAM_RAW_TRIMMED),
    optional_param('codigo', 0, PARAM_INT),
    optional_param('detalle', '', PARAM_RAW_TRIMMED)
);
if ($datos === null) {
    ivplayer_respaldo_responder(400, ['ok' => false, 'motivo' => 'causa']);
}

// Que player.php vaya a respetar ?origen=vimeo (ajuste prendido y ID de Vimeo) y que la
// actividad hoy reproduzca Bunny: si volvió a Vimeo mientras tanto, no hay salto que contar.
try {
    $usabunny = ivplayer_bunny_de_actividad($ivplayer, ivplayer_reproductor_html() ?? '', time()) !== null;
} catch (Throwable $e) {
    ivplayer_respaldo_responder(500, ['ok' => false, 'motivo' => 'error']);
}
if (!$usabunny || !ivplayer_respaldo_vimeo(get_config('mod_ivplayer', 'respaldovimeo'), $ivplayer->vimeoid)) {
    ivplayer_respaldo_responder(409, ['ok' => false, 'motivo' => 'apagado']);
}

// Lo que sigue no escribe en la sesión: soltarla para no trabar el guardado del avance,
// que el reproductor manda a la vez.
\core\session\manager::write_close();

try {
    $registrado = ivplayer_respaldo_registrar($ivplayer, $course, $cm, $context, $datos);
} catch (Throwable $e) {
    // Sin registro, el alumno igual sigue con Vimeo: el respaldo vale más que la fila.
    $registrado = false;
}
ivplayer_respaldo_responder(200, ['ok' => true, 'registrado' => $registrado]);
