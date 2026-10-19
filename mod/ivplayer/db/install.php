<?php
/**
 * Después de crear las tablas en una instalación nueva del plugin.
 *
 * En un sitio que ya tenía el plugin no corre esto sino db/upgrade.php, que hace lo
 * mismo en sus pasos: la clave de Bunny en la lista de ajustes sensibles (1.3.0) y el
 * secreto de los subtítulos para la TV (2026101904).
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
    mod_ivplayer_crear_secreto_subtitulos();
    return true;
}
