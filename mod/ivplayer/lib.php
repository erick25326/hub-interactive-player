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
    return $data->id;
}

function ivplayer_update_instance($data, $mform = null) {
    global $DB;

    $data->id = $data->instance;
    $data->timemodified = time();

    $parsed = ivplayer_parse_vimeo($data->vimeoid);
    $data->vimeoid = $parsed['id'];
    $data->vimeohash = $parsed['hash'];

    return $DB->update_record('ivplayer', $data);
}

function ivplayer_delete_instance($id) {
    global $DB;
    if (!$DB->get_record('ivplayer', ['id' => $id])) {
        return false;
    }
    $DB->delete_records('ivplayer_progress', ['ivplayerid' => $id]);
    $DB->delete_records('ivplayer', ['id' => $id]);
    return true;
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
