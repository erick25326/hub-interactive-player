<?php
/**
 * Vuelve a firmar el video de Bunny de una actividad, con la lección abierta.
 *
 * player.php firma el playlist con un vencimiento (la duración del token, llevada a la
 * hora en punto siguiente) y Bunny lo valida en CADA pedido de video: una lección que
 * quedaba abierta más que eso se cortaba con "El acceso al video venció". El
 * reproductor (src/firma.js) llama acá un rato antes de que venza y sigue con las URLs
 * nuevas, sin recargar la página.
 *
 *   POST cmid=<id del módulo>&sesskey=<sesskey>
 *   200 { ok: true, playlist, poster, expires, ahora, subtitulosTv? }   subtitulosTv: el
 *                               enlace firmado de subtitulos.php con el vencimiento nuevo
 *                               (sólo si la lección tiene subtítulos; ver lib.php)
 *   4xx { ok: false, motivo }   motivo: 'sesion' (401: se cerró la sesión o el sesskey ya
 *                               no vale), 'permiso' (403), 'actividad' (404),
 *                               'sinbunny' (409: la actividad ya no reproduce Bunny
 *                               firmado), 'metodo' (405)
 *   500 { ok: false, motivo: 'error' }
 *
 * 🔴 La clave de Bunny NO sale de acá: sólo las URLs ya firmadas, el vencimiento y la
 * hora del servidor (para que el reproductor mida el vencimiento sin su propio reloj).
 * 🔴 Siempre JSON, también con la sesión vencida: el reproductor tiene que poder decirle
 * al alumno qué hacer, y la página del login adentro de un fetch no le dice nada.
 * 🔴 Firma con la MISMA regla que player.php (ivplayer_bunny_de_actividad): nunca firma
 * un video que la lección no reproduce.
 * 🔴 No mantiene viva la sesión del campus (NO_SESSION_UPDATE, ver abajo).
 */

// AJAX_SCRIPT: sin redirección al login (require_login tira la excepción, que se
// atrapa acá) y sin la página de error HTML de Moodle.
define('AJAX_SCRIPT', true);
// Un aviso de depuración antes del JSON lo dejaría ilegible.
define('NO_DEBUG_DISPLAY', true);
// 🔴 Renovar la firma NO cuenta como actividad del alumno. El reproductor llama acá por
// reloj (cada ~6 h con la lección abierta), haya alguien mirando o no; si este pedido
// renovara la sesión, una lección en pausa en una PC compartida (un aula, un ciber, la
// PC del campo) mantenía la sesión del campus ENTERA abierta por días, siempre por
// debajo del vencimiento por inactividad (sessiontimeout, 8 h por defecto), y el que se
// sentaba después entraba como ese alumno. El que está mirando el video mantiene la
// sesión igual: progress.php guarda el avance mientras corre.
define('NO_SESSION_UPDATE', true);

require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

/**
 * Responde en JSON, sin caché, y termina.
 *
 * @param int $estado Código HTTP.
 * @param array $cuerpo
 */
function ivplayer_firma_responder(int $estado, array $cuerpo): void {
    http_response_code($estado);
    header('Content-Type: application/json; charset=utf-8');
    // 🔴 Sin caché en ningún lado: es una URL firmada con su vencimiento, para este
    // alumno. Una copia guardada sería una firma vieja (o la de otro).
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
    ivplayer_firma_responder(405, ['ok' => false, 'motivo' => 'metodo']);
}

$cmid = optional_param('cmid', 0, PARAM_INT);
if ($cmid <= 0) {
    ivplayer_firma_responder(404, ['ok' => false, 'motivo' => 'actividad']);
}

try {
    $cm = get_coursemodule_from_id('ivplayer', $cmid, 0, false, IGNORE_MISSING);
    $course = $cm ? $DB->get_record('course', ['id' => $cm->course]) : false;
    $ivplayer = $cm ? $DB->get_record('ivplayer', ['id' => $cm->instance]) : false;
} catch (Throwable $e) {
    ivplayer_firma_responder(500, ['ok' => false, 'motivo' => 'error']);
}
if (!$cm || !$course || !$ivplayer) {
    ivplayer_firma_responder(404, ['ok' => false, 'motivo' => 'actividad']);
}

