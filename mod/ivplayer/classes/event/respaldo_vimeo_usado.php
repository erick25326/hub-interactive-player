<?php
namespace mod_ivplayer\event;

defined('MOODLE_INTERNAL') || die();

/**
 * La red de seguridad pasó una lección de Bunny a Vimeo (respaldo.php, por
 * ivplayer_respaldo_registrar()).
 *
 * Una fila por salto, con la causa en `other`:
 *   causa    'http-404', 'http-5NN' (el CDN contestó con ese error), 'red' (no se llegó al
 *            CDN o lo que llegó no servía), 'medio' (error fatal del medio) u 'otro'.
 *   codigo   el código HTTP (0 si no hubo).
 *   detalle  el nombre del error (hls.js: manifestLoadError = el playlist,
 *            levelLoadError = el de una calidad, fragLoadError = un segmento).
 * Es lo que se cuenta para separar "falla de Bunny" de "señal mala" (README, "Red de
 * seguridad"). La firma vencida y la sesión cerrada no saltan, así que acá no aparecen.
 *
 * Nivel "otro" (no es participación ni enseñanza: no cuenta en los informes de
 * participación) y de lectura. La descripción va en inglés y sin traducir, como las de
 * core (Moodle la guarda armada).
 *
 * 🔴 La clase entra al mapa de clases de Moodle recién con el upgrade (o una purga de
 * cachés): por eso se subió $plugin->version junto con ella, y por eso
 * ivplayer_respaldo_registrar() pregunta class_exists antes de usarla.
 *
 * @package    mod_ivplayer
 * @copyright  Hub Education
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class respaldo_vimeo_usado extends \core\event\base {

    protected function init() {
        $this->data['crud'] = 'r';
        $this->data['edulevel'] = self::LEVEL_OTHER;
        $this->data['objecttable'] = 'ivplayer';
    }

    public static function get_name() {
        return get_string('eventrespaldovimeo', 'mod_ivplayer');
    }

    public function get_description() {
        $causa = (string) ($this->other['causa'] ?? '');
        $codigo = (int) ($this->other['codigo'] ?? 0);
        $detalle = (string) ($this->other['detalle'] ?? '');
        return "The user with id '$this->userid' could not play the Bunny Stream video of the interactive video "
            . "with course module id '$this->contextinstanceid' and the lesson was reloaded with Vimeo "
            . "(cause '$causa', HTTP code $codigo, detail '$detalle').";
    }

    public function get_url() {
        return new \moodle_url('/mod/ivplayer/view.php', ['id' => $this->contextinstanceid]);
    }

    protected function validate_data() {
        parent::validate_data();
        if (empty($this->other['causa'])) {
            throw new \coding_exception('Falta other[causa]: sin la causa el salto no se puede contar.');
        }
        if ($this->contextlevel != CONTEXT_MODULE) {
            throw new \coding_exception('El contexto tiene que ser el del módulo.');
        }
    }

    /**
     * Al restaurar un respaldo del curso con sus registros, el objectid pasa por el mapeo
     * de la instancia (como el evento de vista).
     */
    public static function get_objectid_mapping() {
        return ['db' => 'ivplayer', 'restore' => 'ivplayer'];
    }

    /**
     * En `other` no hay ids (causa, código y detalle): nada que mapear al restaurar.
     */
    public static function get_other_mapping() {
        return false;
    }
}
