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
