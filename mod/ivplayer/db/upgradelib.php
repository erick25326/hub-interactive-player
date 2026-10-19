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
    mod_ivplayer_marcar_sensible('bunnytokenkey@@mod_ivplayer');
}

/**
 * Agrega un ajuste del plugin ("nombre@@mod_ivplayer") a los "ajustes sensibles" del sitio
 * (adminpresets | sensiblesettings), los que la exportación de presets saltea.
 *
 * Lo de mod_ivplayer_marcar_clave_sensible, para cualquier ajuste. Idempotente.
 *
 * @param string $entrada "nombre@@mod_ivplayer".
 */
function mod_ivplayer_marcar_sensible(string $entrada): void {
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

/**
 * Crea, si falta, el secreto con que se firman los enlaces de subtítulos para la TV
 * (subtitulos.php; ver "Subtítulos en la TV" en lib.php).
 *
 * 32 bytes al azar (random_bytes) en base64url, sin "=": 43 caracteres. Se guarda con
 * set_config, que NO lo anota en el registro de cambios de configuración (eso lo hacen los
 * ajustes del panel, y éste no es uno: no hay campo que lo muestre ni lo edite, así que
 * tampoco sale en la exportación de presets, que recorre los del panel). Igual entra en la
 * lista de ajustes sensibles, como la clave de Bunny, por si algún día tiene un campo.
 * 🔴 Uno que ya existe NO se cambia: rotarlo deja sin subtítulos a las TVs que ya los
 * cargaron con la firma vieja hasta la próxima renovación. Para rotarlo a propósito, el
 * README ("Subtítulos en la TV") dice cómo.
 *
 * Idempotente: corre en la instalación (install.php) y en el upgrade a 2026101904.
 */
function mod_ivplayer_crear_secreto_subtitulos(): void {
    $actual = get_config('mod_ivplayer', 'subtitulossecreto');
    if (!is_string($actual) || strlen(trim($actual)) < 32) {
        $secreto = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        set_config('subtitulossecreto', $secreto, 'mod_ivplayer');
    }
    mod_ivplayer_marcar_sensible('subtitulossecreto@@mod_ivplayer');
}
