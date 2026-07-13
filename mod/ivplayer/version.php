<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026071301;
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.2.3'; // Fix congelamientos tras pause/seek en móvil: seeks serializados+verificados, watchdog de play, 720p en fullscreen táctil, spinner de buffering.
