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
| Unitarias | `tests/unit/` | El candado (`src/candado.js`: `debeFrenar`, la guardia, `tiempoAGuardar`) con casos fijos y un simulador de ticks; el parser de subtítulos (`src/subtitulos.js`); la firma de Bunny contra los vectores oficiales (espejo en Node), incluida la regla de "¿esta actividad usa Bunny?" que comparten `player.php` y `firma.php`; la renovación de la firma (`src/firma.js`: leer y reescribir las URLs del master, variantes, `.ts` y miniatura, el reloj con la hora del celular corrida, el Renovador contra un `firma.php` falso); el adaptador de Chromecast (`CastPlayer`) contra una TV falsa que avisa un salto en un solo estado. Además, una huella del código de las funciones de `lib.php` que sólo prueba PHP: si cambian, avisa que hay que correr la prueba PHP. |
| PHP | `tests/php/correr.php` | La sintaxis de cada `.php` del plugin (`php -l`: `player.php` y `firma.php` necesitan Moodle y ninguna otra prueba los ejecuta) y las funciones puras de `mod/ivplayer/lib.php` leídas del archivo real: firma HS256 de Bunny, la regla de qué actividad reproduce Bunny (`ivplayer_bunny_video`, la de `player.php` y `firma.php`, y que la clave no salga) y normalización de subtítulos (BOM, UTF-16, Windows-1252, bytes rotos). El `php -l` corre también en el workflow que publica el ZIP. |
| Navegador | `tests/navegador/` | El bundle compilado en Chrome, con clics y toques reales por CDP: el candado con hls.js y con HLS nativo (saltos de afuera, también con una nota abierta; restauración; +10 y −10; play de afuera), el cambio de calidad antes de una pregunta (y, con el nativo, un salto del cambio de fuente que aterriza corrido), los subtítulos, la TV con Chromecast y AirPlay simulados, la fila de controles a 320 y 360 px en pantalla completa simulada, y la firma de Bunny que vence a los pocos segundos (el servidor de pruebas la valida como el CDN, con 403): sin cortes ni saltos y con el candado intacto, el 403 que se arregla solo (también con la red que tarda en volver), el pedido que espera una renovación en camino, un salto y un play durante esa espera (y, con el nativo, un −10 durante el rescate y la calidad elegida justo al vencer), una calidad rota que no es el vencimiento (con hls.js pasa a otra, sin cartel), el cartel si no se puede renovar y la TV que recarga con la firma nueva. Y el configurador armado como el de GitHub Pages con un MP4 de la compu (generado con ffmpeg): tomar el tiempo, saltar, la vista previa con el reproductor, exportar sin `vimeoId`, liberar el archivo al cambiarlo, un archivo que no es video o que no se puede leer, un video sin la duración en la cabecera (WebM), el JSON de la skill con `videoUrl` y el ida y vuelta con Moodle pasado por el manejador real de `mod_form.php` (el campo de Vimeo no se toca). |

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
- El HLS nativo de Chrome no es el de Safari: sirve para probar el camino del iPhone
  (cambio de fuente, reintentos del salto), pero tiene sus propias mañas (ver el
  CLAUDE.md). Que nativePlayer RETENGA los eventos durante el cambio de fuente no se
  ve con Chrome solo (el reintento sale en el mismo evento que vería el 0): se prueba
  forzando, con una trampa en el setter de `currentTime`, que el primer salto
  aterrice 6 s antes, como hace iOS. Lo que hace Safari de verdad sólo se ve en un
  iPhone. Si un Chrome no trae HLS nativo, esas pruebas se saltean diciendo por qué.

## Configuración

Editar `window.PLAYER_CONFIG` en el HTML o en `src/InteractiveVideoPlayer.jsx`:

```javascript
window.PLAYER_CONFIG = {
  title: "Nombre del módulo",
  vimeoId: "1171751497",
  vimeoHash: "415649d0b1",  // Solo para videos privados
  subtitlesUrl: "https://ejemplo.com/subs.vtt",
  interactions: [
    { id: "q1", type: "multiple-choice", time: 30, data: { ... } },
    { id: "n1", type: "note", time: 60, data: { ... } },
  ]
};
```

## Deploy en Moodle

1. Compilar con `npx vite build`
2. Subir `dist/index.html` como recurso "Archivo" en Moodle
3. O embeber como iframe en una actividad "Página"

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

El configurador de interacciones no puede reproducir el video de Bunny (sin firma no
abre). Para marcar los tiempos, **"Abrir video de tu computadora"** carga el mismo
archivo que se subió a Bunny en un `<video>` de la página: no se sube a ningún lado.
"Usar tiempo actual", "Ir a este tiempo", la línea de tiempo y la vista previa con el
reproductor andan igual que con Vimeo.

- El JSON se exporta **sin video** (`vimeoId` vacío) y "Guardar en Moodle" cambia sólo
  las interacciones: el campo de Vimeo de la actividad no se toca (si tenía uno, sigue
  ahí para volver atrás). El video de Bunny se carga en la actividad por su ID.
- El paquete SCORM sigue necesitando un video de Vimeo.
- Un JSON de la skill `interacciones-video` con `videoUrl` (el HLS de Bunny) se importa
  igual: ese `videoUrl` no se reproduce ni pisa lo que mandó Moodle, y se conserva al
  exportar (sólo si el JSON sale sin Vimeo). Un `vimeoId` que no es un ID de Vimeo
  ("PENDIENTE") se ignora.

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
avance guardado.

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
| App de Moodle (WebView) | se espera que no | a verificar |

Probado sólo con receptores **simulados** (ver "Pendiente" al final de la sección).

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
- Los subtítulos se siguen viendo sólo en el celular.
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
iPad y Mac.

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
