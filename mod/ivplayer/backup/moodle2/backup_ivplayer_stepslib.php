<?php
defined('MOODLE_INTERNAL') || die();

class backup_ivplayer_activity_structure_step extends backup_activity_structure_step {

    protected function define_structure() {
        $userinfo = $this->get_setting_value('userinfo');

        $ivplayer = new backup_nested_element('ivplayer', ['id'], [
            'name', 'intro', 'introformat', 'vimeoid', 'vimeohash',
            'videoloop', 'interactions', 'completioninteractions',
            'grade', 'timecreated', 'timemodified',
        ]);

        $progresses = new backup_nested_element('progresses');
        $progress = new backup_nested_element('progress', ['id'], [
            'userid', 'completed', 'progress', 'timemodified',
        ]);

        $answers = new backup_nested_element('answers');
        $answer = new backup_nested_element('answer', ['id'], [
            'userid', 'interactionid', 'answer', 'correct', 'timemodified',
        ]);

        $ivplayer->add_child($progresses);
        $progresses->add_child($progress);
        $ivplayer->add_child($answers);
        $answers->add_child($answer);

        $ivplayer->set_source_table('ivplayer', ['id' => backup::VAR_ACTIVITYID]);

        if ($userinfo) {
            $progress->set_source_table('ivplayer_progress', ['ivplayerid' => backup::VAR_PARENTID]);
            $answer->set_source_table('ivplayer_answers', ['ivplayerid' => backup::VAR_PARENTID]);
        }

        $progress->annotate_ids('user', 'userid');
        $answer->annotate_ids('user', 'userid');

        return $this->prepare_activity_structure($ivplayer);
    }
}
