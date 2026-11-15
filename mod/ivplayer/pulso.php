<?php
/**
 * AJAX endpoint: el toque de fin de lección (1.5.0). "¿Cómo te resultó esta lección?" con
 * hasta una opción de cada grupo (ivplayer_pulso_opciones): cómo siguió la lección
 * (`dificultad`) y si le aportó (`utilidad`). El reproductor manda siempre lo marcado en los
 * dos ('' = nada), así un envío repetido o fuera de orden deja lo último. Una fila por alumno
 * y video, que se puede cambiar. Los mismos chequeos que answer.php: sesskey, sesión, acceso
 * a la actividad y permiso de verla. No toca la nota ni la finalización.
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
define('AJAX_SCRIPT', true);
require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

$cmid = required_param('cmid', PARAM_INT);
$dificultad = optional_param('dificultad', '', PARAM_ALPHA);
$utilidad = optional_param('utilidad', '', PARAM_ALPHA);

require_sesskey();

$cm = get_coursemodule_from_id('ivplayer', $cmid, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$ivplayer = $DB->get_record('ivplayer', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/ivplayer:view', $context);

header('Content-Type: application/json; charset=utf-8');

$pulso = ivplayer_pulso_leer($dificultad, $utilidad);
if ($pulso === null) {
    echo json_encode(['success' => false, 'error' => 'Unknown answer']);
    exit;
}

$ahora = time();
$record = $DB->get_record('ivplayer_pulso', ['ivplayerid' => $ivplayer->id, 'userid' => $USER->id]);
if ($record) {
    if ($record->dificultad !== $pulso['dificultad'] || $record->utilidad !== $pulso['utilidad']) {
        $record->dificultad = $pulso['dificultad'];
        $record->utilidad = $pulso['utilidad'];
        $record->timemodified = $ahora;
        $DB->update_record('ivplayer_pulso', $record);
    }
} else {
    $DB->insert_record('ivplayer_pulso', (object) [
        'ivplayerid' => $ivplayer->id,
        'userid' => $USER->id,
        'dificultad' => $pulso['dificultad'],
        'utilidad' => $pulso['utilidad'],
        'timecreated' => $ahora,
        'timemodified' => $ahora,
    ]);
}

echo json_encode(['success' => true] + $pulso);
