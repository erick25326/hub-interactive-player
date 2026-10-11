# Hub Education — Interactive Video Player

## What this is
A standalone interactive video player that replaces H5P for Hub Education's Moodle-based drone courses. Solves two H5P pain points: broken mobile fullscreen and dated UI.

## Architecture
- **React + Vite** single-page app
- **vite-plugin-singlefile** compiles everything into ONE `index.html` (no external assets except Google Fonts)
- **@vimeo/player** SDK for video playback (controls are custom, Vimeo iframe has `pointer-events: none`)
- Config via `window.PLAYER_CONFIG` object in the HTML (video ID, subtitles, interactions)

## Key files
- `src/InteractiveVideoPlayer.jsx` — Main component: player, interactions, subtitles, all in one file
- `src/styles.css` — All styles with `.iv-` prefix namespace
- `src/main.jsx` — React entry point
- `vite.config.js` — Build config with singlefile plugin
- `index.html` — HTML shell

## Interaction types
1. **note** — Info popup, dismiss to continue
2. **multiple-choice** — 4 options, feedback, explanation
3. **true-false** — Binary choice with feedback
4. **hotspot** — Clickable points overlaid on video, must view all to continue
5. **label** — Pin over the video; click opens a popup with a definition

## Text formatting (labels, notes, questions, explanations)

These fields accept a small markdown subset: `data.text`, `data.definition`,
`data.explanation`, `data.statement`, `data.question`.

```
**negrita**            _cursiva_   or   *cursiva*
a blank line         → new paragraph
a single newline     → line break
```

Everything else is literal. Plain text keeps rendering exactly as before —
verified against the 89 existing strings in `interacciones/`: none changed.

Two rules worth knowing:

- **`_` only opens/closes italics at a word boundary.** `hub_student_identity`
  stays intact; `_idnumber_` between spaces becomes italic. Without this rule,
  every meta and function name in a definition rendered mangled. `*` does allow
  intraword italics, like real markdown.
- **It parses to React elements, never `dangerouslySetInnerHTML`.** The player is
  embedded in the campus and the text comes from a JSON the configurator edits,
  so raw `<b>` or `<script>` in a definition renders as literal text.

Implemented by `RichText` in `InteractiveVideoPlayer.jsx` (exported, so it can be
tested). `prueba-richtext.html` is a dev-only bench with 21 cases — open
`http://localhost:5173/prueba-richtext.html` with `npx vite` running. It is not
part of the build; `vite build` only emits `index.html`.

## Build
```bash
npm install
npx vite build    # outputs dist/index.html
```

## Dev server
```bash
npx vite          # http://localhost:5173
```

## Vimeo private videos
Use `vimeoId` + `vimeoHash` or a full URL like `https://vimeo.com/ID/HASH`.
The video must allow embedding in Vimeo privacy settings.

## Z-index layer order
1. Vimeo iframe: z-index 1 (pointer-events: none)
2. Click-to-play layer: z-index 3
3. Big play button: z-index 5
4. Subtitles: z-index 6
5. Controls bar: z-index 8
6. Interaction overlays: z-index 10

## Candado de saltos externos (guardia) — reglas
La guardia del efecto de disparo devuelve a la primera pregunta pendiente cuando
un salto que NO pidió el reproductor la dejó atrás (±15 s de la pantalla de
bloqueo, auriculares, hilo trabado). Verificada en oct-2026 con simulador + CDP.
- 🔴 **La guardia no va sin la restauración optimista** (`currentTimeRef` +
  `setCurrent` al restaurar el avance). Con Vimeo no llega ningún timeupdate antes
  del primer play: sin el estado optimista, el primer tick trae prev=0 y la guardia
  arrastraba al alumno hacia atrás. Si se porta sola a master, llevar las dos.
- Va ANTES del bucle de disparo. Después, un salto que caía en la ventana de otra
  pendiente (o en los 8 s de un hotspot) mostraba ésa y perdía las anteriores.
- Muestra la tarjeta ella misma: con el video quieto no hay render siguiente.
- `tiempoAGuardar` nunca guarda más allá de una pendiente, y la restauración usa
  la misma función: un avance viejo pasado una pregunta se retoma en ella.

## Bunny Stream en el plugin (mod_ivplayer 1.3.0) — trampas
La actividad guarda sólo el GUID (columna `videourl`, minúsculas; el nombre quedó
genérico). Host, clave y duración son ajustes del sitio (`settings.php`), y
`player.php` firma en cada carga con las funciones `ivplayer_bunny_*` de `lib.php`.
- 🔴 **El repo es PÚBLICO.** Nada de host de producción, GUIDs reales, IDs de
  biblioteca, claves ni tokens en el código, los docs o los ejemplos: usar
  sintéticos (`11111111-2222-4333-8444-555555555555`, `vz-ejemplo.b-cdn.net`).
- 🔴 **La clave sólo vive en el servidor** (ajuste `bunnytokenkey`). Al navegador
  sale la URL firmada; la clave no va en `PLAYER_CONFIG`, ni en logs, ni en errores.
- 🔴 **El GUID tiene que quedar como tramo `/<guid>/` de `videoUrl`**: de ahí saca el
  reproductor la clave del avance en localStorage (regex de `vimeoData`). En la URL
  firmada el tramo `/bcdn_token=…/` va antes y `token_path` va codificado (`%2F`), así
  que el primer `/<guid>/` literal es el bueno y la clave no cambia al renovar el token.
