<?php
require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

$id = required_param('id', PARAM_INT);

$cm = get_coursemodule_from_id('ivplayer', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$ivplayer = $DB->get_record('ivplayer', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/ivplayer:view', $context);

// Page setup.
$PAGE->set_url('/mod/ivplayer/view.php', ['id' => $id]);
$PAGE->set_title($ivplayer->name);
$PAGE->set_heading($course->fullname);
$PAGE->add_body_class('ivplayer-page');

// Mark viewed for completion.
$completion = new completion_info($course);
$completion->set_module_viewed($cm);

// Player iframe URL.
$playerurl = new moodle_url('/mod/ivplayer/player.php', ['id' => $cm->id]);

echo $OUTPUT->header();
?>

<style>
/* Make content area wide for the player */
.ivplayer-page #region-main {
    max-width: 100% !important;
}
.ivplayer-page #region-main .card-body,
.ivplayer-page #region-main-box {
    max-width: 100% !important;
}
.ivplayer-frame-wrap {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    border-radius: 12px;
    overflow: hidden;
    background: #000;
}
.ivplayer-frame {
    width: 100%;
    aspect-ratio: 16/9;
    border: none;
    display: block;
}
/* Native fullscreen (Android/desktop) */
.ivplayer-frame-wrap:fullscreen,
.ivplayer-frame-wrap:-webkit-full-screen {
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
}
.ivplayer-frame-wrap:fullscreen .ivplayer-frame,
.ivplayer-frame-wrap:-webkit-full-screen .ivplayer-frame {
    width: 100%;
    height: 100%;
    aspect-ratio: unset;
}
/* CSS fullscreen fallback (iOS) */
.ivplayer-frame-wrap.ivplayer-css-fs {
    position: fixed !important;
    inset: 0 !important;
    z-index: 99999 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-width: none !important;
    border-radius: 0 !important;
    background: #000 !important;
    display: flex;
    align-items: center;
    justify-content: center;
}
.ivplayer-frame-wrap.ivplayer-css-fs .ivplayer-frame {
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: unset !important;
}
</style>

<div class="ivplayer-frame-wrap" id="ivplayerWrap">
    <iframe class="ivplayer-frame" id="ivplayerFrame"
            src="<?php echo $playerurl->out(true); ?>"
            allow="autoplay; fullscreen; encrypted-media"
            allowfullscreen></iframe>
</div>

<script>
(function() {
    var wrap = document.getElementById('ivplayerWrap');
    var frame = document.getElementById('ivplayerFrame');
    var isFSNow = false;

    // Listen for fullscreen requests from the player iframe.
    window.addEventListener('message', function(e) {
        if (!e.data || e.data.type !== 'ivplayer-fullscreen') return;
        if (!wrap) return;

        if (e.data.action === 'enter' && !isFSNow) {
            // Try native Fullscreen API first (works on Android/desktop).
            var ok = false;
            try {
                if (wrap.requestFullscreen) { wrap.requestFullscreen(); ok = true; }
                else if (wrap.webkitRequestFullscreen) { wrap.webkitRequestFullscreen(); ok = true; }
            } catch(e) {}
            // Fallback: CSS fullscreen (iOS — no Fullscreen API).
            if (!ok) {
                wrap.classList.add('ivplayer-css-fs');
                document.body.style.overflow = 'hidden';
                isFSNow = true;
                notifyIframe(true);
            }
        } else if (e.data.action === 'exit') {
            // Exit native fullscreen if active.
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            }
            // Exit CSS fullscreen.
            wrap.classList.remove('ivplayer-css-fs');
            document.body.style.overflow = '';
            isFSNow = false;
            notifyIframe(false);
        }
    });

    // Native fullscreen change events (Android/desktop).
    document.addEventListener('fullscreenchange', onNativeFS);
    document.addEventListener('webkitfullscreenchange', onNativeFS);
    function onNativeFS() {
        isFSNow = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (!isFSNow) {
            wrap.classList.remove('ivplayer-css-fs');
            document.body.style.overflow = '';
        }
        notifyIframe(isFSNow);
    }

    function notifyIframe(isFS) {
        if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage({ type: 'ivplayer-fullscreen-state', isFS: isFS }, '*');
        }
    }
})();
</script>

<?php
echo $OUTPUT->footer();
