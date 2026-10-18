<?php
defined('MOODLE_INTERNAL') || die();

// Duración por defecto del token de Bunny: 6 h. Cada .ts se valida contra el MISMO
// `expires` y, cuando vence, lo que no estaba bajado da 403. Con la lección abierta el
// reproductor pide una firma nueva antes de que venza (firma.php y src/firma.js), así
// que ya no hace falta que cubra la sesión entera; igual conviene holgada: es lo que
// aguanta si la renovación no puede (sesión del campus cerrada, sin red) y lo que dura
// un enlace que se filtre.
define('IVPLAYER_BUNNY_TTL_DEFAULT', 21600);
// Topes del ajuste. Menos de 1 h corta lecciones normales a la mitad; más de 7 días
// es un enlace robado que sirve una semana (y suele ser "6 días" tipeado por "6 horas").
define('IVPLAYER_BUNNY_TTL_MIN', 3600);
define('IVPLAYER_BUNNY_TTL_MAX', 604800);

function ivplayer_supports($feature) {
    switch ($feature) {
        case FEATURE_MOD_INTRO:
            return true;
        case FEATURE_COMPLETION_TRACKS_VIEWS:
            return true;
        case FEATURE_COMPLETION_HAS_RULES:
            return true;
        case FEATURE_GRADE_HAS_GRADE:
            return true;
        case FEATURE_SHOW_DESCRIPTION:
            return true;
        case FEATURE_BACKUP_MOODLE2:
            return true;
        default:
            return null;
    }
}

function ivplayer_add_instance($data, $mform = null) {
    global $DB;

    $data->timecreated = time();
    $data->timemodified = time();

    // Parse Vimeo URL to extract ID and hash.
    $parsed = ivplayer_parse_vimeo($data->vimeoid ?? '');
    $data->vimeoid = $parsed['id'];
    $data->vimeohash = $parsed['hash'];
    $data->videourl = ivplayer_bunny_guid_a_guardar($data->videourl ?? '');

    $data->id = $DB->insert_record('ivplayer', $data);

    ivplayer_grade_item_update($data);

    return $data->id;
}

function ivplayer_update_instance($data, $mform = null) {
    global $DB;

    $data->id = $data->instance;
    $data->timemodified = time();

    $parsed = ivplayer_parse_vimeo($data->vimeoid ?? '');
    $data->vimeoid = $parsed['id'];
    $data->vimeohash = $parsed['hash'];
    // Vaciar el campo guarda NULL, y ésa es la vuelta atrás a Vimeo. Si el pedido
    // ni siquiera trae el campo (una actualización que no viene del formulario), no
    // se toca: borrarle el video a una actividad por omisión sería peor.
    if (property_exists($data, 'videourl')) {
        $data->videourl = ivplayer_bunny_guid_a_guardar($data->videourl);
    }

    $result = $DB->update_record('ivplayer', $data);

    // Re-grade: the max grade or the set of interactions may have changed.
    ivplayer_grade_item_update($data);
    ivplayer_update_grades($DB->get_record('ivplayer', ['id' => $data->id]));

    return $result;
}

function ivplayer_delete_instance($id) {
    global $DB;
    if (!($ivplayer = $DB->get_record('ivplayer', ['id' => $id]))) {
        return false;
    }
    ivplayer_grade_item_update($ivplayer, 'reset');
    $DB->delete_records('ivplayer_answers', ['ivplayerid' => $id]);
    $DB->delete_records('ivplayer_progress', ['ivplayerid' => $id]);
    $DB->delete_records('ivplayer', ['id' => $id]);
    return true;
}

/* ─── Gradebook API ─────────────────────────────────────────── */

/**
 * Gradable interactions of an instance (multiple-choice and true-false).
 *
 * @return array of interaction arrays, indexed by interaction id.
 */
function ivplayer_gradable_interactions($ivplayer) {
    $interactions = json_decode($ivplayer->interactions ?? '[]', true);
    if (!is_array($interactions)) {
        return [];
    }
    $gradable = [];
    foreach ($interactions as $ia) {
        if (!empty($ia['id']) && in_array($ia['type'] ?? '', ['multiple-choice', 'true-false'], true)) {
            $gradable[$ia['id']] = $ia;
        }
    }
    return $gradable;
}

/**
 * Create/update the grade item for an instance.
 *
 * @param stdClass $ivplayer instance (needs id, course, name, grade)
 * @param mixed $grades grade objects, 'reset', or null
 */
function ivplayer_grade_item_update($ivplayer, $grades = null) {
    global $CFG;
    require_once($CFG->libdir . '/gradelib.php');

    $item = [
        'itemname' => $ivplayer->name,
        'gradetype' => GRADE_TYPE_NONE,
    ];
    if (!empty($ivplayer->grade) && $ivplayer->grade > 0) {
        $item['gradetype'] = GRADE_TYPE_VALUE;
        $item['grademax'] = $ivplayer->grade;
        $item['grademin'] = 0;
    }
    if ($grades === 'reset') {
        $item['reset'] = true;
        $grades = null;
    }

    return grade_update('mod/ivplayer', $ivplayer->course, 'mod', 'ivplayer',
        $ivplayer->id, 0, $grades, $item);
}

