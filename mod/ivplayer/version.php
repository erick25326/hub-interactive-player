<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026101902; // Red de seguridad (classes/event/respaldo_vimeo_usado y el ajuste respaldovimeo): la clase nueva entra al mapa de clases con el upgrade, y el ajuste toma su valor por defecto (apagado) ahí. Antes, 2026101901: el evento de vista.
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.4.0'; // Transmitir a la TV desde la app de Hub Education (puente ivcast + casilla "La app con Chromecast ya está publicada"). Sin la app nueva no cambia nada.
