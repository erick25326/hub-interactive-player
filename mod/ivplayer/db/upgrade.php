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

    return true;
}
