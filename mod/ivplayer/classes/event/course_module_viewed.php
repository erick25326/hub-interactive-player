<?php
namespace mod_ivplayer\event;

defined('MOODLE_INTERNAL') || die();

/**
 * Se abrió una actividad de Video interactivo (view.php, por ivplayer_view()).
 *
 * Es el evento estándar de "módulo visto": el nombre, el CRUD de lectura y el nivel
 * "participación" los pone \core\event\course_module_viewed, así que no hace falta
 * ningún texto propio. Con él, la lección aparece en Registros, en el informe de
 * Actividad del curso y en Participación.
 *
 * 🔴 La clase entra al mapa de clases de Moodle recién con el upgrade (o una purga de
 * cachés). Por eso se subió $plugin->version junto con ella. Mientras el upgrade no
 * corre, ivplayer_view() no la encuentra y no registra la vista (sin romper la lección).
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class course_module_viewed extends \core\event\course_module_viewed {

    protected function init() {
        $this->data['objecttable'] = 'ivplayer';
        parent::init();
    }

    /**
     * Al restaurar un respaldo, el objectid pasa por el mapeo de la instancia (lo arma
     * apply_activity_instance() en restore_ivplayer_stepslib.php).
     */
    public static function get_objectid_mapping() {
        return ['db' => 'ivplayer', 'restore' => 'ivplayer'];
    }
}
