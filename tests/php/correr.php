<?php
// Pruebas de las funciones PURAS de mod/ivplayer/lib.php, con PHP de verdad y sin
// Moodle: la firma de Bunny (HS256), la regla de "¿esta actividad usa Bunny?" que
// comparten player.php y firma.php, la lectura de lo que pega el docente y la
// normalización de los subtítulos a UTF-8. Antes, la sintaxis de TODOS los .php del
// plugin (php -l): los que necesitan Moodle no los ejecuta ninguna prueba.
//
//   php tests/php/correr.php          (desde cualquier carpeta)
//
// Sale con 0 si todo da bien, 1 si algo falla y 2 si falta algo para correr.
//
// Las funciones NO se copian: se leen de lib.php cada vez, desde "function nombre(" hasta
// la primera "}" en la columna 0, y se cargan con eval. Así la prueba siempre mira el
// código que se instala. Para eso tienen que seguir siendo puras (sin get_config, $DB,
// archivos): si alguna empieza a usar Moodle, esto lo avisa antes de probarla.
//
// De Moodle se reemplaza lo mínimo: coding_exception y core_text::convert.
// Los vectores de la firma están en vectores-bunny.json (los comparte con la prueba en
// Node del espejo, tests/unit/bunny-espejo.test.mjs, que corre sin PHP).

error_reporting(E_ALL);
// Avisos y deprecaciones a la vista en el log de CI (no hacen fallar la prueba). Los
// silenciados con @ (iconv en core_text) no pasan por acá.
set_error_handler(function ($nivel, $mensaje, $archivo, $linea) {
    if (!(error_reporting() & $nivel)) {
        return false;
    }
    echo "AVISO PHP: $mensaje (línea $linea)" . PHP_EOL;
    return true;
});

foreach (['mbstring', 'iconv', 'json', 'hash'] as $extension) {
    if (!extension_loaded($extension)) {
        fwrite(STDERR, "Falta la extensión '$extension' de PHP (Moodle también la exige)." . PHP_EOL);
        exit(2);
    }
}

if (!class_exists('coding_exception')) {
    // En Moodle es la excepción de "error de programación": acá alcanza con una propia.
    class coding_exception extends Exception {
    }
}

if (!class_exists('core_text')) {
    // Lo que hace core_text::convert de Moodle 4.x/5.x: iconv con //TRANSLIT, y false si
    // iconv no puede (un byte que no existe en la codificación de origen, UTF-16 cortado).
    class core_text {
        public static function convert($text, $fromcs, $tocs = 'utf-8') {
            $text = (string) $text;
            if ($text === '') {
                return '';
            }
            return @iconv(strtolower($fromcs), strtolower($tocs) . '//TRANSLIT', $text);
        }
    }
}

$funciones = [
    'ivplayer_bunny_normalizar_guid',
    'ivplayer_bunny_analizar',
    'ivplayer_bunny_normalizar_host',
    'ivplayer_bunny_error_de_entrada',
    'ivplayer_bunny_validar',
    'ivplayer_bunny_token',
    'ivplayer_bunny_firmar',
    'ivplayer_bunny_urls',
    'ivplayer_bunny_expires',
    'ivplayer_bunny_video',
    'ivplayer_reproductor_soporta_bunny',
    'ivplayer_subtitulos_normalizar',
    'ivplayer_app_cast_publicada',
];

$rutalib = dirname(__DIR__, 2) . '/mod/ivplayer/lib.php';
$src = @file_get_contents($rutalib);
if ($src === false) {
    fwrite(STDERR, "No pude leer $rutalib" . PHP_EOL);
    exit(2);
}
// Con CRLF (checkout en Windows) o LF, igual.
$src = str_replace("\r\n", "\n", $src);

