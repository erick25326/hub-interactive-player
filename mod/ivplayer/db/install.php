<?php
/**
 * Después de crear las tablas en una instalación nueva del plugin.
 *
 * En un sitio que ya tenía el plugin no corre esto sino db/upgrade.php, que hace lo
 * mismo en su paso de la 1.3.0.
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once(__DIR__ . '/upgradelib.php');

/**
 * @return bool
 */
function xmldb_ivplayer_install() {
    mod_ivplayer_marcar_clave_sensible();
    return true;
}
