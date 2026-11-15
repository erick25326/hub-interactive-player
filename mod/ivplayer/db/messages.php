<?php
/**
 * Notificaciones de mod_ivplayer.
 *
 * comentario (1.5.0): un alumno dejó una duda o comentario en la tarjeta de fin de una
 * lección. Les llega a los administradores del sitio y a quien tenga
 * mod/ivplayer:recibircomentarios (ivplayer_comentario_avisar, lib.php). Por defecto, por
 * mail y en la campanita; cada uno lo puede cambiar en sus preferencias de notificación.
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$messageproviders = [
    'comentario' => [
        'defaults' => [
            'popup' => MESSAGE_PERMITTED + MESSAGE_DEFAULT_ENABLED,
            'email' => MESSAGE_PERMITTED + MESSAGE_DEFAULT_ENABLED,
        ],
    ],
];
