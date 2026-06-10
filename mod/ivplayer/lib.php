<?php
defined('MOODLE_INTERNAL') || die();

function ivplayer_supports($feature) {
    switch ($feature) {
        case FEATURE_MOD_INTRO:
            return true;
        case FEATURE_COMPLETION_TRACKS_VIEWS:
            return true;
        case FEATURE_COMPLETION_HAS_RULES:
            return true;
        case FEATURE_GRADE_HAS_GRADE:
            return true;
        case FEATURE_SHOW_DESCRIPTION:
            return true;
        case FEATURE_BACKUP_MOODLE2:
            return true;
        default:
            return null;
    }
}

function ivplayer_add_instance($data, $mform = null) {
    global $DB;

    $data->timecreated = time();
    $data->timemodified = time();

    // Parse Vimeo URL to extract ID and hash.
    $parsed = ivplayer_parse_vimeo($data->vimeoid);
    $data->vimeoid = $parsed['id'];
    $data->vimeohash = $parsed['hash'];

    $data->id = $DB->insert_record('ivplayer', $data);

    ivplayer_grade_item_update($data);

    return $data->id;
}

function ivplayer_update_instance($data, $mform = null) {
    global $DB;

    $data->id = $data->instance;
    $data->timemodified = time();

    $parsed = ivplayer_parse_vimeo($data->vimeoid);
    $data->vimeoid = $parsed['id'];
    $data->vimeohash = $parsed['hash'];

    $result = $DB->update_record('ivplayer', $data);

    // Re-grade: the max grade or the set of interactions may have changed.
    ivplayer_grade_item_update($data);
    ivplayer_update_grades($DB->get_record('ivplayer', ['id' => $data->id]));

    return $result;
}

function ivplayer_delete_instance($id) {
    global $DB;
    if (!($ivplayer = $DB->get_record('ivplayer', ['id' => $id]))) {
        return false;
    }
    ivplayer_grade_item_update($ivplayer, 'reset');
    $DB->delete_records('ivplayer_answers', ['ivplayerid' => $id]);
    $DB->delete_records('ivplayer_progress', ['ivplayerid' => $id]);
    $DB->delete_records('ivplayer', ['id' => $id]);
    return true;
}

/* ─── Gradebook API ─────────────────────────────────────────── */

/**
 * Gradable interactions of an instance (multiple-choice and true-false).
 *
 * @return array of interaction arrays, indexed by interaction id.
 */
function ivplayer_gradable_interactions($ivplayer) {
    $interactions = json_decode($ivplayer->interactions ?? '[]', true);
    if (!is_array($interactions)) {
        return [];
    }
    $gradable = [];
    foreach ($interactions as $ia) {
        if (!empty($ia['id']) && in_array($ia['type'] ?? '', ['multiple-choice', 'true-false'], true)) {
            $gradable[$ia['id']] = $ia;
        }
    }
    return $gradable;
}

/**
 * Create/update the grade item for an instance.
 *
 * @param stdClass $ivplayer instance (needs id, course, name, grade)
 * @param mixed $grades grade objects, 'reset', or null
 */
function ivplayer_grade_item_update($ivplayer, $grades = null) {
    global $CFG;
    require_once($CFG->libdir . '/gradelib.php');

    $item = [
        'itemname' => $ivplayer->name,
        'gradetype' => GRADE_TYPE_NONE,
    ];
    if (!empty($ivplayer->grade) && $ivplayer->grade > 0) {
        $item['gradetype'] = GRADE_TYPE_VALUE;
        $item['grademax'] = $ivplayer->grade;
        $item['grademin'] = 0;
    }
    if ($grades === 'reset') {
        $item['reset'] = true;
        $grades = null;
    }

    return grade_update('mod/ivplayer', $ivplayer->course, 'mod', 'ivplayer',
        $ivplayer->id, 0, $grades, $item);
}

/**
 * Compute user grades: (correct answers / gradable interactions) * grade.
 *
 * @param stdClass $ivplayer
 * @param int $userid 0 = all users with answers
 * @return array userid => grade object, or [] if nothing to grade
 */