- 🔴 **Si una actividad tiene Bunny y Vimeo, gana Bunny** (con host configurado). Sin
  host, todas siguen con Vimeo: así se instala sin cambiar nada y se vuelve atrás.
- 🔴 **HLS firmado en la RUTA, sueltos en la query.** Las variantes y los `.ts` del
  playlist son relativos: con el token en la ruta lo heredan; en la query se pierde
  y la variante da 403. La miniatura va en la query porque responde 200 con la
  autenticación de Bunny prendida o apagada.
- 🔴 **No hay estado que sirva para los dos lados**: firmado en la ruta con la
  autenticación de Bunny APAGADA da 404 (medido oct-2026); sin firmar con la
  autenticación PRENDIDA da 403. La clave en Moodle y el interruptor en Bunny van juntos.
- 🔴 **Validar el GUID antes de firmar, con barra final y sin `\n`.** El GUID arma la
  ruta firmada (`token_path=/<guid>/`): uno vacío firmaría `/` y abriría la biblioteca
  entera. Las expresiones llevan `/D` (sin ella `$` calza antes de un salto final) y
  la barra final evita que `/<guid>` cubra `/<guid>xyz/`.
- 🔴 **Algoritmo HS256, no confundir con el del iframe.** Mensaje del HMAC =
  `/<guid>/` + expires + `token_path=/<guid>/` (token_path crudo en el HMAC, codificado
  en la URL); clave como clave del HMAC; digest BINARIO a base64url. El token del
  iframe embebido (`SHA256_HEX(key+video_id+expires)`) es otra cosa y no sirve para el CDN.
- Las funciones puras (de `ivplayer_bunny_normalizar_guid` a `ivplayer_bunny_expires`,
  incluidas `ivplayer_bunny_analizar` y `ivplayer_bunny_error_de_entrada`) no tocan
  Moodle a propósito: se copian tal cual a un script de prueba con los vectores de
  Bunny. Si se cambian, regenerar esa copia y volver a correrla.
- Pendiente: el reproductor muestra siempre `thumbnail.jpg`; una miniatura
  personalizada de Bunny tiene otro nombre de archivo (`thumbnailFileName`) y no se ve.
- El vencimiento se lleva a la hora en punto siguiente (`ivplayer_bunny_expires`):
  las recargas de la misma hora dan la misma URL y reusan la caché del navegador.
  O sea que el token dura entre el TTL y el TTL + 1 h, no "el TTL".
- 🔴 **`player.html` viejo = Bunny roto en silencio.** Es copia de `dist/index.html` y
  sólo se actualiza con `npm run build:plugin`. `player.php` usa Bunny sólo si
  `ivplayer_reproductor_soporta_bunny()` encuentra `loadSource` (hls.js) en el HTML;
  si no, cae a Vimeo o muestra un cartel, y el estado de los ajustes lo avisa. Si el
  bundle se parte y el JS deja de ir adentro de `player.html`, esa marca desaparece y
  TODO vuelve a Vimeo: cambiarla en el mismo momento por una marca explícita.
- 🔴 **El GUID solo no dice de qué biblioteca es.** Se guarda sólo el GUID y se pide
  siempre al host del sitio, así que el formulario (`ivplayer_bunny_error_de_entrada`,
  pura) rechaza enlaces de otro host o de otra biblioteca (esta última sólo con el
  ajuste opcional `bunnylibraryid`), y Bunny-sin-Vimeo en un sitio sin host.
- 🔴 **Los errores de `mod_form` se pintan como HTML** (`{{{error}}}` en la plantilla
  de core): todo lo que venga de lo pegado por el docente va con `s()`.
- 🔴 **Password unmask NO saca la clave de la exportación de presets** del sitio: ésa
  saltea sólo la lista `adminpresets | sensiblesettings`. `db/upgradelib.php` le agrega
  `bunnytokenkey@@mod_ivplayer` en install y upgrade (mismo idioma que core en su paso
  2024080500). Sin la lista no la crea: una lista con sólo esa entrada dejaría
  exportables las claves de core.
- Los topes del TTL se validan al guardar (`set_validate_function` del ajuste de
  duración, existe desde 4.1 y recibe segundos). `ivplayer_bunny_ttl()` los vuelve a
  aplicar de red para valores cargados por CLI o `config.php`.
- Pendiente: el reproductor todavía no renueva el token (al vencer, se corta y hay
  que recargar); con Bunny no hay subtítulos (los de Vimeo venían de su iframe); el
  configurador visual sólo previsualiza Vimeo.

## Brand
- Colors: #0162F5 (primary), #14CCF7 (secondary), #84F4BE (accent), #062E60 (dark)
- Fonts: Changa (headings), Work Sans (body)
- Hub Education, Buenos Aires, Argentina

## Roadmap
- [ ] Visual editor for interactions (no JSON editing)
- [ ] SCORM/xAPI wrapper for Moodle grade reporting
- [ ] Support for YouTube/self-hosted MP4 alongside Vimeo
- [ ] Keyboard shortcuts (space, arrows, F)
- [ ] Touch gestures (double-tap to skip ±10s)
- [ ] Playback speed control
