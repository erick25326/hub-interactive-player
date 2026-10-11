<?php
/**
 * Serves the player HTML with config injected.
 * This runs inside an iframe — no Moodle page wrapper.
 */
require_once(__DIR__ . '/../../config.php');
require_once(__DIR__ . '/lib.php');

$id = required_param('id', PARAM_INT); // Course module ID.

$cm = get_coursemodule_from_id('ivplayer', $id, 0, false, MUST_EXIST);
$course = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
$ivplayer = $DB->get_record('ivplayer', ['id' => $cm->instance], '*', MUST_EXIST);

require_login($course, true, $cm);
$context = context_module::instance($cm->id);
require_capability('mod/ivplayer:view', $context);

// El reproductor se lee ANTES de elegir el video: de él depende si se puede usar Bunny.
$playerhtml = ivplayer_reproductor_html() ?? '<p>Player not found.</p>';

// Qué video se reproduce. Si la actividad tiene GUID de Bunny y el sitio tiene host
// configurado, gana Bunny AUNQUE también haya Vimeo: así se migra cargando el GUID
// sin borrar el de Vimeo, y se vuelve atrás vaciándolo. Sin host (Bunny apagado en
// el sitio), las actividades siguen con Vimeo como en 1.2.9.
// `?? ''`: si el código se actualizó y el upgrade de la base todavía no corrió, la
// columna no existe y esto no puede tirar un aviso adentro del iframe.
$bunnyguid = ivplayer_bunny_normalizar_guid($ivplayer->videourl ?? '') ?? '';
$bunnyhost = ivplayer_bunny_host();
// 🔴 Con un player.html viejo (sólo Vimeo: el plugin se subió sin rearmar el build) la
// rama de Bunny deja al alumno con un reproductor que no arranca. Ahí se trata como si
// Bunny no estuviera: las que tienen Vimeo siguen con Vimeo y el resto ve un cartel.
$reproductorbunny = ivplayer_reproductor_soporta_bunny($playerhtml);
$video = null;
if ($bunnyguid !== '' && $bunnyhost !== '' && $reproductorbunny) {
    // 🔴 La clave se usa SÓLO acá, para firmar. Al navegador sale la firma, nunca la clave.
    $bunny = ivplayer_bunny_urls($bunnyhost, $bunnyguid, ivplayer_bunny_clave(),
        ivplayer_bunny_expires(time(), ivplayer_bunny_ttl()));
    $video = [
        // Vacíos a propósito: con videoUrl el reproductor no crea el de Vimeo, pero así
        // no queda dando vueltas el video de ejemplo de su config por defecto.
        'vimeoId' => '',
        'vimeoHash' => null,
        // 🔴 El GUID queda como tramo "/<guid>/" de la URL, firmada o no: de ahí saca el
        // reproductor la clave del avance en localStorage, que así no cambia al renovar
        // el token (el tramo /bcdn_token=…/ va antes y token_path va codificado).
        'videoUrl' => $bunny['playlist'],
        'poster' => $bunny['poster'],
    ];
} else if (trim((string) $ivplayer->vimeoid) !== '') {
    $video = [
        'vimeoId' => $ivplayer->vimeoid,
        'vimeoHash' => $ivplayer->vimeohash ?: null,
    ];
}

if ($video === null) {
    // Sin nada que reproducir, un cartel que diga por qué y qué hacer, en vez de un
    // reproductor negro que no arranca nunca.
    if ($bunnyguid !== '' && $bunnyhost !== '') {
        // Hay host, así que lo que falta es el reproductor (ver $reproductorbunny).
        $motivo = get_string('sinvideo_reproductorviejo', 'ivplayer');
        if (has_capability('moodle/site:config', context_system::instance())) {
            $ayuda = s(get_string('sinvideo_reinstalar', 'ivplayer'));
        } else {
            $ayuda = s(get_string('sinvideo_avisar', 'ivplayer'));
        }
    } else if ($bunnyguid !== '') {
        $motivo = get_string('sinvideo_bunnysinhost', 'ivplayer');
        if (has_capability('moodle/site:config', context_system::instance())) {
            $ayuda = html_writer::link(
                new moodle_url('/admin/settings.php', ['section' => 'modsettingivplayer']),
                get_string('sinvideo_configurar', 'ivplayer'), ['target' => '_top']);
        } else {
            $ayuda = s(get_string('sinvideo_avisar', 'ivplayer'));
        }
    } else {
        $motivo = get_string('sinvideo', 'ivplayer');
        if (has_capability('moodle/course:manageactivities', $context)) {
            $ayuda = html_writer::link(
                new moodle_url('/course/modedit.php', ['update' => $cm->id]),
                get_string('sinvideo_editar', 'ivplayer'), ['target' => '_top']);
        } else {
            $ayuda = s(get_string('sinvideo_avisar', 'ivplayer'));
        }
    }
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="' . s(str_replace('_', '-', current_language())) . '"><head>'
        . '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<title>' . s($ivplayer->name) . '</title>'
        . '<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;'
        . 'justify-content:center;background:#062E60;color:#fff;font:16px/1.5 system-ui,sans-serif;'
        . 'text-align:center;padding:24px;box-sizing:border-box}p{margin:0 0 8px;max-width:36em}'
        . 'a{color:#84F4BE}</style></head><body><div>'
        . '<p><strong>' . s($motivo) . '</strong></p><p>' . $ayuda . '</p>'
        . '</div></body></html>';
    exit;
}

