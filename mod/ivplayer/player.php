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

// Build config.
$interactions = !empty($ivplayer->interactions) ? $ivplayer->interactions : '[]';
$config = json_encode([
    'title' => $ivplayer->name,
    'vimeoId' => $ivplayer->vimeoid,
    'vimeoHash' => $ivplayer->vimeohash ?: null,
    'loop' => !empty($ivplayer->videoloop),
    'interactions' => json_decode($interactions, true) ?: [],
], JSON_UNESCAPED_UNICODE);

$moodlecontext = json_encode([
    'cmid' => $cm->id,
    'sesskey' => sesskey(),
    'completeUrl' => (new moodle_url('/mod/ivplayer/complete.php'))->out(false),
]);

// Load player HTML.
$playerpath = __DIR__ . '/player.html';
$playerhtml = file_exists($playerpath) ? file_get_contents($playerpath) : '<p>Player not found.</p>';

// Inject config before </head>.
$configscript = "<script>\nwindow.PLAYER_CONFIG = {$config};\nwindow.MOODLE_CONTEXT = {$moodlecontext};\n</script>";
$playerhtml = str_replace('</head>', $configscript . "\n</head>", $playerhtml);

// Output raw HTML — no Moodle wrapper.
header('Content-Type: text/html; charset=utf-8');
echo $playerhtml;
