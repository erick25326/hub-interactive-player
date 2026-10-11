<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026101000;
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.3.0'; // Videos de Bunny Stream con la URL firmada en el servidor (si una actividad tiene Bunny y Vimeo, gana Bunny). Trae además el motor propio <video> + hls.js, el candado contra saltos externos, el giro y el botón atrás de la etapa 2.
