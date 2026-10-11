<?php
/**
 * Funciones que comparten db/install.php y db/upgrade.php.
 *
 * Viven acá y no en lib.php porque un paso de upgrade tiene que hacer siempre lo mismo,
 * aunque lib.php cambie en versiones futuras.
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Agrega la clave de token de Bunny a los "ajustes sensibles" del sitio.
 *
 * 🔴 Con esa clave cualquiera firma URLs de CUALQUIER video de la biblioteca, por el
 * tiempo que quiera. Que el ajuste sea de tipo "password" la enmascara en pantalla y en
 * el registro de cambios, pero NO la saca de la exportación de "Presets de
 * administración del sitio": esa exportación saltea sólo los ajustes de la lista
 * adminpresets | sensiblesettings, que trae los de core y ninguno de este plugin. Se
 * agrega igual que lo hace el upgrade de core (paso 2024080500) con los suyos.
 *
 * Es idempotente, y si el admin la saca a mano de la lista, no vuelve a menos que se
 * reinstale el plugin.
 */
function mod_ivplayer_marcar_clave_sensible(): void {
    $entrada = 'bunnytokenkey@@mod_ivplayer';
    $lista = get_config('adminpresets', 'sensiblesettings');
    // Sin la lista (un sitio a medio instalar, antes de que core cargue sus valores por
    // defecto) no se crea: una lista con sólo esta entrada dejaría afuera las de core,
    // como la contraseña del SMTP, y ésas pasarían a exportarse.
    if (!is_string($lista) || trim($lista) === '') {
        return;
    }
    $entradas = array_map('trim', explode(',', $lista));
    if (in_array($entrada, $entradas, true)) {
        return;
    }
    set_config('sensiblesettings', rtrim($lista, " ,") . ', ' . $entrada, 'adminpresets');
}
