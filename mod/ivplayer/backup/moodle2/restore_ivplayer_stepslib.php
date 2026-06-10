<?php
defined('MOODLE_INTERNAL') || die();

class restore_ivplayer_activity_structure_step extends restore_activity_structure_step {

    protected function define_structure() {
        $paths = [];
        $userinfo = $this->get_setting_value('userinfo');

        $paths[] = new restore_path_element('ivplayer', '/activity/ivplayer');
        if ($userinfo) {
            $paths[] = new restore_path_element('ivplayer_progress', '/activity/ivplayer/progresses/progress');
        }

        return $this->prepare_activity_structure($paths);
    }

    protected function process_ivplayer($data) {
        global $DB;

        $data = (object)$data;
        $data->course = $this->get_courseid();

        $newitemid = $DB->insert_record('ivplayer', $data);
        $this->apply_activity_instance($newitemid);
    }

    protected function process_ivplayer_progress($data) {
        global $DB;

        $data = (object)$data;
        $data->ivplayerid = $this->get_new_parentid('ivplayer');
        $data->userid = $this->get_mappingid('user', $data->userid);

        $DB->insert_record('ivplayer_progress', $data);
    }

    protected function after_execute() {
        $this->add_related_files('mod_ivplayer', 'intro', null);
    }
}
