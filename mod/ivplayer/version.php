<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026101903; // Etiquetas: glosario interactivo o en pantalla (columna etiquetas de ivplayer, paso de db/upgrade.php; las actividades que ya existen quedan con el glosario). Antes, 2026101902: la red de seguridad (classes/event/respaldo_vimeo_usado y el ajuste respaldovimeo), y 2026101901: el evento de vista.
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.4.0'; // Cinco piezas (README): (1) transmitir a la TV desde la app de Hub Education (puente ivcast + casilla appcastpublicada, apagada); (2) evento de vista: view.php registra "Módulo de curso visto" en el log; (3) "Reintentar" con la sesión cerrada recarga la página entera, y la config por defecto ya no trae video; (4) el configurador abre el video de Bunny de la actividad (enlace firmado de vida corta) o uno de la compu, y la red de seguridad (casilla respaldovimeo, apagada); (5) avisos de las interacciones que frenan (tic-tac 3 s antes, plop y vibración; el alumno los apaga en Ajustes) y el glosario interactivo de las etiquetas (ajuste Etiquetas por actividad: glosario por defecto o en pantalla, como antes). Con las dos casillas apagadas, para el alumno cambian el log, el Reintentar, los avisos y el glosario. Volver atrás = una 1.4.1 hacia adelante: Moodle no deja bajar de versión.
