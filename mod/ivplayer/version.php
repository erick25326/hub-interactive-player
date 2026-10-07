<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026100700;
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.2.8'; // Las preguntas y notas frenan el video al llegar a su tiempo, no hasta 0,8 s antes (cortaban la última palabra). Además: el final del video no vuelve a arrancar solo al responder, y Reiniciar, el bucle y la restauración del avance se portan bien en los bordes.