// 🔴 Con NO_SESSION_UPDATE, Moodle NO cierra en este pedido una sesión vencida por
// inactividad: sale antes de destruirla (core\session\manager, initialise_user_session) y
// el alumno seguiría "adentro" para require_login. Se mira a mano, con la misma cuenta
// que usa Moodle (lo que queda desde la última actividad registrada). No consulta el
// ignore_timeout_hook de los plugins de autenticación (lo usan algunos SSO): con uno de
// ésos contesta 'sesion' y recargar la lección alcanza.
if (isloggedin() && !isguestuser()) {
    $restante = \core\session\manager::time_remaining(session_id());
    if ($restante['timeremaining'] <= 0) {
        ivplayer_firma_responder(401, ['ok' => false, 'motivo' => 'sesion']);
    }
}

// Los mismos controles que player.php (curso + módulo + permiso de ver), más el sesskey.
// 🔴 Sin entrar como invitado sola ($autologinguest = false, a diferencia de player.php):
// es un pedido de fondo, que no tiene que cambiar quién es la sesión del navegador. Sin
// nadie adentro, require_login tira la excepción y contesta 'sesion'.
try {
    require_login($course, false, $cm, false, true);
} catch (moodle_exception $e) {
    // require_login_exception también sale por un curso oculto o una actividad que ya no
    // se ve: sólo es "volvé a ingresar" si de verdad no hay nadie adentro.
    if (!isloggedin() || isguestuser()) {
        ivplayer_firma_responder(401, ['ok' => false, 'motivo' => 'sesion']);
    }
    ivplayer_firma_responder(403, ['ok' => false, 'motivo' => 'permiso']);
}
$context = context_module::instance($cm->id);
try {
    require_capability('mod/ivplayer:view', $context);
} catch (moodle_exception $e) {
    ivplayer_firma_responder(403, ['ok' => false, 'motivo' => 'permiso']);
}
try {
    require_sesskey();
} catch (moodle_exception $e) {
    // El sesskey de la página ya no es el de la sesión (se cerró y se volvió a ingresar
    // en otra pestaña): para el alumno es lo mismo, recargar la lección.
    ivplayer_firma_responder(401, ['ok' => false, 'motivo' => 'sesion']);
}
// Lo que sigue no escribe en la sesión: soltarla para no trabar otros pedidos del alumno.
\core\session\manager::write_close();

try {
    $ahora = time();
    $video = ivplayer_bunny_de_actividad($ivplayer, ivplayer_reproductor_html() ?? '', $ahora);
} catch (Throwable $e) {
    // Sin el mensaje: no tiene la clave, pero tampoco le sirve al alumno.
    ivplayer_firma_responder(500, ['ok' => false, 'motivo' => 'error']);
}
// Sin Bunny (la actividad volvió a Vimeo, se apagó Bunny en el sitio, player.html viejo)
// o sin firma (se sacó la clave): no hay nada que renovar. El reproductor sigue con lo
// que tiene y, si vence, el cartel lo manda a recargar, que arma la lección de nuevo.
if ($video === null || !$video['firmada']) {
    ivplayer_firma_responder(409, ['ok' => false, 'motivo' => 'sinbunny']);
}

$respuesta = [
    'ok' => true,
    'playlist' => $video['playlist'],
    'poster' => $video['poster'],
    'expires' => $video['expires'],
    'ahora' => $ahora,
];
// Subtítulos en la TV: el enlace a subtitulos.php con el vencimiento NUEVO, el mismo que el
// del video. Cuando la TV vuelve a cargar el video con la firma nueva, la pista va con éste
// (el viejo vence con la firma vieja). Si algo falla acá, la renovación del video sale
// igual, sin él: la TV conserva el que tenía hasta que venza.
try {
    $subtitulos = ivplayer_subtitulos_texto($context);
    if ($subtitulos !== null && ivplayer_subtitulos_a_vtt($subtitulos) !== null) {
        $subtitulostv = ivplayer_subtitulos_tv_url($cm->id, $video['expires']);
        if ($subtitulostv !== null) {
            $respuesta['subtitulosTv'] = $subtitulostv;
        }
    }
} catch (Throwable $e) {
    // Sin el mensaje, como arriba.
}
ivplayer_firma_responder(200, $respuesta);