/**
 * Compute user grades: (correct answers / gradable interactions) * grade.
 *
 * @param stdClass $ivplayer
 * @param int $userid 0 = all users with answers
 * @return array userid => grade object, or [] if nothing to grade
 */
function ivplayer_get_user_grades($ivplayer, $userid = 0) {
    global $DB;

    $total = count(ivplayer_gradable_interactions($ivplayer));
    if (!$total || empty($ivplayer->grade) || $ivplayer->grade <= 0) {
        return [];
    }

    $params = ['ivplayerid' => $ivplayer->id];
    if ($userid) {
        $params['userid'] = $userid;
    }
    $answers = $DB->get_records('ivplayer_answers', $params);

    // Only count answers to interactions that still exist.
    $gradable = ivplayer_gradable_interactions($ivplayer);
    $byuser = [];
    foreach ($answers as $a) {
        if (!isset($gradable[$a->interactionid])) {
            continue;
        }
        if (!isset($byuser[$a->userid])) {
            $byuser[$a->userid] = ['correct' => 0, 'time' => 0];
        }
        $byuser[$a->userid]['correct'] += $a->correct ? 1 : 0;
        $byuser[$a->userid]['time'] = max($byuser[$a->userid]['time'], (int)$a->timemodified);
    }

    $grades = [];
    foreach ($byuser as $uid => $info) {
        $grade = new stdClass();
        $grade->userid = $uid;
        $grade->rawgrade = $ivplayer->grade * $info['correct'] / $total;
        $grade->dategraded = $info['time'];
        $grades[$uid] = $grade;
    }
    return $grades;
}

/**
 * Standard update_grades callback.
 */
function ivplayer_update_grades($ivplayer, $userid = 0, $nullifnone = true) {
    if (empty($ivplayer->grade) || $ivplayer->grade <= 0) {
        ivplayer_grade_item_update($ivplayer);
        return;
    }
    if ($grades = ivplayer_get_user_grades($ivplayer, $userid)) {
        ivplayer_grade_item_update($ivplayer, $grades);
    } else if ($userid && $nullifnone) {
        $grade = new stdClass();
        $grade->userid = $userid;
        $grade->rawgrade = null;
        ivplayer_grade_item_update($ivplayer, $grade);
    } else {
        ivplayer_grade_item_update($ivplayer);
    }
}

/**
 * Course module info: show description on course page and expose
 * custom completion rules to the completion API.
 */
function ivplayer_get_coursemodule_info($coursemodule) {
    global $DB;

    $ivplayer = $DB->get_record('ivplayer', ['id' => $coursemodule->instance],
        'id, name, intro, introformat, completioninteractions');
    if (!$ivplayer) {
        return false;
    }

    $info = new cached_cm_info();
    $info->name = $ivplayer->name;

    if ($coursemodule->showdescription) {
        $info->content = format_module_intro('ivplayer', $ivplayer, $coursemodule->id, false);
    }

    if ($coursemodule->completion == COMPLETION_TRACKING_AUTOMATIC) {
        $info->customdata['customcompletionrules']['completioninteractions'] =
            $ivplayer->completioninteractions;
    }

    return $info;
}

/**
 * Registra que se abrió la actividad: el evento de vista y el "visto" de la finalización.
 *
 * Lo llama view.php, una vez por carga de la página de la lección. Es el patrón de los
 * módulos de core (page_view() en mod/page): primero el evento, después la finalización.
 * Sin el evento, el log del campus no veía las lecciones (Registros, Actividad del
 * curso y Participación las daban en 0) aunque la finalización sí las marcaba.
 * 🔴 No va en player.php: el iframe se recarga solo (giro de pantalla en iOS,
 * "Reintentar" cuando vence la firma) y contaría vistas de más.
 * 🔴 La clase del evento es nueva y Moodle la ve recién después del upgrade (que purga
 * el mapa de clases). El actualizador automático (scripts/moodle-auto-update.php) copia
 * los archivos y deja el upgrade para cuando entra un admin: en ese rato, sin el
 * class_exists, view.php tiraba "clase no encontrada" en TODAS las lecciones. Así sólo
 * se pierde el registro de esas vistas, y la finalización se marca igual.
 *
 * @param stdClass $ivplayer Registro de la tabla ivplayer.
 * @param stdClass $course Registro del curso.
 * @param stdClass|cm_info $cm Módulo del curso.
 * @param context_module $context Contexto del módulo.
 */
