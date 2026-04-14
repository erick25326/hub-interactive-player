<?php
/**
 * Auto-update script para mod_ivplayer en Moodle (Hostinger shared hosting)
 *
 * Descarga la última release de GitHub y actualiza el plugin automáticamente.
 * Configurar como Cron Job en Hostinger hPanel.
 */

// ======================== CONFIGURACIÓN ========================
// El repo de GitHub es público y se puede dejar acá.
$GITHUB_REPO = 'erick25326/hub-interactive-player';

// La ruta a Moodle NO se hardcodea — se lee desde un archivo de config
// que vive FUERA del repo (no se commitea).
//
// Crear en el servidor: /home/<user>/ivplayer-update.config.php
// con el siguiente contenido:
//
//   <?php
//   return [
//       'moodle_path' => '/home/<user>/domains/<dominio>/public_html/<moodle>',
//   ];
//
// O alternativamente, definir la variable de entorno IVPLAYER_MOODLE_PATH
// antes de ejecutar este script.
$MOODLE_PATH = getenv('IVPLAYER_MOODLE_PATH') ?: null;

if (!$MOODLE_PATH) {
    // Buscar config file en el home del usuario que ejecuta el script
    $home = getenv('HOME') ?: (posix_getpwuid(posix_geteuid())['dir'] ?? null);
    $configCandidates = array_filter([
        $home ? $home . '/ivplayer-update.config.php' : null,
        __DIR__ . '/../ivplayer-update.config.php',
    ]);
    foreach ($configCandidates as $configFile) {
        if (file_exists($configFile)) {
            $cfg = require $configFile;
            if (is_array($cfg) && !empty($cfg['moodle_path'])) {
                $MOODLE_PATH = $cfg['moodle_path'];
                break;
            }
        }
    }
}

if (!$MOODLE_PATH || !is_dir($MOODLE_PATH)) {
    fwrite(STDERR, "ERROR: No se encontró la ruta de Moodle.\n");
    fwrite(STDERR, "Definí IVPLAYER_MOODLE_PATH como variable de entorno\n");
    fwrite(STDERR, "o creá ~/ivplayer-update.config.php con la clave 'moodle_path'.\n");
    exit(1);
}

$PLUGIN_DIR  = $MOODLE_PATH . '/mod/ivplayer';
$VERSION_FILE = $PLUGIN_DIR . '/.installed_release';
$BACKUP_DIR  = $MOODLE_PATH . '/mod/ivplayer_backup';
$TMP_DIR     = sys_get_temp_dir() . '/ivplayer_update_' . time();
// ===============================================================

// Logging
function logMsg($msg) {
    echo date('[Y-m-d H:i:s] ') . $msg . PHP_EOL;
}

// 1. Obtener la última release de GitHub
logMsg("Consultando última release de GitHub...");

$opts = [
    'http' => [
        'method' => 'GET',
        'header' => "User-Agent: ivplayer-updater\r\n",
        'timeout' => 30
    ]
];
$context = stream_context_create($opts);
$apiUrl = "https://api.github.com/repos/{$GITHUB_REPO}/releases/latest";
$response = @file_get_contents($apiUrl, false, $context);

if ($response === false) {
    logMsg("ERROR: No se pudo conectar a GitHub API");
    exit(1);
}

$release = json_decode($response, true);
if (!$release || !isset($release['tag_name'])) {
    logMsg("ERROR: Respuesta de GitHub inválida");
    exit(1);
}

$tagName = $release['tag_name'];
logMsg("Última release: {$tagName}");

// 2. Verificar si ya está instalada esta versión
if (file_exists($VERSION_FILE)) {
    $installed = trim(file_get_contents($VERSION_FILE));
    if ($installed === $tagName) {
        logMsg("Ya tenés la última versión ({$tagName}). Sin cambios.");
        exit(0);
    }
    logMsg("Versión instalada: {$installed} → Actualizando a {$tagName}");
} else {
    logMsg("Primera actualización automática");
}

// 3. Buscar el URL de descarga del ZIP
$downloadUrl = null;
if (isset($release['assets']) && is_array($release['assets'])) {
    foreach ($release['assets'] as $asset) {
        if (strpos($asset['name'], 'mod_ivplayer.zip') !== false) {
            $downloadUrl = $asset['browser_download_url'];
            break;
        }
    }
}

if (!$downloadUrl) {
    logMsg("ERROR: No se encontró mod_ivplayer.zip en la release");
    exit(1);
}

