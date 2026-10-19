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

    protected function after_execute() {
        $this->add_related_files('mod_ivplayer', 'intro', null);
    }
}