function ivplayer_view($ivplayer, $course, $cm, $context) {
    if (class_exists(\mod_ivplayer\event\course_module_viewed::class)) {
        $event = \mod_ivplayer\event\course_module_viewed::create([
            'objectid' => $ivplayer->id,
            'context' => $context,
        ]);
        $event->add_record_snapshot('course_modules', $cm);
        $event->add_record_snapshot('course', $course);
        $event->add_record_snapshot('ivplayer', $ivplayer);
        $event->trigger();
    }

    $completion = new completion_info($course);
    $completion->set_module_viewed($cm);
}

/**
 * Parse a Vimeo URL or ID into components.
 */
function ivplayer_parse_vimeo($input) {
    $input = trim($input);

    // Strip query params.
    $clean = preg_replace('/[?#].*$/', '', $input);

    // Just a numeric ID.
    if (preg_match('/^\d+$/', $clean)) {
        return ['id' => $clean, 'hash' => null];
    }

    // URL: vimeo.com/ID/HASH.
    if (preg_match('/vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-f0-9]+))?/', $clean, $m)) {
        return ['id' => $m[1], 'hash' => $m[2] ?? null];
    }

    // Player URL: player.vimeo.com/video/ID?h=HASH.
    if (preg_match('/player\.vimeo\.com\/video\/(\d+)/', $input, $m)) {
        $hash = null;
        if (preg_match('/[?&]h=([a-f0-9]+)/', $input, $hm)) {
            $hash = $hm[1];
        }
        return ['id' => $m[1], 'hash' => $hash];
    }

    return ['id' => $clean, 'hash' => null];
}

/* ─── Bunny Stream ──────────────────────────────────────────── */
//
// La actividad guarda SÓLO el GUID del video (campo `videourl`, en minúsculas; se
// llama así por si mañana guarda otra fuente). El host del CDN, la clave y la
// duración del token son ajustes del sitio (settings.php), y la URL se arma y se
// firma acá, en cada carga de player.php.
// 🔴 El repo es PÚBLICO: ni el host de producción, ni la clave, ni GUIDs reales van
// en el código. Viven en los ajustes del admin y en la base.
//
// Las funciones "puras" (de ivplayer_bunny_normalizar_guid a ivplayer_bunny_video) no
// tocan Moodle a propósito: tests/php/correr.php las lee de este archivo y las prueba
// con PHP pelado contra los vectores de Bunny (y el espejo de Node, con la misma huella).

/**
 * GUID de un video de Bunny Stream a partir de lo que pegue el docente.
 *
 * Acepta el GUID solo (el "Video ID" del panel de Bunny), el enlace del reproductor
 * de Bunny (player.mediadelivery.net/play/<biblioteca>/<guid>,
 * iframe.mediadelivery.net/embed/<biblioteca>/<guid>) y cualquier URL del CDN cuyo
 * primer tramo sea el GUID (https://<host>/<guid>/playlist.m3u8), firmada o no.
 *
 * @param string|null $entrada
 * @return string|null '' si vino vacío; el GUID en minúsculas si se reconoce; null si no.
 */
function ivplayer_bunny_normalizar_guid($entrada): ?string {
    $analisis = ivplayer_bunny_analizar($entrada);
    return $analisis === null ? null : $analisis['guid'];
}

/**
 * Lo que se puede leer de lo que pegó el docente: el GUID y, si vino un enlace, DE
 * DÓNDE es (el servidor de un enlace al CDN, o el número de biblioteca de un enlace al
 * reproductor de Bunny).
 *
 * El origen importa porque se guarda sólo el GUID y el reproductor lo pide SIEMPRE al
 * host del sitio: un enlace de otra biblioteca se guardaba sin aviso y daba 404 recién
 * al alumno. Con esto el formulario lo frena (ver ivplayer_bunny_error_de_entrada).
 *
 * @param string|null $entrada
 * @return array{guid: string, host: ?string, biblioteca: ?string}|null null si no se
 *         reconoce. guid: en minúsculas, '' si vino vacío. host: el servidor de un enlace
 *         al CDN, en minúsculas y TAL CUAL vino (puede no ser un host válido: traerlo con
 *         puerto o usuario también es "otro servidor"). biblioteca: los dígitos de un
 *         enlace player/iframe.mediadelivery.net.
 */
