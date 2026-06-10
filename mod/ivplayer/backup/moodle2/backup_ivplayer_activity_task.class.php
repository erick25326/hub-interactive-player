<?php
defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/ivplayer/backup/moodle2/backup_ivplayer_stepslib.php');

class backup_ivplayer_activity_task extends backup_activity_task {

    protected function define_my_settings() {
        // No particular settings for this activity.
    }

    protected function define_my_steps() {
        $this->add_step(new backup_ivplayer_activity_structure_step('ivplayer_structure', 'ivplayer.xml'));
    }

    public static function encode_content_links($content) {
        global $CFG;
        $base = preg_quote($CFG->wwwroot, '/');

        // Link to the list of ivplayers.
        $search = '/(' . $base . '\/mod\/ivplayer\/index.php\?id\=)([0-9]+)/';
        $content = preg_replace($search, '$@IVPLAYERINDEX*$2@$', $content);

        // Link to ivplayer view by moduleid.
        $search = '/(' . $base . '\/mod\/ivplayer\/view.php\?id\=)([0-9]+)/';
        $content = preg_replace($search, '$@IVPLAYERVIEWBYID*$2@$', $content);

        return $content;
    }
}