$codigo = '';
foreach ($funciones as $nombre) {
    $m = [];
    if (!preg_match('/^function ' . preg_quote($nombre, '/') . '\(/m', $src, $m, PREG_OFFSET_CAPTURE)) {
        fwrite(STDERR, "No encontré la función $nombre en lib.php (¿se renombró?)." . PHP_EOL);
        exit(1);
    }
    $desde = $m[0][1];
    $hasta = strpos($src, "\n}", $desde);
    if ($hasta === false) {
        fwrite(STDERR, "No encontré dónde termina $nombre en lib.php." . PHP_EOL);
        exit(1);
    }
    $cuerpo = substr($src, $desde, $hasta + 2 - $desde);
    // 🔴 Si una de estas empieza a usar Moodle ya no es pura: no se puede probar acá y,
    // peor, un cálculo podría tocar la base o la configuración.
    $moodle = [];
    if (preg_match('/\bget_config\b|\bget_file_storage\b|\$DB\b|\$CFG\b|\$USER\b|\bmoodle_exception\b|\brequire(_once)?\b/', $cuerpo, $moodle)) {
        fwrite(STDERR, "$nombre usa Moodle ({$moodle[0]}): sacalo a otra función o dejá de probarla acá." . PHP_EOL);
        exit(1);
    }
    $codigo .= $cuerpo . "\n";
}
try {
    eval($codigo);
} catch (ParseError $e) {
    fwrite(STDERR, 'Las funciones leídas de lib.php no compilan: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

$vectores = json_decode((string) file_get_contents(__DIR__ . '/vectores-bunny.json'), true);
if (!is_array($vectores)) {
    fwrite(STDERR, 'No pude leer vectores-bunny.json' . PHP_EOL);
    exit(2);
}

$ok = 0;
$mal = 0;
$okantes = 0;
$malantes = 0;

function chequear(string $nombre, $obtenido, $esperado): void {
    global $ok, $mal;
    if ($obtenido === $esperado) {
        $ok++;
        return;
    }
    $mal++;
    echo 'MAL  ' . $nombre . PHP_EOL;
    echo '     obtenido: ' . var_export($obtenido, true) . PHP_EOL;
    echo '     esperado: ' . var_export($esperado, true) . PHP_EOL;
}

// Cierra una sección: cuántas dieron bien y mal desde la anterior.
function seccion(string $titulo): void {
    global $ok, $mal, $okantes, $malantes;
    echo sprintf('%5d ok %3d mal  ', $ok - $okantes, $mal - $malantes) . $titulo . PHP_EOL;
    $okantes = $ok;
    $malantes = $mal;
}

// Lo que importa de los subtítulos: UTF-8 válido (json_encode no falla) o null. Con un
// solo byte inválido, json_encode del PLAYER_CONFIG da false y el reproductor queda sin
// config. $sinbom: además, que no empiece con el BOM de UTF-8.
function utf8_seguro($r, bool $sinbom = true): bool {
    if ($r === null) {
        return true;
    }
    return is_string($r) && $r !== '' && mb_check_encoding($r, 'UTF-8') && json_encode($r) !== false
        && (!$sinbom || strncmp($r, "\xEF\xBB\xBF", 3) !== 0);
}

echo 'PHP ' . PHP_VERSION . ' · ' . count($funciones) . ' funciones leídas de mod/ivplayer/lib.php' . PHP_EOL . PHP_EOL;

// ─── Sintaxis de todo el plugin ──────────────────────────────────────────────
// 🔴 player.php, firma.php y el resto necesitan Moodle para correr: ninguna prueba los
// ejecuta. Sin esto, un error de sintaxis llegaba al campus sin que nada lo frenara (con
// player.php roto, TODAS las lecciones dan error; con firma.php roto, el reproductor lo
// toma como "sin red" y termina en un cartel de conexión que no es cierto). php -l
// compila sin ejecutar. Si exec() no está habilitado, el analizador de PHP
// (token_get_all con TOKEN_PARSE) ve los errores de sintaxis, no todos los de compilación.
$raizplugin = dirname(__DIR__, 2) . '/mod/ivplayer';
$archivosphp = [];
$recorrido = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($raizplugin, FilesystemIterator::SKIP_DOTS));
foreach ($recorrido as $archivo) {
    if ($archivo->isFile() && strtolower($archivo->getExtension()) === 'php') {
        $archivosphp[] = $archivo->getPathname();
    }
}
sort($archivosphp);
$conexec = function_exists('exec');
foreach ($archivosphp as $ruta) {
    $nombre = str_replace('\\', '/', substr($ruta, strlen($raizplugin) + 1));
    if ($conexec) {
        $salida = [];
        $estadolint = 1;
        exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($ruta) . ' 2>&1', $salida, $estadolint);
        $resultado = $estadolint === 0 ? 'sin errores' : trim(implode(PHP_EOL, $salida));
    } else {
        try {
            token_get_all((string) file_get_contents($ruta), TOKEN_PARSE);
            $resultado = 'sin errores';
        } catch (ParseError $e) {
            $resultado = $e->getMessage() . ' (línea ' . $e->getLine() . ')';
        }
    }
    chequear('sintaxis de ' . $nombre, $resultado, 'sin errores');
}
chequear('se revisó la sintaxis de player.php y firma.php',
    in_array('player.php', array_map('basename', $archivosphp), true) && in_array('firma.php', array_map('basename', $archivosphp), true), true);
