<?php
/**
 * Serves the player HTML with config injected.
 * This runs inside an iframe — no Moodle page wrapper.
 */
require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

$id = required_param('id', PARAM_INT); // Course module ID.

$cm = get_coursemodule_from_id('ivplayer', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$ivplayer = $DB->get_record('ivplayer', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/ivplayer:view', $context);

// Build config. JSON_HEX_TAG prevents "</script>" inside interaction
// content from breaking out of the injected <script> block.
$jsonflags = JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;
$interactions = !empty($ivplayer->interactions) ? $ivplayer->interactions : '[]';
$config = json_encode([
    'title' => $ivplayer->name,
    'vimeoId' => $ivplayer->vimeoid,
    'vimeoHash' => $ivplayer->vimeohash ?: null,
    'loop' => !empty($ivplayer->videoloop),
    'interactions' => json_decode($interactions, true) ?: [],
], $jsonflags);

// Per-user saved progress (cross-device resume).
$progressrec = $DB->get_record('ivplayer_progress', [
    'ivplayerid' => $ivplayer->id,
    'userid' => $USER->id,
]);
$savedprogress = null;
if ($progressrec && !empty($progressrec->progress)) {
    $savedprogress = json_decode($progressrec->progress, true);
}

$moodlecontext = json_encode([
    'cmid' => $cm->id,
    'sesskey' => sesskey(),
    'completeUrl' => (new moodle_url('/mod/ivplayer/complete.php'))->out(false),
    'progressUrl' => (new moodle_url('/mod/ivplayer/progress.php'))->out(false),
    'answerUrl' => (new moodle_url('/mod/ivplayer/answer.php'))->out(false),
    'savedProgress' => $savedprogress,
    'alreadyCompleted' => $progressrec ? (bool)$progressrec->completed : false,
], $jsonflags);

// Load player HTML.
$playerpath = __DIR__ . '/player.html';
$playerhtml = file_exists($playerpath) ? file_get_contents($playerpath) : '<p>Player not found.</p>';

// Inject config before </head>.
$configscript = "<script>\nwindow.PLAYER_CONFIG = {$config};\nwindow.MOODLE_CONTEXT = {$moodlecontext};\n</script>";
$playerhtml = str_replace('</head>', $configscript . "\n</head>", $playerhtml);

// Output raw HTML — no Moodle wrapper.
header('Content-Type: text/html; charset=utf-8');
echo $playerhtml;
