<?php
defined('MOODLE_INTERNAL') || die();

// ivplayer_modo_etiquetas (process_ivplayer): el restore no siempre trae lib.php cargado.
require_once(__DIR__ . '/../../lib.php');

class restore_ivplayer_activity_structure_step extends restore_activity_structure_step {

    protected function define_structure() {
        $paths = [];
        $userinfo = $this->get_setting_value('userinfo');

        $paths[] = new restore_path_element('ivplayer', '/activity/ivplayer');
        if ($userinfo) {
            $paths[] = new restore_path_element('ivplayer_progress', '/activity/ivplayer/progresses/progress');
            $paths[] = new restore_path_element('ivplayer_answer', '/activity/ivplayer/answers/answer');
            $paths[] = new restore_path_element('ivplayer_vista', '/activity/ivplayer/vistas/vista');
            $paths[] = new restore_path_element('ivplayer_pulso', '/activity/ivplayer/pulsos/pulso');
            $paths[] = new restore_path_element('ivplayer_comentario', '/activity/ivplayer/comentarios/comentario');
        }

        return $this->prepare_activity_structure($paths);
    }

    protected function process_ivplayer($data) {
        global $DB;

        $data = (object)$data;
        $data->course = $this->get_courseid();
        // videourl (GUID de Bunny) entra tal cual con el resto. Un backup de antes de
        // 1.3.0 no lo trae y queda NULL: la actividad sigue con Vimeo.
        // etiquetas (1.4.0): uno de los dos valores (lo que no lo sea, el glosario). Un
        // backup de antes no lo trae y queda el de la columna: el glosario, igual que las
        // actividades que ya existían al hacer el upgrade.
        if (property_exists($data, 'etiquetas')) {
            $data->etiquetas = ivplayer_modo_etiquetas($data->etiquetas);
        }

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

    protected function process_ivplayer_answer($data) {
        global $DB;

        $data = (object)$data;
        $data->ivplayerid = $this->get_new_parentid('ivplayer');
        $data->userid = $this->get_mappingid('user', $data->userid);

        $DB->insert_record('ivplayer_answers', $data);
    }

    // Tramos vistos por día (1.5.0). Un backup de antes no los trae.
    protected function process_ivplayer_vista($data) {
        global $DB;

        $data = (object)$data;
        $data->ivplayerid = $this->get_new_parentid('ivplayer');
        $data->userid = $this->get_mappingid('user', $data->userid);
        if (!$data->userid) {
            return;
        }
        // Una fila por alumno, video y día (clave única): si ya está, no se duplica.
        if ($DB->record_exists('ivplayer_vistas', ['ivplayerid' => $data->ivplayerid, 'userid' => $data->userid, 'dia' => $data->dia])) {
            return;
        }
        $data->sesiones = null;
        $DB->insert_record('ivplayer_vistas', $data);
    }

    // El toque de fin de lección (1.5.0).
    protected function process_ivplayer_pulso($data) {
        global $DB;

        $data = (object)$data;
        $data->ivplayerid = $this->get_new_parentid('ivplayer');
        $data->userid = $this->get_mappingid('user', $data->userid);
        $pulso = $data->userid ? ivplayer_pulso_leer($data->dificultad ?? null, $data->utilidad ?? null) : null;
        if ($pulso === null) {
            return;
        }
        $data->dificultad = $pulso['dificultad'];
        $data->utilidad = $pulso['utilidad'];
        if ($DB->record_exists('ivplayer_pulso', ['ivplayerid' => $data->ivplayerid, 'userid' => $data->userid])) {
            return;
        }
        $DB->insert_record('ivplayer_pulso', $data);
    }

    // Las dudas o comentarios de la tarjeta de fin (1.5.0). Al restaurar no se avisa a nadie.
    protected function process_ivplayer_comentario($data) {
        global $DB;

        $data = (object)$data;
        $data->ivplayerid = $this->get_new_parentid('ivplayer');
        $data->userid = $this->get_mappingid('user', $data->userid);
        $data->texto = ivplayer_comentario_limpio($data->texto ?? null);
        if (!$data->userid || $data->texto === null) {
            return;
        }
        $DB->insert_record('ivplayer_comentarios', $data);
    }

    protected function after_execute() {
        $this->add_related_files('mod_ivplayer', 'intro', null);
    }
}
