<?php
defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/course/moodleform_mod.php');
require_once($CFG->dirroot . '/mod/ivplayer/lib.php');

class mod_ivplayer_mod_form extends moodleform_mod {

    public function definition() {
        $mform = $this->_form;

        // General section.
        $mform->addElement('header', 'general', get_string('general', 'form'));

        $mform->addElement('text', 'name', get_string('modulename', 'ivplayer'), ['size' => '64']);
        $mform->setType('name', PARAM_TEXT);
        $mform->addRule('name', null, 'required', null, 'client');
        $mform->addRule('name', get_string('maximumchars', '', 255), 'maxlength', 255, 'client');

        $this->standard_intro_elements();

        // Video section.
        $mform->addElement('header', 'videosection', 'Video');
        // Moodle abre solas las secciones con un campo obligatorio. Al sacarle el
        // 'required' a Vimeo, ésta iba a arrancar plegada: se abre a mano.
        $mform->setExpanded('videosection');

        // Bunny primero porque, si están los dos, gana Bunny (ver player.php). Ninguno
        // de los dos es obligatorio por separado: hace falta uno, y eso lo controla
        // validation(). Un 'required' en Vimeo impedía las actividades sólo con Bunny.
        $mform->addElement('text', 'videourl', get_string('videourl', 'ivplayer'), ['size' => '64']);
        $mform->setType('videourl', PARAM_TEXT);
        $mform->addHelpButton('videourl', 'videourl', 'ivplayer');

        $mform->addElement('text', 'vimeoid', get_string('vimeoid', 'ivplayer'), ['size' => '64']);
        $mform->setType('vimeoid', PARAM_TEXT);
        $mform->addHelpButton('vimeoid', 'vimeoid', 'ivplayer');

        $mform->addElement('advcheckbox', 'videoloop', 'Loop', 'Reproducir en bucle al terminar');
        $mform->setType('videoloop', PARAM_BOOL);
        $mform->setDefault('videoloop', 0);

        // Interactions section — visual editor.
        $mform->addElement('header', 'interactionssection', get_string('interactions', 'ivplayer'));

        // Hidden textarea that stores the JSON.
        $mform->addElement('textarea', 'interactions', '', [
            'rows' => 3,
            'cols' => 80,
            'id' => 'id_interactions_json',
            'style' => 'font-family:monospace; font-size:11px; color:#666; display:none;'
        ]);
        $mform->setType('interactions', PARAM_RAW);

        // Visual editor button + preview.
        $editorhtml = '
        <div id="ivplayer-editor-wrap" style="margin-bottom:16px;">
            <div id="ivplayer-interactions-preview" style="
                background:#1a1a2e; border-radius:8px; padding:16px; margin-bottom:12px;
                color:#ccc; font-size:13px; min-height:60px;
            ">
                <em>Sin interacciones configuradas.</em>
            </div>
            <button type="button" id="ivplayer-edit-btn" style="
                background:#0162F5; color:#fff; border:none; padding:10px 24px;
                border-radius:8px; font-size:14px; font-weight:600; cursor:pointer;
                font-family:inherit;
            ">
                Editar interacciones
            </button>
            <span id="ivplayer-edit-status" style="margin-left:12px; color:#84F4BE; font-size:13px;"></span>
        </div>

        <script>
        (function() {
            var jsonField = document.getElementById("id_interactions_json") || document.querySelector("textarea[name=interactions]");
            var preview = document.getElementById("ivplayer-interactions-preview");
            var btn = document.getElementById("ivplayer-edit-btn");
            var status = document.getElementById("ivplayer-edit-status");
            var vimeoField = document.getElementById("id_vimeoid");
            var bunnyField = document.getElementById("id_videourl");

            var CONFIGURATOR_URL = "https://erick25326.github.io/hub-interactive-player/configurator.html";
            var CONFIGURATOR_ORIGIN = new URL(CONFIGURATOR_URL).origin;

            // El video de Bunny de la actividad, firmado en el servidor para el configurador
            // (ivplayer_bunny_configurador, sólo para quien puede editarla). Se lee y se saca
            // de la página: no es un campo del formulario, no viaja al guardar y sólo sale
            // en el mensaje al configurador, con su origen explícito.
            var videoFirmado = null;
            var desfase = 0;   // reloj de esta compu menos el del servidor, en segundos
            var bloqueFirmado = document.getElementById("ivplayer-video-firmado");
            if (bloqueFirmado) {
                try { videoFirmado = JSON.parse(bloqueFirmado.textContent); } catch(e) {}
                bloqueFirmado.parentNode.removeChild(bloqueFirmado);
                if (videoFirmado && videoFirmado.ahora) desfase = Date.now() / 1000 - videoFirmado.ahora;
            }

            // Lo que va en "bunny" del mensaje: el enlace y cuánto le queda, { vencido: true }
            // si ya no sirve, o null si no corresponde mandarlo.
            function bunnyParaElConfigurador() {
                if (!videoFirmado || !videoFirmado.playlist || !videoFirmado.guid) return null;
                // Firmado es el GUID GUARDADO: si se cambió o se vació el campo sin guardar,
                // ya no es el video de la actividad (sin Bunny, el configurador usa Vimeo).
                if (!bunnyField || bunnyField.value.toLowerCase().indexOf(videoFirmado.guid) === -1) return null;
                if (!videoFirmado.expires) return { playlist: videoFirmado.playlist, restan: null };
                // Con el reloj del servidor. Con menos de 5 min no alcanza para marcar nada.
                var restan = Math.floor(videoFirmado.expires - (Date.now() / 1000 - desfase));
                if (restan < 300) return { vencido: true };
                return { playlist: videoFirmado.playlist, restan: restan };
            }

            function escapeHtml(str) {
                var div = document.createElement("div");
                div.appendChild(document.createTextNode(String(str)));
                return div.innerHTML;
            }

            function renderPreview() {
                if (!jsonField) return;
                var val = jsonField.value.trim();
                if (!val || val === "[]") {
                    preview.innerHTML = "<em>Sin interacciones configuradas.</em>";
                    return;
                }
                try {
                    var items = JSON.parse(val);
                    if (!Array.isArray(items) || items.length === 0) {
                        preview.innerHTML = "<em>Sin interacciones configuradas.</em>";
                        return;
                    }
                    var typeNames = {"note":"Nota","multiple-choice":"MC","true-false":"V/F","hotspot":"Hotspot","label":"Etiqueta"};
                    var typeColors = {"note":"#84F4BE","multiple-choice":"#0162F5","true-false":"#14CCF7","hotspot":"#F59E0B","label":"#14CCF7"};
                    var html = "<strong>" + items.length + " interaccion(es):</strong><br><br>";
                    items.forEach(function(ia) {
                        var m = Math.floor(ia.time/60);
                        var s = ia.time % 60;
                        var time = m + ":" + String(s).padStart(2,"0");
                        // Escapado: el tipo viene del JSON guardado o del configurador.
                        var label = escapeHtml(typeNames[ia.type] || ia.type);
                        var color = typeColors[ia.type] || "#fff";
                        var summary = "";
                        var d = ia.data || {};
                        if (ia.type==="note") summary = d.title || d.text || "";
                        else if (ia.type==="multiple-choice") summary = d.question || "";
                        else if (ia.type==="true-false") summary = d.statement || "";
                        else if (ia.type==="hotspot") summary = (d.spots||[]).length + " punto(s)";
                        else if (ia.type==="label") summary = d.text || "";
                        summary = escapeHtml(summary.substring(0, 60));
                        html += "<span style=\"display:inline-block;background:" + color + ";color:#000;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-right:6px;\">" + label + "</span>";
                        html += "<span style=\"color:#aaa;font-size:12px;margin-right:8px;\">" + time + "</span>";
                        html += "<span style=\"color:#eee;font-size:13px;\">" + summary + "</span><br style=\"margin-bottom:6px;\">";
                    });
                    preview.innerHTML = html;
                } catch(e) {
                    preview.innerHTML = "<em style=\"color:#EF4444;\">JSON invalido</em>";
                }
            }

            renderPreview();

            var colorStatus = status.style.color;

            // La ventana del configurador que abrió esta página: sólo de ella se aceptan las
            // interacciones de vuelta. El origen solo no alcanza: es el de TODAS las páginas
            // de GitHub Pages de la cuenta.
            var ventanaConfigurador = null;
            function esElConfigurador(fuente) {
                if (!fuente) return false;
                if (fuente === ventanaConfigurador) return true;
                // La que abrió esta página antes de recargarse: la variable se perdió con la
                // recarga, pero el opener de esa ventana sigue siendo ésta. (opener se puede
                // leer entre orígenes.)
                try { return fuente.opener === window; } catch(err) { return false; }
            }

            btn.addEventListener("click", function() {
                status.textContent = "";
                status.style.color = colorStatus;
                // Build config to send to configurator.
                var config = { vimeoId: "", interactions: [] };
                if (vimeoField) config.vimeoId = vimeoField.value;
                try { config.interactions = JSON.parse(jsonField.value) || []; } catch(e) {}
                // Aparte de config: lo que vuelve de "Guardar en Moodle" es config, y el enlace
                // firmado no tiene que poder volver a ningún campo.
                var mensaje = { type: "ivplayer-load-config", config: config };
                var bunny = bunnyParaElConfigurador();
                if (bunny) mensaje.bunny = bunny;
                if (bunny && bunny.vencido) {
                    status.style.color = "#B91C1C";
                    status.textContent = "El enlace del video de Bunny venció: guardá los cambios o recargá la página para verlo en el configurador.";
                }

                // Open configurator with config.
                var w = window.open(CONFIGURATOR_URL, "ivplayer_editor", "width=1200,height=800");
                if (w) ventanaConfigurador = w;

                // Send config to configurator once loaded.
                var sent = false;
                var sendInterval = setInterval(function() {
                    if (w && w.closed) { clearInterval(sendInterval); return; }
                    try {
                        // targetOrigin explícito (no "*"): la config no debe poder
                        // filtrarse a otro documento que ocupe esa ventana.
                        w.postMessage(mensaje, CONFIGURATOR_ORIGIN);
                    } catch(e) {}
                }, 500);

                // After 5 seconds stop trying to send.
                setTimeout(function() { clearInterval(sendInterval); }, 10000);
            });

            // Listen for config coming back from configurator.
            window.addEventListener("message", function(e) {
                if (e.origin !== CONFIGURATOR_ORIGIN) return;
                if (!esElConfigurador(e.source)) return;
                if (!e.data || e.data.type !== "ivplayer-save-config") return;
                var config = e.data.config;
                if (config && config.interactions) {
                    jsonField.value = JSON.stringify(config.interactions, null, 2);
                    renderPreview();
                    status.style.color = colorStatus;
                    status.textContent = "Interacciones actualizadas";
                    setTimeout(function() { status.textContent = ""; }, 3000);
                }
                if (config && config.vimeoId && vimeoField) {
                    var url = config.vimeoId;
                    if (config.vimeoHash) url = "https://vimeo.com/" + config.vimeoId + "/" + config.vimeoHash;
                    vimeoField.value = url;
                }
            });
        })();
        </script>';

        // El bloque con el video de Bunny firmado va ANTES del script, que lo lee al cargar.
        $mform->addElement('html', ivplayer_configurador_fuente_html($this->video_para_configurador()) . $editorhtml);

        // Standard elements (grading section: max grade, category, pass grade).
        $this->standard_grading_coursemodule_elements();
        $this->standard_coursemodule_elements();
        $this->add_action_buttons();
    }

