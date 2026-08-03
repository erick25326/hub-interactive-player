<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026080300;
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.2.5'; // El progreso ya no se pierde con mala señal: cola persistente con reintentos. Y player.php deja de servirse con no-store.