function ivplayer_bunny_analizar($entrada): ?array {
    $entrada = trim((string) $entrada);
    if ($entrada === '') {
        return ['guid' => '', 'host' => null, 'biblioteca' => null];
    }
    $guid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
    // Después del GUID, fin o un separador: sin esto "…555555555555xyz/" pasaba como GUID.
    $fin = '(?:[/?#]|$)';
    // 🔴 Todos con D: sin ella "$" también calza ANTES de un "\n" final, y un GUID con
    // salto de línea terminaría adentro de la ruta firmada.
    if (preg_match('~^' . $guid . '$~iD', $entrada, $m)) {
        return ['guid' => strtolower($m[1]), 'host' => null, 'biblioteca' => null];
    }
    if (preg_match('~^(?:https?://)?(?:(?:player|iframe)\.mediadelivery\.net|video\.bunnycdn\.com)/(?:play|embed)/(\d+)/'
            . $guid . $fin . '~iD', $entrada, $m)) {
        return ['guid' => strtolower($m[2]), 'host' => null, 'biblioteca' => $m[1]];
    }
    // URL del CDN, con o sin https://. Si viene firmada en la ruta, el tramo
    // /bcdn_token=…/ va ANTES del GUID.
    if (preg_match('~^(?:https?://)?([^/?#\s]+)/(?:bcdn_token=[^/?#\s]*/)?' . $guid . $fin . '~iD', $entrada, $m)) {
        return ['guid' => strtolower($m[2]), 'host' => strtolower($m[1]), 'biblioteca' => null];
    }
    return null;
}

/**
 * Host del CDN de Bunny tal como se usa para armar las URLs.
 *
 * Se perdona pegar la URL entera (https://host/… o host/…): queda sólo el host.
 *
 * @param string|null $entrada
 * @return string|null '' si vino vacío; el host en minúsculas; null si no es un host válido.
 */
function ivplayer_bunny_normalizar_host($entrada): ?string {
    $host = strtolower(trim((string) $entrada));
    $host = preg_replace('~^[a-z][a-z0-9+.-]*://~', '', $host);
    $host = preg_replace('~[/?#].*$~s', '', $host);
    if ($host === '') {
        return '';
    }
    // Nombre DNS: dos o más etiquetas de [a-z0-9-] que no empiezan ni terminan en "-".
    // 🔴 Sin puerto, usuario ni espacios: el host se pega tal cual delante de la ruta firmada.
    if (!preg_match('/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/D', $host)) {
        return null;
    }
    return $host;
}

/**
 * El error del campo "Video de Bunny Stream" del formulario, o null si está bien.
 *
 * Es pura (recibe los ajustes del sitio como parámetros) para que entre en el script de
 * prueba junto con la firma. mod_form la llama con ivplayer_bunny_host() y
 * ivplayer_bunny_biblioteca().
 *
 * @param string|null $bunny Lo cargado en el campo de Bunny.
 * @param string|null $vimeo Lo cargado en el campo de Vimeo.
 * @param string $hostsitio Host del CDN del sitio ('' = Bunny sin configurar).
 * @param string $bibliotecasitio Número de biblioteca del sitio ('' = no se controla).
 * @return array{clave: string, a: ?string}|null La clave del string de error y su {$a}.
 *         🔴 'a' sale de lo que pegó el docente: escaparla antes de mostrarla, porque los
 *         errores del formulario se pintan como HTML.
 */
function ivplayer_bunny_error_de_entrada($bunny, $vimeo, string $hostsitio, string $bibliotecasitio): ?array {
    $bunny = trim((string) $bunny);
    $vimeo = trim((string) $vimeo);
    if ($bunny === '') {
        return $vimeo === '' ? ['clave' => 'errorsinvideo', 'a' => null] : null;
    }
    $analisis = ivplayer_bunny_analizar($bunny);
    if ($analisis === null) {
        return ['clave' => 'errorbunnyguid', 'a' => null];
    }
    // Sin host del sitio no hay con qué comparar. Sin Vimeo lo frena el último control;
    // con Vimeo pasa (hoy reproduce Vimeo), y si después se configura el host, ese enlace
    // ajeno daría 404. Es un caso de borde aceptado: no hay contra qué compararlo.
    if ($analisis['host'] !== null && $hostsitio !== ''
            && ivplayer_bunny_normalizar_host($analisis['host']) !== $hostsitio) {
        return ['clave' => 'errorbunnyotrohost', 'a' => $analisis['host']];
    }
    // Los enlaces del reproductor no traen el host, sólo el número de biblioteca. Sólo se
    // compara si el admin lo cargó (es opcional).
    if ($analisis['biblioteca'] !== null && $bibliotecasitio !== ''
            && ltrim($analisis['biblioteca'], '0') !== ltrim($bibliotecasitio, '0')) {
        return ['clave' => 'errorbunnyotrabiblioteca', 'a' => $analisis['biblioteca']];
    }
    // Sólo Bunny en un sitio sin Bunny: player.php no tendría nada que reproducir y el
    // aviso lo vería recién el alumno. Con Vimeo cargado pasa, porque cae a Vimeo.
    if ($hostsitio === '' && $vimeo === '') {
        return ['clave' => 'errorbunnysinhost', 'a' => null];
    }
    return null;
}

