<?php
/**
 * Ajustes del sitio para mod_ivplayer: el video de Bunny Stream.
 *
 * Moodle crea $settings (la página "modsettingivplayer") antes de incluir este
 * archivo. Se llega desde Administración del sitio > Plugins > Módulos de actividad >
 * Video Interactivo.
 *
 * 🔴 El repo es PÚBLICO: acá van sólo los NOMBRES de los ajustes y sus valores por
 * defecto vacíos. El host de producción y la clave se cargan en el panel de Moodle.
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

if ($ADMIN->fulltree) {
    require_once($CFG->dirroot . '/mod/ivplayer/lib.php');

    // El estado se calcula de lo que está guardado, para que el admin vea de un vistazo
    // qué tiene que estar prendido del lado de Bunny. Es la trampa más fácil de pisar:
    // firmar con el token apagado da 404, y no firmar con el token prendido da 403.
    if (ivplayer_bunny_host() === '') {
        $estado = get_string('bunnyestado_apagado', 'ivplayer');
    } else if (!ivplayer_reproductor_soporta_bunny(ivplayer_reproductor_html() ?? '')) {
        // Va antes que la firma: con el player.html viejo, player.php no usa Bunny en
        // ninguna actividad (ver ivplayer_reproductor_soporta_bunny), firme o no.
        $estado = get_string('bunnyestado_reproductorviejo', 'ivplayer');
    } else if (ivplayer_bunny_clave() === '') {
        $estado = get_string('bunnyestado_sinfirma', 'ivplayer');
    } else {
        $estado = get_string('bunnyestado_firmado', 'ivplayer');
    }

    $settings->add(new admin_setting_heading('mod_ivplayer/bunnyheading',
        get_string('bunnyheading', 'ivplayer'),
        get_string('bunnyheading_desc', 'ivplayer', $estado)));

    // Vacío = Bunny apagado en todo el sitio: las actividades siguen con Vimeo aunque
    // tengan un GUID cargado. Por eso instalar esta versión no cambia nada hasta acá.
    $settings->add(new \mod_ivplayer\admin\setting_bunnyhost('mod_ivplayer/bunnyhost',
        get_string('bunnyhost', 'ivplayer'),
        get_string('bunnyhost_desc', 'ivplayer'),
        '', PARAM_RAW_TRIMMED));

    // Opcional. Los enlaces del reproductor de Bunny traen el número de biblioteca y no
    // el host: con esto el formulario rechaza los de otra biblioteca (ver
    // ivplayer_bunny_error_de_entrada). Vacío = no se controla.
    $settings->add(new admin_setting_configtext('mod_ivplayer/bunnylibraryid',
        get_string('bunnylibraryid', 'ivplayer'),
        get_string('bunnylibraryid_desc', 'ivplayer'),
        '', PARAM_INT, 12));

    // 🔴 La clave firma en el servidor y no sale nunca al navegador del alumno. Con el
    // tipo "password unmask" el admin la ve enmascarada y el registro de cambios de
    // configuración la anota como asteriscos.
    // 🔴 Eso NO la saca de la exportación de "Presets de administración del sitio": ahí
    // sólo se saltean los ajustes de la lista adminpresets | sensiblesettings, y por eso
    // la instalación y el upgrade de la 1.3.0 la agregan a esa lista (db/upgradelib.php).
    $settings->add(new admin_setting_configpasswordunmask('mod_ivplayer/bunnytokenkey',
        get_string('bunnytokenkey', 'ivplayer'),
        get_string('bunnytokenkey_desc', 'ivplayer'),
        ''));

    // Se guarda en segundos; el selector de unidad es sólo para cargarlo cómodo (6 horas).
    $ttl = new admin_setting_configduration('mod_ivplayer/bunnytokenttl',
        get_string('bunnytokenttl', 'ivplayer'),
        get_string('bunnytokenttl_desc', 'ivplayer'),
        IVPLAYER_BUNNY_TTL_DEFAULT, HOURSECS);
    // Los topes se avisan al guardar. Antes se aplicaban callados en ivplayer_bunny_ttl():
    // el panel mostraba "30 minutos" o "2 semanas" y se usaba 1 hora o 7 días. Ese
    // recorte queda allá de red para los valores que no pasan por acá (CLI, config.php).
    // set_validate_function existe en este tipo de ajuste desde Moodle 4.1 y recibe los
    // segundos ya calculados.
    $ttl->set_validate_function(function($segundos): string {
        $segundos = (int) $segundos;
        if ($segundos >= IVPLAYER_BUNNY_TTL_MIN && $segundos <= IVPLAYER_BUNNY_TTL_MAX) {
            return '';
        }
        return get_string('errorbunnyttl', 'ivplayer');
    });
    $settings->add($ttl);

    // Red de seguridad (plan Bunny 0.4): si el CDN de Bunny falla, la lección se recarga
    // con el Vimeo de la actividad (player.php ?origen=vimeo; ver respaldo.php y
    // src/respaldo.js). APAGADA por defecto: se instala apagada y se prende recién
    // probada en test-academy. Apagarla es la vuelta atrás. Hay que apagarla también el
    // día en que los videos de Vimeo pasan a privados: si no, salta a un video que no se ve.
    $settings->add(new admin_setting_configcheckbox('mod_ivplayer/respaldovimeo',
        get_string('respaldovimeo', 'ivplayer'),
        get_string('respaldovimeo_desc', 'ivplayer'),
        0));

    // Transmitir a la TV desde la app de Hub Education (reproductor 1.4.0, protocolo
    // ivcast). Apagada por defecto: el reproductor sale antes que la app, y mientras la
    // versión con Chromecast no esté en Play nadie tiene que leer "actualizá la app". Va
    // al reproductor en MOODLE_CONTEXT.appCastPublicada (player.php).
    $settings->add(new admin_setting_heading('mod_ivplayer/appheading',
        get_string('appheading', 'ivplayer'),
        get_string('appheading_desc', 'ivplayer')));
    $settings->add(new admin_setting_configcheckbox('mod_ivplayer/appcastpublicada',
        get_string('appcastpublicada', 'ivplayer'),
        get_string('appcastpublicada_desc', 'ivplayer'),
        0));
}
