<?php
defined('MOODLE_INTERNAL') || die();

function xmldb_ivplayer_upgrade($oldversion) {
    global $DB;
    $dbman = $DB->get_manager();

    if ($oldversion < 2026040210) {
        $table = new xmldb_table('ivplayer');
        $field = new xmldb_field('videoloop', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'vimeohash');

        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_mod_savepoint(true, 2026040210, 'ivplayer');
    }

    if ($oldversion < 2026061000) {
        // Add completioninteractions field to ivplayer.
        $table = new xmldb_table('ivplayer');
        $field = new xmldb_field('completioninteractions', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0', 'interactions');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        // Create ivplayer_progress table.
        $table = new xmldb_table('ivplayer_progress');
        $table->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
        $table->add_field('ivplayerid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
        $table->add_field('userid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
        $table->add_field('completed', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0');
        $table->add_field('progress', XMLDB_TYPE_TEXT, null, null, null, null, null);
        $table->add_field('timemodified', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
        $table->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
        $table->add_key('ivplayerid', XMLDB_KEY_FOREIGN, ['ivplayerid'], 'ivplayer', ['id']);
        $table->add_key('userid', XMLDB_KEY_FOREIGN, ['userid'], 'user', ['id']);
        $table->add_key('ivplayerid-userid', XMLDB_KEY_UNIQUE, ['ivplayerid', 'userid']);
        if (!$dbman->table_exists($table)) {
            $dbman->create_table($table);
        }

        upgrade_mod_savepoint(true, 2026061000, 'ivplayer');
    }

    if ($oldversion < 2026061001) {
        // Add grade field. Default 0 (no grading) so existing activities
        // don't suddenly appear in the gradebook; new ones default to 100
        // via the form.
        $table = new xmldb_table('ivplayer');
        $field = new xmldb_field('grade', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0', 'completioninteractions');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        // Create ivplayer_answers table.
        $table = new xmldb_table('ivplayer_answers');
        $table->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
        $table->add_field('ivplayerid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
        $table->add_field('userid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
        $table->add_field('interactionid', XMLDB_TYPE_CHAR, '64', null, XMLDB_NOTNULL, null, '');
        $table->add_field('answer', XMLDB_TYPE_CHAR, '255', null, null, null, null);
        $table->add_field('correct', XMLDB_TYPE_INTEGER, '1', null, XMLDB_NOTNULL, null, '0');
        $table->add_field('timemodified', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
        $table->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
        $table->add_key('ivplayerid', XMLDB_KEY_FOREIGN, ['ivplayerid'], 'ivplayer', ['id']);
        $table->add_key('userid', XMLDB_KEY_FOREIGN, ['userid'], 'user', ['id']);
        $table->add_key('ivplayerid-userid-interactionid', XMLDB_KEY_UNIQUE, ['ivplayerid', 'userid', 'interactionid']);
        if (!$dbman->table_exists($table)) {
            $dbman->create_table($table);
        }

        upgrade_mod_savepoint(true, 2026061001, 'ivplayer');
    }

    if ($oldversion < 2026101000) {
        // Video de Bunny Stream: guarda SÓLO el GUID, en minúsculas (el host y la clave
        // son ajustes del sitio). NULL en todas las actividades existentes, así que
        // después del upgrade todas siguen reproduciendo Vimeo como antes.
        $table = new xmldb_table('ivplayer');
        $field = new xmldb_field('videourl', XMLDB_TYPE_CHAR, '255', null, null, null, null, 'vimeohash');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        // La clave de token de Bunny (ajuste nuevo de esta versión) no tiene que salir en
        // la exportación de presets del sitio. Una instalación nueva lo hace en install.php.
        require_once(__DIR__ . '/upgradelib.php');
        mod_ivplayer_marcar_clave_sensible();

        upgrade_mod_savepoint(true, 2026101000, 'ivplayer');
    }

    if ($oldversion < 2026101903) {
        // Modo de las etiquetas (1.4.0): 'glosario' (el glosario interactivo, el nuevo por
        // defecto) o 'pantalla' (los pines sobre el video, como hasta ahora: el respaldo,
        // por actividad). Las actividades que ya existen quedan con el de por defecto, el
        // glosario. Lo lee player.php (ivplayer_config_base). Mismo campo que install.xml:
        // tests/php/correr.php los compara.
        $table = new xmldb_table('ivplayer');
        $field = new xmldb_field('etiquetas', XMLDB_TYPE_CHAR, '16', null, XMLDB_NOTNULL, null, 'glosario', 'videoloop');
        if (!$dbman->field_exists($table, $field)) {
            $dbman->add_field($table, $field);
        }

        upgrade_mod_savepoint(true, 2026101903, 'ivplayer');
    }

    if ($oldversion < 2026101904) {
        // Subtítulos en la TV (1.4.0): el secreto con que player.php y firma.php firman el
        // enlace de subtitulos.php (la TV baja el VTT sin la sesión del campus). Si ya hay
        // uno, no se toca. Una instalación nueva lo crea en install.php. Sin este paso
        // (código nuevo, upgrade sin correr) no se le ofrece la pista a la TV y el celular
        // sigue dibujando los subtítulos, como antes.
        require_once(__DIR__ . '/upgradelib.php');
        mod_ivplayer_crear_secreto_subtitulos();

        upgrade_mod_savepoint(true, 2026101904, 'ivplayer');
    }

    return true;
}