/**
 * Frena antes de interpolar algo que no sea exactamente un GUID y un host.
 *
 * 🔴 El GUID arma la ruta firmada: uno mal formado (o vacío) podría firmar "/" y abrir
 * la biblioteca ENTERA hasta que vence el token.
 *
 * @param string $host
 * @param string $guid En minúsculas: lo que se guarda pasa por ivplayer_bunny_normalizar_guid().
 * @throws coding_exception
 */
function ivplayer_bunny_validar(string $host, string $guid): void {
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D', $guid)) {
        throw new coding_exception('GUID de Bunny inválido');
    }
    if ($host === '' || ivplayer_bunny_normalizar_host($host) !== $host) {
        throw new coding_exception('Host de Bunny inválido');
    }
}

/**
 * Token de directorio "Advanced" (HMAC-SHA256) del CDN de Bunny, con token_path como
 * único parámetro firmado: sin IP, países ni límite de velocidad.
 *
 * Mensaje = ruta firmada + expires + [bytes de la IP: no se usa] + parámetros ordenados
 * ("k=v" con el valor CRUDO, unidos por "&"). Con token_path la ruta firmada ES
 * token_path, así que aparece dos veces: "/<guid>/" . E . "token_path=/<guid>/".
 *
 * @param string $clave Clave de autenticación por token de la biblioteca.
 * @param string $rutafirmada Prefijo autorizado, con barra final ("/<guid>/").
 * @param int $expires UNIX en SEGUNDOS: Bunny no acepta milisegundos.
 * @return string "HS256-" + base64url del digest.
 */
function ivplayer_bunny_token(string $clave, string $rutafirmada, int $expires): string {
    $mensaje = $rutafirmada . $expires . 'token_path=' . $rutafirmada;
    // 🔴 La clave va como CLAVE del HMAC (no concatenada al mensaje) y la salida es
    // BINARIA (true), no hex: el base64 del hex da un token que Bunny rechaza con 403.
    $digest = hash_hmac('sha256', $mensaje, $clave, true);
    return 'HS256-' . rtrim(strtr(base64_encode($digest), '+/', '-_'), '=');
}

/**
 * URLs firmadas de UN video de Bunny Stream: el playlist HLS y la miniatura.
 *
 * El token es de directorio (token_path=/<guid>/): el MISMO token vale para todo lo
 * que vive bajo /<guid>/ (variantes, .ts, miniatura, captions/<lang>.vtt).
 *
 * @param string $host Host del CDN de la biblioteca (ajuste del sitio, normalizado).
 * @param string $guid GUID del video, en minúsculas.
 * @param string $clave Clave de autenticación por token. Nunca sale al navegador.
 * @param int $expires UNIX en segundos.
 * @return array{playlist: string, poster: string, query: string, expires: int}
 * @throws coding_exception
 */
function ivplayer_bunny_firmar(string $host, string $guid, string $clave, int $expires): array {
    ivplayer_bunny_validar($host, $guid);
    if ($clave === '') {
        throw new coding_exception('Falta la clave de token de Bunny');
    }
    if ($expires <= 0) {
        throw new coding_exception('Vencimiento de Bunny inválido');
    }
    // Con barra final: Bunny valida por PREFIJO, y "/<guid>" cubriría también "/<guid>xyz/…".
    $ruta = '/' . $guid . '/';
    $token = ivplayer_bunny_token($clave, $ruta, $expires);
    // 🔴 token_path va CRUDO en el HMAC y CODIFICADO en la URL (%2F<guid>%2F): crudo, sus
    // barras partirían el tramo /bcdn_token=…/ en varios y el CDN no lo reconocería.
    $params = 'token_path=' . rawurlencode($ruta) . '&expires=' . $expires;
    return [
        // HLS: el token va EN LA RUTA. El playlist trae variantes y .ts RELATIVOS que, al
        // resolverse, heredan el prefijo /bcdn_token=…/; con el token en la query
        // (?token=…) la variante lo perdería y daría 403.
        'playlist' => 'https://' . $host . '/bcdn_token=' . $token . '&' . $params . $ruta . 'playlist.m3u8',
        // Archivos sueltos: el mismo token, en la query. Así la miniatura anda con la
        // autenticación de Bunny prendida o apagada (el formato de ruta, apagada, da 404).
        'poster' => 'https://' . $host . $ruta . 'thumbnail.jpg?token=' . $token . '&' . $params,
        // Para lo que se agregue después bajo /<guid>/ (subtítulos: captions/<lang>.vtt?…).
        'query' => 'token=' . $token . '&' . $params,
        'expires' => $expires,
    ];
}

