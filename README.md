# 🎬 Hub Education — Video Interactivo

Reproductor de video interactivo para cursos de drones. Reemplaza H5P Interactive Video con fullscreen nativo en mobile, controles custom, y estética moderna.

## Features

- 🎥 **Video Vimeo** — Soporte para videos públicos y privados/no listados
- 📱 **Fullscreen nativo** — Funciona en mobile (Android + iOS 16.4+)
- ⏩ **Skip ±10s** — Botones de adelantar/retroceder
- 🔊 **Control de volumen** — Slider + mute
- 💬 **Subtítulos** — Archivo .vtt externo o cues inline, toggle on/off
- ❓ **Multiple Choice** — Con feedback y explicación
- ✅ **Verdadero/Falso** — Con feedback
- 📍 **Hotspots** — Puntos clickeables sobre el video
- 📝 **Notas** — Popups informativos en momentos específicos
- 📖 **Glosario interactivo** — Las etiquetas se suman a un glosario a medida que se nombran (o, por actividad, en pantalla como antes)
- 🔔 **Avisos** — Tic-tac 3 s antes de lo que frena el video, "plop" al frenar y vibración (el alumno los apaga en Ajustes)
- 📊 **Marcadores** — Timeline visual con colores por tipo de interacción
- 📦 **Single file** — Se compila a un solo HTML, cero dependencias externas

## Setup

```bash
npm install
```

## Desarrollo

```bash
npx vite
```

Sin `window.PLAYER_CONFIG` (ver "Configuración") muestra "No hay video para mostrar":
la config por defecto no trae video a propósito.

## Build para producción

```bash
npx vite build
# Output: dist/index.html (un solo archivo, ~240KB)
```

## Pruebas

```bash
npm test                 # las tres capas, en orden, con un resumen al final
npm run test:unit        # sin navegador, unos segundos
npm run test:php         # sólo con php en el PATH (en CI sí hay)
npm run test:navegador   # Chrome headless, ~2 min
```

`npm test` corre las tres aunque una falle y se saltea sola la que no puede correr
(sin PHP, o sin Chrome / sin video de prueba), diciendo por qué. El resumen del final
distingue `bien` de `salteada` (y de "en parte salteada", si faltó el HLS nativo):
🔴 una capa salteada no probó nada, y sin el nivel navegador el cableado del candado
en el componente queda sin ninguna prueba. En GitHub corre todo en cada push a
master, en cada PR y a mano desde Actions → Pruebas → Run workflow (para una rama sin
PR) (`.github/workflows/pruebas.yml`, ubuntu + Node 24). Si ahí se saltean pruebas,
el job queda verde con una advertencia arriba del log.

| Capa | Dónde | Qué protege |
|---|---|---|
| Unitarias | `tests/unit/` | El candado (`src/candado.js`: `debeFrenar`, la guardia, `tiempoAGuardar`) con casos fijos y un simulador de ticks; el parser de subtítulos (`src/subtitulos.js`); la firma de Bunny contra los vectores oficiales (espejo en Node), incluida la regla de "¿esta actividad usa Bunny?" que comparten `player.php` y `firma.php`; la renovación de la firma (`src/firma.js`: qué recarga Reintentar según el motivo y si la página de arriba se puede tocar, leer y reescribir las URLs del master, variantes, `.ts` y miniatura, el reloj con la hora del celular corrida, el Renovador contra un `firma.php` falso); el adaptador de Chromecast (`CastPlayer`) contra una TV falsa que avisa un salto en un solo estado; la config por defecto sin video y cuándo hay video para reproducir (`src/configuracion.js`, y que `config.example.js` tal cual no traiga uno); el puente con hub-app (`src/puenteApp.js`: sobres, respuestas de otra instancia, topes, el saludo sin respuesta, latido y adios) y el SDK imitado (`src/castNativo.js`: un Media por msid, estados repetidos descartados, rechazos de `requestSession`, `CastPlayer` a través del shim); del configurador, lo que acepta del mensaje de `mod_form.php` con el video de Bunny (`fuenteBunnyDeMoodle`), el motor (hls.js o nativo), que el enlace firmado no llegue a lo que se exporta o vuelve a Moodle, el armado que mete hls.js en el configurador publicado, de qué orígenes acepta el mensaje de Moodle (el campus y test-academy) y que de un JSON o de Moodle entren sólo los cinco tipos de interacción y los números como números; la red de seguridad (`src/respaldo.js`: con qué errores salta a Vimeo y con cuáles nunca —la firma, la sesión, la TV, sin respaldo ofrecido—, lo que se le manda a `respaldo.php` y cómo se lee su respuesta, la URL con `origen=vimeo`), la pregunta al CDN del HLS nativo antes de dar el error (`src/sondeo.js`: qué pide, qué devuelve con cada respuesta, el tope de tiempo y el error que sale) y el guardado del avance que espera la respuesta (`moodleGuardarAvanceYa`). Los avisos de las interacciones que frenan (`src/avisos.js`: qué tic toca en cada paso —3, 2 y 1 s antes, en tiempo de video, alto-bajo-alto—, sólo de la PRÓXIMA pendiente aunque haya dos a menos de 3 s, el umbral del salto que crece con la velocidad, nunca al llegar saltando ni en pausa, que un temblor del reloj no lo repita y un salto hacia atrás sí, la cuenta regresiva, las preferencias del alumno sin localStorage y `comoAvisar`: el silencio del video calla los sonidos y no la vibración), los sonidos contra un Web Audio de mentira (`src/sonidos.js`: nada antes del gesto, la sesión de audio de iPhone, tonos y volumen, vibrar sólo con pantalla táctil) y el glosario (`src/glosario.js`: qué término se suma en cada paso y cuál con sonido, también a 2×, lo último arriba, las notas vistas, y el panel que tapa el video: cuánto lo tapa en cada caso de `styles.css`, cuándo pausa al abrir y cuándo retoma al cerrar). Los subtítulos en la TV (1.4.0): la pista, su estilo y lo que dice una media de la TV de ella (`src/cast.js`); el SDK imitado con la capacidad `'subtitulos'` (`cargar` con `media.tracks`, `textTrackStyle` y `activeTrackIds`, el comando `pistas`, un `media` que cambia sólo en `activeTrackIds` no es repetido, y sin la capacidad, nada de eso) y `CastPlayer` a través de él (la carga con la pista, un toque del botón durante la carga, adoptar con los subtítulos prendidos, recargar con la pista si la TV no la tiene, el enlace de la última renovación); el Renovador que guarda el enlace nuevo de `firma.php`; y que `parseVTT` lea los mismos cues que manda la TV (vectores compartidos con PHP). Además, una huella del código de las funciones de `lib.php` que sólo prueba PHP: si cambian, avisa que hay que correr la prueba PHP (también el cableado del modo de las etiquetas: formulario, columna, upgrade, backup y `PLAYER_CONFIG`, y el de los subtítulos en la TV: `subtitulos.php`, `player.php`, `firma.php`, el secreto y la versión). |
| PHP | `tests/php/correr.php` | La sintaxis de cada `.php` del plugin (`php -l`: `player.php` y `firma.php` necesitan Moodle y ninguna otra prueba los ejecuta) y las funciones puras de `mod/ivplayer/lib.php` leídas del archivo real: firma HS256 de Bunny, la regla de qué actividad reproduce Bunny (`ivplayer_bunny_video`, la de `player.php` y `firma.php`, y que la clave no salga) y normalización de subtítulos (BOM, UTF-16, Windows-1252, bytes rotos). Además, el cableado del evento de vista (`ivplayer_view`) con reemplazos mínimos de Moodle: qué evento sale, con qué datos, la finalización después, y que sin la clase (antes del upgrade) la lección no rompe. Y el enlace del configurador con el video de Bunny (`ivplayer_bunny_configurador`: la regla de la lección, vida de 2 a 3 h, sólo el playlist, sin la clave) y el bloque JSON que lo lleva en el formulario (un `</script>` adentro no lo cierra). Y la red de seguridad: la regla con que `player.php` respeta `?origen=vimeo` (ajuste prendido + ID de Vimeo, `ivplayer_respaldo_forzar`), las causas que acepta `respaldo.php` (nunca 401/403/410) y el registro del salto con el evento propio (sin la clase y con ella). Y el modo de las etiquetas (1.4.0): `ivplayer_modo_etiquetas` (sólo "pantalla" vuelve a los pines; NULL antes del upgrade es el glosario), `ivplayer_config_base` (lo que `player.php` pone en `PLAYER_CONFIG`, con `etiquetas`), el paso del upgrade de `db/upgrade.php` corrido con un XMLDB de mentira (agrega la columna una sola vez y marca 2026101903) y que `install.xml`, `version.php` y el backup digan lo mismo. Y los subtítulos en la TV (1.4.0): la firma del enlace de `subtitulos.php` contra el HMAC de Node, vencida, más allá del tope, con el cmid o el vencimiento alterados, sin secreto o con uno corto, y que un enlace con el vencimiento del video pase con cualquier duración del token; el paso de un SRT o un VTT "flojo" a WebVTT estricto con los mismos cues que lee el celular (`tests/php/vectores-subtitulos.json`, que comparte con Node), también desde UTF-16 y Windows-1252, y 400 entradas al azar; y el paso 2026101904 del upgrade e `install.php` (el secreto al azar, que no se pisa si ya está, en la lista de ajustes sensibles sin tocar las de core). El `php -l` corre también en el workflow que publica el ZIP. |
| Navegador | `tests/navegador/` | El bundle compilado en Chrome, con clics y toques reales por CDP: el candado con hls.js y con HLS nativo (saltos de afuera, también con una nota abierta; restauración; +10 y −10; play de afuera), el cambio de calidad antes de una pregunta (y, con el nativo, un salto del cambio de fuente que aterriza corrido), los subtítulos, la TV con Chromecast y AirPlay simulados (también como adentro de hub-app, por el puente: salir y volver, el saludo sin respuesta, sin Chromecast, iPhone con AirPlay o sin, y el WebView de la app de hoy), la fila de controles de 320 a 400 px en pantalla completa simulada (y sin ella, con la TV y el glosario en la fila), y la firma de Bunny que vence a los pocos segundos (el servidor de pruebas la valida como el CDN, con 403): sin cortes ni saltos y con el candado intacto, el 403 que se arregla solo (también con la red que tarda en volver), el pedido que espera una renovación en camino, un salto y un play durante esa espera (y, con el nativo, un −10 durante el rescate y la calidad elegida justo al vencer), una calidad rota que no es el vencimiento (con hls.js pasa a otra, sin cartel), el cartel si no se puede renovar, su Reintentar (con la sesión cerrada recarga la página de arriba; con otro motivo, o con la de arriba de otro origen, sólo el iframe) y la TV que recarga con la firma nueva. Sin video configurado (sin `PLAYER_CONFIG`, sin video o con un ID que no es un ID), el cartel "No hay video para mostrar" sin crear ningún reproductor ni pedirle nada a Vimeo. Y el configurador armado como el de GitHub Pages con un MP4 de la compu (generado con ffmpeg): tomar el tiempo, saltar, la vista previa con el reproductor, exportar sin `vimeoId`, liberar el archivo al cambiarlo, un archivo que no es video o que no se puede leer, un video sin la duración en la cabecera (WebM), el JSON de la skill con `videoUrl` y el ida y vuelta con Moodle pasado por el manejador real de `mod_form.php` (el campo de Vimeo no se toca). La red de seguridad con fallas simuladas del CDN (404 del playlist, 503 de los segmentos a mitad de la clase, el CDN caído; con el HLS nativo, el 404 salta con la misma causa que hls.js y un 403 de los segmentos con la firma vigente no salta): recarga sólo el iframe con Vimeo y retoma donde iba, sin pisar el avance; y no salta con la sesión cerrada, con la firma vencida (se renueva o, sin permiso, el cartel), con el ajuste apagado, si respaldo.php no lo deja ni transmitiendo por AirPlay. También con el video de Bunny que manda Moodle (un HLS de ffmpeg servido por un CDN de mentira en otro origen, que valida el token como Bunny): reproducirlo con hls.js (y con el nativo), tomar el tiempo y saltar, la vista previa, exportar y guardar sin el enlace firmado y sin tocar el campo de Vimeo, un archivo de la compu encima y volver, el enlace vencido o rechazado, y del lado de `mod_form.php` (su script real) que el bloque firmado salga de la página y no se mande si se cambió el campo de Bunny o venció, medido con el reloj del servidor. Y lo que encontró la revisión de seguridad de la 1.4.0: un tipo de interacción armado no se ejecuta ni en la vista previa de `mod_form.php` ni en el configurador (tampoco el id de una opción, x/y o la duración), y `mod_form.php` acepta lo que vuelve sólo de la ventana que abrió. Los avisos y el glosario (1.4.0) con Web Audio y vibración de mentira (`simulados/sonido-simulado.js`): tres tics 3 s antes y un plop al frenar en una nota, una pregunta y unos puntos para tocar (también a 2×), la cuenta regresiva, nada al llegar saltando, el aviso que se repite al volver para atrás, los ajustes del alumno que lo apagan y quedan recordados, el glosario que crece de a un término con su plop suave (sin vibrar), lo último arriba con "recién", el aviso que abre el panel en ese término, teclado y Escape, tocar afuera sin pausar, un salto hacia adelante que suma callado, el modo "En pantalla" igual que antes, movimiento reducido, y transmitiendo a la TV (los avisos en el celular, el panel encima del cartel de la TV, y conectándola antes del primer play). Y lo que encontró la verificación del cierre: dos que frenan a menos de 3 s (sólo la próxima, el freno vibra entero, la etiqueta del mismo segundo sin plop suave encima), un salto corto con la barra reproduciendo (callado: ni el término ni el tic que cruza), y el panel abierto que deja libre la fila de controles y le anuncia el término nuevo al lector de pantalla. Y las decisiones del 19-oct-2026: el panel que tapa el video (375 × 211, en `marco.html`) lo pausa al abrir y lo retoma al cerrar sin repetir ni saltear un tic, no pausa a 1280 × 720 ni transmitiendo, no retoma si en el medio lo frenó una pregunta o un play y una pausa de afuera, y en la hoja de abajo (540 × 304) Reproducir con el panel abierto lo cierra y reproduce (un clic lento, en el borde del botón); y con el video en silencio los avisos no llaman al sintetizador pero sí a `navigator.vibrate` (tampoco la muestra de Ajustes), y vuelven al quitar el silencio. Y los subtítulos en la TV (1.4.0), con Chrome y por el puente de la app: el LOAD con la pista y `activeTrackIds`, la TV que baja el VTT del `subtitulos.php` de mentira (vigente, `text/vtt`, CORS abierto), el celular que no los dibuja encima del cartel, el botón que los apaga y los prende en la TV sin recargar, la vuelta al celular que los vuelve a dibujar, una sesión adoptada con los subtítulos prendidos (el botón queda prendido), sin pista en la TV (sin enlace, o una app sin `'subtitulos'`) los sigue dibujando el celular, y con la firma que vence cada pocos segundos, cada recarga de la TV con un enlace nuevo, con el vencimiento de su firma. |

