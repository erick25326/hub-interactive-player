<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026080200;
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.2.4'; // Respuesta al toque: play/pausa inmediato en la zona central (antes 300 ms fijos) y sin backdrop-filter sobre el video.
