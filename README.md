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

### Configurar el sitio

*Administración del sitio > Plugins > Módulos de actividad > Video Interactivo*:

| Ajuste | Qué va |
|---|---|
| Host del CDN | El hostname del CDN de la biblioteca (`vz-….b-cdn.net`). Vacío = Bunny apagado en todo el sitio. |
| Número de biblioteca (opcional) | El "Video Library ID" (Stream > biblioteca > API). Sólo sirve para rechazar enlaces del reproductor de Bunny de otra biblioteca. Vacío o 0 = no se controla. |
| Clave de autenticación por token | La "Token authentication key" de la biblioteca (Stream > biblioteca > Security). Vacía = URLs sin firmar. |
| Duración del token | Por defecto 6 h. Tiene que cubrir la sesión entera, pausas incluidas. Tiene que estar entre 1 h y 7 días: fuera de eso, no se guarda. |

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

### Qué pasa cuando vence el token

Bunny valida el vencimiento en cada pedido. El vencimiento se redondea a la hora
en punto siguiente para que las recargas de la misma hora reusen lo que el
navegador ya tiene en caché, así que la URL vale entre la duración del token y una
hora más desde que el alumno abrió la lección. Si la deja abierta más que eso, el
video sigue unos segundos con lo que ya bajó y después se corta con el cartel "El
acceso al video venció". Con 6 h es raro, pero el reproductor todavía no renueva
la firma solo: el botón **Reintentar** recarga la lección, `player.php` firma de
nuevo y se retoma desde el avance guardado.

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

- Un botón **Transmitir a la TV** en la fila de controles, que aparece sólo si hay
  una TV a la vista (en la misma red Wi-Fi). En un reproductor angosto (340 px o
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
- **Chromecast** (`cast.js`): la TV baja el video sola, con la misma URL firmada.
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
- La URL firmada (6 h) viaja a la TV y la pueden ver otros equipos de la misma red.
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
