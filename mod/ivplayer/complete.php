<?php
/**
 * AJAX endpoint: the player reports that the current user finished
 * the video and all interactions. Stores a completion record and
 * triggers Moodle completion recalculation.
 */
define('AJAX_SCRIPT', true);
require_once(__DIR__ . '/../../config.php');

$cmid = required_param('cmid', PARAM_INT);

require_sesskey();

$cm = get_coursemodule_from_id('ivplayer', $cmid, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/ivplayer:view', $context);

// Record completion for this user.
$record = $DB->get_record('ivplayer_progress', [
    'ivplayerid' => $cm->instance,
    'userid' => $USER->id,
]);
if ($record) {
    $record->completed = 1;
    $record->timemodified = time();
    $DB->update_record('ivplayer_progress', $record);
} else {
    $DB->insert_record('ivplayer_progress', (object)[
        'ivplayerid' => $cm->instance,
        'userid' => $USER->id,
        'completed' => 1,
        'progress' => null,
        'timemodified' => time(),
    ]);
}

// Recalculate activity completion state.
$completion = new completion_info($course);
if ($completion->is_enabled($cm)) {
    $completion->update_state($cm, COMPLETION_COMPLETE);
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode(['success' => true]);