🔴 El simulador de las unitarias (`tests/unit/apoyo/simulador.mjs`) usa las
decisiones REALES de `candado.js`, pero el efecto de disparo del componente (el orden
guardia → bucle, `prev` quieto con la tarjeta abierta, la restauración, el freno de
'play') es una RÉPLICA: si se cambia en `InteractiveVideoPlayer.jsx`, actualizarla. El
cableado de verdad lo ve sólo el nivel navegador.

**Nivel navegador.** Compila el reproductor a una carpeta temporal (`dist/` no se
toca), lo sirve en un puerto que elige el sistema con `PLAYER_CONFIG` inyectado
antes de `</head>` (como `player.php`) y lo maneja con un Chrome headless propio, con
perfil temporal. Al terminar mata sólo el proceso que lanzó.

- **Chrome:** el de siempre de cada sistema, o `CHROME_PATH=/ruta/al/chrome`.
- **Video de prueba:** si hay ffmpeg, `npm run video-prueba` genera uno local de 78 s
  con 240p/360p/480p y audio en `tests/navegador/.video/` (ignorada por git); es el
  que usa CI. Sin ffmpeg usa un HLS público de prueba (el Big Buck Bunny de Mux) o el
  que diga `IVP_VIDEO_URL`. Sin ffmpeg y sin red, se saltea con un aviso.
- **Otro bundle:** `IVP_HTML=mod/ivplayer/player.html npm run test:navegador` prueba
  el que va en el ZIP del plugin en vez de compilar `src/`.
- **Sólo algunas:** `node --test --test-name-pattern="calidad" tests/navegador/navegador.test.mjs`.
- Si una falla, la captura queda en `tests/navegador/.salida/` (en CI, como artefacto).
- Los receptores de la TV son **simulados** (`tests/navegador/simulados/`): prueban
  todo nuestro código, no una TV de verdad (ver "Pendiente: probar con TVs reales").
  Hay UNA TV (`tv-simulada.js`) y dos emisores: el Cast de Chrome (`cast-simulado.js`) y
  hub-app con su puente (`puente-app-simulado.js`, en `marco.html` con `app=fake`). El
  recorrido de la TV y la renovación de la firma corren con los dos.
- El HLS nativo de Chrome no es el de Safari: sirve para probar el camino del iPhone
  (cambio de fuente, reintentos del salto), pero tiene sus propias mañas (ver el
  CLAUDE.md). Que nativePlayer RETENGA los eventos durante el cambio de fuente no se
  ve con Chrome solo (el reintento sale en el mismo evento que vería el 0): se prueba
  forzando, con una trampa en el setter de `currentTime`, que el primer salto
  aterrice 6 s antes, como hace iOS. Lo que hace Safari de verdad sólo se ve en un
  iPhone. Si un Chrome no trae HLS nativo, esas pruebas se saltean diciendo por qué.

## Configuración

Pasar `window.PLAYER_CONFIG` en el HTML, antes del bundle (es lo que hace `player.php`
en el campus). Ejemplo completo, con todos los tipos de interacción, en `config.example.js`:

```javascript
window.PLAYER_CONFIG = {
  title: "Nombre del módulo",
  vimeoId: "ID_DEL_VIDEO",
  vimeoHash: "HASH_DEL_VIDEO",  // Solo para videos privados
  // o un video propio (HLS de Bunny o MP4), que manda sobre vimeoId:
  // videoUrl: "https://vz-ejemplo.b-cdn.net/11111111-2222-4333-8444-555555555555/playlist.m3u8",
  subtitlesUrl: "https://ejemplo.com/subs.vtt",
  interactions: [
    { id: "q1", type: "multiple-choice", time: 30, data: { ... } },
    { id: "n1", type: "note", time: 60, data: { ... } },
  ]
};
```

🔴 **La config por defecto no trae video** (`DEFAULT_CONFIG` en `src/configuracion.js`):
sin `PLAYER_CONFIG`, o con uno sin `videoUrl` ni un ID de Vimeo válido, el reproductor
muestra "No hay video para mostrar" en vez de quedarse cargando. Hasta la 1.4.0 traía
una clase real del campus, y lo que va ahí viaja en `player.html`, en el configurador
y en cada SCORM. No pegar un video ahí para probar. (Los ZIP de los releases viejos y el
historial de git, también el de `gh-pages`, lo siguen trayendo: no cambian con el código.)

## Deploy en Moodle

1. Compilar con `npx vite build`
2. Subir `dist/index.html` como recurso "Archivo" en Moodle
3. O embeber como iframe en una actividad "Página"

(En el campus va como plugin `mod_ivplayer`: ver la sección siguiente.)

## Instalar el plugin en el campus (a mano, desde el 18-oct-2026)

**Ya no hay instalación automática**: el 18-oct-2026 se borró la tarea programada (cron
de hPanel) que corría `~/ivplayer-update.php` y bajaba sola cada release. Cada push a
master sigue publicando un release (`build-plugin.yml`) y el configurador en GitHub
Pages, pero en el campus no cambia nada hasta que alguien lo instala.

**Primero test-academy**, con el ZIP de la rama: `npm run build:plugin` deja
`dist/mod_ivplayer.zip`, que se sube en *Administración del sitio → Plugins → Instalar
plugins* (o se copia `mod/ivplayer` y se corren el segundo y el tercer comando de abajo
con la carpeta de test-academy). 🔴 Nunca correr `build-plugin.yml` a mano
(`workflow_dispatch`) desde una rama: también publica un release marcado como el último,
que es el que baja `ivplayer-update.php` en producción.

**Después producción, de noche**, con la rama ya en master y el workflow "Build &
Deploy" terminado, por SSH:

```bash
php ~/ivplayer-update.php                               # baja el último release y copia mod/ivplayer
php <moodle>/admin/cli/upgrade.php --non-interactive    # registra la versión nueva (clases nuevas, ajustes)
php <moodle>/admin/cli/purge_caches.php                 # nadie queda con el mapa de clases o el player.html viejos
```