    /**
     * El video de Bunny GUARDADO en la actividad, firmado con vida corta para el
     * configurador (ivplayer_bunny_configurador), o null.
     *
     * Sólo al editar una actividad que ya existe (al agregarla todavía no hay GUID
     * guardado) y sólo para quien puede editarla: modedit.php ya lo exige, y esto lo
     * vuelve a mirar porque el enlace abre el video. Nunca rompe el formulario: ante
     * cualquier problema, el configurador sigue como antes (Vimeo o un archivo de la compu).
     * 🔴 Ni el enlace ni la clave van a un log, a la base o a un campo del formulario.
     *
     * @return array|null
     */
    protected function video_para_configurador(): ?array {
        try {
            $cm = $this->get_coursemodule();
            $guardado = $this->current->videourl ?? '';
            if (!$cm || trim((string) $guardado) === ''
                    || !has_capability('moodle/course:manageactivities', $this->get_context())) {
                return null;
            }
            $html = ivplayer_reproductor_html();
            return ivplayer_bunny_configurador($guardado, ivplayer_bunny_host(), ivplayer_bunny_clave(), time(),
                $html !== null && ivplayer_reproductor_soporta_bunny($html));
        } catch (Throwable $e) {
            return null;
        }
    }

    /**
     * Custom completion rule: require all interactions completed.
     * get_suffix() exists from Moodle 4.3 (default completion forms).
     */
    public function add_completion_rules() {
        $mform = $this->_form;
        $suffix = method_exists($this, 'get_suffix') ? $this->get_suffix() : '';
        $name = 'completioninteractions' . $suffix;

        $mform->addElement('advcheckbox', $name, '', get_string('completioninteractions', 'ivplayer'));
        $mform->setType($name, PARAM_BOOL);
        $mform->setDefault($name, 0);

        return [$name];
    }

