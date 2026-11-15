<?php
/**
 * AJAX endpoint: la duda o comentario que deja el alumno en la tarjeta de fin (1.5.0). Se
 * guarda en ivplayer_comentarios (una fila por mensaje) y se avisa por las notificaciones de
 * Moodle a quien responde las dudas (ivplayer_comentario_avisar): por mail, con "responder a"
 * el alumno. Los mismos chequeos que answer.php.
 *
 * El reproductor lo manda por la cola de scorm.js, que reintenta si no llega la respuesta:
 * el mismo texto del mismo alumno en la misma lección dentro de la hora no se guarda ni se
 * avisa dos veces.
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
define('AJAX_SCRIPT', true);
require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

$cmid = required_param('cmid', PARAM_INT);
$texto = required_param('texto', PARAM_TEXT);

require_sesskey();

$cm = get_coursemodule_from_id('ivplayer', $cmid, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$ivplayer = $DB->get_record('ivplayer', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/ivplayer:view', $context);

header('Content-Type: application/json; charset=utf-8');

$texto = ivplayer_comentario_limpio($texto);
if ($texto === null) {
    echo json_encode(['success' => false, 'error' => 'Empty']);
    exit;
}

$ahora = time();
$repetido = $DB->record_exists_select('ivplayer_comentarios',
    'ivplayerid = :iv AND userid = :u AND timecreated > :desde AND ' . $DB->sql_compare_text('texto', 1000) . ' = ' . $DB->sql_compare_text(':t', 1000),
    ['iv' => $ivplayer->id, 'u' => $USER->id, 'desde' => $ahora - HOURSECS, 't' => $texto]);
if (!$repetido) {
    $DB->insert_record('ivplayer_comentarios', (object) [
        'ivplayerid' => $ivplayer->id,
        'userid' => $USER->id,
        'texto' => $texto,
        'timecreated' => $ahora,
    ]);
    // Si el aviso falla (sin correo, notificaciones apagadas), la duda igual quedó guardada.
    try {
        ivplayer_comentario_avisar($ivplayer, $course, $cm, $context, $USER, $texto);
    } catch (\Throwable $e) {
        debugging('mod_ivplayer: no se pudo avisar de la duda: ' . $e->getMessage(), DEBUG_DEVELOPER);
    }
}

echo json_encode(['success' => true]);
