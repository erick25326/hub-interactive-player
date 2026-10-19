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
    // Sin el campo (una actividad que no viene del formulario), el de por defecto.
    $data->etiquetas = ivplayer_modo_etiquetas($data->etiquetas ?? null);

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
    // Igual con el modo de las etiquetas: sólo si viene, y sólo uno de los dos valores.
    if (property_exists($data, 'etiquetas')) {
        $data->etiquetas = ivplayer_modo_etiquetas($data->etiquetas);
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

/* ─── Configurador de interacciones con el video de Bunny ───── */
//
// "Editar interacciones" (mod_form.php) abre el configurador publicado en GitHub Pages y
// le pasa por postMessage lo de la actividad. El configurador no tiene la clave: si la
// actividad reproduce Bunny, mod_form le firma ACÁ un enlace al playlist HLS, de vida
// corta, y se lo manda junto con lo de siempre. Uso y trampas: README ("Marcar los
// tiempos de un video de Bunny") y CLAUDE.md.

// Vida mínima del enlace del configurador: 2 h. Es lo que se puede tener abierto el
// formulario antes de tocar "Editar interacciones" (después hay que recargarlo) y lo
// que sirve un enlace que se filtre. Con el redondeo de ivplayer_bunny_expires, dura
// entre 2 y 3 h.
define('IVPLAYER_BUNNY_TTL_CONFIGURADOR', 7200);

/**
 * El video de Bunny de la actividad para el configurador, firmado con vida corta, o null
 * si la actividad no reproduce Bunny.
 *
 * La regla de "¿usa Bunny?" es LA de la lección (ivplayer_bunny_video): el configurador
 * muestra el video que ve el alumno. Si el player.html instalado no reproduce Bunny, la
 * lección va por Vimeo y el configurador también.
 *
 * Pura a propósito (tests/php/correr.php la prueba). mod_form.php la llama sólo para quien
 * puede editar la actividad. 🔴 Lo que devuelve sale al navegador del docente y a ningún
 * otro lado: no se guarda en la base, no va a un log ni a un campo del formulario.
 *
 * @param string|null $guardado Lo que guarda la actividad en `videourl` (el GUID).
 * @param string $host Host del CDN del sitio ('' = Bunny apagado en el sitio).
 * @param string $clave Clave de token del sitio ('' = enlace sin firmar). Nunca sale.
 * @param int $ahora UNIX en segundos (time() del servidor).
 * @param bool $reproductorbunny ¿El player.html instalado reproduce Bunny?
 * @return array{playlist: string, expires: int|null, ahora: int, guid: string}|null
 *         guid: para que el formulario no lo mande si se cambió el campo sin guardar.
 *         ahora: la hora del servidor al firmar, para medir el vencimiento sin el reloj
 *         de la compu. Sin poster ni query: el configurador no los usa.
 */
function ivplayer_bunny_configurador($guardado, string $host, string $clave, int $ahora, bool $reproductorbunny): ?array {
    $video = ivplayer_bunny_video($guardado, $host, $clave, IVPLAYER_BUNNY_TTL_CONFIGURADOR, $ahora, $reproductorbunny);
    if ($video === null) {
        return null;
    }
    return [
        'playlist' => $video['playlist'],
        'expires' => $video['expires'],
        'ahora' => $ahora,
        'guid' => ivplayer_bunny_normalizar_guid($guardado),
    ];
}

/**
 * El bloque que lleva el enlace del configurador en la página del formulario: un
 * <script type="application/json"> que el script de "Editar interacciones" lee y SACA de
 * la página al cargar. No es un campo del formulario, así que no viaja al guardar.
 *
 * @param array|null $fuente Lo de ivplayer_bunny_configurador().
 * @return string '' sin fuente.
 */
function ivplayer_configurador_fuente_html(?array $fuente): string {
    if ($fuente === null) {
        return '';
    }
    // 🔴 JSON_HEX_TAG: con "<" escapado no puede aparecer un "</script>" que cierre el
    // bloque antes de tiempo. Adentro de un <script> no se decodifican entidades: va el
    // JSON crudo.
    $json = json_encode($fuente, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return '';
    }
    return '<script type="application/json" id="ivplayer-video-firmado">' . $json . '</script>';
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

/* ─── Etiquetas: glosario interactivo o en pantalla (1.4.0) ──── */
//
// Las etiquetas (los términos con su definición) se muestran de dos maneras, por
// actividad (columna etiquetas, ajuste "Etiquetas" del formulario): 'glosario', el nuevo
// y el de por defecto (cada término se suma a un glosario en el momento en que se nombra,
// src/glosario.js), o 'pantalla', los pines sobre el video como hasta ahora (respaldo).
// Va a PLAYER_CONFIG.etiquetas. Los avisos de las que frenan (tic-tac, "plop") valen en
// los dos modos. Uso: README ("Glosario interactivo y avisos de las interacciones").

/**
 * El modo de las etiquetas de una actividad: 'pantalla' (como antes) o 'glosario'.
 *
 * Pura a propósito (tests/php/correr.php la prueba sin Moodle). Recibe lo guardado en la
 * columna: NULL (el código se actualizó y el upgrade todavía no corrió, o un backup de
 * antes de la 1.4.0), vacío o cualquier otra cosa cuentan como el de por defecto. Sólo
 * 'pantalla' vuelve a los pines.
 *
 * @param mixed $guardado La columna etiquetas de la tabla ivplayer.
 * @return string 'glosario' o 'pantalla'.
 */
function ivplayer_modo_etiquetas($guardado): string {
    return (is_string($guardado) && trim($guardado) === 'pantalla') ? 'pantalla' : 'glosario';
}

/**
 * Lo que va en window.PLAYER_CONFIG de una lección, salvo los subtítulos: el título, el
 * video ya elegido, el bucle, las interacciones y el modo de las etiquetas. Lo arma
 * player.php.
 *
 * Pura a propósito (tests/php/correr.php): recibe el registro de la actividad y el video
 * que eligió player.php (Bunny firmado o Vimeo), y no mira ningún ajuste del sitio.
 *
 * @param stdClass $ivplayer Registro de la tabla ivplayer.
 * @param array $video Lo de player.php: vimeoId/vimeoHash, o videoUrl/poster.
 * @return array
 */
function ivplayer_config_base(stdClass $ivplayer, array $video): array {
    $interactions = !empty($ivplayer->interactions) ? $ivplayer->interactions : '[]';
    return array_merge(['title' => $ivplayer->name], $video, [
        'loop' => !empty($ivplayer->videoloop),
        'interactions' => json_decode($interactions, true) ?: [],
        // `?? null`: con el código nuevo y el upgrade sin correr la columna no existe.
        'etiquetas' => ivplayer_modo_etiquetas($ivplayer->etiquetas ?? null),
    ]);
}

/* ─── Red de seguridad: Vimeo si el CDN de Bunny falla (plan Bunny 0.4) ── */
//
// Si el video de Bunny no se puede reproducir por una falla del CDN (red, 5xx, 404 o un
// error fatal del medio, después de los reintentos), el reproductor (src/respaldo.js) le
// avisa a respaldo.php, que registra el salto con su causa, y recarga player.php con
// ?origen=vimeo. player.php fuerza Vimeo en esa carga sólo con el ajuste del sitio
// respaldovimeo prendido y la actividad con ID de Vimeo; si no, lo ignora. El ajuste
// viene APAGADO. No cambia de motor en caliente: recarga, y retoma del avance guardado.
// Uso, cómo contar los saltos y trampas: README ("Red de seguridad") y CLAUDE.md.

/**
 * ¿Esta actividad tiene red de seguridad? El ajuste del sitio prendido y un ID de Vimeo
 * cargado en la actividad.
 *
 * La usan player.php (para ofrecerla en una carga de Bunny y para respetar ?origen=vimeo)
 * y respaldo.php (para no registrar un salto que player.php después ignoraría). Pura a
 * propósito: tests/php/correr.php la prueba sin Moodle.
 *
 * @param mixed $ajuste get_config('mod_ivplayer', 'respaldovimeo'): false sin guardar
 *        (recién instalado), '0' o '1'. Sólo '1' prende.
 * @param mixed $vimeoid El ID de Vimeo de la actividad (columna vimeoid). La condición es
 *        la de la rama de Vimeo de player.php: algo cargado.
 * @return bool
 */
function ivplayer_respaldo_vimeo($ajuste, $vimeoid): bool {
    if (is_array($ajuste) || is_object($ajuste) || (string) $ajuste !== '1') {
        return false;
    }
    return is_scalar($vimeoid) && trim((string) $vimeoid) !== '';
}

/**
 * ¿player.php fuerza Vimeo en esta carga? Sólo si la pidió el reproductor (?origen=vimeo)
 * y la actividad tiene red de seguridad (ivplayer_respaldo_vimeo). Si no, el parámetro se
 * ignora y la lección sale como siempre (con Bunny, si lo tiene).
 *
 * Pura a propósito (tests/php/correr.php).
 *
 * @param mixed $ajuste get_config('mod_ivplayer', 'respaldovimeo').
 * @param mixed $vimeoid El ID de Vimeo de la actividad.
 * @param mixed $origen optional_param('origen', '', PARAM_ALPHA).
 * @return bool
 */
function ivplayer_respaldo_forzar($ajuste, $vimeoid, $origen): bool {
    return $origen === 'vimeo' && ivplayer_respaldo_vimeo($ajuste, $vimeoid);
}

/**
 * Lo que manda el reproductor para registrar el salto, validado: la causa, el código
 * HTTP y el detalle, o null si la causa no es una por la que se salta.
 *
 * 🔴 Es la lista de causaDelRespaldo() (src/respaldo.js), del lado del servidor: aunque un
 * reproductor viejo o tocado lo pidiera, por la firma (401/403/410) no se salta ni se
 * registra. Con una causa HTTP el código es el de la causa: no se guardan dos datos que
 * se contradigan. Cualquier otro error de hls.js ('otro') tampoco: el plan cuenta sólo
 * la red, un 5xx, un 404 o un error fatal del medio.
 *
 * Pura a propósito (tests/php/correr.php).
 *
 * @param mixed $causa 'red', 'medio', 'http-404' o 'http-5NN'.
 * @param mixed $codigo Código HTTP (0 si no hubo).
 * @param mixed $detalle El nombre del error (hls.js: manifestLoadError, fragLoadError…).
 * @return array{causa: string, codigo: int, detalle: string}|null
 */
function ivplayer_respaldo_datos($causa, $codigo, $detalle): ?array {
    if (!is_string($causa) || !preg_match('/^(red|medio|http-404|http-5\d\d)$/D', $causa)) {
        return null;
    }
    $codigo = is_numeric($codigo) ? (int) $codigo : 0;
    if (in_array($codigo, [401, 403, 410], true)) {
        return null;
    }
    if ($codigo < 0 || $codigo > 599) {
        $codigo = 0;
    }
    if (strpos($causa, 'http-') === 0) {
        $codigo = (int) substr($causa, 5);
    }
    $detalle = is_scalar($detalle) ? preg_replace('/[^A-Za-z0-9_.:-]/', '', (string) $detalle) : '';
    return ['causa' => $causa, 'codigo' => $codigo, 'detalle' => substr($detalle, 0, 64)];
}

/**
 * Registra en el log del campus que esta carga de la lección pasa a Vimeo (la red de
 * seguridad), con su causa. Lo llama respaldo.php, una vez por salto.
 *
 * 🔴 La clase del evento es nueva y Moodle la ve recién después del upgrade, como la del
 * evento de vista (ver ivplayer_view): sin el class_exists, respaldo.php tiraría "clase no
 * encontrada" en ese rato y el alumno se quedaría sin el respaldo. Sin la clase, no
 * registra y devuelve false (el salto sigue).
 *
 * @param stdClass $ivplayer Registro de la tabla ivplayer.
 * @param stdClass $course Registro del curso.
 * @param stdClass|cm_info $cm Módulo del curso.
 * @param context_module $context Contexto del módulo.
 * @param array $datos Lo de ivplayer_respaldo_datos(): causa, codigo, detalle.
 * @return bool Si quedó registrado.
 */
function ivplayer_respaldo_registrar($ivplayer, $course, $cm, $context, array $datos): bool {
    if (!class_exists(\mod_ivplayer\event\respaldo_vimeo_usado::class)) {
        return false;
    }
    $event = \mod_ivplayer\event\respaldo_vimeo_usado::create([
        'objectid' => $ivplayer->id,
        'context' => $context,
        'other' => $datos,
    ]);
    $event->add_record_snapshot('course_modules', $cm);
    $event->add_record_snapshot('course', $course);
    $event->add_record_snapshot('ivplayer', $ivplayer);
    $event->trigger();
    return true;
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

/* ─── Subtítulos en la TV (Chromecast, 1.4.0) ───────────────── */
//
// Con el video en la TV, los subtítulos los tiene que dibujar la TV: el receptor de Cast
// (el de Google en Chrome, o el Cast nativo de hub-app) baja el VTT él solo, como baja el
// video. Pero lo pide SIN la cookie del campus, así que no puede leerlo de player.php ni
// de pluginfile.php. Lo sirve subtitulos.php, sin sesión y con una firma propia en la URL:
//
//   subtitulos.php?id=<cmid>&e=<vencimiento unix>&s=<base64url(HMAC-SHA256("cmid|e", secreto))>
//
// El secreto es un ajuste del plugin (subtitulossecreto) que crean la instalación y el
// upgrade (db/upgradelib.php) y que no se muestra ni se exporta. La URL la arma player.php
// con el MISMO vencimiento que la firma del video (subtitlesUrlTv en PLAYER_CONFIG) y
// firma.php la renueva junto con él: cuando la TV vuelve a cargar el video con la firma
// nueva, la pista va con la URL nueva. Uso y trampas: README ("Subtítulos en la TV") y
// CLAUDE.md.
//
// Las funciones puras (de ivplayer_subtitulos_tv_firma a ivplayer_subtitulos_a_vtt) no
// tocan Moodle: tests/php/correr.php las lee de este archivo y las prueba.

/** Largo mínimo del secreto: el que crea upgradelib son 43 caracteres (32 bytes). */
define('IVPLAYER_SUBTITULOS_TV_SECRETO_MIN', 32);
/** Margen, en segundos, sobre la vida más larga que puede tener un enlace legítimo. */
define('IVPLAYER_SUBTITULOS_TV_MARGEN', 300);

/**
 * La firma del enlace de subtítulos para la TV, o null si no se puede firmar.
 *
 * Mensaje "cmid|e" con el secreto como CLAVE del HMAC (como el token de Bunny) y el digest
 * binario en base64url, sin "=". Pura (tests/php/correr.php).
 *
 * @param int $cmid Módulo del curso (la actividad).
 * @param int $expires Vencimiento, UNIX en segundos.
 * @param string $secreto El ajuste subtitulossecreto. Nunca sale: lo que sale es la firma.
 * @return string|null null sin secreto (o uno corto), con un cmid o un vencimiento no positivos.
 */
function ivplayer_subtitulos_tv_firma(int $cmid, int $expires, string $secreto): ?string {
    if ($cmid <= 0 || $expires <= 0 || strlen($secreto) < IVPLAYER_SUBTITULOS_TV_SECRETO_MIN) {
        return null;
    }
    $digest = hash_hmac('sha256', $cmid . '|' . $expires, $secreto, true);
    return rtrim(strtr(base64_encode($digest), '+/', '-_'), '=');
}

/**
 * Los parámetros de la URL de subtitulos.php para la TV (id, e, s), o null.
 *
 * Pura (tests/php/correr.php). player.php y firma.php la usan a través de
 * ivplayer_subtitulos_tv_url(), que le pone el secreto del sitio y la ruta.
 *
 * @param int $cmid
 * @param int $expires El MISMO vencimiento que la firma del video.
 * @param string $secreto
 * @return array{id: int, e: int, s: string}|null
 */
function ivplayer_subtitulos_tv_parametros(int $cmid, int $expires, string $secreto): ?array {
    $firma = ivplayer_subtitulos_tv_firma($cmid, $expires, $secreto);
    return $firma === null ? null : ['id' => $cmid, 'e' => $expires, 's' => $firma];
}

/**
 * ¿El pedido que llegó a subtitulos.php trae una firma buena, vigente y dentro del tope?
 *
 * 🔴 Comparación con hash_equals (tiempo constante): con === la firma se podría adivinar
 * de a un carácter midiendo cuánto tarda la respuesta. Y la firma va ANTES de mirar la
 * base: sin ella, nadie hace que el servidor busque nada.
 * El tope no deja pasar un vencimiento lejano: un enlace legítimo vence, como mucho, a la
 * duración del token del video más la hora del redondeo (ivplayer_bunny_expires).
 * Pura (tests/php/correr.php): recibe lo que leyó subtitulos.php, el secreto y la hora.
 *
 * @param mixed $cmid El parámetro id (PARAM_INT: un entero, 0 si faltó).
 * @param mixed $expires El parámetro e.
 * @param mixed $firma El parámetro s.
 * @param string $secreto
 * @param int $ahora UNIX en segundos.
 * @param int $tope Cuánto más allá de $ahora puede vencer un enlace (ivplayer_subtitulos_tv_tope).
 * @return bool
 */
function ivplayer_subtitulos_tv_valida($cmid, $expires, $firma, string $secreto, int $ahora, int $tope): bool {
    if (!is_int($cmid) || !is_int($expires) || !is_string($firma) || $firma === '') {
        return false;
    }
    $esperada = ivplayer_subtitulos_tv_firma($cmid, $expires, $secreto);
    if ($esperada === null || !hash_equals($esperada, $firma)) {
        return false;
    }
    return $expires > $ahora && $expires <= $ahora + $tope;
}

/**
 * Cuánto más allá de ahora puede vencer un enlace de subtítulos legítimo: la duración del
 * token del video, la hora del redondeo de ivplayer_bunny_expires y un margen.
 *
 * 🔴 Con la duración del sitio: si el admin la baja, los enlaces ya emitidos con la vieja
 * dejan de valer. La TV baja el VTT al cargar el video, y cada carga de después (la
 * renovación de la firma) trae uno nuevo, así que a lo sumo una TV que se recarga sin
 * renovar (el video terminado y vuelto a empezar) se queda sin subtítulos hasta la
 * próxima renovación.
 * Pura (tests/php/correr.php).
 *
 * @param int $ttl Duración del token del video (ivplayer_bunny_ttl), en segundos.
 * @return int Segundos.
 */
function ivplayer_subtitulos_tv_tope(int $ttl): int {
    return max(0, $ttl) + 3600 + IVPLAYER_SUBTITULOS_TV_MARGEN;
}

/**
 * Los cues de un VTT o SRT ya normalizado a UTF-8: [inicio en ms, fin en ms, texto].
 *
 * 🔴 Es parseVTT + textoDeCue de src/subtitulos.js, línea por línea, para que la TV
 * muestre EXACTAMENTE lo mismo que dibuja el celular: la misma regex del tiempo (que es
 * también la de la transcripción del tema), las mismas etiquetas sacadas y las mismas
 * entidades resueltas. Si se toca una, tocar la otra: los vectores compartidos
 * (tests/php/vectores-subtitulos.json) los prueban las dos, en PHP (correr.php) y en Node
 * (tests/unit/subtitulos-tv.test.mjs). El trim de JS saca también los espacios de Unicode
 * (el de no separación, U+FEFF…): acá, con la misma clase.
 * Pura (tests/php/correr.php).
 *
 * @param string $texto UTF-8 válido (ivplayer_subtitulos_normalizar).
 * @return array<int, array{0: int, 1: int, 2: string}>
 */
function ivplayer_subtitulos_cues(string $texto): array {
    $blancos = '[\s\p{Zs}\x{FEFF}\x{2028}\x{2029}]';
    $recortar = function (string $s) use ($blancos): string {
        return (string) preg_replace('/^' . $blancos . '+|' . $blancos . '+$/uD', '', $s);
    };
    $tiempo = '/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/';
    // Milisegundos exactos: "0." + 1 a 3 dígitos es una fracción decimal (",5" = 500 ms).
    $ms = function ($h, $m, $s, $f): int {
        return (((int) $h * 60 + (int) $m) * 60 + (int) $s) * 1000 + (int) str_pad((string) $f, 3, '0', STR_PAD_RIGHT);
    };
    // textoDeCue: fuera lo que tiene forma de etiqueta (VTT y SRT), entidades resueltas.
    $textodecue = function (string $t) use ($recortar): string {
        $t = (string) preg_replace('/<\/?[a-zA-Z][^<>]*>|<\d{2,}:\d{2}[:.,\d]*>/u', '', $t);
        $t = str_replace(['&lt;', '&gt;', '&nbsp;', '&lrm;', '&rlm;', '&quot;', '&apos;'],
            ['<', '>', "\u{00A0}", '', '', '"', "'"], $t);
        $cp = function ($n): string {
            return ($n > 0 && $n <= 0x10FFFF && ($n < 0xD800 || $n > 0xDFFF)) ? (string) mb_chr((int) $n, 'UTF-8') : '';
        };
        $t = (string) preg_replace_callback('/&#(\d+);/', function ($m) use ($cp) {
            return $cp((int) $m[1]);
        }, $t);
        $t = (string) preg_replace_callback('/&#x([0-9a-f]+);/i', function ($m) use ($cp) {
            return $cp(hexdec($m[1]));
        }, $t);
        return $recortar(str_replace('&amp;', '&', $t));
    };
    $lineas = preg_split('/\r*\n|\r/', $texto);
    $cues = [];
    $cur = null;
    $cerrar = function () use (&$cur, &$cues, $textodecue) {
        if ($cur !== null) {
            $t = $textodecue(implode("\n", $cur['l']));
            if ($t !== '' && $cur['fin'] > $cur['inicio']) {
                $cues[] = [$cur['inicio'], $cur['fin'], $t];
            }
        }
        $cur = null;
    };
    $n = count($lineas);
    for ($i = 0; $i < $n; $i++) {
        $linea = $lineas[$i];
        $m = [];
        if (preg_match($tiempo, $linea, $m)) {
            $cerrar();
            $cur = ['inicio' => $ms($m[1], $m[2], $m[3], $m[4]), 'fin' => $ms($m[5], $m[6], $m[7], $m[8]), 'l' => []];
            continue;
        }
        if ($cur === null) {
            continue;
        }
        if ($recortar($linea) === '') {
            foreach ($cur['l'] as $x) {
                if ($recortar($x) !== '') {
                    $cerrar();
                    break;
                }
            }
            continue;
        }
        // El número de un SRT pegado al tiempo siguiente no es texto.
        if (preg_match('/^' . $blancos . '*\d+' . $blancos . '*$/uD', $linea) && $i + 1 < $n && preg_match($tiempo, $lineas[$i + 1])) {
            continue;
        }
        $cur['l'][] = $linea;
    }
    $cerrar();
    return $cues;
}

/**
 * Un VTT o SRT (ya en UTF-8) como WebVTT estricto, el que entiende cualquier receptor de
 * Cast, o null si no tiene ningún cue.
 *
 * Sale de los MISMOS cues que dibuja el celular (ivplayer_subtitulos_cues): un SRT pasa a
 * WebVTT, y un VTT "flojo" (horas de un dígito o ausentes, coma, milisegundos cortos,
 * ajustes de posición) queda con los tiempos en HH:MM:SS.mmm. El texto va sin etiquetas
 * (como en el celular) y con &, < y > escapados: así una flecha o una etiqueta del texto
 * no se leen como tiempo o formato. Sin renglones en blanco adentro de un cue (cortarían
 * el cue en el receptor).
 * Pura (tests/php/correr.php).
 *
 * @param string $texto UTF-8 válido (ivplayer_subtitulos_normalizar).
 * @return string|null
 */
function ivplayer_subtitulos_a_vtt(string $texto): ?string {
    $cues = ivplayer_subtitulos_cues($texto);
    if (!$cues) {
        return null;
    }
    $hora = function (int $ms): string {
        return sprintf('%02d:%02d:%02d.%03d', intdiv($ms, 3600000), intdiv($ms, 60000) % 60, intdiv($ms, 1000) % 60, $ms % 1000);
    };
    $bloques = [];
    foreach ($cues as [$inicio, $fin, $t]) {
        $lineas = [];
        foreach (explode("\n", $t) as $l) {
            if (preg_match('/[^\s\p{Zs}\x{FEFF}\x{2028}\x{2029}]/u', $l)) {
                $lineas[] = str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $l);
            }
        }
        $bloques[] = $hora($inicio) . ' --> ' . $hora($fin) . "\n" . implode("\n", $lineas);
    }
    return "WEBVTT\n\n" . implode("\n\n", $bloques) . "\n";
}

/**
 * El secreto con que se firman los enlaces de subtítulos para la TV, o '' si no está (el
 * código se actualizó y el upgrade todavía no corrió: sin él no se ofrece la pista a la
 * TV, y el celular sigue dibujando los subtítulos).
 *
 * 🔴 Sólo del lado del servidor, para firmar y verificar. No va al navegador, ni a un
 * log, ni a un error, ni a la pantalla de ajustes.
 *
 * @return string
 */
function ivplayer_subtitulos_tv_secreto(): string {
    $secreto = get_config('mod_ivplayer', 'subtitulossecreto');
    return is_string($secreto) ? trim($secreto) : '';
}

/**
 * La URL firmada de subtitulos.php para la TV, o null si no se puede firmar (sin secreto).
 *
 * La usan player.php (subtitlesUrlTv, con el vencimiento de la firma del video) y firma.php
 * (subtitulosTv, la nueva con cada renovación).
 *
 * @param int $cmid
 * @param int $expires El vencimiento de la firma del video.
 * @return string|null
 */
function ivplayer_subtitulos_tv_url(int $cmid, int $expires): ?string {
    $parametros = ivplayer_subtitulos_tv_parametros($cmid, $expires, ivplayer_subtitulos_tv_secreto());
    return $parametros === null ? null : (new moodle_url('/mod/ivplayer/subtitulos.php', $parametros))->out(false);
}
