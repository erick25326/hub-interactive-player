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

## Transmitir a la TV (Chromecast y AirPlay) — trampas
Sólo con video propio. AirPlay vive en `nativePlayer.js` (el `<video>` sigue siendo el
dueño: el candado no cambia). Chromecast vive en `src/cast.js`: mientras transmite,
`playerRef.current` es un `CastPlayer` con la API de `nativePlayer` y el `<video>`
espera en `localPlayerRef`, en pausa y sin bajar nada (`detenerCarga`). Probado sólo
con receptores SIMULADOS (oct-2026); el uso, los límites y lo que falta probar con
TVs reales están en el README.
- 🔴 **Sólo el motor ACTIVO le habla al componente** (`suscribirRef` + `activo()`).
  Al conectar, `playerRef` cambia ANTES de pausar el `<video>`: si no, su 'pause'
  ponía el botón en "Reproducir" con la TV andando. Al volver, `playerRef` vuelve al
  `<video>` ANTES de destruir el adaptador. Un manejador nuevo tiene que mirar `activo()`.
- 🔴 **La vuelta al celular es un salto PROPIO** (`marcarSaltoPropio` + `seekTo`) al
  segundo del adaptador. Sin eso, la guardia de saltos o debeFrenar leían el cambio
  de motor como un salto de afuera. El arranque en la TV usa `local.tiempo()` (el
  segundo real del `<video>`), no el último tick, que puede estar ~250 ms atrás.
- 🔴 `requestSession()` y `remote.prompt()` **dentro del toque y sin await antes**:
  los dos exigen activación de usuario. Vale también desde la fila de Ajustes.
- 🔴 **El SDK de Cast va como `<script>` clásico desde la URL de gstatic**
  (`cast_sender.js?loadCastFramework=1`), insertado con createElement. El cargador
  mira `document.currentScript.src`: inlineado por singlefile, como módulo o copiado
  al repo, no carga el framework. `__onGCastApiAvailable` se define antes.
- 🔴 **El SDK se baja sólo con una TV a la vista** (`cuandoHayaTV`: Presentation API,
  `cast:<appId>`, con el reproductor listo y en un rato libre; NO "al reproducir").
  Antes se bajaba en cada vista en Chrome. Si `getAvailability` rechaza, se baja igual.
- 🔴 **`HlsVideoSegmentFormat.MPEG2_TS`, no `.TS`** (no existe y el campo queda vacío
  sin avisar; Video.js 10 tiene ese error). `HlsSegmentFormat.TS` sí existe.
- 🔴 **`friendlyName` viene escapado como HTML**: `chrome.cast.unescape` antes de
  mostrarlo, o "Living &amp; Comedor".
- 🔴 **`endCurrentSession(true)`**: con false la TV se desconecta y SIGUE
  reproduciendo sin nadie que frene en las preguntas.
- 🔴 **Los comandos de media tardan 10 MINUTOS en fallar** (`chrome.cast.media.timeout`
  vale 0): cada uno lleva su propio tope en `cast.js`.
- 🔴 **El freno en la TV nunca antes de la pregunta** (como debeFrenar en local). La
  pausa sale un ida y vuelta antes, menos `MARGEN_FRENO`; el ida y vuelta es el
  MÍNIMO de las últimas medidas y sólo se mide con pausa y pedido de estado (con el
  LOAD, el simulador la inflaba y la TV frenaba 0,17 s antes). Pasarse se corrige
  (pausa anclada). Un `play()` con el ancla sin confirmar (`_reanudar`) espera el
  estado de esa pausa y recién ahí elige: salto al ancla con PLAYBACK_START si se pasó,
  o play. 🔴 No mandar el salto en el acto: el estado de la pausa que ya viene en
  camino cae a <1,5 s del destino y se toma como su aterrizaje (el reloj retrocedía).
  Si frenó ANTES, NO se la adelanta: queda ahí y se sigue informando el segundo pedido
  (`_fijo`) hasta el próximo play o salto.
- 🔴 **Nada que adelante el estimador**: reloj `performance.now()` (con `Date.now()`
  un ajuste de hora frenaba 2 s antes), y una velocidad MÁS ALTA no se aplica al
  estimador hasta que la TV la confirma (más baja, sí al instante).