// 4. Descargar el ZIP (vía cURL — GitHub releases redirigen a S3 y file_get_contents
//    falla con esa redirección en algunos hosts compartidos)
logMsg("Descargando {$downloadUrl}...");
@mkdir($TMP_DIR, 0755, true);
$zipPath = $TMP_DIR . '/mod_ivplayer.zip';

$ch = curl_init($downloadUrl);
$fp = fopen($zipPath, 'w');
curl_setopt_array($ch, [
    CURLOPT_FILE           => $fp,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_USERAGENT      => 'ivplayer-updater',
    CURLOPT_TIMEOUT        => 120,
    CURLOPT_CONNECTTIMEOUT => 30,
    CURLOPT_FAILONERROR    => true,
    CURLOPT_SSL_VERIFYPEER => true,
]);
$ok = curl_exec($ch);
$err = curl_error($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
fclose($fp);

if (!$ok || !file_exists($zipPath) || filesize($zipPath) < 1000) {
    logMsg("ERROR: Falló la descarga (HTTP {$code}, error: {$err})");
    @unlink($zipPath);
    @rmdir($TMP_DIR);
    exit(1);
}
logMsg("Descargado: " . round(filesize($zipPath) / 1024) . " KB");

// 5. Verificar que es un ZIP válido
$zip = new ZipArchive();
$res = $zip->open($zipPath);
if ($res !== true) {
    logMsg("ERROR: El archivo no es un ZIP válido (code: {$res})");
    @unlink($zipPath);
    @rmdir($TMP_DIR);
    exit(1);
}

// 6. Hacer backup del plugin actual
if (is_dir($PLUGIN_DIR)) {
    // Eliminar backup anterior si existe
    if (is_dir($BACKUP_DIR)) {
        logMsg("Eliminando backup anterior...");
        deleteDir($BACKUP_DIR);
    }
    logMsg("Creando backup del plugin actual...");
    copyDir($PLUGIN_DIR, $BACKUP_DIR);
}

// 7. Extraer el nuevo plugin
logMsg("Instalando plugin...");

// Extraer a carpeta temporal
$extractDir = $TMP_DIR . '/extract';
@mkdir($extractDir, 0755, true);
$zip->extractTo($extractDir);
$zip->close();

// Determinar la carpeta raíz del ZIP (puede ser 'ivplayer/' o similar)
$extractedContents = scandir($extractDir);
$sourceDir = $extractDir;
foreach ($extractedContents as $item) {
    if ($item !== '.' && $item !== '..' && is_dir($extractDir . '/' . $item)) {
        $sourceDir = $extractDir . '/' . $item;
        break;
    }
}

// Verificar que tiene version.php (es un plugin válido)
if (!file_exists($sourceDir . '/version.php')) {
    logMsg("ERROR: El ZIP no contiene un plugin Moodle válido (falta version.php)");
    logMsg("Contenido encontrado: " . implode(', ', array_diff(scandir($sourceDir), ['.', '..'])));
    // Restaurar backup
    if (is_dir($BACKUP_DIR)) {
        deleteDir($PLUGIN_DIR);
        rename($BACKUP_DIR, $PLUGIN_DIR);
        logMsg("Backup restaurado.");
    }
    cleanup($TMP_DIR);
    exit(1);
}

// Eliminar plugin actual y copiar el nuevo
if (is_dir($PLUGIN_DIR)) {
    deleteDir($PLUGIN_DIR);
}
copyDir($sourceDir, $PLUGIN_DIR);

// 8. Guardar versión instalada
file_put_contents($PLUGIN_DIR . '/.installed_release', $tagName);

// 9. Limpiar
cleanup($TMP_DIR);

logMsg("✓ Plugin actualizado a {$tagName} exitosamente");
logMsg("IMPORTANTE: Entrá a tu Moodle como admin para completar el upgrade de la DB.");

// ======================== FUNCIONES AUXILIARES ========================

function deleteDir($dir) {
    if (!is_dir($dir)) return;
    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($items as $item) {
        if ($item->isDir()) {
            @rmdir($item->getRealPath());
        } else {
            @unlink($item->getRealPath());
        }
    }
    @rmdir($dir);
}

function copyDir($src, $dst) {
    @mkdir($dst, 0755, true);
    $dir = opendir($src);
    while (($file = readdir($dir)) !== false) {
        if ($file === '.' || $file === '..') continue;
        $srcPath = $src . '/' . $file;
        $dstPath = $dst . '/' . $file;
        if (is_dir($srcPath)) {
            copyDir($srcPath, $dstPath);
        } else {
            copy($srcPath, $dstPath);
        }
    }
    closedir($dir);
}

function cleanup($dir) {
    deleteDir($dir);
}