/**
 * Las URLs que recibe el reproductor para un video de Bunny: firmadas si hay clave,
 * planas si no.
 *
 * 🔴 Las planas sólo andan con la autenticación por token APAGADA en Bunny, y las
 * firmadas en la ruta sólo con la autenticación PRENDIDA: apagada, el CDN da 404
 * porque pasa el tramo /bcdn_token=…/ literal al storage (medido oct-2026). No hay
 * un estado que sirva para las dos: la clave en Moodle y el interruptor en Bunny se
 * cambian juntos.
 *
 * @param string $host
 * @param string $guid
 * @param string $clave '' = no firmar.
 * @param int $expires UNIX en segundos (se ignora sin clave).
 * @return array{playlist: string, poster: string, firmada: bool, expires: int|null}
 * @throws coding_exception
 */
function ivplayer_bunny_urls(string $host, string $guid, string $clave, int $expires): array {
    if ($clave === '') {
        ivplayer_bunny_validar($host, $guid);
        return [
            'playlist' => 'https://' . $host . '/' . $guid . '/playlist.m3u8',
            'poster' => 'https://' . $host . '/' . $guid . '/thumbnail.jpg',
            'firmada' => false,
            'expires' => null,
        ];
    }
    $firmada = ivplayer_bunny_firmar($host, $guid, $clave, $expires);
    return [
        'playlist' => $firmada['playlist'],
        'poster' => $firmada['poster'],
        'firmada' => true,
        'expires' => $firmada['expires'],
    ];
}

/**
 * Vencimiento del token: ahora + duración, llevado a la hora en punto SIGUIENTE.
 *
 * Con el redondeo, todas las cargas de la misma hora reciben la MISMA URL. Importa por
 * la caché del navegador: los .ts se sirven con max-age de 30 días, pero la caché va
 * por URL completa y el token es parte de la ruta. Sin redondear, recargar la lección
 * volvía a bajar todo lo ya visto (en datos móviles, en el campo). Cuesta, como mucho,
 * una hora más de validez.
 *
 * @param int $ahora UNIX en segundos: time() del servidor de Moodle, que tiene que
 *        estar en hora (NTP). El reloj del alumno no participa.
 * @param int $ttl Validez mínima garantizada, en segundos.
 * @return int
 */
function ivplayer_bunny_expires(int $ahora, int $ttl): int {
    return (intdiv($ahora, 3600) + 1) * 3600 + $ttl;
}

/**
 * Las URLs del video de Bunny de una actividad, firmadas a la hora $ahora, o null si la
 * actividad NO reproduce Bunny.
 *
 * Es LA regla de "¿esta actividad usa Bunny?" (GUID guardado + host en el sitio +
 * player.html que lo sabe reproducir), la misma para player.php, que arma la lección, y
 * para firma.php, que la vuelve a firmar con la lección abierta. Si divergieran,
 * firma.php podría firmar un video que la página no reproduce (Vimeo de respaldo), o
 * negarse a renovar uno que sí.
 *
 * Pura a propósito (recibe los ajustes y la hora): tests/php/correr.php la lee de este
 * archivo y la prueba. Con los ajustes de verdad la llama ivplayer_bunny_de_actividad().
 *
 * @param string|null $guardado Lo que guarda la actividad en `videourl` (el GUID).
 * @param string $host Host del CDN del sitio ('' = Bunny apagado en el sitio).
 * @param string $clave Clave de token del sitio ('' = URLs sin firmar). Nunca sale: lo
 *        que devuelve son URLs ya firmadas.
 * @param int $ttl Duración del token, en segundos.
 * @param int $ahora UNIX en segundos.
 * @param bool $reproductorbunny ¿El player.html instalado reproduce Bunny?
 *        (ivplayer_reproductor_soporta_bunny)
 * @return array{playlist: string, poster: string, firmada: bool, expires: int|null}|null
 * @throws coding_exception si el host configurado no es válido (no puede pasar: se
 *         normaliza al leerlo).
 */
function ivplayer_bunny_video($guardado, string $host, string $clave, int $ttl, int $ahora, bool $reproductorbunny): ?array {
    // Lo guardado ya es un GUID en minúsculas; se normaliza igual, por si la base trae
    // algo cargado a mano. Lo que no se reconoce es "sin Bunny", nunca una firma de "/".
    $guid = ivplayer_bunny_normalizar_guid($guardado ?? '') ?? '';
    if ($guid === '' || $host === '' || !$reproductorbunny) {
        return null;
    }
    return ivplayer_bunny_urls($host, $guid, $clave, ivplayer_bunny_expires($ahora, $ttl));
}

/**
 * GUID listo para guardar en la base: NULL si el campo vino vacío.
 *
 * @param string|null $entrada Lo que se cargó en el formulario.
 * @return string|null
 * @throws moodle_exception si no es un video de Bunny reconocible (el formulario ya lo
 *         frena con un mensaje; esto cubre las altas que no pasan por él).
 */
function ivplayer_bunny_guid_a_guardar($entrada): ?string {
    $guid = ivplayer_bunny_normalizar_guid($entrada);
    if ($guid === null) {
        throw new moodle_exception('errorbunnyguid', 'ivplayer');
    }
    return $guid === '' ? null : $guid;
}