- 🔴 **Un comando sin respuesta no se supone aceptado ni rechazado**: se pide el
  estado. Y el latido pide estado cada 5 s SIEMPRE que haya media: con un play cuya
  respuesta se perdió, la TV corría sin freno hasta el final.
- 🔴 **Salto propio pisado por el control remoto**: si la TV ya contestó el salto y
  su estado (quieta o reproduciendo) cae lejos del destino, se reenvía ya
  (`_saltoRespondido`, tope `INTENTOS_SALTO`). Esperar al reintento de 8 s dejaba la
  TV sin vigilancia.
- 🔴 **Un play de afuera se "rechaza" (vuelve a su segundo) sólo si la TV sigue
  reproduciéndolo**: el freno propio (`_prefrenar`) y los saltos propios limpian
  `_playExterno`; si no, el freno de la pregunta siguiente rebobinaba la TV.
- 🔴 **La pregunta del final**: `alTerminar` marca `evaluarEnFinRef` (como dismiss).
  La TV manda el último segundo y 'ended' juntos, el 0 del rebobinado llega en una
  microtarea y React los junta en un render: sin la marca, el efecto sólo veía el 0.
- 🔴 **El volumen de la TV no se toca**: el reproductor llama `setVolume` con cada
  play (para el silencio forzado del iframe) y la pondría al 100%. Sólo silencio, y
  el sonido vuelve sólo si lo silenciamos nosotros.
- 🔴 **En Chrome `video.remote` es CAST, no AirPlay**: AirPlay sólo si existe
  `window.WebKitPlaybackTargetAvailabilityEvent`. Y `prompt()` rechaza siempre sin
  un `watchAvailability` previo (WebKit arranca en "no disponible").
- 🔴 **hls.js + ManagedMediaSource apaga AirPlay** (`disableRemotePlayback`). No hay
  parche: un `<source>` HLS agregado después lo deshace `recoverMediaError`. En Apple
  el motor por defecto es el HLS nativo, que sí transmite.
- 🔴 **Calidad fija + AirPlay**: la TV recibiría esa variante sola, sin ABR. En
  iPhone/iPad se vuelve al master ANTES del selector (ahí `prompt()` no pide
  metadata); en la Mac, al conectar (ahí sí la pide).
- Con una pregunta abierta, un salto hecho desde la TV se deshace YA (efecto propio,
  sólo transmitiendo): en local la guardia lo corrige recién al responder.
- Hotspot con Chromecast: el `<video>` del celular (quieto) se lleva al cuadro de la
  TV, así los puntos caen sobre lo que marcan. Con AirPlay quedan sobre negro.
- La TV parada o con otro video cargado desde otro equipo: vuelve al celular EN
  PAUSA. Sesión cortada o error: como estaba. `pagehide` deja la TV en pausa.
- Sesión reanudada (recargar, otra lección): se adopta sólo si la TV tiene ESTE
  video (tramo `/<guid>/`); si no, no se toca y el botón la carga sin selector. Al
  conectar, `setPlaying(!ad.pausado())`: si no, tras recargar con la TV en pausa el
  botón quedaba en "Pausar" para siempre. Y `CastPlayer.pause()` en pausa emite igual.
- 🔴 **"Cancelar la conexión" en SESSION_STARTING**: `endCurrentSession` no hace nada
  hasta SESSION_STARTED. Se marca `cancelarCastRef` y se corta al llegar.
- 🔴 **El `<video>` del celular sigue vivo mientras transmite**: un play de afuera
  (notificación de Android, auricular) lo arrancaba detrás del cartel. Se lo pausa en
  el manejador de 'play' del motor inactivo, y Media Session play/pause va a la TV.
- El ícono del sonido refleja el silencio de la TV al conectar y el del `<video>` al
  volver. Si la TV ya estaba en silencio, quitarlo con el botón cuenta como propio.
- A ≤372 px con el botón de girar (`.con-girar`) el de la TV va a Ajustes: entre 341
  y ~365 recortaba el de salir de pantalla completa.
- AirPlay en iPhone: si se cierra el selector sin elegir, vuelve la calidad fijada.
- Pendiente de producto: las etiquetas se dibujan sobre el cartel de la TV.
- El arnés con el receptor simulado (`cast-simulado.js`, `airplay-simulado.js`) NO
  está en el repo: vive en el scratchpad de la sesión que lo armó.

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