`<moodle>` es la carpeta web del sitio (la que tiene `admin/` y `mod/`).

- 🔴 **Los tres seguidos.** Entre el primero y el segundo corre el código nuevo con la
  versión vieja registrada: las clases nuevas no están (no se registran las vistas ni los
  saltos de la red) y las casillas nuevas quedan sin valor, o sea apagadas. Nada se rompe
  en ese rato (`class_exists`), pero no hay que dejarlo así.
- Al terminar: *Administración del sitio → Notificaciones* sin nada pendiente, y
  *Plugins → Módulos de actividad → Video Interactivo* con la versión del release (1.4.0,
  2026101904) y, abajo de todo, "Subtítulos en la TV — Estado: listo".
- 🔴 `scripts/moodle-auto-update.php` (el original de `~/ivplayer-update.php`) deja el
  respaldo de la versión anterior en `mod/ivplayer_backup/`, adentro de la carpeta web:
  ahí se puede abrir por web y corre el reproductor viejo (sin evento de vista ni red de
  seguridad). En el servidor, `$BACKUP_DIR` tiene que apuntar fuera de la carpeta web
  (plan de migración a Bunny, tramo 0.2).
- **Volver atrás:** Moodle no deja bajar de versión. Se publica una versión nueva hacia
  adelante (después de la 1.4.0, una 1.4.1); nunca se copia encima la carpeta vieja
  entera. La red de seguridad y el aviso de la app vienen detrás de casillas apagadas
  (apagarlas es su vuelta atrás); el evento de vista y el Reintentar con la sesión
  cerrada no tienen casilla. El glosario se vuelve atrás por actividad ("Etiquetas: En pantalla")
  y los sonidos y la vibración, por alumno (Ajustes); no hay casilla del sitio para ellos.

### Ajustes nuevos de la 1.4.0 (los dos vienen apagados)

*Administración del sitio → Plugins → Módulos de actividad → Video Interactivo*:

| Ajuste | Qué hace | Cuándo prenderlo |
|---|---|---|
| **Red de seguridad: Vimeo si Bunny falla** (`respaldovimeo`) | Si el CDN de Bunny falla, la lección se recarga con el Vimeo de la actividad y retoma del avance (ver "Red de seguridad"). | Probada en test-academy. 🔴 Apagarla el día en que los videos de Vimeo pasen a privados. |
| **La app con Chromecast ya está publicada** (`appcastpublicada`) | Adentro de una app vieja (sin el puente con el reproductor), el botón de la TV pasa a decir que actualicen la app. | Cuando la versión de la app con Chromecast esté disponible para todos en las tiendas. |

Más abajo, **Subtítulos en la TV** no es un ajuste sino un estado: dice si existe la clave
interna con que se firman los enlaces de los subtítulos para la TV (la crea el upgrade; no
se muestra nunca). Ver "Subtítulos en la TV".

## Glosario interactivo y avisos de las interacciones (1.4.0)

Pedido de Erick (18-oct-2026): las etiquetas aparecían unos segundos como pines sobre el
video y no daban tiempo a leerlas, y el alumno que miraba para otro lado se enteraba de
una pregunta cuando el video ya estaba frenado. Prototipo aprobado: glosario a un costado,
tic-tac antes de frenar y un "plop" al frenar.

### Qué ve y oye el alumno