/**
 * Host del CDN configurado en el sitio, o '' si no hay (o no es válido).
 *
 * @return string
 */
function ivplayer_bunny_host(): string {
    return ivplayer_bunny_normalizar_host(get_config('mod_ivplayer', 'bunnyhost')) ?? '';
}

/**
 * Clave de token configurada en el sitio, o '' (= no firmar).
 *
 * 🔴 Sólo se usa del lado del servidor, para firmar. No va en PLAYER_CONFIG, ni en
 * logs, ni en mensajes de error.
 *
 * @return string
 */
function ivplayer_bunny_clave(): string {
    return trim((string) get_config('mod_ivplayer', 'bunnytokenkey'));
}

/**
 * Número de la biblioteca de Bunny del sitio, o '' si no se cargó (= no se controla).
 *
 * Es opcional y sólo sirve para que el formulario rechace los enlaces del reproductor de
 * Bunny (player/iframe.mediadelivery.net/…/<biblioteca>/<guid>) de OTRA biblioteca: esos
 * enlaces no traen el host, así que contra el host no se pueden comparar.
 *
 * @return string Dígitos, o ''.
 */
function ivplayer_bunny_biblioteca(): string {
    // PARAM_INT guarda 0 cuando se vacía el campo: 0 (o un negativo) es "no cargado".
    $biblioteca = (int) get_config('mod_ivplayer', 'bunnylibraryid');
    return $biblioteca > 0 ? (string) $biblioteca : '';
}

/**
 * Duración del token en segundos, dentro de los topes.
 *
 * Los topes ya los frena el ajuste al guardarlo (settings.php); esto queda de red para
 * un valor cargado por CLI o por config.php.
 *
 * @return int
 */
function ivplayer_bunny_ttl(): int {
    $ttl = (int) get_config('mod_ivplayer', 'bunnytokenttl');
    if ($ttl <= 0) {
        return IVPLAYER_BUNNY_TTL_DEFAULT;
    }
    return max(IVPLAYER_BUNNY_TTL_MIN, min(IVPLAYER_BUNNY_TTL_MAX, $ttl));
}

/**
 * El video de Bunny de esta actividad, firmado a la hora $ahora con los ajustes del
 * sitio, o null si la actividad no reproduce Bunny (ver ivplayer_bunny_video).
 *
 * La usan player.php y firma.php: una sola regla para los dos.
 *
 * @param stdClass $ivplayer Registro de la actividad.
 * @param string $playerhtml El player.html instalado (ivplayer_reproductor_html()).
 * @param int $ahora UNIX en segundos (time()): el mismo que se le pasa al reproductor
 *        como hora del servidor, para que mida el vencimiento sin su propio reloj.
 * @return array{playlist: string, poster: string, firmada: bool, expires: int|null}|null
 */
function ivplayer_bunny_de_actividad(stdClass $ivplayer, string $playerhtml, int $ahora): ?array {
    // `?? ''`: si el código se actualizó y el upgrade de la base todavía no corrió, la
    // columna no existe y esto no puede tirar un aviso.
    return ivplayer_bunny_video($ivplayer->videourl ?? '', ivplayer_bunny_host(), ivplayer_bunny_clave(),
        ivplayer_bunny_ttl(), $ahora, ivplayer_reproductor_soporta_bunny($playerhtml));
}

/* ─── Reproductor instalado (player.html) ───────────────────── */

/**
 * El reproductor compilado que sirve player.php, o null si no está.
 *
 * @return string|null
 */
function ivplayer_reproductor_html(): ?string {
    $ruta = __DIR__ . '/player.html';
    if (!is_readable($ruta)) {
        return null;
    }
    $html = file_get_contents($ruta);
    return $html === false ? null : $html;
}

/**
 * ¿El player.html instalado sabe reproducir un video de Bunny (videoUrl + HLS)?
 *
 * player.html es una COPIA del build (dist/index.html) que se mete en el zip al armar
 * la release. Si el plugin se sube sin rearmarlo (la carpeta a mano, un zip viejo),
 * queda el reproductor sólo-Vimeo de la 1.2.9: ignora videoUrl, intenta crear el de
 * Vimeo con un ID vacío y el alumno queda frente a un reproductor que no arranca, y
 * sólo en las actividades YA migradas. Con esto player.php cae a Vimeo (o muestra un
 * cartel) y el estado de los ajustes lo avisa.
 *
 * 🔴 La marca es "loadSource", el método de hls.js con el que el motor propio carga el
 * playlist: no está en el build sólo-Vimeo y el minificador no puede renombrarlo (es
 * API pública de hls.js). Si un día el bundle se parte y el JS deja de ir ADENTRO de
 * player.html (ver "Pendiente: partir el bundle" en el README), esta marca desaparece y
 * todas las actividades vuelven a Vimeo: cambiarla en ese momento por una marca
 * explícita en el HTML.
 *
 * @param string $html Contenido de player.html.
 * @return bool
 */
