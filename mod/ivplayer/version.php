<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026071300;
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.2.2'; // Privacy API (GDPR/Ley 25.326), hardening auto-updater/configurador, y fixes móvil: audio muteado al iniciar, fullscreen tapaba controles, etiquetas recortadas.
