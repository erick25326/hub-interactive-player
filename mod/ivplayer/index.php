<?php
require_once(__DIR__ . '/../../config.php');

$id = required_param('id', PARAM_INT); // Course ID.
$course = $DB->get_record('course', ['id' => $id], '*', MUST_EXIST);

require_login($course);
$PAGE->set_url('/mod/ivplayer/index.php', ['id' => $id]);
$PAGE->set_title($course->fullname);
$PAGE->set_heading($course->fullname);

echo $OUTPUT->header();

$activities = get_all_instances_in_course('ivplayer', $course);

if (empty($activities)) {
    notice(get_string('noinstances', 'moodle'), new moodle_url('/course/view.php', ['id' => $id]));
}

$table = new html_table();
$table->head = ['#', get_string('name'), get_string('description')];
$table->data = [];

foreach ($activities as $i => $activity) {
    $link = html_writer::link(
        new moodle_url('/mod/ivplayer/view.php', ['id' => $activity->coursemodule]),
        format_string($activity->name)
    );
    $table->data[] = [$i + 1, $link, format_text($activity->intro, $activity->introformat)];
}

echo html_writer::table($table);
echo $OUTPUT->footer();