function ivplayer_get_user_grades($ivplayer, $userid = 0) {
    global $DB;

    $total = count(ivplayer_gradable_interactions($ivplayer));
    if (!$total || empty($ivplayer->grade) || $ivplayer->grade <= 0) {
        return [];
    }

    $params = ['ivplayerid' => $ivplayer->id];
    if ($userid) {
        $params['userid'] = $userid;
    }
    $answers = $DB->get_records('ivplayer_answers', $params);

    // Only count answers to interactions that still exist.
    $gradable = ivplayer_gradable_interactions($ivplayer);
    $byuser = [];
    foreach ($answers as $a) {
        if (!isset($gradable[$a->interactionid])) {
            continue;
        }
        if (!isset($byuser[$a->userid])) {
            $byuser[$a->userid] = ['correct' => 0, 'time' => 0];
        }
        $byuser[$a->userid]['correct'] += $a->correct ? 1 : 0;
        $byuser[$a->userid]['time'] = max($byuser[$a->userid]['time'], (int)$a->timemodified);
    }

    $grades = [];
    foreach ($byuser as $uid => $info) {
        $grade = new stdClass();
        $grade->userid = $uid;
        $grade->rawgrade = $ivplayer->grade * $info['correct'] / $total;
        $grade->dategraded = $info['time'];
        $grades[$uid] = $grade;
    }
    return $grades;
}

/**
 * Standard update_grades callback.
 */
function ivplayer_update_grades($ivplayer, $userid = 0, $nullifnone = true) {
    if (empty($ivplayer->grade) || $ivplayer->grade <= 0) {
        ivplayer_grade_item_update($ivplayer);
        return;
    }
    if ($grades = ivplayer_get_user_grades($ivplayer, $userid)) {
        ivplayer_grade_item_update($ivplayer, $grades);
    } else if ($userid && $nullifnone) {
        $grade = new stdClass();
        $grade->userid = $userid;
        $grade->rawgrade = null;
        ivplayer_grade_item_update($ivplayer, $grade);
    } else {
        ivplayer_grade_item_update($ivplayer);
    }
}

/**
 * Course module info: show description on course page and expose
 * custom completion rules to the completion API.
 */
function ivplayer_get_coursemodule_info($coursemodule) {
    global $DB;

    $ivplayer = $DB->get_record('ivplayer', ['id' => $coursemodule->instance],
        'id, name, intro, introformat, completioninteractions');
    if (!$ivplayer) {
        return false;
    }

    $info = new cached_cm_info();
    $info->name = $ivplayer->name;

    if ($coursemodule->showdescription) {
        $info->content = format_module_intro('ivplayer', $ivplayer, $coursemodule->id, false);
    }

    if ($coursemodule->completion == COMPLETION_TRACKING_AUTOMATIC) {
        $info->customdata['customcompletionrules']['completioninteractions'] =
            $ivplayer->completioninteractions;
    }

    return $info;
}

/**
 * Parse a Vimeo URL or ID into components.
 */
function ivplayer_parse_vimeo($input) {
    $input = trim($input);

    // Strip query params.
    $clean = preg_replace('/[?#].*$/', '', $input);

    // Just a numeric ID.
    if (preg_match('/^\d+$/', $clean)) {
        return ['id' => $clean, 'hash' => null];
    }

    // URL: vimeo.com/ID/HASH.
    if (preg_match('/vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-f0-9]+))?/', $clean, $m)) {
        return ['id' => $m[1], 'hash' => $m[2] ?? null];
    }

    // Player URL: player.vimeo.com/video/ID?h=HASH.
    if (preg_match('/player\.vimeo\.com\/video\/(\d+)/', $input, $m)) {
        $hash = null;
        if (preg_match('/[?&]h=([a-f0-9]+)/', $input, $hm)) {
            $hash = $hm[1];
        }
        return ['id' => $m[1], 'hash' => $hash];
    }

    return ['id' => $clean, 'hash' => null];
}