seccion('sintaxis de cada .php de mod/ivplayer (' . count($archivosphp) . ' archivos, ' . ($conexec ? 'php -l' : 'token_get_all') . ')');

// ─── Firma de Bunny ───────────────────────────────────────────────────────────
foreach ($vectores['token'] as $t) {
    chequear('token ' . $t['ruta'] . ' (' . $t['fuente'] . ')',
        ivplayer_bunny_token($t['clave'], $t['ruta'], $t['expires']), $t['esperado']);
}
seccion('token contra los vectores oficiales de Bunny');

foreach ($vectores['firmar'] as $f) {
    chequear('firmar ' . $f['nombre'], ivplayer_bunny_firmar($f['host'], $f['guid'], $f['clave'], $f['expires']), [
        'playlist' => $f['playlist'],
        'poster' => $f['poster'],
        'query' => $f['query'],
        'expires' => $f['expires'],
    ]);
    chequear('urls con clave ' . $f['nombre'], ivplayer_bunny_urls($f['host'], $f['guid'], $f['clave'], $f['expires']), [
        'playlist' => $f['playlist'],
        'poster' => $f['poster'],
        'firmada' => true,
        'expires' => $f['expires'],
    ]);
}
$u = $vectores['urlsSinClave'];
chequear('urls sin clave', ivplayer_bunny_urls($u['host'], $u['guid'], '', 0), $u['esperado']);
seccion('firmar y urls contra el SDK oficial de Bunny');

foreach ($vectores['rechazos'] as $r) {
    $lanzo = false;
    try {
        call_user_func_array('ivplayer_bunny_' . $r['funcion'], $r['args']);
    } catch (coding_exception $e) {
        $lanzo = true;
    } catch (Throwable $e) {
        $lanzo = 'otra excepción: ' . get_class($e) . ': ' . $e->getMessage();
    }
    chequear('rechaza: ' . $r['nombre'], $lanzo, true);
}
seccion('nunca se firma algo que no sea /<guid>/ de un host válido');

foreach ($vectores['expires'] as $e) {
    chequear('expires(' . $e[0] . ', ' . $e[1] . ')', ivplayer_bunny_expires($e[0], $e[1]), $e[2]);
}
seccion('vencimiento: hora en punto siguiente + TTL');

