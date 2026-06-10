<?php
defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/ivplayer/backup/moodle2/restore_ivplayer_stepslib.php');

class restore_ivplayer_activity_task extends restore_activity_task {

    protected function define_my_settings() {
        // No particular settings for this activity.
    }

    protected function define_my_steps() {
        $this->add_step(new restore_ivplayer_activity_structure_step('ivplayer_structure', 'ivplayer.xml'));
    }

    public static function define_decode_contents() {
        $contents = [];
        $contents[] = new restore_decode_content('ivplayer', ['intro'], 'ivplayer');
        return $contents;
    }

    public static function define_decode_rules() {
        $rules = [];
        $rules[] = new restore_decode_rule('IVPLAYERINDEX', '/mod/ivplayer/index.php?id=$1', 'course');
        $rules[] = new restore_decode_rule('IVPLAYERVIEWBYID', '/mod/ivplayer/view.php?id=$1', 'course_module');
        return $rules;
    }
}
