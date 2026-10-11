<?php
defined('MOODLE_INTERNAL') || die();

class backup_ivplayer_activity_structure_step extends backup_activity_structure_step {

    protected function define_structure() {
        $userinfo = $this->get_setting_value('userinfo');

        // videourl (1.3.0) es el GUID de Bunny. Viaja como dato de la actividad: el host
        // y la clave son ajustes del sitio y NO van en el backup, así que al restaurar
        // en otro Moodle el video anda si ese sitio apunta a la misma biblioteca.
        $ivplayer = new backup_nested_element('ivplayer', ['id'], [
            'name', 'intro', 'introformat', 'vimeoid', 'vimeohash', 'videourl',
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
