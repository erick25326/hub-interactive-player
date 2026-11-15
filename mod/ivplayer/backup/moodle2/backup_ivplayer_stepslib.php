<?php
defined('MOODLE_INTERNAL') || die();

class backup_ivplayer_activity_structure_step extends backup_activity_structure_step {

    protected function define_structure() {
        $userinfo = $this->get_setting_value('userinfo');

        // videourl (1.3.0) es el GUID de Bunny. Viaja como dato de la actividad: el host
        // y la clave son ajustes del sitio y NO van en el backup, así que al restaurar
        // en otro Moodle el video anda si ese sitio apunta a la misma biblioteca.
        // etiquetas (1.4.0): el modo de las etiquetas (glosario o en pantalla) viaja con
        // la actividad; al restaurar en un curso nuevo se ve igual que en el original.
        $ivplayer = new backup_nested_element('ivplayer', ['id'], [
            'name', 'intro', 'introformat', 'vimeoid', 'vimeohash', 'videourl',
            'videoloop', 'etiquetas', 'interactions', 'completioninteractions',
            'grade', 'timecreated', 'timemodified',
        ]);

        $progresses = new backup_nested_element('progresses');
        $progress = new backup_nested_element('progress', ['id'], [
            'userid', 'completed', 'progress', 'timemodified',
        ]);

        // El primer intento (1.5.0) viaja con la respuesta: en las de antes, vacío.
        $answers = new backup_nested_element('answers');
        $answer = new backup_nested_element('answer', ['id'], [
            'userid', 'interactionid', 'answer', 'correct', 'timemodified',
            'firstanswer', 'firstcorrect', 'attempts', 'timefirst',
        ]);

        // Tramos vistos por día y toque de fin de lección (1.5.0), con los datos de usuario.
        // `sesiones` no viaja: sólo sirve para no sumar dos veces un reenvío de esa carga.
        $vistas = new backup_nested_element('vistas');
        $vista = new backup_nested_element('vista', ['id'], [
            'userid', 'dia', 'tramos', 'duracion', 'segundos', 'timemodified',
        ]);

        $pulsos = new backup_nested_element('pulsos');
        $pulso = new backup_nested_element('pulso', ['id'], [
            'userid', 'dificultad', 'utilidad', 'timecreated', 'timemodified',
        ]);

        $comentarios = new backup_nested_element('comentarios');
        $comentario = new backup_nested_element('comentario', ['id'], [
            'userid', 'texto', 'timecreated',
        ]);

        $ivplayer->add_child($progresses);
        $progresses->add_child($progress);
        $ivplayer->add_child($answers);
        $answers->add_child($answer);
        $ivplayer->add_child($vistas);
        $vistas->add_child($vista);
        $ivplayer->add_child($pulsos);
        $pulsos->add_child($pulso);
        $ivplayer->add_child($comentarios);
        $comentarios->add_child($comentario);

        $ivplayer->set_source_table('ivplayer', ['id' => backup::VAR_ACTIVITYID]);

        if ($userinfo) {
            $progress->set_source_table('ivplayer_progress', ['ivplayerid' => backup::VAR_PARENTID]);
            $answer->set_source_table('ivplayer_answers', ['ivplayerid' => backup::VAR_PARENTID]);
            $vista->set_source_table('ivplayer_vistas', ['ivplayerid' => backup::VAR_PARENTID]);
            $pulso->set_source_table('ivplayer_pulso', ['ivplayerid' => backup::VAR_PARENTID]);
            $comentario->set_source_table('ivplayer_comentarios', ['ivplayerid' => backup::VAR_PARENTID]);
        }

        $progress->annotate_ids('user', 'userid');
        $answer->annotate_ids('user', 'userid');
        $vista->annotate_ids('user', 'userid');
        $pulso->annotate_ids('user', 'userid');
        $comentario->annotate_ids('user', 'userid');

        return $this->prepare_activity_structure($ivplayer);
    }
}
