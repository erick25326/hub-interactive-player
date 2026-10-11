<?php
$string['modulename'] = 'Video Interactivo';
$string['modulenameplural'] = 'Videos Interactivos';
$string['modulename_help'] = 'El modulo de Video Interactivo permite crear lecciones en video con interacciones como preguntas, notas y hotspots.';
$string['pluginname'] = 'Video Interactivo';
$string['pluginadministration'] = 'Administracion de Video Interactivo';
$string['ivplayer:addinstance'] = 'Agregar un nuevo Video Interactivo';
$string['ivplayer:view'] = 'Ver Video Interactivo';
$string['vimeoid'] = 'URL o ID de Vimeo';
$string['vimeoid_help'] = 'Ingresa la URL del video en Vimeo (ej: https://vimeo.com/123456789/abcdef) o solo el ID numerico.

Es opcional si cargaste un video de Bunny Stream: si están los dos, se reproduce el de Bunny.';
$string['interactions'] = 'Interacciones (JSON)';
$string['interactions_help'] = 'Pega la configuracion JSON generada por el configurador visual. Usa el configurador en la URL proporcionada para crear este JSON facilmente.';
$string['completioninteractions'] = 'El estudiante debe ver el video y completar todas las interacciones';
$string['completiondetail:interactions'] = 'Ver el video y completar todas las interacciones';

// Video de Bunny Stream (1.3.0).
$string['videourl'] = 'Video de Bunny Stream';
$string['videourl_help'] = 'Pegá el ID del video de Bunny Stream (el "Video ID" del panel, con formato 8-4-4-4-12, por ejemplo 1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d) o cualquiera de los enlaces que da Bunny: el del reproductor (player.mediadelivery.net/play/... o iframe.mediadelivery.net/embed/...) o el del playlist (https://.../playlist.m3u8). Se guarda sólo el ID.

Si cargás este campo y también el de Vimeo, se reproduce el de Bunny. Así se migra un video sin borrar el de Vimeo, y para volver a Vimeo alcanza con vaciar este campo.

Para que se reproduzca, Bunny Stream tiene que estar configurado en los ajustes del plugin. Mientras no lo esté, la actividad sigue usando el video de Vimeo.

El video tiene que estar en la biblioteca de Bunny del campus. Con Bunny ya configurado, el formulario rechaza los enlaces de otra biblioteca o de otro servidor.

Como portada, el reproductor muestra siempre la miniatura que Bunny genera del video (thumbnail.jpg). Una miniatura personalizada que se suba en Bunny queda con otro nombre de archivo y no se ve.';
$string['errorbunnyguid'] = 'No reconozco ese video de Bunny Stream. Pegá el ID del video (formato 8-4-4-4-12, por ejemplo 1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d) o el enlace del reproductor o del playlist que da Bunny.';
$string['errorvimeoesbunny'] = 'Eso es un video de Bunny Stream, no de Vimeo. Pegalo en el campo "Video de Bunny Stream".';
$string['errorsinvideo'] = 'Falta el video: cargá el de Bunny Stream o el de Vimeo.';
$string['errorbunnyotrohost'] = 'Ese enlace es de otro servidor ({$a}), no del CDN de la biblioteca de Bunny Stream del campus, y el campus sólo reproduce los videos de su biblioteca. Subí el video ahí y pegá el ID o el enlace que te da esa biblioteca.';
$string['errorbunnyotrabiblioteca'] = 'Ese enlace es de otra biblioteca de Bunny Stream (la {$a}), y el campus sólo reproduce los videos de la suya. Subí el video a la biblioteca del campus y pegá el ID o el enlace que te da ahí.';
$string['errorbunnysinhost'] = 'Bunny Stream todavía no está configurado en el campus, así que este video no se reproduciría. Cargá también el video de Vimeo o pedile al administrador que configure Bunny.';
$string['errorbunnyhost'] = 'No es un host válido. Poné sólo el nombre del servidor del CDN, sin https:// ni barras (por ejemplo: vz-xxxxxxxx-xxx.b-cdn.net).';
$string['errorbunnyttl'] = 'Tiene que estar entre 1 hora y 7 días.';

// Ajustes del sitio (settings.php).
$string['bunnyheading'] = 'Bunny Stream';
$string['bunnyheading_desc'] = 'Las actividades con un video de Bunny Stream lo reproducen con el reproductor propio, desde el CDN de la biblioteca. Si una actividad tiene Bunny y Vimeo, gana Bunny.

