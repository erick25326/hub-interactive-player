<?php
defined('MOODLE_INTERNAL') || die();

$capabilities = [
    'mod/ivplayer:addinstance' => [
        'riskbitmask' => RISK_XSS,
        'captype' => 'write',
        'contextlevel' => CONTEXT_COURSE,
        'archetypes' => [
            'editingteacher' => CAP_ALLOW,
            'manager' => CAP_ALLOW,
        ],
        'clonepermissionsfrom' => 'moodle/course:manageactivities',
    ],
    'mod/ivplayer:view' => [
        'captype' => 'read',
        'contextlevel' => CONTEXT_MODULE,
        'archetypes' => [
            'student' => CAP_ALLOW,
            'teacher' => CAP_ALLOW,
            'editingteacher' => CAP_ALLOW,
            'manager' => CAP_ALLOW,
        ],
    ],
    // Recibir el aviso de las dudas y comentarios que dejan los alumnos al terminar una
    // lección (1.5.0). Sin rol por defecto: les llega a los administradores del sitio y a
    // quien se le dé este permiso (por ejemplo, el profesor de un curso).
    'mod/ivplayer:recibircomentarios' => [
        'captype' => 'read',
        'contextlevel' => CONTEXT_MODULE,
        'archetypes' => [],
    ],
];
