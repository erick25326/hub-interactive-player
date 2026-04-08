<?php
defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/course/moodleform_mod.php');

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

        $mform->addElement('text', 'vimeoid', get_string('vimeoid', 'ivplayer'), ['size' => '64']);
        $mform->setType('vimeoid', PARAM_TEXT);
        $mform->addRule('vimeoid', null, 'required', null, 'client');
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
            var loopField = document.getElementById("id_loop");

            var CONFIGURATOR_URL = "https://erick25326.github.io/hub-interactive-player/configurator.html";

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
                    var typeNames = {"note":"Nota","multiple-choice":"MC","true-false":"V/F","hotspot":"Hotspot"};
                    var typeColors = {"note":"#84F4BE","multiple-choice":"#0162F5","true-false":"#14CCF7","hotspot":"#F59E0B"};
                    var html = "<strong>" + items.length + " interaccion(es):</strong><br><br>";
                    items.forEach(function(ia) {
                        var m = Math.floor(ia.time/60);
                        var s = ia.time % 60;
                        var time = m + ":" + String(s).padStart(2,"0");
                        var label = typeNames[ia.type] || ia.type;
                        var color = typeColors[ia.type] || "#fff";
                        var summary = "";
                        if (ia.type==="note") summary = ia.data.title || ia.data.text || "";
                        else if (ia.type==="multiple-choice") summary = ia.data.question || "";
                        else if (ia.type==="true-false") summary = ia.data.statement || "";
                        else if (ia.type==="hotspot") summary = (ia.data.spots||[]).length + " punto(s)";
                        summary = summary.substring(0, 60);
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

            btn.addEventListener("click", function() {
                // Build config to send to configurator.
                var config = { vimeoId: "", interactions: [] };
                if (vimeoField) config.vimeoId = vimeoField.value;
                try { config.interactions = JSON.parse(jsonField.value) || []; } catch(e) {}

                // Open configurator with config.
                var w = window.open(CONFIGURATOR_URL, "ivplayer_editor", "width=1200,height=800");

                // Send config to configurator once loaded.
                var sent = false;
                var sendInterval = setInterval(function() {
                    if (w && w.closed) { clearInterval(sendInterval); return; }
                    try {
                        w.postMessage({ type: "ivplayer-load-config", config: config }, "*");
                    } catch(e) {}
                }, 500);

                // After 5 seconds stop trying to send.
                setTimeout(function() { clearInterval(sendInterval); }, 10000);
            });

            // Listen for config coming back from configurator.
            window.addEventListener("message", function(e) {
                if (!e.data || e.data.type !== "ivplayer-save-config") return;
                var config = e.data.config;
                if (config && config.interactions) {
                    jsonField.value = JSON.stringify(config.interactions, null, 2);
                    renderPreview();
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

        $mform->addElement('html', $editorhtml);

        // Standard elements.
        $this->standard_coursemodule_elements();
        $this->add_action_buttons();
    }

    public function data_preprocessing(&$defaultvalues) {
        // When editing, reconstruct the Vimeo URL for display.
        if (!empty($defaultvalues['vimeoid']) && !empty($defaultvalues['vimeohash'])) {
            $defaultvalues['vimeoid'] = 'https://vimeo.com/' .
                $defaultvalues['vimeoid'] . '/' . $defaultvalues['vimeohash'];
        }
    }
}