**Estado actual:** {$a}';
$string['bunnyestado_apagado'] = 'apagado. No hay host cargado, así que todas las actividades usan Vimeo aunque tengan un video de Bunny.';
$string['bunnyestado_sinfirma'] = 'URLs SIN firmar. Sólo funciona con la autenticación por token APAGADA en Bunny: si está prendida, los videos dan error 403.';
$string['bunnyestado_firmado'] = 'URLs firmadas. Sólo funciona con la autenticación por token PRENDIDA en Bunny: si está apagada, los videos dan error 404.';
$string['bunnyestado_reproductorviejo'] = 'el reproductor instalado NO reproduce Bunny. El player.html del plugin es anterior a la 1.3.0 (se subió sin rearmar el build), así que todas las actividades siguen con Vimeo y las que tienen sólo Bunny muestran un aviso. Volvé a instalar el plugin desde el zip del release.';
$string['bunnyhost'] = 'Host del CDN';
$string['bunnyhost_desc'] = 'El hostname del CDN de la biblioteca de Bunny Stream (en el panel de Bunny, Stream > biblioteca > API, el hostname de la Pull Zone: empieza con vz- y termina en .b-cdn.net). Sólo el nombre, sin https:// ni barras; si pegás una URL entera, se guarda el host. Vacío = Bunny apagado en todo el sitio.';
$string['bunnylibraryid'] = 'Número de biblioteca (opcional)';
$string['bunnylibraryid_desc'] = 'El "Video Library ID" de la biblioteca (Stream > biblioteca > API). Si lo cargás, el formulario de la actividad rechaza los enlaces del reproductor de Bunny (player.mediadelivery.net/play/NÚMERO/...) que sean de otra biblioteca. Vacío o 0 = no se controla. Los enlaces al CDN se controlan siempre, contra el host.';
$string['bunnytokenkey'] = 'Clave de autenticación por token';
$string['bunnytokenkey_desc'] = 'La "Token authentication key" de la biblioteca (Stream > biblioteca > Security; el campo dice "API key", pero NO es la API key de la biblioteca). Es la misma que la "URL Token Authentication Key" de su Pull Zone. Con clave, el campus firma cada URL en el servidor y la clave nunca llega al navegador. Vacía = no firmar.

Cargar la clave acá y prender la autenticación por token en Bunny van juntos: mirá el estado de arriba.

La clave no sale en la exportación de presets del sitio: el plugin la agrega a los ajustes sensibles (adminpresets | sensiblesettings, en Seguridad > Ajustes de seguridad del sitio). No la saques de esa lista.';
$string['bunnytokenttl'] = 'Duración del token';
$string['bunnytokenttl_desc'] = 'Cuánto dura, como mínimo, la URL firmada desde que el alumno abre la lección. El vencimiento se lleva a la hora en punto siguiente (así las recargas de la misma hora aprovechan lo que el navegador ya bajó), de modo que en la práctica dura entre este valor y una hora más. Tiene que cubrir la sesión entera, pausas incluidas: al vencer, el video sigue unos segundos con lo que ya bajó y se corta, y el alumno tiene que tocar "Reintentar", que recarga la lección y la retoma desde su avance guardado. Recomendado: 6 horas (como mínimo, 3 veces la duración del video más 1 hora). Tiene que estar entre 1 hora y 7 días.';

// Cartel de player.php cuando no hay nada que reproducir.
$string['sinvideo'] = 'Esta actividad todavía no tiene un video cargado.';
$string['sinvideo_bunnysinhost'] = 'El video de esta actividad está en Bunny Stream, pero el campus todavía no tiene Bunny configurado.';
$string['sinvideo_reproductorviejo'] = 'El video de esta actividad está en Bunny Stream, pero el reproductor instalado en el campus todavía no lo reproduce.';
$string['sinvideo_reinstalar'] = 'Volvé a instalar el plugin desde el zip del release (el que arma npm run build:plugin): el player.html instalado es anterior a la 1.3.0.';
$string['sinvideo_configurar'] = 'Configurar Bunny Stream en los ajustes del plugin';
$string['sinvideo_editar'] = 'Editar la actividad para cargar el video';
$string['sinvideo_avisar'] = 'Avisale al equipo del campus.';

// Privacy API.
$string['privacy:metadata:ivplayer_progress'] = 'Progreso de visualización por usuario de un video interactivo.';
$string['privacy:metadata:ivplayer_progress:userid'] = 'El ID del usuario al que pertenece el progreso.';
$string['privacy:metadata:ivplayer_progress:completed'] = 'Si el usuario completó el video y sus interacciones.';
$string['privacy:metadata:ivplayer_progress:progress'] = 'Datos serializados de progreso de visualización e interacciones.';
$string['privacy:metadata:ivplayer_progress:timemodified'] = 'Cuándo se actualizó el progreso por última vez.';
$string['privacy:metadata:ivplayer_answers'] = 'Última respuesta por usuario para cada interacción calificable.';
$string['privacy:metadata:ivplayer_answers:userid'] = 'El ID del usuario que respondió.';
$string['privacy:metadata:ivplayer_answers:interactionid'] = 'La interacción respondida.';
$string['privacy:metadata:ivplayer_answers:answer'] = 'La respuesta que dio el usuario.';
$string['privacy:metadata:ivplayer_answers:correct'] = 'Si la respuesta fue correcta.';
$string['privacy:metadata:ivplayer_answers:timemodified'] = 'Cuándo se actualizó la respuesta por última vez.';
