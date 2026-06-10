<?php
namespace mod_ivplayer\completion;

use core_completion\activity_custom_completion;

defined('MOODLE_INTERNAL') || die();

/**
 * Custom completion rules for mod_ivplayer.
 *
 * Rule "completioninteractions": the student must finish the video and
 * all its interactions (reported by the player via complete.php).
 */
class custom_completion extends activity_custom_completion {

    public function get_state(string $rule): int {
        global $DB;

        $this->validate_rule($rule);

        $done = $DB->record_exists('ivplayer_progress', [
            'ivplayerid' => $this->cm->instance,
            'userid' => $this->userid,
            'completed' => 1,
        ]);

        return $done ? COMPLETION_COMPLETE : COMPLETION_INCOMPLETE;
    }

    public static function get_defined_custom_rules(): array {
        return ['completioninteractions'];
    }

    public function get_custom_rule_descriptions(): array {
        return [
            'completioninteractions' => get_string('completiondetail:interactions', 'ivplayer'),
        ];
    }

    public function get_sort_order(): array {
        return ['completionview', 'completioninteractions'];
    }
}