    public function completion_rule_enabled($data) {
        $suffix = method_exists($this, 'get_suffix') ? $this->get_suffix() : '';
        return !empty($data['completioninteractions' . $suffix]);
    }

    public function data_preprocessing(&$defaultvalues) {
        // When editing, reconstruct the Vimeo URL for display.
        if (!empty($defaultvalues['vimeoid']) && !empty($defaultvalues['vimeohash'])) {
            $defaultvalues['vimeoid'] = 'https://vimeo.com/' .
                $defaultvalues['vimeoid'] . '/' . $defaultvalues['vimeohash'];
        }
        // El de Bunny se muestra como se guardó: el GUID solo. No se rearma ninguna URL
        // porque el host es un ajuste del sitio y la firma vence.
    }

    /**
     * Hace falta un video, de Bunny o de Vimeo. El de Bunny tiene que reconocerse, ser
     * de la biblioteca del sitio y, si va solo, el sitio tiene que tener Bunny configurado.
     *
     * @param array $data
     * @param array $files
     * @return array
     */
    public function validation($data, $files) {
        $errors = parent::validation($data, $files);

        // Lo que hace falta para que el video de Bunny se reproduzca se controla ACÁ, al
        // guardar: si no, el docente no ve ningún problema y el error (un 404, o el cartel
        // de "Bunny no está configurado") lo encuentra recién el alumno.
        $error = ivplayer_bunny_error_de_entrada($data['videourl'] ?? '', $data['vimeoid'] ?? '',
            ivplayer_bunny_host(), ivplayer_bunny_biblioteca());
        if ($error !== null) {
            // 🔴 'a' es lo que pegó el docente (el host de un enlace ajeno) y los errores
            // del formulario se pintan como HTML ({{{error}}} en la plantilla): va escapado.
            $errors['videourl'] = get_string($error['clave'], 'ivplayer',
                $error['a'] === null ? null : s($error['a']));
        }

        // Un enlace de Bunny pegado en el campo de Vimeo se guardaría como "ID de Vimeo"
        // (y uno largo ni entra en la columna): mejor decir dónde va.
        $vimeo = trim((string) ($data['vimeoid'] ?? ''));
        if ($vimeo !== '' && ivplayer_bunny_normalizar_guid($vimeo) !== null) {
            $errors['vimeoid'] = get_string('errorvimeoesbunny', 'ivplayer');
        }

        return $errors;
    }
}
