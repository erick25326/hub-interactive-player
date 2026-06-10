<?php
/**
 * AJAX endpoint: saves per-user playback progress (completed
 * interaction ids + current time) so it survives across devices.
 */
define('AJAX_SCRIPT', true);
require_once(__DIR__ . '/../../config.php');

$cmid = required_param('cmid', PARAM_INT);
$data = required_param('data', PARAM_RAW);

require_sesskey();

$cm = get_coursemodule_from_id('ivplayer', $cmid, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/ivplayer:view', $context);

header('Content-Type: application/json; charset=utf-8');

// Validate payload: must be small, valid JSON with expected shape.
if (strlen($data) > 20000) {
    echo json_encode(['success' => false, 'error' => 'Payload too large']);
    exit;
}
$decoded = json_decode($data, true);
if (!is_array($decoded)) {
    echo json_encode(['success' => false, 'error' => 'Invalid JSON']);
    exit;
}
$clean = [
    'completed' => [],
    'currentTime' => isset($decoded['currentTime']) ? (float)$decoded['currentTime'] : 0,
];
if (!empty($decoded['completed']) && is_array($decoded['completed'])) {
    foreach ($decoded['completed'] as $iaid) {
        if (is_string($iaid) || is_numeric($iaid)) {
            $clean['completed'][] = clean_param((string)$iaid, PARAM_ALPHANUMEXT);
        }
    }
}

$record = $DB->get_record('ivplayer_progress', [
    'ivplayerid' => $cm->instance,
    'userid' => $USER->id,
]);
if ($record) {
    $record->progress = json_encode($clean);
    $record->timemodified = time();
    $DB->update_record('ivplayer_progress', $record);
} else {
    $DB->insert_record('ivplayer_progress', (object)[
        'ivplayerid' => $cm->instance,
        'userid' => $USER->id,
        'completed' => 0,
        'progress' => json_encode($clean),
        'timemodified' => time(),
    ]);
}

echo json_encode(['success' => true]);
