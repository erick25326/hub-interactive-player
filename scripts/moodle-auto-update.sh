#!/bin/bash
# =============================================================
# Auto-update script para mod_ivplayer en Moodle
# Descarga la última release de GitHub e instala/actualiza el plugin
#
# USO:
#   1. Copiá este archivo al servidor Moodle
#   2. Editá las variables de abajo con tus rutas
#   3. Hacelo ejecutable: chmod +x moodle-auto-update.sh
#   4. Probalo manualmente: sudo ./moodle-auto-update.sh
#   5. Agregalo al cron (ver abajo)
#
# CRON (cada 6 horas):
#   0 */6 * * * /ruta/al/moodle-auto-update.sh >> /var/log/ivplayer-update.log 2>&1
# =============================================================

# --- CONFIGURACIÓN (editá estas variables) ---
MOODLE_PATH="/var/www/html/moodle"          # Ruta a tu instalación de Moodle
MOODLE_DATA="/var/moodledata"                # Ruta a moodledata
WEB_USER="www-data"                          # Usuario del servidor web (www-data en Ubuntu/Debian, apache en CentOS)
PHP_BIN="php"                                # Ruta al binario de PHP

# --- NO EDITAR DEBAJO DE ESTA LÍNEA ---
GITHUB_REPO="erick25326/hub-interactive-player"
PLUGIN_DIR="$MOODLE_PATH/mod/ivplayer"
TMP_DIR=$(mktemp -d)
VERSION_FILE="$PLUGIN_DIR/.installed_release"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# 1. Obtener la última release de GitHub
log "${YELLOW}Consultando última release de GitHub...${NC}"
LATEST_RELEASE=$(curl -s "https://api.github.com/repos/$GITHUB_REPO/releases/latest")

if [ $? -ne 0 ] || [ -z "$LATEST_RELEASE" ]; then
    log "${RED}Error: No se pudo conectar a GitHub${NC}"
    exit 1
fi

TAG_NAME=$(echo "$LATEST_RELEASE" | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)
DOWNLOAD_URL=$(echo "$LATEST_RELEASE" | grep -o '"browser_download_url": *"[^"]*mod_ivplayer\.zip"' | head -1 | cut -d'"' -f4)

if [ -z "$TAG_NAME" ] || [ -z "$DOWNLOAD_URL" ]; then
    log "${RED}Error: No se encontró release o archivo ZIP${NC}"
    exit 1
fi

log "Última release: $TAG_NAME"

# 2. Verificar si ya está instalada esta versión
if [ -f "$VERSION_FILE" ]; then
    INSTALLED_VERSION=$(cat "$VERSION_FILE")
    if [ "$INSTALLED_VERSION" = "$TAG_NAME" ]; then
        log "${GREEN}Ya tenés la última versión ($TAG_NAME). Sin cambios.${NC}"
        exit 0
    fi
    log "Versión instalada: $INSTALLED_VERSION → Actualizando a $TAG_NAME"
else
    log "Primera instalación automática"
fi

# 3. Descargar el ZIP
log "Descargando $DOWNLOAD_URL..."
curl -sL "$DOWNLOAD_URL" -o "$TMP_DIR/mod_ivplayer.zip"

if [ $? -ne 0 ] || [ ! -f "$TMP_DIR/mod_ivplayer.zip" ]; then
    log "${RED}Error: Falló la descarga${NC}"
    exit 1
fi

# Verificar que es un ZIP válido
if ! unzip -t "$TMP_DIR/mod_ivplayer.zip" > /dev/null 2>&1; then
    log "${RED}Error: El archivo descargado no es un ZIP válido${NC}"
    exit 1
fi

# 4. Activar modo mantenimiento en Moodle
log "${YELLOW}Activando modo mantenimiento...${NC}"
sudo -u "$WEB_USER" $PHP_BIN "$MOODLE_PATH/admin/cli/maintenance.php" --enable

# 5. Hacer backup del plugin actual (si existe)
if [ -d "$PLUGIN_DIR" ]; then
    BACKUP_DIR="$MOODLE_PATH/mod/ivplayer_backup_$(date +%Y%m%d_%H%M%S)"
    log "Backup del plugin actual en $BACKUP_DIR"
    cp -r "$PLUGIN_DIR" "$BACKUP_DIR"
fi

# 6. Extraer el nuevo plugin
log "Instalando plugin..."
unzip -o "$TMP_DIR/mod_ivplayer.zip" -d "$MOODLE_PATH/mod/" > /dev/null

if [ $? -ne 0 ]; then
    log "${RED}Error: Falló la extracción. Restaurando backup...${NC}"
    if [ -d "$BACKUP_DIR" ]; then
        rm -rf "$PLUGIN_DIR"
        mv "$BACKUP_DIR" "$PLUGIN_DIR"
    fi
    sudo -u "$WEB_USER" $PHP_BIN "$MOODLE_PATH/admin/cli/maintenance.php" --disable
    exit 1
fi

# 7. Ajustar permisos
chown -R "$WEB_USER:$WEB_USER" "$PLUGIN_DIR"

# 8. Ejecutar upgrade de Moodle (aplica cambios de DB, etc.)
log "${YELLOW}Ejecutando upgrade de Moodle...${NC}"
sudo -u "$WEB_USER" $PHP_BIN "$MOODLE_PATH/admin/cli/upgrade.php" --non-interactive

if [ $? -ne 0 ]; then
    log "${RED}Error en el upgrade. Restaurando backup...${NC}"
    if [ -d "$BACKUP_DIR" ]; then
        rm -rf "$PLUGIN_DIR"
        mv "$BACKUP_DIR" "$PLUGIN_DIR"
        sudo -u "$WEB_USER" $PHP_BIN "$MOODLE_PATH/admin/cli/upgrade.php" --non-interactive
    fi
    sudo -u "$WEB_USER" $PHP_BIN "$MOODLE_PATH/admin/cli/maintenance.php" --disable
    exit 1
fi

# 9. Desactivar modo mantenimiento
sudo -u "$WEB_USER" $PHP_BIN "$MOODLE_PATH/admin/cli/maintenance.php" --disable

# 10. Guardar versión instalada
echo "$TAG_NAME" > "$VERSION_FILE"
chown "$WEB_USER:$WEB_USER" "$VERSION_FILE"

# 11. Limpiar backups viejos (mantener últimos 3)
log "Limpiando backups viejos..."
ls -dt "$MOODLE_PATH/mod/ivplayer_backup_"* 2>/dev/null | tail -n +4 | xargs rm -rf 2>/dev/null

log "${GREEN}✓ Plugin actualizado a $TAG_NAME exitosamente${NC}"
