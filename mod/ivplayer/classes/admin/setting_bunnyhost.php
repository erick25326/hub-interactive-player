<?php
/**
 * Ajuste del host del CDN de Bunny, con un error que dice qué está mal.
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_ivplayer\admin;

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->libdir . '/adminlib.php');
require_once($CFG->dirroot . '/mod/ivplayer/lib.php');

/**
 * Texto que guarda sólo el host (vz-xxxx.b-cdn.net).
 *
 * Lo natural es copiar del panel de Bunny una URL entera (https://host/…). En vez de
 * rechazarla con el "valor no válido" genérico de Moodle, se le saca el esquema y la
 * ruta y se guarda el host. Si ni así es un host, el error dice el formato esperado.
 */
class setting_bunnyhost extends \admin_setting_configtext {

    /**
     * Normaliza antes de guardar.
     *
     * @param string $data
     * @return string '' si se guardó; el mensaje de error si no.
     */
    public function write_setting($data) {
        $host = \ivplayer_bunny_normalizar_host($data);
        if ($host === null) {
            return get_string('errorbunnyhost', 'ivplayer');
        }
        return parent::write_setting($host);
    }
}
