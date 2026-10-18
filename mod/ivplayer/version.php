<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026101801;
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.3.2'; // Transmitir a la TV: en la primera conexión, si la TV tarda en abrir su aplicación, la compu la espera y se engancha en vez de seguir sola.
