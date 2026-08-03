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
