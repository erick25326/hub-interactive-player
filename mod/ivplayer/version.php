<?php
defined('MOODLE_INTERNAL') || die();

$plugin->component = 'mod_ivplayer';
$plugin->version = 2026101902; // Red de seguridad (classes/event/respaldo_vimeo_usado y el ajuste respaldovimeo): la clase nueva entra al mapa de clases con el upgrade, y el ajuste toma su valor por defecto (apagado) ahí. Antes, 2026101901: el evento de vista.
$plugin->requires = 2022112800; // Moodle 4.1+
$plugin->maturity = MATURITY_BETA;
$plugin->release = '1.4.0'; // Cuatro piezas (README): (1) transmitir a la TV desde la app de Hub Education (puente ivcast + casilla appcastpublicada, apagada); (2) evento de vista: view.php registra "Módulo de curso visto" en el log; (3) "Reintentar" con la sesión cerrada recarga la página entera, y la config por defecto ya no trae video; (4) el configurador abre el video de Bunny de la actividad (enlace firmado de vida corta) o uno de la compu, y la red de seguridad (casilla respaldovimeo, apagada). Con las dos casillas apagadas, para el alumno sólo cambian el log y el Reintentar. Volver atrás = una 1.4.1 hacia adelante: Moodle no deja bajar de versión.
