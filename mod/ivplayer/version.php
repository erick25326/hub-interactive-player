<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026100701;
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.2.9'; // La transcripción ya no puede saltear preguntas: el reproductor ofrece una API de tiempo y salto (postMessage) con el mismo candado que la barra. Además, con el celular acostado los controles ya no quedan debajo del borde.
