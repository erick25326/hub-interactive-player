<?php
/**
 * Privacy API provider for mod_ivplayer.
 *
 * El plugin guarda datos personales por usuario en ivplayer_progress
 * (progreso/completado del video), ivplayer_answers (respuestas a las
 * interacciones, con el primer intento desde la 1.5.0), ivplayer_vistas (los
 * tramos del video vistos por día, 1.5.0), ivplayer_pulso (el toque de fin de
 * lección, 1.5.0) e ivplayer_comentarios (las dudas que deja al terminar una lección, 1.5.0;
 * el aviso que le llega al equipo es una notificación de Moodle, que declara core_message). Este provider los declara y permite exportarlos/borrarlos
 * ante un pedido de datos (GDPR / Ley 25.326 AR).
 *
 * Bunny Stream (1.3.0) no cambia nada acá: el GUID (ivplayer.videourl) es
 * configuración de la actividad, y la URL firmada no lleva nada del alumno (ni
 * su id ni su IP: la validación por IP de Bunny queda apagada a propósito). El
 * navegador baja el video del CDN igual que antes lo bajaba de Vimeo.
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_ivplayer\privacy;

defined('MOODLE_INTERNAL') || die();

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\helper;
use core_privacy\local\request\transform;
use core_privacy\local\request\userlist;
use core_privacy\local\request\writer;

class provider implements
    \core_privacy\local\metadata\provider,
    \core_privacy\local\request\plugin\provider,
    \core_privacy\local\request\core_userlist_provider {

    /**
     * Describe las tablas con datos personales.
     *
     * @param collection $collection
     * @return collection
     */
    public static function get_metadata(collection $collection): collection {
        $collection->add_database_table('ivplayer_progress', [
            'userid'       => 'privacy:metadata:ivplayer_progress:userid',
            'completed'    => 'privacy:metadata:ivplayer_progress:completed',
            'progress'     => 'privacy:metadata:ivplayer_progress:progress',
            'timemodified' => 'privacy:metadata:ivplayer_progress:timemodified',
        ], 'privacy:metadata:ivplayer_progress');

        $collection->add_database_table('ivplayer_answers', [
            'userid'        => 'privacy:metadata:ivplayer_answers:userid',
            'interactionid' => 'privacy:metadata:ivplayer_answers:interactionid',
            'answer'        => 'privacy:metadata:ivplayer_answers:answer',
            'correct'       => 'privacy:metadata:ivplayer_answers:correct',
            'timemodified'  => 'privacy:metadata:ivplayer_answers:timemodified',
            'firstanswer'   => 'privacy:metadata:ivplayer_answers:firstanswer',
            'firstcorrect'  => 'privacy:metadata:ivplayer_answers:firstcorrect',
            'attempts'      => 'privacy:metadata:ivplayer_answers:attempts',
            'timefirst'     => 'privacy:metadata:ivplayer_answers:timefirst',
        ], 'privacy:metadata:ivplayer_answers');

        $collection->add_database_table('ivplayer_vistas', [
            'userid'       => 'privacy:metadata:ivplayer_vistas:userid',
            'dia'          => 'privacy:metadata:ivplayer_vistas:dia',
            'tramos'       => 'privacy:metadata:ivplayer_vistas:tramos',
            'duracion'     => 'privacy:metadata:ivplayer_vistas:duracion',
            'segundos'     => 'privacy:metadata:ivplayer_vistas:segundos',
            'sesiones'     => 'privacy:metadata:ivplayer_vistas:sesiones',
            'timemodified' => 'privacy:metadata:ivplayer_vistas:timemodified',
        ], 'privacy:metadata:ivplayer_vistas');

        $collection->add_database_table('ivplayer_pulso', [
            'userid'       => 'privacy:metadata:ivplayer_pulso:userid',
            'dificultad'   => 'privacy:metadata:ivplayer_pulso:dificultad',
            'utilidad'     => 'privacy:metadata:ivplayer_pulso:utilidad',
            'timecreated'  => 'privacy:metadata:ivplayer_pulso:timecreated',
            'timemodified' => 'privacy:metadata:ivplayer_pulso:timemodified',
        ], 'privacy:metadata:ivplayer_pulso');

        $collection->add_database_table('ivplayer_comentarios', [
            'userid'      => 'privacy:metadata:ivplayer_comentarios:userid',
            'texto'       => 'privacy:metadata:ivplayer_comentarios:texto',
            'timecreated' => 'privacy:metadata:ivplayer_comentarios:timecreated',
        ], 'privacy:metadata:ivplayer_comentarios');

        return $collection;
    }

    /**
     * Contextos (módulos ivplayer) donde el usuario tiene datos.
     *
     * @param int $userid
     * @return contextlist
     */
    public static function get_contexts_for_userid(int $userid): contextlist {
        $contextlist = new contextlist();

        $sql = "SELECT ctx.id
                  FROM {context} ctx
                  JOIN {course_modules} cm ON cm.id = ctx.instanceid AND ctx.contextlevel = :modlevel
                  JOIN {modules} m ON m.id = cm.module AND m.name = :modname
                  JOIN {ivplayer} iv ON iv.id = cm.instance
             LEFT JOIN {ivplayer_progress} ip ON ip.ivplayerid = iv.id AND ip.userid = :userid1
             LEFT JOIN {ivplayer_answers} ia ON ia.ivplayerid = iv.id AND ia.userid = :userid2
                 WHERE ip.id IS NOT NULL OR ia.id IS NOT NULL";

        $contextlist->add_from_sql($sql, [
            'modlevel' => CONTEXT_MODULE,
            'modname'  => 'ivplayer',
            'userid1'  => $userid,
            'userid2'  => $userid,
        ]);

        // Las tablas de la 1.5.0, aparte: un LEFT JOIN más por tabla multiplicaba las filas
        // (una por día en ivplayer_vistas).
        foreach (['ivplayer_vistas', 'ivplayer_pulso', 'ivplayer_comentarios'] as $tabla) {
            $sql = "SELECT ctx.id
                      FROM {context} ctx
                      JOIN {course_modules} cm ON cm.id = ctx.instanceid AND ctx.contextlevel = :modlevel
                      JOIN {modules} m ON m.id = cm.module AND m.name = :modname
                      JOIN {{$tabla}} t ON t.ivplayerid = cm.instance
                     WHERE t.userid = :userid";
            $contextlist->add_from_sql($sql, ['modlevel' => CONTEXT_MODULE, 'modname' => 'ivplayer', 'userid' => $userid]);
        }

        return $contextlist;
    }

    /**
     * Usuarios con datos dentro de un contexto (módulo).
     *
     * @param userlist $userlist
     */
    public static function get_users_in_context(userlist $userlist) {
        $context = $userlist->get_context();
        if (!$context instanceof \context_module) {
            return;
        }

        $params = [
            'modlevel'   => CONTEXT_MODULE,
            'modname'    => 'ivplayer',
            'contextid'  => $context->id,
        ];

        $sql = "SELECT ip.userid
                  FROM {ivplayer_progress} ip
                  JOIN {ivplayer} iv ON iv.id = ip.ivplayerid
                  JOIN {course_modules} cm ON cm.instance = iv.id
                  JOIN {modules} m ON m.id = cm.module AND m.name = :modname
                  JOIN {context} ctx ON ctx.instanceid = cm.id AND ctx.contextlevel = :modlevel
                 WHERE ctx.id = :contextid";
        $userlist->add_from_sql('userid', $sql, $params);

        $sql = "SELECT ia.userid
                  FROM {ivplayer_answers} ia
                  JOIN {ivplayer} iv ON iv.id = ia.ivplayerid
                  JOIN {course_modules} cm ON cm.instance = iv.id
                  JOIN {modules} m ON m.id = cm.module AND m.name = :modname
                  JOIN {context} ctx ON ctx.instanceid = cm.id AND ctx.contextlevel = :modlevel
                 WHERE ctx.id = :contextid";
        $userlist->add_from_sql('userid', $sql, $params);

        foreach (['ivplayer_vistas', 'ivplayer_pulso', 'ivplayer_comentarios'] as $tabla) {
            $sql = "SELECT t.userid
                      FROM {{$tabla}} t
                      JOIN {ivplayer} iv ON iv.id = t.ivplayerid
                      JOIN {course_modules} cm ON cm.instance = iv.id
                      JOIN {modules} m ON m.id = cm.module AND m.name = :modname
                      JOIN {context} ctx ON ctx.instanceid = cm.id AND ctx.contextlevel = :modlevel
                     WHERE ctx.id = :contextid";
            $userlist->add_from_sql('userid', $sql, $params);
        }
    }

    /**
     * Exporta los datos del usuario para los contextos aprobados.
     *
     * @param approved_contextlist $contextlist
     */
    public static function export_user_data(approved_contextlist $contextlist) {
        global $DB;

        $userid = $contextlist->get_user()->id;

        foreach ($contextlist->get_contexts() as $context) {
            if (!$context instanceof \context_module) {
                continue;
            }
            $cm = get_coursemodule_from_id('ivplayer', $context->instanceid);
            if (!$cm) {
                continue;
            }

            $data = helper::get_context_data($context, $contextlist->get_user());

            $progress = $DB->get_record('ivplayer_progress', ['ivplayerid' => $cm->instance, 'userid' => $userid]);
            if ($progress) {
                $data->progress = (object) [
                    'completed'    => transform::yesno($progress->completed),
                    'progress'     => $progress->progress,
                    'timemodified' => transform::datetime($progress->timemodified),
                ];
            }

            $answers = $DB->get_records('ivplayer_answers', ['ivplayerid' => $cm->instance, 'userid' => $userid]);
            if ($answers) {
                $data->answers = array_values(array_map(function ($a) {
                    return (object) [
                        'interactionid' => $a->interactionid,
                        'answer'        => $a->answer,
                        'correct'       => transform::yesno($a->correct),
                        'timemodified'  => transform::datetime($a->timemodified),
                        // Primer intento (1.5.0). En las de antes, desconocido: null.
                        'firstanswer'   => $a->firstanswer ?? null,
                        'firstcorrect'  => isset($a->firstcorrect) ? transform::yesno($a->firstcorrect) : null,
                        'attempts'      => isset($a->attempts) ? (int) $a->attempts : null,
                        'timefirst'     => isset($a->timefirst) ? transform::datetime($a->timefirst) : null,
                    ];
                }, $answers));
            }

            // Los tramos vistos por día (1.5.0): una cifra por tramo de 5 s.
            $vistas = $DB->get_records('ivplayer_vistas', ['ivplayerid' => $cm->instance, 'userid' => $userid], 'dia');
            if ($vistas) {
                $data->vistas = array_values(array_map(function ($v) {
                    return (object) [
                        'dia'          => (int) $v->dia,
                        'tramos'       => $v->tramos,
                        'duracion'     => (int) $v->duracion,
                        'segundos'     => (int) $v->segundos,
                        'timemodified' => transform::datetime($v->timemodified),
                    ];
                }, $vistas));
            }

            // El toque de fin de lección (1.5.0).
            $pulso = $DB->get_record('ivplayer_pulso', ['ivplayerid' => $cm->instance, 'userid' => $userid]);
            if ($pulso) {
                $data->pulso = (object) [
                    'dificultad'   => $pulso->dificultad ? get_string('pulso_' . $pulso->dificultad, 'ivplayer') : null,
                    'utilidad'     => $pulso->utilidad ? get_string('pulso_' . $pulso->utilidad, 'ivplayer') : null,
                    'timecreated'  => transform::datetime($pulso->timecreated),
                    'timemodified' => transform::datetime($pulso->timemodified),
                ];
            }

            // Las dudas o comentarios que dejó al terminar la lección (1.5.0).
            $comentarios = $DB->get_records('ivplayer_comentarios', ['ivplayerid' => $cm->instance, 'userid' => $userid], 'timecreated');
            if ($comentarios) {
                $data->comentarios = array_values(array_map(function ($c) {
                    return (object) ['texto' => $c->texto, 'timecreated' => transform::datetime($c->timecreated)];
                }, $comentarios));
            }

            writer::with_context($context)->export_data([], $data);
        }
    }

    /**
     * Borra los datos de TODOS los usuarios en un contexto (módulo).
     *
     * @param \context $context
     */
    public static function delete_data_for_all_users_in_context(\context $context) {
        global $DB;

        if (!$context instanceof \context_module) {
            return;
        }
        $cm = get_coursemodule_from_id('ivplayer', $context->instanceid);
        if (!$cm) {
            return;
        }

        $DB->delete_records('ivplayer_progress', ['ivplayerid' => $cm->instance]);
        $DB->delete_records('ivplayer_answers', ['ivplayerid' => $cm->instance]);
        $DB->delete_records('ivplayer_vistas', ['ivplayerid' => $cm->instance]);
        $DB->delete_records('ivplayer_pulso', ['ivplayerid' => $cm->instance]);
        $DB->delete_records('ivplayer_comentarios', ['ivplayerid' => $cm->instance]);
    }

    /**
     * Borra los datos del usuario en los contextos aprobados.
     *
     * @param approved_contextlist $contextlist
     */
    public static function delete_data_for_user(approved_contextlist $contextlist) {
        global $DB;

        $userid = $contextlist->get_user()->id;

        foreach ($contextlist->get_contexts() as $context) {
            if (!$context instanceof \context_module) {
                continue;
            }
            $cm = get_coursemodule_from_id('ivplayer', $context->instanceid);
            if (!$cm) {
                continue;
            }
            $DB->delete_records('ivplayer_progress', ['ivplayerid' => $cm->instance, 'userid' => $userid]);
            $DB->delete_records('ivplayer_answers', ['ivplayerid' => $cm->instance, 'userid' => $userid]);
            $DB->delete_records('ivplayer_vistas', ['ivplayerid' => $cm->instance, 'userid' => $userid]);
            $DB->delete_records('ivplayer_pulso', ['ivplayerid' => $cm->instance, 'userid' => $userid]);
            $DB->delete_records('ivplayer_comentarios', ['ivplayerid' => $cm->instance, 'userid' => $userid]);
        }
    }

    /**
     * Borra los datos de una lista aprobada de usuarios en un contexto.
     *
     * @param approved_userlist $userlist
     */
    public static function delete_data_for_users(approved_userlist $userlist) {
        global $DB;

        $context = $userlist->get_context();
        if (!$context instanceof \context_module) {
            return;
        }
        $cm = get_coursemodule_from_id('ivplayer', $context->instanceid);
        if (!$cm) {
            return;
        }

        $userids = $userlist->get_userids();
        if (empty($userids)) {
            return;
        }

        list($insql, $inparams) = $DB->get_in_or_equal($userids, SQL_PARAMS_NAMED);
        $params = array_merge(['ivplayerid' => $cm->instance], $inparams);

        $DB->delete_records_select('ivplayer_progress', "ivplayerid = :ivplayerid AND userid {$insql}", $params);
        $DB->delete_records_select('ivplayer_answers', "ivplayerid = :ivplayerid AND userid {$insql}", $params);
        $DB->delete_records_select('ivplayer_vistas', "ivplayerid = :ivplayerid AND userid {$insql}", $params);
        $DB->delete_records_select('ivplayer_pulso', "ivplayerid = :ivplayerid AND userid {$insql}", $params);
        $DB->delete_records_select('ivplayer_comentarios', "ivplayerid = :ivplayerid AND userid {$insql}", $params);
    }
}
