<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026091400;
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.2.7'; // Pantalla completa en celulares: el video quedaba pegado arriba con negro abajo. Ahora pasa a pantalla completa todo el reproductor y el video queda 16:9 centrado.