function ivplayer_reproductor_soporta_bunny(string $html): bool {
    return strpos($html, 'loadSource') !== false;
}

/* ─── Transmitir a la TV desde hub-app (1.4.0) ─────────────────── */

/**
 * ¿Ya está publicada la app de Hub Education con Chromecast? (casilla del sitio
 * appcastpublicada). Va a MOODLE_CONTEXT.appCastPublicada y decide si el reproductor le
 * dice "actualizá la app" a quien abre la lección en la app vieja: antes de que la
 * versión con Cast esté en Play para todos, ese pedido no tendría cómo cumplirse.
 *
 * Pura a propósito (tests/php/correr.php la prueba sin Moodle): recibe lo que devuelve
 * get_config, que es false con el ajuste sin guardar (recién instalado) y '0' o '1'
 * guardado. Sólo '1' prende.
 *
 * @param mixed $guardado Valor de get_config('mod_ivplayer', 'appcastpublicada').
 * @return bool
 */
function ivplayer_app_cast_publicada($guardado): bool {
    return !is_array($guardado) && !is_object($guardado) && (string) $guardado === '1';
}

/* ─── Subtítulos de la lección ──────────────────────────────── */

/** Tope del archivo de subtítulos que se inyecta en el reproductor (1 MB). */
define('IVPLAYER_SUBTITULOS_MAX', 1024 * 1024);

/**
 * Texto de los subtítulos de la lección (VTT o SRT), o null si no hay.
 *
 * Es el MISMO archivo que el docente sube en "Editar transcripción" (formato de curso
 * hubcampus: filearea transcriptvtt del contexto del módulo) y que el tema usa para la
 * transcripción sincronizada. Con Vimeo los subtítulos venían de la pista de Vimeo; con
 * Bunny no hay pista, así que sin esto una lección migrada se quedaba sin subtítulos.
 * Se manda el texto crudo y lo parsea el reproductor (parseVTT, que ya entiende VTT y
 * SRT): un solo parser, el mismo que usa subtitlesUrl. Si el sitio no tiene el formato
 * hubcampus, el área está vacía y no pasa nada.
 *
 * 🔴 Tiene que salir en UTF-8 válido: json_encode devuelve false con un solo byte
 * inválido y el reproductor se quedaría sin config. Un SRT viejo puede venir en
 * Windows-1252 o UTF-16: se convierte. Si aun así no es UTF-8, no hay subtítulos.
 *
 * @param context_module $context Contexto de la actividad.
 * @return string|null
 */
function ivplayer_subtitulos_texto(context_module $context): ?string {
    $fs = get_file_storage();
    $files = $fs->get_area_files($context->id, 'format_hubcampus', 'transcriptvtt', 0,
        'timemodified DESC', false);
    foreach ($files as $file) {
        // El más nuevo, igual que la transcripción del tema.
        if ($file->get_filesize() > IVPLAYER_SUBTITULOS_MAX) {
            return null;
        }
        return ivplayer_subtitulos_normalizar((string) $file->get_content());
    }
    return null;
}

/**
 * Pasa el contenido de un VTT/SRT a UTF-8 sin BOM, o null si no se puede o está vacío.
 *
 * Función pura (sin Moodle salvo core_text), para poder probarla aparte.
 *
 * @param string $texto Bytes del archivo.
 * @return string|null
 */
function ivplayer_subtitulos_normalizar(string $texto): ?string {
    if (strncmp($texto, "\xFF\xFE", 2) === 0) {
        $texto = core_text::convert(substr($texto, 2), 'utf-16le', 'utf-8');
    } else if (strncmp($texto, "\xFE\xFF", 2) === 0) {
        $texto = core_text::convert(substr($texto, 2), 'utf-16be', 'utf-8');
    } else if (strncmp($texto, "\xEF\xBB\xBF", 3) === 0) {
        $texto = substr($texto, 3);   // BOM de UTF-8 (algunos exportes de Premiere)
    }
    if (!mb_check_encoding($texto, 'UTF-8')) {
        // Si ya hay letras UTF-8 válidas de varios bytes, es UTF-8 con algún byte roto:
        // se limpia ese byte. Convertir el archivo entero como Windows-1252 lo dejaba
        // ilegible ("AcciÃ³n"). Sin ninguna, es un SRT viejo en Windows-1252.
        if (preg_match('/[\xC2-\xF4][\x80-\xBF]/', $texto)) {
            $texto = mb_scrub($texto, 'UTF-8');
        } else {
            $texto = core_text::convert($texto, 'windows-1252', 'utf-8');
        }
    }
    if (!mb_check_encoding($texto, 'UTF-8') || trim($texto) === '') {
        return null;
    }
    return $texto;
}