// La regla que comparten player.php (al armar la lección) y firma.php (al volver a
// firmarla con la lección abierta): si divergieran, firma.php podría firmar un video que
// la lección no reproduce, o negarse a renovar uno que sí.
foreach ($vectores['video'] as $v) {
    $r = ivplayer_bunny_video($v['guardado'], $v['host'], $v['clave'], $v['ttl'], $v['ahora'], $v['reproductor']);
    chequear('video ' . $v['nombre'], $r, $v['esperado']);
    // 🔴 Sale al navegador (PLAYER_CONFIG y la respuesta de firma.php): nunca la clave.
    // Serializado como lo serializa firma.php (sin escapar "/": con json_encode a secas,
    // una clave con "/" saldría escapada y strpos no la encontraría) y, además, campo por
    // campo, crudo.
    $sale = $v['clave'] !== '' && strpos((string) json_encode($r, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $v['clave']) !== false;
    foreach ((array) $r as $campo) {
        if ($v['clave'] !== '' && is_string($campo) && strpos($campo, $v['clave']) !== false) {
            $sale = true;
        }
    }
    chequear('video ' . $v['nombre'] . ': la clave no sale', $sale, false);
}
seccion('video de una actividad: la misma regla para player.php y firma.php');

// ─── Lo que pega el docente en el formulario ─────────────────────────────────
foreach ($vectores['normalizarGuid'] as $c) {
    chequear('normalizar_guid ' . var_export($c[0], true), ivplayer_bunny_normalizar_guid($c[0]), $c[1]);
}
seccion('normalizar_guid');
foreach ($vectores['normalizarHost'] as $c) {
    chequear('normalizar_host ' . var_export($c[0], true), ivplayer_bunny_normalizar_host($c[0]), $c[1]);
}
seccion('normalizar_host');
foreach ($vectores['analizar'] as $c) {
    chequear('analizar ' . var_export($c[0], true), ivplayer_bunny_analizar($c[0]), $c[1]);
}
seccion('analizar: GUID + host o biblioteca de origen');
foreach ($vectores['errorDeEntrada'] as $c) {
    chequear('error_de_entrada ' . var_export([$c[0], $c[1], $c[2], $c[3]], true),
        ivplayer_bunny_error_de_entrada($c[0], $c[1], $c[2], $c[3]), $c[4]);
}
seccion('error_de_entrada: otro host, otra biblioteca, sitio sin Bunny');
foreach ($vectores['soportaBunny'] as $c) {
    chequear('soporta_bunny ' . var_export($c[0], true), ivplayer_reproductor_soporta_bunny($c[0]), $c[1]);
}
seccion('reproductor instalado que soporta Bunny (marca loadSource)');

// ─── Subtítulos a UTF-8 ──────────────────────────────────────────────────────
$vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAcci\u{F3}n y \u{F1}and\u{FA}\n";
$srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nC\u{E1}mara y \u{D3}ptica\r\n";
$bom8 = "\xEF\xBB\xBF";

chequear('UTF-8 válido queda igual', ivplayer_subtitulos_normalizar($vtt), $vtt);
chequear('el BOM de UTF-8 (exporte de Premiere) se saca', ivplayer_subtitulos_normalizar($bom8 . $vtt), $vtt);
chequear('UTF-16LE con BOM se pasa a UTF-8',
    ivplayer_subtitulos_normalizar("\xFF\xFE" . mb_convert_encoding($srt, 'UTF-16LE', 'UTF-8')), $srt);
chequear('UTF-16BE con BOM se pasa a UTF-8',
    ivplayer_subtitulos_normalizar("\xFE\xFF" . mb_convert_encoding($srt, 'UTF-16BE', 'UTF-8')), $srt);
chequear('Windows-1252 (SRT viejo) se pasa a UTF-8, comillas tipográficas y euro incluidos',
    ivplayer_subtitulos_normalizar("1\n00:00:01,000 --> 00:00:02,000\nCampa\xF1a \x93ok\x94 \x80\n"),
    "1\n00:00:01,000 --> 00:00:02,000\nCampa\u{F1}a \u{201C}ok\u{201D} \u{20AC}\n");

// UTF-8 con UN byte suelto (una línea editada en un editor ANSI): se limpia ese byte
// y el resto queda como estaba. Antes se convertía todo como Windows-1252 ("AcciÃ³n").
$roto = ivplayer_subtitulos_normalizar("Acci\u{F3}n \xFF y \u{F1}and\u{FA}\n");
chequear('UTF-8 con un byte roto: sale UTF-8 válido', utf8_seguro($roto) && $roto !== null, true);
chequear('UTF-8 con un byte roto: las letras buenas quedan intactas (sin "AcciÃ³n")',
    is_string($roto) && strpos($roto, "Acci\u{F3}n ") === 0 && strpos($roto, "\u{F1}and\u{FA}") !== false, true);

chequear('vacío: sin subtítulos', ivplayer_subtitulos_normalizar(''), null);
chequear('sólo espacios: sin subtítulos', ivplayer_subtitulos_normalizar(" \r\n\t "), null);
chequear('sólo el BOM: sin subtítulos', ivplayer_subtitulos_normalizar($bom8), null);
chequear('UTF-16LE vacío: sin subtítulos', ivplayer_subtitulos_normalizar("\xFF\xFE"), null);

// Entradas raras: el resultado exacto depende de iconv, pero NUNCA UTF-8 inválido.
$raras = [
    'Windows-1252 con un byte indefinido (0x81)' => "1\n00:00:01,000 --> 00:00:02,000\nCampa\x81a\n",
    'UTF-16LE con un byte de más al final' => "\xFF\xFE" . mb_convert_encoding($srt, 'UTF-16LE', 'UTF-8') . "\x00",
    'UTF-16LE sin BOM' => mb_convert_encoding($srt, 'UTF-16LE', 'UTF-8'),
    'BOM de UTF-8 seguido de Windows-1252' => $bom8 . "Campa\xF1a\n",
];
foreach ($raras as $nombre => $texto) {
    chequear('nunca UTF-8 inválido: ' . $nombre, utf8_seguro(ivplayer_subtitulos_normalizar($texto)), true);
}
// Bytes al azar con y sin BOM. Acá no se exige "sin BOM": un UTF-16 al azar puede traer
// un U+FEFF de verdad como primera letra, y eso es inofensivo; lo que rompe es el UTF-8 inválido.
mt_srand(2026);
$prefijos = ['', $bom8, "\xFF\xFE", "\xFE\xFF"];
$malos = 0;
for ($i = 0; $i < 500; $i++) {
    $bytes = $prefijos[$i % 4];
    $largo = mt_rand(0, 80);
    for ($k = 0; $k < $largo; $k++) {
        $bytes .= chr(mt_rand(0, 255));
    }
    if (!utf8_seguro(ivplayer_subtitulos_normalizar($bytes), false)) {
        $malos++;
        echo 'MAL  bytes al azar #' . $i . ': ' . bin2hex($bytes) . PHP_EOL;
    }
}
chequear('500 entradas de bytes al azar: siempre UTF-8 válido o null', $malos, 0);
seccion('subtítulos: BOM, UTF-16, Windows-1252, bytes rotos, vacío');

// ─── La casilla "La app con Chromecast ya está publicada" (1.4.0) ────────────
// player.php pone ivplayer_app_cast_publicada(get_config(...)) en MOODLE_CONTEXT
// (tests/unit/lib-php.test.mjs mira que siga ahí). get_config da false con el ajuste sin
// guardar (recién instalado): tiene que quedar apagada, y el reproductor no dice
// "actualizá la app" hasta que Erick la prenda.
chequear('sin el ajuste guardado (get_config da false): apagada', ivplayer_app_cast_publicada(false), false);
chequear('guardado apagado ("0"): apagada', ivplayer_app_cast_publicada('0'), false);
chequear('guardado prendido ("1"): prendida', ivplayer_app_cast_publicada('1'), true);
chequear('vacío: apagada', ivplayer_app_cast_publicada(''), false);
chequear('null: apagada', ivplayer_app_cast_publicada(null), false);
chequear('cualquier otro texto: apagada', ivplayer_app_cast_publicada('si'), false);
chequear('un arreglo no la prende', ivplayer_app_cast_publicada(['1']), false);
chequear('en el contexto del reproductor sale como booleano JSON',
    json_encode(['appCastPublicada' => ivplayer_app_cast_publicada(false)]), '{"appCastPublicada":false}');
seccion('casilla appcastpublicada: booleano, apagada sin guardar');

// ─── Evento de vista: view.php → ivplayer_view() ─────────────────────────────
// Sin Moodle no hay log: se prueba el CABLEADO con lo mínimo de \core\event y de
// completion_info. Qué evento sale, con qué datos (los que valida el de core: objectid,
// objecttable y un contexto de módulo), una sola vez, y la finalización DESPUÉS, como
// page_view() de core. Que la vista llegue al log lo confirma sólo el campus (README,
// "Vistas en el log del campus").
// ivplayer_view no es pura (usa completion_info y la clase del evento): se lee aparte,
// sin pasar por el control de arriba, y corre sólo contra estos reemplazos.
if (!defined('MOODLE_INTERNAL')) {
    define('MOODLE_INTERNAL', true);
}
eval('namespace core\event;
abstract class course_module_viewed {
    public static $registro = [];
    protected $data = [];
    protected $context = null;
    public $snapshots = [];
    private $disparado = false;
    final public static function create(?array $data = null) {
        $evento = new static();
        $evento->init();
        $evento->data["objectid"] = $data["objectid"] ?? null;
        $evento->context = $data["context"] ?? null;
        // Lo que exige validate_data() de core para un "módulo visto" (70 = CONTEXT_MODULE).
        if (empty($evento->data["objectid"])) { throw new \coding_exception("falta objectid"); }
        if (empty($evento->data["objecttable"])) { throw new \coding_exception("falta objecttable (va en init)"); }
        if (!is_object($evento->context) || ($evento->context->contextlevel ?? null) !== 70) { throw new \coding_exception("el contexto tiene que ser del módulo"); }
        return $evento;
    }
    protected function init() {
        $this->data["crud"] = "r";
        $this->data["edulevel"] = 2;
    }
    public function add_record_snapshot($tabla, $registro) {
        if ($this->disparado) { throw new \coding_exception("snapshot después de trigger()"); }
        $this->snapshots[$tabla] = $registro;
    }
    public function trigger() {
        if ($this->disparado) { throw new \coding_exception("trigger() dos veces"); }
        $this->disparado = true;
        self::$registro[] = ["evento", get_class($this), $this->data, $this->context, $this->snapshots];
    }
}');
if (!class_exists('completion_info')) {
    class completion_info {
        private $curso;
        public function __construct($curso) {
            $this->curso = $curso;
        }
        public function set_module_viewed($cm, $userid = 0) {
            \core\event\course_module_viewed::$registro[] = ['visto', $cm, $this->curso];
        }
    }
}
$mview = [];
if (!preg_match('/^function ivplayer_view\(.*?^\}/ms', $src, $mview)) {
    chequear('ivplayer_view está en lib.php', false, true);
} else {
    eval($mview[0]);
    $curso = (object) ['id' => 5];
    $cmprueba = (object) ['id' => 393, 'course' => 5, 'instance' => 42, 'modname' => 'ivplayer'];
    $ivprueba = (object) ['id' => 42, 'course' => 5, 'name' => 'Lección de prueba'];
    $contexto = (object) ['id' => 900, 'contextlevel' => 70, 'instanceid' => 393];

    // Antes del upgrade la clase no está en el mapa de clases (acá, sin autoloader, todavía
    // no se cargó): no rompe y la finalización se marca igual.
    \core\event\course_module_viewed::$registro = [];
    $error = null;
    try {
        ivplayer_view($ivprueba, $curso, $cmprueba, $contexto);
    } catch (Throwable $e) {
        $error = get_class($e) . ': ' . $e->getMessage();
    }
    chequear('sin la clase del evento (antes del upgrade): view.php no rompe', $error, null);
    chequear('sin la clase del evento: igual marca el "visto" de la finalización',
        \core\event\course_module_viewed::$registro, [['visto', $cmprueba, $curso]]);

    require $raizplugin . '/classes/event/course_module_viewed.php';
    chequear('el evento propio es un "módulo visto" de core',
        is_subclass_of('mod_ivplayer\event\course_module_viewed', 'core\event\course_module_viewed'), true);
    chequear('al restaurar un respaldo, el objectid sigue el mapeo de la instancia',
        \mod_ivplayer\event\course_module_viewed::get_objectid_mapping(), ['db' => 'ivplayer', 'restore' => 'ivplayer']);

    \core\event\course_module_viewed::$registro = [];
    $error = null;
    try {
        ivplayer_view($ivprueba, $curso, $cmprueba, $contexto);
    } catch (Throwable $e) {
        $error = get_class($e) . ': ' . $e->getMessage();
    }
    $reg = \core\event\course_module_viewed::$registro;
    chequear('con la clase: no rompe', $error, null);
    chequear('un evento y un "visto", en ese orden (como page_view() de core)', array_column($reg, 0), ['evento', 'visto']);
    $ev = $reg[0] ?? [null, null, [], null, []];
    chequear('el evento es mod_ivplayer\event\course_module_viewed', $ev[1], 'mod_ivplayer\event\course_module_viewed');
    chequear('objecttable ivplayer y objectid = la instancia (no el cmid)',
        [$ev[2]['objecttable'] ?? null, $ev[2]['objectid'] ?? null], ['ivplayer', 42]);
    chequear('lectura y nivel "participación" (los pone el de core: cuenta en los informes)',
        [$ev[2]['crud'] ?? null, $ev[2]['edulevel'] ?? null], ['r', 2]);
    chequear('en el contexto del módulo', $ev[3] === $contexto, true);
    chequear('con las fotos del módulo, el curso y la instancia',
        [($ev[4]['course_modules'] ?? null) === $cmprueba, ($ev[4]['course'] ?? null) === $curso, ($ev[4]['ivplayer'] ?? null) === $ivprueba],
        [true, true, true]);
    chequear('el "visto" de la finalización es de este módulo y este curso', $reg[1] ?? null, ['visto', $cmprueba, $curso]);
}
seccion('evento de vista: ivplayer_view() (sin la clase y con ella)');

echo PHP_EOL . "$ok ok, $mal mal" . PHP_EOL;
exit($mal ? 1 : 0);
