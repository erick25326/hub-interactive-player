<?php
/**
 * AJAX endpoint: stores a student's answer to a gradable interaction.
 * Correctness is verified server-side against the stored interaction
 * config — the client only reports WHAT was answered, never whether
 * it was right.
 */
define('AJAX_SCRIPT', true);
require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

$cmid = required_param('cmid', PARAM_INT);
$interactionid = required_param('interactionid', PARAM_ALPHANUMEXT);
$answer = required_param('answer', PARAM_TEXT);

require_sesskey();

$cm = get_coursemodule_from_id('ivplayer', $cmid, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$ivplayer = $DB->get_record('ivplayer', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/ivplayer:view', $context);

header('Content-Type: application/json; charset=utf-8');

$gradable = ivplayer_gradable_interactions($ivplayer);
if (!isset($gradable[$interactionid])) {
    echo json_encode(['success' => false, 'error' => 'Unknown gradable interaction']);
    exit;
}

// Verify correctness server-side.
$ia = $gradable[$interactionid];
$answer = core_text::substr($answer, 0, 255);
if ($ia['type'] === 'multiple-choice') {
    $correct = isset($ia['data']['correctId']) && $answer === (string)$ia['data']['correctId'];
} else { // true-false
    $expected = !empty($ia['data']['correct']) ? 'true' : 'false';
    $correct = core_text::strtolower($answer) === $expected;
}

// Upsert the latest answer for this interaction.
$record = $DB->get_record('ivplayer_answers', [
    'ivplayerid' => $ivplayer->id,
    'userid' => $USER->id,
    'interactionid' => $interactionid,
]);
if ($record) {
    $record->answer = $answer;
    $record->correct = $correct ? 1 : 0;
    $record->timemodified = time();
    $DB->update_record('ivplayer_answers', $record);
} else {
    $DB->insert_record('ivplayer_answers', (object)[
        'ivplayerid' => $ivplayer->id,
        'userid' => $USER->id,
        'interactionid' => $interactionid,
        'answer' => $answer,
        'correct' => $correct ? 1 : 0,
        'timemodified' => time(),
    ]);
}

// Recalculate this user's grade in the gradebook.
ivplayer_update_grades($ivplayer, $USER->id);

echo json_encode(['success' => true, 'correct' => $correct]);