- **Lo que frena el video** (preguntas, notas, puntos para tocar): 3 segundos antes, un
  tic por segundo (alto, bajo, alto) con una cuenta chica arriba a la derecha ("Se viene
  una pregunta / nota / actividad") y una vibración corta en cada tic. Al frenar, un
  "plop" y una vibración más larga. Los segundos son de VIDEO: a 2× los tics van cada
  medio segundo. Si llega saltando (barra, ±10 s, la transcripción, retomar el avance)
  no hay tic-tac; el plop al frenar sí. Todo salto pedido es callado, también uno corto
  (un toque en la barra 1 s más adelante, o el ±10 que frena justo en una pendiente que
  estaba a menos de 2 s). Si vuelve para atrás, el aviso se
  repite al cruzarlo de nuevo. Una pregunta ya respondida no avisa (el candado no la
  frena). Con dos a menos de 3 s (una nota a los 7 y una pregunta a los 9) se anuncia
  sólo la próxima: la nota con sus tres tics y su plop (y la vibración larga entera),
  y la pregunta, al seguir, con los tics que le queden. Al frenar suena sólo el plop:
  ni un tic ni el plop suave de una etiqueta del mismo segundo encima.
- **Las etiquetas** (modo "Glosario interactivo", el de por defecto): no frenan ni
  aparecen sobre el video. Cada término se suma al glosario en el momento en que se
  nombra, con un plop suave (sin vibrar): el botón "Glosario" de la barra (un libro con
  el contador, que late una vez) y, con el panel cerrado, un aviso "Nuevo en el glosario:
  …" que al tocarlo abre el panel en ese término. El panel muestra sólo lo ya nombrado,
  lo último arriba (resaltado unos segundos con "recién"); cada término se toca (o Enter)
  para desplegar la definición. Se cierra con la X, Escape o tocando afuera (también un
  control de la barra: hace lo suyo y lo cierra). Lateral derecho en un reproductor
  ancho y hoja de abajo en uno angosto, los dos apoyados sobre la fila de controles
  (pausar, Ajustes y pantalla completa siguen a mano). En un reproductor bajo (≤300 px
  de alto: el iframe del campus con el celular parado mide ~210, y la pantalla completa
  con el celular parado también, porque centra un 16:9) ocupa todo, controles incluidos.
  Si el panel **tapa el video, lo pausa** al abrirse y lo retoma al cerrarse (ver "El
  panel que tapa el video", abajo); si lo deja ver (al costado, en una pantalla ancha),
  no lo pausa. Con el panel abierto el aviso no se muestra, pero un término nuevo se le
  anuncia igual al lector de pantalla.
  Las notas, después de verlas, quedan en el glosario con su marca (para releerlas). Un
  salto hacia adelante suma callado lo que quedó atrás; volver para atrás no saca nada;
  Reiniciar lo vacía.
- **Transmitiendo a la TV**: todo sigue en el celular (los sonidos y la vibración salen
  en el celular, que es el que tiene las preguntas) y el glosario se abre encima del
  cartel "Reproduciendo en la TV". Las etiquetas ya no se dibujan sobre ese cartel. Si
  conecta la TV antes de dar play (la TV arranca sola), ese toque es el gesto que
  habilita los sonidos.
- **Ajustes del alumno** (el engranaje): "Sonidos de aviso" y "Vibración" (sólo en un
  equipo que vibra: no en la compu ni en iPhone), sí/no, recordados en su navegador.
  Por defecto, sí. Al prenderlos suena (o vibra) una muestra (la del sonido no suena con
  el video en silencio). Ajustes abre siempre en la vista principal (ahí están los dos
  interruptores), así que la velocidad queda a un toque más. A 320 px de ancho
  "Vibración" queda debajo y se llega desplazando el panel.
- **Con el video en silencio** (el botón de volumen, la tecla M o la barra de volumen
  en 0) los sonidos de aviso **se callan y la vibración sigue**: quien silenció el
  video no quiere tic-tac, pero se entera igual de lo que viene con el celular en la
  mano. Al quitar el silencio vuelven. Se suma a "Sonidos de aviso": apagado, no suenan
  nunca. Ver "El silencio del video", abajo.

### El panel que tapa el video (decisión de Erick, 19-oct-2026)

Si al abrir el glosario el panel tapa **más del 70 %** del video, el video se pausa; al
cerrarlo (la X, Escape, tocando afuera o el botón del glosario) se retoma. Pasa en el
reproductor bajo (el panel lo ocupa todo) y en la hoja de abajo de un reproductor
angosto (tapa el 78 %); en una pantalla ancha el panel va al costado (tapa ~26 % a
1280 × 720 y ~36 % a 900 × 506) y el video sigue, como antes. Se mide al abrir, con el
panel ya armado, contra el contenedor del video (siempre 16:9): un cambio de las
medidas del panel en `styles.css` no pide tocar nada más. Las decisiones son puras:
`cobertura`, `pausarAlAbrir`, `pasoATapar` y `reanudarAlCerrar` en `src/glosario.js`.

- **Sólo si estaba reproduciendo** al abrirlo. En pausa no se toca nada, ni al cerrar.
- **No se retoma si algo más lo frenó o lo tomó en el medio**: una pregunta (aparece y
  cierra el panel: el video queda en la pregunta), un error, la TV, o un play de otro
  lado aunque después lo vuelvan a pausar (los auriculares, la pantalla de bloqueo). Si
  el alumno toca **Reproducir** con el panel abierto (en la hoja de abajo la fila de
  controles queda a la vista; el botón grande del centro, si el celular se acostó con el
  video pausado por el panel), decide ese toque: el panel se cierra y el video arranca
  (sin ese cuidado, cerrar lo retomaría y el clic que viene detrás lo pausaría). Una
  pausa del alumno que llega con el panel abierto también es suya: el toque al costado
  del video pausa 300 ms después (espera por el doble toque), y si en ese rato se abrió
  el glosario, cerrarlo no lo retoma.
- **Transmitiendo a la TV (Chromecast o AirPlay) no se pausa nunca**: el video está en
  la TV y el celular es el control; lo que tapa el panel es el cartel "Reproduciendo
  en…".
- La pausa y la vuelta son **las mismas que las del botón** (pausa con el intento de
  play anulado, `safePlay` al volver): para el candado, los avisos, el avance guardado y
  la renovación de la firma es una pausa más del alumno. El tic-tac sigue donde iba (un
  aviso a medias no se repite ni se saltea).
- **Si con el panel abierto el reproductor cambia de tamaño** (girar el celular, salir
  de la pantalla completa con el atrás del sistema) y el panel **pasa a tapar** el video,
  vale lo mismo que al abrirlo: lo pausa si estaba reproduciendo (antes, acostado con el
  panel al costado y después parado, el video seguía corriendo debajo del panel). Si
  **deja de tapar**, no se retoma: girar el celular no es pedir que siga; lo retoma
  cerrar el panel.

### El silencio del video (decisión de Erick, 19-oct-2026)

Lo decide `comoAvisar` (`src/avisos.js`): **suena** con "Sonidos de aviso" prendido y el
video sin silencio; **vibra** con "Vibración" prendida (el plop suave del glosario no
vibra nunca). El silencio que cuenta es **el que muestra el botón de volumen del
reproductor** (el ícono tachado):

- El que pone el alumno (botón, tecla M, barra de volumen en 0) y el que el reproductor
  lee del video en cada play. Si el navegador arrancó el video en silencio (Vimeo
  adentro de la app de Moodle: el toque no llega al iframe de Vimeo), el ícono lo
  muestra y los avisos también callan; "Activar sonido" devuelve las dos cosas. Se
  descartó distinguir ese silencio del que pone el alumno (era la propuesta de antes):
  un ícono tachado con tic-tac sonando se lee como una falla.
- **Transmitiendo a la TV**, el silencio de la TV tal como lo refleja el ícono: el que
  tenía la TV al conectar, el que pone el alumno con el botón (silencia la TV) y el que
  el reproductor lee de la TV en cada play. Si alguien silencia o quita el silencio con
  el control remoto de la TV entre dos play, el reproductor no se entera al instante
  (no escucha los cambios de volumen de la TV): cuenta el último que reflejó el ícono,
  o sea el del control del celular. Con AirPlay el `<video>` sigue siendo el del
  celular: su silencio es el que viaja a la TV y el que cuenta.
- El interruptor de silencio del iPhone no cuenta: la sesión de audio `playback` lo
  saltea a propósito (ver "Cómo suenan").

### El ajuste de la actividad: "Etiquetas"

En el formulario de la actividad, sección Interacciones: **Glosario interactivo (nuevo,
por defecto)** o **En pantalla (como antes)**. Se guarda en la columna `etiquetas` de
`ivplayer` y `player.php` lo pasa en `PLAYER_CONFIG.etiquetas` (`ivplayer_config_base`).

- 🔴 **Las actividades que ya existen quedan con el glosario** después del upgrade
  (2026101903): es el de por defecto de la columna. "En pantalla" es el respaldo, por
  actividad, si una lección lo necesita.
- En "En pantalla" el reproductor es el de antes (pines sobre el video, sin botón de
  glosario, sin plop suave). Los avisos de lo que frena (tic-tac, plop, vibración) siguen
  igual: son independientes del modo.
- El modo viaja en el backup y al duplicar la actividad. Un backup de antes de la 1.4.0
  restaura con el glosario.
- Sin `etiquetas` en `PLAYER_CONFIG` (SCORM, demos de la web) es el glosario. El menú
  del formulario es la única fuente del modo: `mod_form.php` no se lo manda al
  configurador ni lo lee de lo que vuelve, y la vista previa del configurador es una
  página con la lista de interacciones, no el reproductor. El configurador sí conserva
  el modo de un JSON importado al exportarlo (no cambia el menú de la actividad).

### Cómo suenan

Sintetizados con Web Audio (`src/sonidos.js`), sin archivos: el reproductor sigue siendo
un solo HTML. El `AudioContext` se crea en el primer gesto (el play): antes no suena ni
vibra nada. En iPhone/iPad (Safari 16.4+) se pide la sesión de audio `playback` para que
el interruptor de silencio no los apague; donde no existe, no pasa nada. El silencio
del video sí los calla, no la vibración (ver "El silencio del video"); el
`AudioContext` se crea igual en el play con el video en silencio, así suenan apenas se
quita. También desbloquean el sonido el toque en el video, "Continuar" de una tarjeta,
prender "Sonidos de aviso" y el botón de la TV.

Qué cuenta como reproducción y qué como salto (`src/avisos.js` y `src/glosario.js`):
un paso del tiempo hacia adelante de hasta `umbralPaso(velocidad)` con el video andando y
sin un salto pedido en vuelo (`seekTargetRef`). El umbral es `SEEK_MIN` (2 s, el del
candado) a 1× o menos y crece con la velocidad (4 s a 2×): a 2× un tick de 1 s de reloj
(el latido de la TV con la página en segundo plano) son 2 s de video y no es un salto.
El candado no cambia: sigue con `SEEK_MIN`.

### Pendiente de probar en equipos reales

Las pruebas usan Web Audio y vibración de mentira (`tests/navegador/simulados/sonido-simulado.js`).
Falta oírlos y sentirlos en: un iPhone con el interruptor de silencio puesto (la sesión
`playback`), un Android en Chrome, y adentro de hub-app (en Android, `navigator.vibrate`
del WebView necesita el permiso `VIBRATE` en la app; sin él, no vibra y no avisa nada).
También: con AirPlay, si los sonidos salen por la TV en vez de por el celular; si en
iOS se pierde la muestra al prender "Sonidos de aviso" (el contexto arranca un instante
después); si un iPhone con música de fondo la corta al dar play; y el consumo de batería
del `AudioContext` que queda andando. Y las dos decisiones del 19-oct-2026: la pausa
del glosario en un celular de verdad (el iframe del campus y hub-app, parado y en
pantalla completa, y girándolo con el panel abierto: las pruebas lo simulan cambiando
el ancho del iframe) y el silencio con Vimeo adentro de la app de Moodle (el arranque en
silencio que fuerza el navegador).

Decisiones abiertas (de Erick):

- **Con el glosario abierto, el teclado sólo cierra** (espacio, flechas, f, m y c no
  hacen nada; Escape lo cierra), igual que con Ajustes abierto, y el video sigue como
  estaba (andando o, si el panel lo tapa, en la pausa del glosario).

Decididas el 19-oct-2026: el panel que tapa el video lo pausa (antes seguía corriendo
sin verse) y el silencio del video calla los sonidos de aviso (antes sonaban igual).
Ver las dos secciones de arriba.

## Vistas en el log del campus (evento de vista)

Hasta la 1.3.3, `view.php` marcaba el "visto" de la finalización pero no disparaba
ningún evento: el log del campus tenía 0 filas de `mod_ivplayer` y los informes de
Registros, Actividad del curso y Participación daban las lecciones en 0. Desde esta
versión `view.php` llama a `ivplayer_view()` (`lib.php`), que dispara
`\mod_ivplayer\event\course_module_viewed` (`classes/event/`) y después marca la
finalización, como `page_view()` de core.

- Se registra **una vez por carga de la página de la lección**. `player.php` (el
  iframe) no registra nada: se recarga solo (giro en iOS, "Reintentar") y contaría de más.
- Las vistas de antes no se recuperan: el log cuenta desde que se instala.
- La clase nueva entra al mapa de clases de Moodle con el **upgrade** (por eso subió
  `$plugin->version`). Si se copiaron los archivos y el upgrade todavía no corrió, la
  lección abre igual y la vista no queda registrada hasta entonces (por eso la
  instalación a mano corre los tres comandos seguidos: ver "Instalar el plugin en el
  campus").
- 🔴 Ahora cualquier plugin del campus que escuche `course_module_viewed` (insignias,
  gamificación, `tool_monitor`, los propios de Hub) empieza a ver las lecciones de
  Video interactivo. Mirarlo en test-academy antes de producción.

**Verificar en el campus (test-academy primero):**

1. Instalar y completar el upgrade (ver "Instalar el plugin en el campus").
2. Con una cuenta de alumno, abrir una lección de Video interactivo (`<cmid>` = el
   número de `id=` en la dirección de la lección) y recargar una vez la página entera:
   son dos cargas. Si se puede, girar el iPhone con la lección abierta: eso recarga sólo
   el iframe y no tiene que sumar.
3. Como admin, Administración del sitio → Informes → Registros (o el curso → Informes
   → Registros), filtrar por esa actividad: tiene que haber **dos** filas "Módulo de
   curso visto" (`\mod_ivplayer\event\course_module_viewed`) de ese alumno, una por cada
   carga de la página; las recargas del iframe no suman.
4. Opcional, por SQL (prefijo según el sitio):
   `SELECT COUNT(*) FROM mdl_logstore_standard_log WHERE component = 'mod_ivplayer' AND action = 'viewed' AND contextinstanceid = <cmid>;`
5. La finalización "visto" sigue igual: en Finalización de actividades, la lección del
   alumno marcada (si la actividad usa "ver" como condición).

## Videos de Bunny Stream en el campus (plugin 1.3.0)

Desde la 1.3.0 una actividad "Video Interactivo" puede reproducir un video de
**Bunny Stream** con nuestro reproductor (motor `<video>` + hls.js), en lugar de
Vimeo. La URL del video se arma y se **firma en el servidor**, en `player.php`,
cada vez que el alumno abre la lección. La clave nunca llega al navegador.

### Cargar un video en una actividad

En el formulario de la actividad, sección **Video**, campo **Video de Bunny
Stream**. Acepta cualquiera de estas formas y guarda sólo el ID del video (el
GUID, en minúsculas):

- el ID solo, como lo muestra el panel de Bunny ("Video ID", formato 8-4-4-4-12);
- el enlace del reproductor de Bunny: `https://player.mediadelivery.net/play/<biblioteca>/<ID>`
  o `https://iframe.mediadelivery.net/embed/<biblioteca>/<ID>`;
- el del playlist: `https://<host>/<ID>/playlist.m3u8`.

Vimeo deja de ser obligatorio: hace falta **uno de los dos**. Si una actividad
tiene los dos, **se reproduce el de Bunny**. Así se migra cargando el ID de Bunny
sin borrar el de Vimeo, y para volver atrás alcanza con vaciar el campo de Bunny.

El formulario frena al guardar lo que después el alumno vería roto:

- un enlace al CDN de **otro servidor** (otra biblioteca, otro sitio), si el host
  del sitio está cargado. Se guarda sólo el ID y el reproductor lo pide siempre al
  host del sitio, así que ese video daría 404;
- un enlace del reproductor de Bunny de **otra biblioteca**, si se cargó el número
  de biblioteca en los ajustes (esos enlaces no traen el host);
- una actividad **sólo con Bunny** en un sitio sin Bunny configurado. Con Vimeo
  cargado se deja guardar, porque cae a Vimeo.

Como portada, el reproductor muestra siempre `thumbnail.jpg`, la miniatura que
Bunny genera del video. Una miniatura personalizada que se suba en Bunny queda con
otro nombre de archivo y no se ve.

El progreso guardado en el servidor es por actividad, así que el alumno que ya
venía viendo el video con Vimeo lo retoma en el mismo punto con Bunny (si es el
mismo archivo: un video re-editado corre los tiempos de las preguntas).

### Marcar los tiempos de un video de Bunny (configurador)

**Desde la actividad (1.4.0).** Si la actividad tiene el ID de Bunny guardado y el sitio
tiene Bunny configurado, "Editar interacciones" le pasa al configurador, además de lo de
siempre, un **enlace firmado de vida corta** al video (entre 2 y 3 h). El configurador
lo reproduce con hls.js (va adentro del configurador publicado; en Safari sin MSE, el
HLS nativo) y "Usar tiempo actual", "Ir a este tiempo", la línea de tiempo y la vista
previa con el reproductor andan igual que con Vimeo.

- Si hay Bunny, es Bunny: el Vimeo de la actividad queda en su campo (para volver a él
  con "Cargar video"), pero no se carga.
- El enlace lo firma el servidor (la clave nunca sale) y **sólo para quien puede editar
  la actividad**. No se guarda en la base, no va a un log ni a un campo del formulario,
  y no viaja en el JSON exportado ni en lo que vuelve con "Guardar en Moodle".
- Se firma el ID **guardado**: si se cambia o se vacía el campo de Bunny sin guardar,
  el configurador abre como antes (Vimeo o un archivo de la compu).
- Si el formulario estuvo abierto más de 2 h, el enlace venció: el configurador lo
  dice, y hay que guardar o recargar la página de la actividad y volver a abrirlo. Lo
  mismo si vence con el configurador abierto (lo que ya cargó se ve; lo demás, no).
- El archivo de la compu se puede abrir igual, encima; "Video de la actividad (Bunny)"
  vuelve al de la actividad.
- 🔴 El configurador vive en GitHub Pages: si algún día se restringen los dominios
  permitidos de la biblioteca de Bunny ("Allowed domains"), sumar
  `erick25326.github.io`, o el configurador no va a poder cargar el video.

**Con un archivo de la compu.** Para un video que no está en Vimeo ni llega firmado desde
el campus (una actividad nueva, todavía sin guardar), **"Abrir video de tu
computadora"** carga el mismo archivo que se subió a Bunny en un `<video>` de la
página: no se sube a ningún lado.

- El JSON se exporta **sin video** (`vimeoId` vacío) y "Guardar en Moodle" cambia sólo
  las interacciones: el campo de Vimeo de la actividad no se toca (si tenía uno, sigue
  ahí para volver atrás). El video de Bunny se carga en la actividad por su ID. Con el
  video de Bunny, igual.
- El paquete SCORM sigue necesitando un video de Vimeo.
- Un JSON de la skill `interacciones-video` con `videoUrl` (el HLS de Bunny) se importa
  igual: ese `videoUrl` no se reproduce ni pisa lo que mandó Moodle, y se conserva al
  exportar (sólo si el JSON sale sin Vimeo). Un `vimeoId` que no es un ID de Vimeo
  ("PENDIENTE") se ignora, y un `videoUrl` firmado (con token) no se conserva.

**Probarlo en test-academy** (con la biblioteca de prueba): abrir una actividad con el
ID de Bunny guardado, "Editar interacciones" → tiene que verse el video y decir "vence a
las…"; marcar un tiempo, "Guardar en Moodle" y guardar el formulario → el campo de Vimeo
y el de Bunny siguen iguales. Con un usuario sin permiso de edición, el formulario ni
abre (lo frena `modedit.php`).

🔴 **El configurador es uno solo para los dos sitios** (el de GitHub Pages, que se publica
con cada push a master), así que esta prueba se puede hacer recién **después** de pasar la
rama a master: antes, test-academy abre el configurador publicado viejo. Desde la 1.4.0 el
configurador acepta el mensaje de `https://test-academy.hubeducation.com.ar` (antes sólo
el del campus y el de esta compu: desde test-academy abría vacío y "Guardar en Moodle"
se perdía). Las dos combinaciones de versiones son compatibles (formulario viejo con
configurador nuevo y al revés: sin `bunny` en el mensaje, el configurador sigue con
Vimeo), y para los alumnos el riesgo es cero: el configurador sólo lo abre quien edita.

### Configurar el sitio

*Administración del sitio > Plugins > Módulos de actividad > Video Interactivo*:

| Ajuste | Qué va |
|---|---|
| Host del CDN | El hostname del CDN de la biblioteca (`vz-….b-cdn.net`). Vacío = Bunny apagado en todo el sitio. |
| Número de biblioteca (opcional) | El "Video Library ID" (Stream > biblioteca > API). Sólo sirve para rechazar enlaces del reproductor de Bunny de otra biblioteca. Vacío o 0 = no se controla. |
| Clave de autenticación por token | La "Token authentication key" de la biblioteca (Stream > biblioteca > Security). Vacía = URLs sin firmar. |
| Duración del token | Por defecto 6 h. Con la lección abierta el reproductor la renueva solo antes de que venza (ver "Qué pasa cuando vence el token"); es lo que aguanta si no puede renovarla. Tiene que estar entre 1 h y 7 días: fuera de eso, no se guarda. |

La clave **no sale en la exportación de presets del sitio** (*Presets de
administración del sitio > Exportar*). Que el ajuste sea de tipo contraseña la
enmascara en pantalla y en el registro de cambios, pero la exportación sólo saltea
los ajustes de la lista `adminpresets | sensiblesettings` (*Seguridad > Ajustes de
seguridad del sitio*). Por eso la instalación y el upgrade a la 1.3.0 le agregan
`bunnytokenkey@@mod_ivplayer`, igual que hace core con los suyos. No sacarla de
esa lista.

Arriba de los ajustes hay una línea de **estado** que dice qué tiene que estar
prendido del lado de Bunny. Importa porque **no hay un estado que sirva para los
dos lados**:

- con clave, las URLs van firmadas en la ruta y **sólo andan con la autenticación
  por token PRENDIDA** en Bunny (apagada, el CDN da 404);
- sin clave, las URLs van planas y **sólo andan con la autenticación APAGADA**
  (prendida, da 403).

Con el host vacío, el plugin se comporta exactamente como la 1.2.9: todas las
actividades siguen con Vimeo aunque tengan un ID de Bunny cargado. Por eso
instalar la 1.3.0 no cambia nada hasta que se configura.

**El `player.html` del plugin tiene que ser el build nuevo.** Es una copia de
`dist/index.html` que `npm run build:plugin` mete en el zip. Si el plugin se sube
sin rearmarlo (la carpeta a mano, un zip viejo), queda el reproductor sólo-Vimeo
de la 1.2.9, que no entiende `videoUrl`. Para que eso no deje alumnos frente a un
reproductor que no arranca, `player.php` sólo usa Bunny si el `player.html`
instalado trae hls.js (busca `loadSource`): si no, las actividades con Vimeo siguen
con Vimeo, las que tienen sólo Bunny muestran un cartel, y la línea de estado de
los ajustes lo dice.

### Orden recomendado para el campus

1. Instalar la 1.3.0. No cambia nada (ninguna actividad tiene todavía un ID de Bunny).
2. En Bunny, prender la autenticación por token de la biblioteca (Pull Zone >
   Security > Token Authentication). **No** prender la validación por IP.
3. En Moodle, cargar host, clave y duración (y, si se quiere, el número de
   biblioteca). La línea de estado tiene que decir "URLs firmadas".
4. Probar con una actividad oculta: el video tiene que arrancar, y la misma URL
   con un carácter del token cambiado tiene que dar 403.
5. Recién ahí, migrar actividades cargándoles el ID de Bunny.

Vuelta atrás: vaciar el campo de Bunny de la actividad (vuelve a Vimeo), o vaciar
el host en los ajustes (vuelven todas).

### Qué pasa cuando vence el token: se renueva solo

Bunny valida el vencimiento en cada pedido. El vencimiento se redondea a la hora
en punto siguiente para que las recargas de la misma hora reusen lo que el
navegador ya tiene en caché, así que la URL vale entre la duración del token y una
hora más desde que el alumno abrió la lección.

Con la lección abierta, el reproductor **pide una firma nueva 10 minutos antes de que
venza** (`mod/ivplayer/firma.php`, del lado del reproductor `src/firma.js`) y sigue
sin cortar la clase:

- **Chrome, Android, escritorio (hls.js):** cada pedido de video sale con la firma
  vigente. No se recarga nada: ni una ruedita.
- **iPhone, iPad, Safari (HLS nativo):** el navegador pide el video solo y no se le
  pueden cambiar los pedidos, así que se cambia la fuente a la misma URL con la firma
  nueva, en el mismo segundo (es el mismo mecanismo del cambio de calidad: el candado
  de preguntas no ve nada). Se hace en un momento tranquilo: en pausa sin pregunta
  abierta, o al tocar reproducir; si no llega ninguno, a 90 s del vencimiento, con una
  ruedita de un segundo.
- **Chromecast:** la TV vuelve a cargar el video con la URL nueva en el mismo segundo:
  en pausa (también con una pregunta abierta, quieta en la pregunta), enseguida;
  reproduciendo, a 90 s del vencimiento (una ruedita en la TV). Una sesión reanudada
  con una firma vieja se pone al día igual.
- **AirPlay:** es el `<video>` del celular el que transmite (HLS nativo), así que
  vale lo del iPhone: el cambio de fuente recarga el video también en el Apple TV.

Si el celular estuvo dormido (pantalla bloqueada, pestaña de fondo) y el timer no
corrió, se renueva al volver (y un pedido de video que sale con la firma por vencer
espera la nueva). El tiempo que le queda a la firma se mide con la hora del
**servidor** al firmar (`firmaAhora`) y lo que pasó desde entonces en el equipo: el
reloj de un celular corrido no la hace vencer antes ni nunca.

Como red, si un pedido igual vuelve con 403 y la firma con que salió estaba por vencer
(venció sin renovarse), se pide una firma nueva y se reintenta **una vez** antes de
mostrar nada. Sin red, ese pedido de firma insiste unos 15 segundos (a 1, 2 y 4 s, y
enseguida si vuelve la conexión): al desbloquear el celular la red tarda un par de
segundos en volver. Mientras tanto, lo que toque el alumno (reproducir, pausar,
adelantar o retroceder) se respeta al seguir. Un 403 con una firma que todavía tenía
vida no es por el vencimiento (una calidad rota, por ejemplo): ahí el reproductor pasa
a otra calidad, como siempre. Sólo si nada de eso anda
aparece el cartel, que ahora dice qué hacer: "Se cerró tu sesión del campus. Tocá
Reintentar y, si te lo pide, volvé a ingresar" (firma.php contestó que no hay
sesión), "No se pudo renovar el acceso al video. Revisá tu conexión y tocá
Reintentar" (sin red) o "El acceso al video venció. Tocá Reintentar para seguir".
**Reintentar** recarga la lección: `player.php` firma de nuevo y se retoma desde el
avance guardado. 🔴 Con la sesión cerrada recarga la **página entera** (la de arriba,
`view.php`), no sólo el cuadro del video: así el ingreso de Moodle aparece en la página
y no adentro del video, donde la app de Hub Education no puede hacer su ingreso
automático (lo detecta en la navegación principal) y el ingreso con Google no se deja
mostrar. Si la página de arriba es de otro origen (una demo, un SCORM) o el motivo es
otro, recarga el cuadro como siempre (`recargarParaReintentar` en `src/firma.js`).

**Verificar en el campus** (test-academy, con la duración del token en el mínimo, 1 h):
abrir una lección de Bunny y dejarla en pausa, cerrar la sesión del campus en otra
pestaña, esperar a que venza la firma (la hora en punto siguiente más 1 h), volver,
reproducir hasta que aparezca "Se cerró tu sesión del campus" y tocar Reintentar: tiene
que aparecer el ingreso de Moodle en la página completa, no adentro del video, y al
ingresar volver a la lección. En la app (Android e iPhone), lo mismo tiene que terminar
en el ingreso automático y de vuelta en la lección, sin pedir usuario y contraseña.
Adentro de la app no hay "otra pestaña": la sesión se cierra desde la compu, con el mismo
usuario (*Preferencias → Sesiones del navegador*, cerrar la de la app), o se baja el
tiempo de sesión de test-academy (`sessiontimeout`) y se espera.

`firma.php` (POST `cmid` + `sesskey`) pide lo mismo que `player.php` (curso, actividad
visible, `mod/ivplayer:view`) más el sesskey, contesta siempre JSON y sin caché
(`{ ok, playlist, poster, expires, ahora }`, o `{ ok: false, motivo }` con 401 si se
cerró la sesión) y firma con la **misma regla** que la lección
(`ivplayer_bunny_de_actividad`): sólo si la actividad reproduce Bunny firmado. La
clave nunca sale. **No cuenta como actividad del alumno** (`NO_SESSION_UPDATE`): una
lección en pausa en una PC compartida no mantiene abierta la sesión del campus; vence a
la hora de siempre (`sessiontimeout`) y ahí firma.php contesta 401. Tampoco entra como
invitado sola. Sin `firmaUrl` en `MOODLE_CONTEXT` (la página de prueba sin token,
el configurador, SCORM) o con una URL sin `bcdn_token`, el reproductor no renueva
nada, como antes.

### Detalles técnicos

- Algoritmo: el "Advanced" de Bunny (HMAC-SHA256, prefijo `HS256-`), con un token
  de **directorio** (`token_path=/<ID>/`). El mismo token vale para el playlist,
  las variantes, los `.ts`, la miniatura y los subtítulos de ese video.
- El playlist va firmado **en la ruta** (`https://<host>/bcdn_token=…&token_path=…&expires=…/<ID>/playlist.m3u8`)
  porque sus variantes y segmentos son relativos y así heredan el token. La
  miniatura (`poster`) va firmada en la query.
- Las funciones de firma de `lib.php` (`ivplayer_bunny_*`) son puras a propósito:
  se probaron contra los vectores oficiales de Bunny y contra su SDK, y se pueden
  copiar tal cual a un script de PHP para volver a probarlas.

## Red de seguridad: Vimeo si Bunny falla (1.4.0, plan 0.4)

Mientras se siga pagando Vimeo, cada actividad migrada a Bunny conserva su ID de Vimeo.
Con la red prendida, si el video de Bunny no se puede reproducir por una **falla del
servidor de video**, la lección se vuelve a cargar con el Vimeo de la actividad y retoma
desde el avance guardado. Para el alumno es una ruedita de "Cargando video..." de un
segundo, sin cartel. **Viene apagada**: se instala apagada y se prende recién probada.

**Cuándo salta** (`causaDelRespaldo` en `src/respaldo.js`), siempre después de los
reintentos que ya hace el reproductor:

| Causa (en el registro) | Qué pasó |
|---|---|
| `http-404` | El playlist o un segmento no está. También: firmado con la autenticación de Bunny apagada, o un GUID que no existe. |
| `http-5NN` | El CDN contestó con un error del servidor (500, 502, 503…). |
| `red` | No se llegó al CDN (sin respuesta, conexión rechazada) o lo que llegó no servía. |
| `medio` | Error fatal del video (hls.js después de recuperar, o el del HLS nativo después de renovar y recargar una vez, con el CDN contestando bien). |

Cualquier otro error de hls.js (`otro`: MUX, KEY_SYSTEM, OTHER) **no** salta: el plan
cuenta sólo la red, un 5xx, un 404 o un error fatal del medio. Va al cartel de siempre.

**iPhone, iPad y Safari (HLS nativo):** el `<video>` no dice el código HTTP de lo que
falló. Antes de dar el error, el reproductor le pregunta al CDN por la misma fuente: el
playlist, la primera calidad y su primer segmento (sólo los encabezados; `src/sondeo.js`).
Así las causas y la regla del 403 son las mismas que en Android y en la compu. Lo que
no se ve así: una calidad o un segmento que fallen y no sean los primeros (ahí queda
`medio`, como antes). Si el CDN no contestara con CORS a ese pedido, saldría `red`.

**Cuándo no salta nunca:**

- Por la **firma** (401, 403 o 410 del CDN): la vencida o a punto de vencer la renueva
  el reproductor solo (ver "Qué pasa cuando vence el token"); si no puede, el cartel
  dice por qué. Un 403 con la firma vigente tampoco salta.
- Con la **sesión del campus cerrada** o **sin permiso**. Si saltara, el alumno vería el
  video con Vimeo sin que se guarde nada: ni avance, ni respuestas, ni finalización.
- **Transmitiendo a la TV** (Chromecast o AirPlay).
- En una actividad **sin ID de Vimeo**, con el **ajuste apagado**, o si la carga ya es la
  de Vimeo: el tope es **una vez por carga de la página de la lección**.

**Cómo** (sin cambiar de motor en caliente):

1. El reproductor guarda el avance y espera la respuesta (`moodleGuardarAvanceYa` en
   `src/scorm.js`). 🔴 Sólo si el avance guardado ya se restauró: un 404 del playlist
   llega antes, con el tiempo en 0 y sin respondidas, y guardar eso pisaba el del alumno.
2. Le avisa a `mod/ivplayer/respaldo.php` (POST `cmid`, `sesskey`, `causa`, `codigo`,
   `detalle`). respaldo.php pide sesión, permiso y sesskey, acepta sólo las causas de
   arriba (`ivplayer_respaldo_datos`), mira que el ajuste esté prendido, que la actividad
   tenga Vimeo y que hoy reproduzca Bunny, y **registra el salto** (evento
   `\mod_ivplayer\event\respaldo_vimeo_usado`).
3. Con el ok, recarga **sólo el iframe** con `player.php?id=…&origen=vimeo`. player.php
   lo respeta sólo con el ajuste prendido y la actividad con ID de Vimeo
   (`ivplayer_respaldo_forzar`); si no, lo ignora. Esa carga es de Vimeo y retoma del
   `savedProgress`.
4. Si respaldo.php no confirma, el cartel de siempre. Con la sesión cerrada, el de la
   sesión ("Reintentar" recarga la página entera para volver a ingresar). Sin conexión
   con el campus tampoco salta: es la señal del alumno, no Bunny, y recargar mostraría la
   página de error del navegador adentro del video.

🔴 **Cuánto tarda en saltar** depende de la falla. Un 404 salta enseguida; el CDN que no
contesta, a los ~15 s (los reintentos de 2, 4 y 8 s del reproductor). Un **5xx en los
segmentos tarda ~2 min 20 s** (medido con el video de prueba, oct-2026): hls.js
reintenta el segmento 6 veces (1, 2, 4, 8, 8 y 8 s), prueba las otras calidades, y el
reproductor repite eso 3 veces más. Es lo mismo que tarda hoy el cartel: la red salta en
el momento en que antes aparecía. Acortarlo es cambiar los reintentos del reproductor
para todas las lecciones (decisión aparte).

🔴 **Un 403 de Bunny nunca salta**, tampoco con la firma vigente y en ninguna plataforma
(desde que el HLS nativo le pregunta al CDN, tampoco en iPhone): por regla, todo
401/403/410 es "la firma". Si Bunny contestara 403 por otra cosa (la cuenta suspendida
por falta de saldo, una restricción de dominios), la red no cubre ese caso. Conviene
medir en test-academy qué contesta la biblioteca de prueba deshabilitada, y qué contesta
un GUID que no existe (la prueba del punto 2 de abajo supone un 404: con un 403 no
salta), antes de contar con la red para eso.

### Prenderla

Administración del sitio → Plugins → Módulos de actividad → Video Interactivo → casilla
**"Red de seguridad: Vimeo si Bunny falla"** (`respaldovimeo`). Apagarla es la vuelta
atrás: no hace falta instalar nada. 🔴 **Apagarla el día en que los videos de Vimeo pasen
a privados**: si no, salta a un video que no se ve.

**Probarla en test-academy** (con la biblioteca de Bunny de prueba, nunca la de Hub Campus):

1. Instalar, completar el upgrade y prender la casilla.
2. En una actividad oculta que tenga Vimeo, cargar un GUID que **no exista** en la
   biblioteca de prueba (con el formato correcto). Abrirla como alumno con avance: tiene
   que recargarse sola con Vimeo y retomar donde iba, sin cartel.
3. Con la sesión vencida (duración del token en el mínimo, 1 h, y la sesión cerrada en
   otra pestaña; en la app, desde la compu: ver "Qué pasa cuando vence el token"): no
   salta y aparece "Se cerró tu sesión del campus".
4. Con la firma vencida y la sesión abierta: la renueva sin saltar.
5. En Registros, el salto del punto 2 con su causa (ver abajo).
6. Lo mismo en la app (Android e iPhone): la recarga del iframe tiene que pasar sin que
   la app la intercepte.
7. Prendida en producción, unos días con los cursos 12 y 13 sin saltos falsos.

### Contar los saltos

Cada salto es una fila **"Red de seguridad: la lección pasó a Vimeo"** en Administración
del sitio → Informes → Registros (o el curso → Informes → Registros), con la causa en la
descripción ("cause 'http-503', HTTP code 503, detail 'fragLoadError'"). El detalle dice
qué falló: `manifestLoadError` es el playlist, `levelLoadError` el de una calidad y
`fragLoadError` un segmento. Con el HLS nativo (iPhone, iPad, Safari) es
`nativo-playlist`, `nativo-variante` o `nativo-segmento` (el pedido que falló al
preguntarle al CDN), o `nativo-medio` si el CDN contestó bien: así también se separan
los saltos de los dispositivos de Apple.

🔴 **Contar alumnos, no filas.** Cualquier alumno con la lección abierta puede llamar a
`respaldo.php` las veces que quiera (tiene el sesskey) y sumar filas; lo que no se puede
inflar así es cuántos alumnos distintos saltaron por día y lección (`alumnos` en las
consultas de abajo). Y al revés: alguien que abre a mano `player.php?…&origen=vimeo` ve la
lección con Vimeo sin dejar ninguna fila (se registra el salto, no la carga).

Por SQL, en MySQL/MariaDB (prefijo según el sitio; `other` se guarda como JSON; el `LIKE`
evita escribir las barras invertidas del nombre del evento, que en MySQL hay que duplicar):

```sql
-- Alumnos que saltaron por día y lección, últimos 30 días (lo que no se puede inflar).
SELECT FROM_UNIXTIME(timecreated, '%Y-%m-%d') AS dia, contextinstanceid AS cmid,
       COUNT(DISTINCT userid) AS alumnos, COUNT(*) AS saltos
  FROM mdl_logstore_standard_log
 WHERE component = 'mod_ivplayer' AND eventname LIKE '%respaldo_vimeo_usado'
   AND timecreated > UNIX_TIMESTAMP() - 30 * 86400
 GROUP BY dia, cmid
 ORDER BY dia, alumnos DESC;

-- Saltos por día y causa, últimos 30 días.
SELECT FROM_UNIXTIME(timecreated, '%Y-%m-%d') AS dia, other,
       COUNT(DISTINCT userid) AS alumnos, COUNT(*) AS saltos
  FROM mdl_logstore_standard_log
 WHERE component = 'mod_ivplayer' AND eventname LIKE '%respaldo_vimeo_usado'
   AND timecreated > UNIX_TIMESTAMP() - 30 * 86400
 GROUP BY dia, other
 ORDER BY dia, alumnos DESC;

-- Por causa y lección (MySQL/MariaDB con JSON).
SELECT JSON_UNQUOTE(JSON_EXTRACT(other, '$.causa')) AS causa, contextinstanceid AS cmid,
       COUNT(*) AS saltos, COUNT(DISTINCT userid) AS alumnos
  FROM mdl_logstore_standard_log
 WHERE component = 'mod_ivplayer' AND eventname LIKE '%respaldo_vimeo_usado'
 GROUP BY causa, cmid
 ORDER BY alumnos DESC;
```

Para leerlos: muchos `http-5NN` o `http-404` en un mismo rato y en varias lecciones es
Bunny; `red` suelto, repartido entre alumnos, suele ser la señal del alumno. Un
`http-404` que se repite en UNA lección es esa lección (el GUID, o el video borrado).

## Transmitir a la TV (Chromecast y AirPlay)

Sólo con video propio (`videoUrl`, Bunny). Con Vimeo no aparece nada.

### Qué ve el alumno

- Un botón **Transmitir a la TV** en la fila de controles, SIEMPRE que el video sea
  propio (Bunny). Al tocarlo se abre la lista de TVs del sistema (Chrome o AirPlay);
  si no hay ninguna en la red, o el navegador no puede transmitir, un aviso lo
  explica. Al conectar, la TV arranca reproduciendo. En un reproductor angosto (340 px o
  menos: celular parado dentro del campus) no entra sin recortar el botón de salir
  de pantalla completa, así que pasa a ser una fila en **Ajustes**.
- Transmitiendo, el video se ve en la TV y en el celular queda un cartel
  "Reproduciendo en Living" (con AirPlay, "Reproduciendo en la TV": Safari no da el
  nombre). Los controles siguen andando y **las preguntas aparecen en el celular**:
  la TV se queda quieta en el cuadro de la pregunta hasta que se responde.
- Mientras transmite no hay **Calidad** (la elige la TV) ni **pantalla completa**
  (si estaba en pantalla completa, sale sola al conectar).
- El botón de sonido muestra y cambia el **silencio de la TV** (nunca su volumen).
  Al dejar de transmitir vuelve a mostrar el del celular.
- **Dejar de transmitir** (el mismo botón): el video sigue en el celular en el mismo
  segundo, reproduciendo o en pausa según estaba la TV.

### Dónde anda

| Navegador | Chromecast | AirPlay |
|---|---|---|
| Chrome / Edge en Android | sí | — |
| Chrome / Edge de escritorio | sí | — |
| Safari en iPhone, iPad y Mac | — | sí (con el motor HLS nativo, que es el de siempre ahí) |
| Chrome en iPhone | no (Google no lo soporta) | a verificar |
| Firefox | no | no |
| App de Hub Education con Chromecast (1.4.0 + la app nueva) | sí, con el Cast de la app | iPhone: sólo si la app lo declara |
| App de Hub Education de hoy / app oficial de Moodle (WebView) | no: "abrí la lección en Chrome" | a verificar |

Probado sólo con receptores **simulados** (ver "Pendiente" al final de la sección).

### Adentro de la app de Hub Education (1.4.0)

En el WebView de la app no hay Cast Web SDK. La app nueva transmite con el Chromecast
NATIVO y le habla al reproductor por un puente de mensajes (protocolo `ivcast` v1; el
diseño y el contrato completo están en `castear-hub-app-v2.md` y en el pedido a hub-app,
fuera de este repo). Del lado del reproductor:

- `src/puenteApp.js`: si hay un `ReactNativeWebView` (en la página o en `window.top`, del
  mismo origen) saluda a la app (`hola` → `hola-ok` con sus `capacidades`, hasta 3 s).
  Lo que prueba que hay una app que habla el protocolo es la respuesta, no el objeto.
- `src/castNativo.js`: con `'cast'` en las capacidades, arma un `window.cast.framework` /
  `window.chrome.cast` imitado sobre el puente. `CastPlayer`, el freno de las preguntas,
  la medición del ida y vuelta y la renovación de la firma son los mismos de Chrome.
- En modo app no se baja nunca el SDK de gstatic. Sin respuesta al saludo, no se instala
  nada y el reproductor sigue igual (el toque dice "No se pudo preparar la transmisión.
  Probá de nuevo." y vuelve a saludar). Sin `'cast'` (teléfono sin Google Play Services):
  "Este teléfono no puede transmitir a Chromecast."
- En iPhone, AirPlay sólo si la app declara `'airplay'`; sin TV de AirPlay a la vista va
  directo a Chromecast, y con las dos aparece un selector propio. Si el saludo de la
  carga no tuvo respuesta, el toque vuelve a saludar y decide con lo que conteste la app
  (con TV de AirPlay, el selector: el de AirPlay sólo se abre dentro de un toque).
- La app de hoy (sin puente) sigue como en 1.3.3. El "actualizá la app" se prende con la
  casilla del plugin **La app con Chromecast ya está publicada** (apagada por defecto):
  prenderla recién cuando la versión con Cast esté en Play para todos.

Lo hace cumplir la app (pausar la TV al salir de la lección, con el celular bloqueado o
en otra app; validar de dónde vienen los mensajes; la lista de hosts de video): el
reproductor no decide nada por la versión de la app, sólo por sus `capacidades`.

**La casilla** está en *Administración del sitio > Plugins > Módulos de actividad >
Video Interactivo*, bajo "Transmitir a la TV desde la app". Llega al reproductor como
`MOODLE_CONTEXT.appCastPublicada` (en `PLAYER_CONFIG` no: las demos de la web no la
tienen y valen "apagada"). Sólo cambia el aviso del WebView **sin** puente:

| Caso | Lo que dice el toque del botón de la TV |
|---|---|
| WebView sin puente (app de hoy, app oficial de Moodle), casilla apagada | "Para transmitir a la TV abrí la lección en Chrome." (Safari en iPhone) |
| WebView sin puente, casilla prendida | "Para transmitir a la TV, abrí la lección en Chrome. Si usás la app de Hub Education, actualizala." |
| App con puente que contesta sin `'cast'` | "Este teléfono no puede transmitir a Chromecast." |
| App que contesta `error{version}` | "Para transmitir a la TV, actualizá la app de Hub Education." (con un solo protocolo hoy no pasa) |
| App con puente que no contesta en 3 s | "No se pudo preparar la transmisión. Probá de nuevo." (el toque siguiente vuelve a saludar) |

**Orden de publicación:** el reproductor 1.4.0 sale primero, con la casilla apagada. Sin
nadie que conteste el saludo no cambia nada (no hay ningún pedido a `gstatic.com` en el
WebView, y los textos son los de hoy). La casilla se prende recién con la app nueva en
Play. Volver atrás es el `player.html` anterior; la casilla apagada es inocua.

**Diagnóstico** (desde `chrome://inspect` con la app de prueba): `window.__ivCastDiag.modo`
dice `app` o `web`; `sdk`, en qué quedó el saludo (`app: listo`, `app: sin-respuesta`,
`app: version`, `app: sin-cast`); `puenteRepetidos`, cuántos `media` idénticos se
descartaron. Las pruebas de navegador lo reproducen con `marco.html?app=fake&webview=1`
(parámetros en `tests/navegador/simulados/puente-app-simulado.js`).

### Subtítulos en la TV (1.4.0)

**Qué ve el alumno.** Transmitiendo con Chromecast (desde Chrome o desde la app), los
subtítulos de la lección salen **en la TV**, con letra más grande que la del receptor,
blanca sobre negro semitransparente. El botón de subtítulos del reproductor los prende y
los apaga en la TV, sin recargar el video. En el celular no se dibujan encima del cartel
"Reproduciendo en…" (estarían duplicados y con el reloj estimado de la TV); al dejar de
transmitir vuelven al celular. Si la lección se recarga con la TV andando (otra lección,
volver a la misma), el botón toma lo que tiene la TV.

**Cómo funciona.** La TV baja el VTT ella sola, como el video, y sin la cookie del campus:

- `mod/ivplayer/subtitulos.php?id=<cmid>&e=<vencimiento>&s=<firma>` sirve el VTT/SRT de
  "Editar transcripción" (el mismo que la transcripción y los subtítulos del celular) como
  **WebVTT estricto**, sin sesión, con CORS abierto y caché privada de 5 min. La firma es
  HMAC-SHA256 de `"cmid|e"` con un secreto del plugin; si no vale, venció o vence más
  allá de la duración del token + 1 h, contesta 403 sin detalle.
- `player.php` agrega `subtitlesUrlTv` a `PLAYER_CONFIG` sólo con Bunny (se puede
  transmitir) y con subtítulos, con el **mismo vencimiento que la firma del video**.
  `firma.php` trae uno nuevo con cada renovación: cuando la TV recarga el video con la
  firma nueva, la pista va con el enlace nuevo.
- El reproductor (`CastPlayer`) manda la pista (`TEXT` / `SUBTITLES`, `text/vtt`,
  español, id 1) y el estilo en el LOAD, con `activeTrackIds` según el botón, y prende o
  apaga con `EDIT_TRACKS_INFO`.
- La pista llega a la TV aunque los subtítulos estén apagados: prenderlos después no
  recarga el video.

**El secreto** (`subtitulossecreto`, 32 bytes al azar) lo crean la instalación y el
upgrade a 2026101904; si ya existe no se toca. No es un ajuste del panel (no se ve ni se
exporta) y además está en la lista de ajustes sensibles. Sin él (código nuevo con el
upgrade sin correr), `player.php` no ofrece la pista y, transmitiendo, los subtítulos
siguen en el celular, como antes. Para rotarlo a propósito (las TVs que ya los cargaron
los pierden hasta la próxima renovación):

```bash
php <moodle>/admin/cli/cfg.php --component=mod_ivplayer --name=subtitulossecreto \
  --set="$(php -r 'echo rtrim(strtr(base64_encode(random_bytes(32)), "+/", "-_"), "=");')"
php <moodle>/admin/cli/purge_caches.php
```

**Decisión: la visibilidad del curso no se mira** en `subtitulos.php`. La firma la emite
`player.php` para quien pasó `require_login` y `mod/ivplayer:view` en esa actividad, y
vence con la del video (la URL de Bunny tampoco se revoca al ocultar el curso). Mirarla
dejaría sin subtítulos en la TV a quien prueba con una actividad oculta.

**En la app de Hub Education** hace falta la app nueva: el reproductor manda la pista sólo
si la app declara `'subtitulos'` en sus capacidades (comando `pistas`, campos nuevos en
`cargar` y `media`; el contrato está en la adenda de las pistas del pedido a hub-app, fuera
de este repo). Con una app que no lo declara, los subtítulos se ven en el celular.

**Dónde NO van en la TV** (y siguen en el celular): AirPlay (el `<video>` del celular es
el que transmite y los subtítulos son una capa del reproductor), SCORM y las demos (sin
`subtitlesUrlTv`), Vimeo (no se transmite).

**Pendiente de probar con una TV real:** que el receptor por defecto baje el VTT del campus
(sin que un filtro del sitio o de Cloudflare frene un pedido sin cookies) y lo muestre con
el HLS de Bunny, que respete el estilo, y que la recarga por la firma nueva conserve los
subtítulos. Con Bunny SIN firmar (sin clave) no hay renovación: el enlace de los
subtítulos vence a la duración del token y, si la TV recarga después (el video terminado y
vuelto a empezar), sale sin subtítulos.

### Cómo funciona

- **AirPlay** (`nativePlayer.js`): el `<video>` sigue siendo el dueño; la TV es sólo
  a dónde sale la imagen. Play, pausa, saltos y lo que se haga con el control del
  Apple TV pasan por el mismo `<video>`, así que el candado de preguntas funciona
  igual. Se usa la Remote Playback API (`video.remote`) y, si no está, las `webkit*`.
- **Chromecast** (`cast.js`): la TV baja el video sola, con la misma URL firmada (y,
  cuando se renueva, la vuelve a cargar con la nueva en el mismo segundo).
  El SDK de Google (unos 90 KB) se baja con el reproductor listo, sólo donde existe
  y sólo si el navegador ve una TV con Cast en la red: eso se pregunta antes con la
  Presentation API, que no le pide nada a Google. Sin TV a la vista, la página no
  hace ningún pedido a `gstatic.com`; si la TV aparece después, se baja en ese
  momento. Mientras transmite, el reproductor le habla a un **adaptador**
  (`CastPlayer`) con la misma forma que el `<video>`, que informa lo que pasa en la
  TV: así las mismas reglas frenan en las preguntas, devuelven a la pregunta un
  salto hecho desde el control remoto o Google Home, y vuelven a pausar un play de
  afuera con una pregunta abierta. El `<video>` del celular espera en pausa, sin
  bajar nada, para la vuelta.
- Para que la TV frene **en** la pregunta y no medio segundo después, la pausa sale
  un ida y vuelta antes (medido). Se apunta a frenar un poco después, nunca antes:
  frenar antes cortaría el final de la frase. Si igual se pasa, se la vuelve a la
  pregunta (también si el alumno responde antes de que la TV confirme la pausa). Si
  frena antes (una TV que informa mal el tiempo), no se la adelanta: se queda ahí y,
  al responder, repite ese tramo.

### Límites (receptor por defecto de Google)

El receptor por defecto no se registra ni cuesta nada, pero sólo reproduce:

- **La TV no muestra la pregunta**; se responde en el celular.
- **No puede impedir** que alguien adelante o dé play desde el control de la TV,
  Google Home o la notificación de Chrome: el reproductor lo **detecta y lo corrige**
  (vuelve a la pregunta), pero se escapan unos cientos de milisegundos de video.
- **El freno depende del celular.** Mientras transmite se pide mantener la pantalla
  encendida. Si el alumno bloquea el celular o cambia de app un rato largo, el
  navegador frena (o congela) la página y la TV sigue de largo, pasando las
  preguntas, hasta que la página vuelve. Ahí frena, muestra la pregunta pendiente y
  lleva la TV a ella (el avance guardado nunca la saltea). Desde el celular no tiene
  arreglo: hacerlo cumplir en la TV pide el receptor propio (ver abajo).
- Al irse de la lección transmitiendo, la TV queda **en pausa**. Si se vuelve a la
  misma lección, se retoma ahí; si se abre otra, el botón la carga en la misma TV.
- Si la paran o cargan otra cosa en la TV desde otro equipo, el video vuelve al
  celular **en pausa**.
- La URL firmada (6 h, y cada una de las que la renuevan) viaja a la TV y la pueden ver
  otros equipos de la misma red.
- Los subtítulos se ven en la TV desde la 1.4.0 (ver "Subtítulos en la TV"). Con
  AirPlay, todavía sólo en el celular.
- **Pendiente de decidir (producto):** las **etiquetas** se siguen dibujando en el
  celular sobre el cartel "Reproduciendo en…", sin el cuadro al que apuntan (se
  pueden tocar y leer la definición). Con **AirPlay**, los puntos de un **hotspot**
  quedan sobre el recuadro negro del celular (con Chromecast se lleva el video del
  celular, quieto, al cuadro de la TV). Opciones: ocultar las etiquetas mientras se
  transmite, o mostrar el cuadro quieto también para ellas.

Mostrar las preguntas en la TV y bloquear los saltos ahí exige un **receptor
propio**: una página nuestra que corre en la TV, registrada en la consola de Google
Cast (un registro de USD 5, no reembolsable) y servida por HTTPS. Cuando exista, su ID va en
`castAppId` del `PLAYER_CONFIG` (8 hexadecimales); hoy queda en `null`.

**Decisión (11-oct-2026): las preguntas NO van en la TV**, ni con Chromecast ni con
AirPlay (desde una página web, AirPlay sólo manda el video; haría falta una app de
Apple TV). Se responden siempre en el celular. `castAppId` queda en el código, sin uso.

### Requisitos para que no se rompa

- **HTTPS** en la página del reproductor (el campus ya lo es; `localhost` sirve para
  probar).
- El `iframe` de `view.php` **no necesita cambios**: no existe un permiso de iframe
  para Cast ni para AirPlay. Lo que sí lo rompería es ponerle `sandbox` sin
  `allow-presentation`.
- Si algún día se agrega una política de seguridad de contenido (CSP), `script-src`
  tiene que permitir `https://www.gstatic.com` (de ahí sale el SDK de Cast).
- En Bunny, **no prender** "Allowed referrers" ni "Block direct URL file access" sin
  probar antes con una TV: la TV pide el video sin pasar por nuestro sitio.

### Pendiente: probar con TVs reales

Todo lo de arriba se probó con un receptor de Cast y un AirPlay **simulados**. Falta
confirmar con equipos de verdad: que la TV herede el token en las variantes y los
segmentos, la latencia real del freno, cuánto tarda la TV en cerrarse sola en pausa
durante una pregunta larga, qué pasa con el celular bloqueado, y AirPlay en iPhone,
iPad y Mac. Del modo app (1.4.0), la prueba de punta a punta con la app de prueba y una
TV real: el estado de sesión que manda la app al volver a primer plano, que la TV
devuelva el `customData` y que el primer IDLE de 1.3.3 siga sin cortar por el puente.

## Pendiente: partir el bundle

Hoy `vite-plugin-singlefile` mete JS y CSS adentro de un único `index.html` de
~260 KB, y `player.php` lo sirve entero. Como **cada lección es un `cmid`
distinto**, o sea otra URL, el navegador se baja y re-compila esos 260 KB en
CADA lección.

Ponerle caché a `player.php` NO lo arregla, y además es peligroso: esa
respuesta lleva `sesskey` y el progreso del alumno congelados adentro. Se
intentó con ETag y se revirtió — el porqué está escrito en el propio
`player.php`, vale la pena leerlo antes de volver a intentarlo.

El arreglo de fondo es servir el bundle estático desde **una sola URL
compartida y versionada**, que se cachea una vez y vale para todas las
lecciones:

1. Que el build emita también `player.js` y `player.css` sueltos (Vite ya lo
   hace; hoy singlefile los vuelve a meter adentro).
2. Que `player.php` devuelva un HTML chico: la config inyectada +
   `<script src="static.php?v=<plugin->version>">`. Con la versión en la query,
   publicar una versión nueva invalida la caché sola.
3. Que ese `static.php` mande `Cache-Control: public, max-age=31536000,
   immutable` — ahí sí `public`, porque el bundle es igual para todos y **no
   lleva `sesskey` ni progreso**. Esa distinción es la que importa: lo que hoy
   NO se puede cachear públicamente es la respuesta de `player.php`, que sí es
   por usuario.

Impacto estimado: un alumno que cursa 6 lecciones baja 260 KB una vez en lugar
de seis. En datos móviles, en el campo, es la diferencia entre esperar y no.

## Fuentes por `@import` (menor)

`src/styles.css:1` trae Work Sans y Changa de Google Fonts con `@import`, que
queda literal dentro del `<style>` del HTML único. Es lo peor de los dos mundos:
el preload scanner no lo ve (se descubre recién al parsear el CSS) y encadena
dos round-trips antes del primer pintado. El arreglo es subsetear a latín,
convertir a woff2 y embeberlas como `@font-face` con `data:` — suma peso al
bundle pero saca dos viajes de red del camino crítico. Requiere `fontTools`.

## Licencia

Uso interno Hub Education.
