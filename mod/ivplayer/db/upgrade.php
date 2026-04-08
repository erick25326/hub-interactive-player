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

    return true;
}