// Build config. JSON_HEX_TAG prevents "</script>" inside interaction
// content from breaking out of the injected <script> block.
// Con JSON_HEX_AMP los "&" de la URL firmada salen como \u0026 y sin
// JSON_UNESCAPED_SLASHES las barras como \/: el navegador los vuelve a armar al
// parsear, así que la URL llega intacta.
$jsonflags = JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;
$interactions = !empty($ivplayer->interactions) ? $ivplayer->interactions : '[]';
$base = array_merge(['title' => $ivplayer->name], $video, [
    'loop' => !empty($ivplayer->videoloop),
    'interactions' => json_decode($interactions, true) ?: [],
]);
// Subtítulos: el VTT/SRT de "Editar transcripción" de esta lección. Con Bunny es la
// única fuente; con Vimeo, si el video trae su propia pista la dibuja Vimeo y éstos
// quedan sin usar (ver hasVimeoSubs en el reproductor).
$subtitulos = ivplayer_subtitulos_texto($context);
$config = json_encode($subtitulos !== null ? $base + ['subtitlesVtt' => $subtitulos] : $base, $jsonflags);
if ($config === false) {
    // Nunca dejar al reproductor sin config por los subtítulos.
    $config = json_encode($base, $jsonflags);
}

// Per-user saved progress (cross-device resume).
$progressrec = $DB->get_record('ivplayer_progress', [
    'ivplayerid' => $ivplayer->id,
    'userid' => $USER->id,
]);
$savedprogress = null;
if ($progressrec && !empty($progressrec->progress)) {
    $savedprogress = json_decode($progressrec->progress, true);
}

$moodlecontext = json_encode([
    'cmid' => $cm->id,
    'sesskey' => sesskey(),
    'completeUrl' => (new moodle_url('/mod/ivplayer/complete.php'))->out(false),
    'progressUrl' => (new moodle_url('/mod/ivplayer/progress.php'))->out(false),
    'answerUrl' => (new moodle_url('/mod/ivplayer/answer.php'))->out(false),
    'savedProgress' => $savedprogress,
    'alreadyCompleted' => $progressrec ? (bool)$progressrec->completed : false,
], $jsonflags);

// Inject config before </head>. ($playerhtml se leyó arriba, antes de elegir el video.)
$configscript = "<script>\nwindow.PLAYER_CONFIG = {$config};\nwindow.MOODLE_CONTEXT = {$moodlecontext};\n</script>";
$playerhtml = str_replace('</head>', $configscript . "\n</head>", $playerhtml);

// Output raw HTML — no Moodle wrapper.
//
// SOBRE LA CACHÉ, PORQUE YA SE INTENTÓ Y SE VOLVIÓ ATRÁS (3-ago-2026).
//
// El HTML pesa ~259 KB y hoy NO se cachea: Moodle arranca la sesión con
// `session.cache_limiter = nocache` y, como este archivo nunca llama a
// `$OUTPUT->header()`, esos headers quedan. Es tentador ponerle un ETag con
// `private, must-revalidate` para ahorrarse el cuerpo en las recargas. Se probó
// y se revirtió, por dos razones:
//
// 1. NO SIRVE. El ETag tendría que salir del HTML final, que incluye el
//    progreso del alumno — y ése cambia cada 5 segundos de reproducción. O sea
//    que el 304 casi nunca dispara, y menos que nunca en el caso que lo
//    justificaba (el remonte del WebView por el arreglo de viewport de iOS).
// 2. ES PELIGROSO. Al pasar de `no-store` a almacenable, este documento —que
//    lleva `savedProgress` y `sesskey` CONGELADOS adentro— puede quedar
//    guardado y reusarse sin revalidar en navegación de historial. El player
//    prefiere ese `savedProgress` viejo por sobre lo que tiene en localStorage
//    y después lo escribe en el servidor, que no compara timestamps: el video
//    "retrocede solo". Ese camino, con `no-store`, es imposible.
//
// Desde 1.3.0 hay una razón más: con Bunny, el HTML lleva la URL firmada, que vence.
// Una copia guardada después de `expires` es un video que da 403.
//
// El ahorro de verdad no está acá: cada lección es un `cmid` distinto, o sea
// otra URL, así que NINGUNA caché de este archivo ahorra bytes entre lecciones.
// Eso se arregla partiendo el bundle estático a una URL compartida y versionada
// (ver "Pendiente: partir el bundle" en el README). Ahí sí corresponde `public`,
// porque ese bundle es igual para todos y no lleva sesskey ni progreso.
header('Content-Type: text/html; charset=utf-8');
echo $playerhtml;
