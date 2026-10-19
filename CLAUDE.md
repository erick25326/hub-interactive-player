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
- `src/configuracion.js` — `DEFAULT_CONFIG`, `getConfig()` y `hayVideo()`. 🔴 La config por
  defecto NO trae video ni interacciones (plan Bunny 0.3): hasta la 1.4.0 traía una clase
  real del campus y viaja en player.html, el configurador y cada SCORM (repo público).
  Sin video, `SinVideo` muestra "No hay video para mostrar" (no corre ningún efecto del
  reproductor). Para probar con un video, `window.PLAYER_CONFIG`; nunca acá.
- `src/respaldo.js` — la red de seguridad (Vimeo si el CDN de Bunny falla): cuándo salta
  (puro) y el aviso a `respaldo.php`. Ver "Red de seguridad".
- `src/sondeo.js` — HLS nativo: antes del error, le pregunta al CDN qué pasó (el
  `<video>` no da el código HTTP). Ver "Red de seguridad".
- `src/avisos.js` / `src/glosario.js` — los avisos de lo que frena (tic-tac, cuenta,
  preferencias del alumno, el silencio del video) y el glosario de las etiquetas (también
  cuándo el panel pausa y retoma el video), puros; `src/sonidos.js`, los
  sonidos (Web Audio) y la vibración. Ver "Glosario interactivo y avisos".
- `src/finVideo.js` — la tarjeta de fin del video, lo puro: leer la barra del tema en la
  página de arriba, qué destino se acepta, "Lección completada" o "Terminaste el video" y
  los textos. Ver "Tarjeta de fin del video".
- `src/styles.css` — All styles with `.iv-` prefix namespace
- `src/main.jsx` — React entry point
- `vite.config.js` — Build config with singlefile plugin
- `index.html` — HTML shell

## Interaction types
1. **note** — Info popup, dismiss to continue
2. **multiple-choice** — 4 options, feedback, explanation
3. **true-false** — Binary choice with feedback
4. **hotspot** — Clickable points overlaid on video, must view all to continue
5. **label** — Does not stop the video. By default (1.4.0, `etiquetas: 'glosario'`) it joins the interactive glossary when its time comes; with `etiquetas: 'pantalla'` it is a pin over the video whose click opens a popup with the definition (as before). See "Glosario interactivo y avisos".

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
  Moodle a propósito: tests/php/correr.php las LEE de lib.php al correr y las prueba
  con los vectores oficiales de Bunny (en CI, donde hay PHP); localmente las cubre el
  espejo en Node, atado por huella al código de lib.php (ver "Pruebas").
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
- El configurador visual no reproduce Bunny: marca los tiempos sobre el ARCHIVO de la
  compu (ver "Configurador con un video de la compu"). (La renovación del token ya
  está: ver la sección siguiente. Los subtítulos con Bunny salen de "Editar
  transcripción": ver "Subtítulos de la lección".)

## Configurador con un video de la compu (oct-2026) — trampas
"Abrir video de tu computadora" (`configurator/index.html`): `<video>` con una URL
`blob:` del archivo, nada sale de la PC. El resto del configurador le habla al video
sólo por la interfaz de "REPRODUCTOR DE LA VISTA PREVIA" (`crearReproductorVimeo` /
`crearReproductorLocal`). Uso, en el README ("Marcar los tiempos de un video de Bunny").
- 🔴 **En modo local el JSON sale con `vimeoId` vacío, y eso es lo que protege el campo
  de Vimeo de la actividad**: el manejador de `mod_form.php` lo escribe sólo si viene con
  algo. Nada de un ID de relleno. Por la misma razón `vimeoDe()` descarta al importar y
  al exportar todo lo que no sea un ID de Vimeo (dígitos): el "PENDIENTE" de los JSON
  viejos de la skill terminaba en el campo de Vimeo de la actividad.
- 🔴 **El `videoUrl` de un JSON importado (la skill `interacciones-video`) NUNCA es
  fuente**: va sólo a `exportJSON` (y sólo sin `vimeoId`: la skill rechaza los dos). Ni
  `buildConfig` (Moodle, SCORM) ni la vista previa lo reciben; la vista previa con el
  reproductor recibe la URL `blob:` por `generatePreviewConfig` (la ventana es del mismo
  origen: `window.open('')` + `document.write`).
- 🔴 **`mod_form.php` repite su mensaje cada 500 ms durante 10 s**: el configurador toma
  sólo el primero. Sin eso, cada repetición recargaba Vimeo y pisaba lo elegido en esos
  segundos (el archivo, un JSON importado, las interacciones).
- `destroy()` del local corta la lectura (`removeAttribute('src')` + `load()`) antes de
  `revokeObjectURL`, y borra `iv_progress_<blob:…>` (la clave del avance de la vista
  previa con esa URL, que no vuelve a existir).
- Un archivo que el navegador no puede leer (pasa el filtro por el tipo, como un `.mp4`
  roto, y falla al cargar) **no queda como el video abierto**: `usarReproductor` lo
  libera y deja `reproductor = null`. Si quedaba, el JSON salía sin `vimeoId`, la vista
  previa abría una URL muerta y el cartel decía "Reproduciendo…".
- Con Vimeo, `setCurrentTime` antes del primer play no resolvió nunca (SDK real en
  Chrome headless, oct-2026): el salto queda hecho y `getCurrentTime` lo da, pero no
  llega `seeked`, así que el "(m:ss)" del botón no se mueve hasta el play. Por eso
  "Ir a este tiempo" no encadena nada después de esa promesa.
- `scripts/armar-configurador.mjs` arma el configurador publicado (lo usan
  `build-configurator.js` y el servidor de pruebas en `/configurador.html`): se prueba
  lo mismo que se publica. La prueba (`escenarios/configurador.mjs`) necesita ffmpeg;
  bloquea el SDK de Vimeo, JSZip y las fuentes, y corre el `<script>` REAL de
  `mod_form.php` (leído del archivo) en un iframe para el ida y vuelta con Moodle. Las
  herramientas que comparte con la de Bunny están en `tests/navegador/apoyo/configurador.mjs`.

## Configurador con el video de Bunny de la actividad (1.4.0) — trampas
"Editar interacciones" firma en el servidor un enlace de vida corta al playlist
(`ivplayer_bunny_configurador`, `lib.php`; TTL `IVPLAYER_BUNNY_TTL_CONFIGURADOR` = 2 h,
que con el redondeo de `ivplayer_bunny_expires` dura de 2 a 3 h) y lo manda en `bunny`
del mensaje, aparte de `config`. El configurador lo reproduce con `crearReproductorHls`
(tipo `'hls'`, misma interfaz que Vimeo y el local). Uso, en el README.
- 🔴 **El enlace nunca va a `config` ni a un campo.** `mod_form.php` lo deja en un
  `<script type="application/json" id="ivplayer-video-firmado">` (el elemento `html` del
  editor, ANTES del script) que el script lee y SACA de la página al cargar. Va en
  `mensaje.bunny`, no en `config`, porque lo que vuelve de "Guardar en Moodle" es config.
  En el configurador vive sólo en `fuenteBunny`: `buildConfig`/`exportJSON` no lo miran
  (lo vigila `tests/unit/configurador.test.mjs`) y sólo la vista previa (misma pestaña)
  lo recibe por `generatePreviewConfig`. Un `videoUrl` firmado en un JSON importado se
  descarta.
- 🔴 **Sólo para quien edita y sólo el GUID GUARDADO** (`$this->current->videourl`, con
  `has_capability('moodle/course:manageactivities')` antes de firmar; `lib-php.test.mjs`
  mira el orden). El script no lo manda si el campo de Bunny ya no contiene ese GUID
  (se cambió o vació sin guardar) y manda `{ vencido: true }` con menos de 5 min,
  medido con el reloj del SERVIDOR (`ahora` del bloque → `desfase`), no el de la compu.
- **Si hay Bunny, es Bunny** (`fuenteSinVimeo()`): con el HLS abierto, o con Bunny que no
  cargó (vencido, 403), el JSON sale sin `vimeoId` (no se toca el campo de Vimeo) e
  importar un JSON no carga Vimeo. Con "Cargar video" de Vimeo a mano, sí lo lleva. Un
  archivo de la compu ya abierto no se saca al llegar el mensaje; "Video de la actividad
  (Bunny)" (`volverBunnyBtn`) vuelve al de Bunny.
- La regla de "¿usa Bunny?" es la de la lección (`ivplayer_bunny_configurador` llama a
  `ivplayer_bunny_video`): con un player.html sin hls.js, la lección va por Vimeo y el
  configurador también. No duplicar esa regla.
- **hls.js va adentro del configurador**, en el `<head>` (`scriptHls` en
  armar-configurador): el HTML armado pesa MB y el mensaje de Moodle puede llegar antes
  de que el parser llegue al final del `<body>`. Completo, no light (el de Bunny se oía
  mudo en Android con light). hls.js primero, nativo si no (`motorHls`), igual que el
  reproductor. Configurador sin armar: sólo nativo.
- Un 401/403 del CDN es `'firma'` (venció o no es de este video); el resto, `'red'`.
  Antes de cargar falla `ready()`; después, avisa por `on('error')`. En los dos casos
  `soltarReproductorCaido` lo libera (no queda como "el video abierto").
- La prueba (`escenarios/configurador-bunny.mjs`) sirve un HLS de ffmpeg desde
  `apoyo/cdn-bunny.mjs`: OTRO origen, CORS abierto (también en el 403) y token validado
  con el HMAC real del espejo (`tests/unit/apoyo/bunny-espejo.mjs`), con las URLs de la
  forma exacta de `lib.php`. Si se restringen los "Allowed domains" en Bunny, sumar
  `erick25326.github.io`.
- 🔴 **`mod_form.php` acepta lo que vuelve sólo de la ventana que abrió**
  (`esElConfigurador(e.source)`: la que devolvió `window.open`, o una cuyo `opener` es
  esta página, que cubre la recarga del formulario con el configurador abierto). El
  origen solo no alcanza: `erick25326.github.io` es el de TODAS las páginas de GitHub
  Pages de la cuenta. Las pruebas que le mandan un mensaje armado tienen que hacer clic
  en "Editar interacciones" con un `window.open` que devuelva una ventana DE VERDAD y
  mandarlo con esa `source` (un objeto común no sirve de `source` de un MessageEvent).
- 🔴 **El tipo de una interacción es HTML si nadie lo filtra.** Iba crudo al `innerHTML`
  de la vista previa de `mod_form.php` (ahora `escapeHtml`) y a la clase y la etiqueta de
  la barra lateral del configurador: `loadConfig` deja entrar sólo los cinco tipos
  (`esTipoDeInteraccion`) y el tiempo y la duración como números (`numeroAttr`, también
  x/y en el editor); el id de una opción se escapa. Encontrado en la revisión de seguridad
  de la 1.4.0 (venía de antes). Un campo nuevo que se interpole en un template, escapado.
- 🔴 **El configurador acepta el mensaje de `academy.`, `test-academy.` y localhost**
  (`isAllowedMoodleOrigin`). Pero es UNO para los dos sitios y GitHub Pages lo publica sólo
  con un push a master: en test-academy, el configurador nuevo se prueba recién después
  del pase a master. Formulario viejo + configurador nuevo y al revés son compatibles.

## Renovación de la firma de Bunny (firma.php + src/firma.js, oct-2026) — trampas
Con la lección abierta, el reproductor pide una firma nueva 10 min antes del
vencimiento (`margenes()`: con firmas cortas, la mitad) y los motores la usan sin
cortar: hls.js reescribe cada pedido (`xhrSetup`), el HLS nativo cambia de fuente en el
mismo segundo (el cambio de calidad, `_cambiarFuente(…, { renovacion })`) y la TV de
Chromecast recibe otro LOAD en el mismo segundo (`CastPlayer._quizasRecargar`). Uso y
textos del cartel, en el README ("Qué pasa cuando vence el token").
- 🔴 **Una sola regla de "¿usa Bunny?"**: `ivplayer_bunny_video` (pura, la prueban
  correr.php y el espejo) y su envoltorio `ivplayer_bunny_de_actividad`, que usan
  `player.php` y `firma.php`. No volver a escribir las condiciones en uno de los dos.
- 🔴 **"Reintentar" con motivo `sesion` recarga `window.top`, no el iframe**
  (`recargarParaReintentar` en firma.js; plan Bunny 0.3). Recargar sólo el iframe ponía
  el ingreso de Moodle adentro del video: hub-app detecta el login sólo en la navegación
  principal (no hace su ingreso automático) y Google no se deja mostrar en un iframe.
  Si `top` es de otro origen (demo, SCORM: leer su `document` tira) o el motivo es otro,
  el iframe como siempre. Pruebas: firma.test.mjs (la decisión) y
  `escenarios/reintentar.mjs` (marco.html del mismo origen; otro puerto con
  `crearMarcoAjeno`, que se maneja por CDP en un mundo aislado del iframe).
- 🔴 **El reloj NO compara `Date.now()` con el expires**: se mide desde la hora del
  servidor al firmar (`firmaAhora` en MOODLE_CONTEXT, `ahora` en la respuesta) más lo
  que pasó en el equipo, con el MAYOR de los dos relojes (monotónico y de pared): el
  monotónico no cuenta la suspensión en algunos sistemas; el de pared puede saltar.
- 🔴 **Lo urgente se mide con la firma de la FUENTE**, no con la vigente:
  `restanteDe(expires)`. Recién renovada, la vigente tiene 6 h y la que tiene cargada
  el <video> (o la TV) vence en 10 min.
- 🔴 **hls.js abre el XHR después de `xhrSetup`** (si `xhrSetup` no lo abrió) y espera
  su promesa: se reabre con la URL nueva ahí, y un pedido con la firma por vencer (o con
  una renovación en camino) espera la nueva. Las URLs de variantes y `.ts` las resuelve
  hls.js contra `responseURL`, que ya es la reescrita.
- 🔴 **El 403 se reintenta UNA vez con firma nueva** (`shouldRetry` de
  manifest/playlist/frag, `_reintentoPorFirma`). Sin eso hls.js igual salía, pero tras
  cuatro 403 y bajando de calidad (otra variante para escapar del error): medido con
  una mutación. Un pedido que salió con una firma ANTERIOR se reintenta sin pedir otra
  (`_usadas`); uno que ya forzó una renovación y vuelve a dar 403, al cartel.
- 🔴 **…pero sólo si el 403 se puede explicar por el VENCIMIENTO**
  (`cercaDeVencer(usada)`: a la firma con que salió le quedaba menos que el margen de
  renovación). Si le quedaba más, es otra cosa (una calidad rota, una regla del CDN) y
  decide hls.js como siempre: pasa a otra calidad y sigue. Antes se forzaba igual, y
  como dentro de la misma hora firma.php devuelve LA MISMA firma, salía el cartel "El
  acceso al video venció" con las otras calidades andando (medido, oct-2026).
- 🔴 **Después de un 403 se insiste sin red** (`renovarYa`, no `renovar`): reintentos a
  1, 2 y 4 s (enseguida si vuelve la red o la pestaña) hasta ~15 s, y recién ahí el
  cartel. Al desbloquear el celular la red tarda un par de segundos en volver y el
  alumno ya tocó play: con un solo pedido fallido salía "Revisá tu conexión". Mientras
  dura, `renovando()` da true y `renovar()` devuelve esa misma promesa.
- 🔴 **Los eventos de vuelta (pestaña visible, `pageshow`, `online`, `focus`) piden
  aunque el último pedido haya fallado hace un instante**: el enfriamiento de 5 s es
  contra la tormenta de pedidos de segmentos, no contra un evento suelto, y es justo
  cuando vuelve la red. Y el enfriamiento se mide con los DOS relojes (como
  `crearReloj`): con sólo el monotónico, un fallo de antes de bloquear la pantalla
  seguía "reciente" horas después.
- 🔴 **Con el HLS nativo un 403 llega como 'error' del <video>** (Chrome; sin código):
  `_rescatarFirma` renueva y recarga en el mismo segundo una vez por firma. En Safari
  puede ser una traba sin 'error': por eso también mira 'waiting' con la fuente vencida
  (`_revisarFirmaAlTrabarse`; ese camino no lo ejercita Chrome).
- 🔴 **Durante el rescate el <video> no se toca** (`_rescate`, como `_cambio` en un
  cambio de fuente): play, pausa y saltos del componente se anotan ahí (`seguia`, `t`) y
  los aplica la recarga; los eventos del <video> no salen (Chrome lo pausa justo
  después del 'error'). Antes iban al <video> en error: el play se rechazaba y la
  ruedita se apagaba sin reproducir, un −10 se deshacía solo al terminar y no se podía
  pausar. `data-rescate="1"` en el <video> lo marca para las pruebas. Una calidad
  elegida con la firma ya vencida se vuelve a pedir al terminar el rescate (antes
  quedaba en Automática sin avisar).
- 🔴 **`reescribir()` sólo toca URLs del MISMO host y del MISMO `token_path`**
  (`mismoVideo`). Sin `token_path` ya no vale de comodín: el token vigente no se le pega
  a una URL de otro servidor que pase por hls.js, el cambio de fuente o la TV.
- El cambio de fuente por renovación es "tranquilo": en pausa sin pregunta abierta y
  sin salto en vuelo (`momento()` del componente: `pregunta`, `saltando`), o dentro
  del toque de play (iOS rechaza el play fuera del gesto después de cambiar la fuente),
  o a 90 s del vencimiento aunque esté reproduciendo. En pausa no muestra la ruedita.
  Un play que llega con un cambio en pausa en curso avisa 'play' y la ruedita ya.
- Transmitiendo con Chromecast el <video> local no estrena firmas (`_enEspera`, desde
  `detenerCarga`): bajaría video que nadie mira. Lo hace el primer play a la vuelta.
- Fallos: 'sesion' (401 o el JSON de login/sesskey de Moodle) no se reintenta solo;
  'red' (sin respuesta, 5xx) se reintenta cada vez más espaciado, hasta 1 por minuto,
  también vencida. Los no forzados no vuelven a pedir por 5 s después de un fallo.
- `firma.php` es `AJAX_SCRIPT` y atrapa ella misma la excepción de `require_login`:
  siempre JSON, nunca la página del login. `require_login_exception` también sale por
  un curso oculto: sólo es 'sesion' si `!isloggedin() || isguestuser()`. Todavía no se
  corrió en un Moodle (no hay PHP en esta PC): probarla en el campus antes de publicar.
- 🔴 **`firma.php` NO mantiene viva la sesión del campus** (`NO_SESSION_UPDATE`). El
  reproductor la llama por reloj, haya alguien mirando o no: si contara como actividad,
  una lección en pausa en una PC compartida dejaba la sesión ENTERA abierta por días
  (cada ~6 h, siempre por debajo de las 8 h de `sessiontimeout`). El que mira el video la
  mantiene igual con progress.php. 🔴 Con `NO_SESSION_UPDATE` Moodle NO cierra una
  sesión vencida en ese pedido (`initialise_user_session` sale antes de destruirla): por
  eso firma.php mira a mano `\core\session\manager::time_remaining()` y contesta
  'sesion'. Y `require_login($course, false, …)`: sin entrar como invitado sola (un
  pedido de fondo no tiene que cambiar quién es la sesión del navegador).
- 🔴 **`php -l` de cada .php del plugin** corre en correr.php (`npm test` con PHP) y en
  los dos workflows: player.php y firma.php necesitan Moodle y ninguna otra prueba los
  ejecuta. `build-plugin.yml` publica la release sin esperar a "Pruebas"; antes de
  mergear una rama, correr Pruebas a mano (Actions → Pruebas → Run workflow) o abrir PR.
- 🔴 **La pestaña dormida no se prueba congelándola por CDP**
  (`Page.setWebLifecycleState`): en Chrome headless el <video> (hls.js y nativo) queda
  "reproduciendo" sin avanzar al descongelar, y la pestaña ya no carga video después
  (medido oct-2026, también sin firma). Lo cubren las unitarias del Renovador
  (visibilitychange/pageshow) y la prueba de la renovación "lenta".
- Mutantes equivalentes conocidos: el camino de 'waiting' del nativo (Chrome tira
  'error'), y `pregunta` de `momento()` (es una preferencia, no una garantía: la
  renovación con una pregunta abierta también es invisible para el candado).

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
- 🔴 **En ANDROID el SDK se baja siempre** (con el reproductor listo, en un rato
  libre). Probado con una TV real (oct-2026): `getAvailability()` con "cast:<id>"
  pelado decía "sin TV" para siempre aunque la TV estuviera, y el botón no aparecía.
  En la compu sigue la consulta (`cuandoHayaTV`) y, si no hay TV a la vista, el SDK
  se baja recién al tocar el botón.
- 🔴 **El botón "Transmitir a la TV" está SIEMPRE con video propio** (pedido de
  Erick): al tocarlo abre el selector del sistema o explica por qué no ("No
  encontramos una TV…", "abrí la lección en Chrome/Safari"). AirPlay escucha las DOS
  fuentes de disponibilidad (watchAvailability puede no andar en iOS) y, si sólo
  avisó el evento webkit, usa `webkitShowPlaybackTargetPicker`.
- 🔴 **Al conectar, la TV arranca REPRODUCIENDO** (como YouTube), salvo pregunta
  abierta o video terminado. Con el celular en pausa quedaba quieta y había que tocar
  de nuevo.
- 🔴 **Un fallo de conexión se confirma 3,5 s después** mirando `getCastState()`:
  en Android `requestSession` puede rechazar (session_error) mientras la TV abre la
  app y la conexión termina bien. Avisar al instante mostraba "No se pudo conectar"
  con la TV cargando. El origen del error queda en `window.__ivCastDiag` (?diag=1).
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
  La TV manda el último segundo y 'ended' juntos y React los junta en un render: hasta la
  tarjeta de fin, el 0 del rebobinado caía en ese mismo render y el efecto sólo veía el 0.
  Ya no se rebobina (ver "Tarjeta de fin del video"), pero la marca sigue: la pasada
  contra el fin es la que encuentra la pregunta que el FINISHED le ganó al freno.
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
- Las etiquetas se dibujaban sobre el cartel de la TV: con el glosario (1.4.0, por defecto) ya no; en el modo "pantalla", sí (como antes).
- El receptor simulado (`tv-simulada.js` + los emisores `cast-simulado.js` y
  `puente-app-simulado.js`, y `airplay-simulado.js`) está en tests/navegador/simulados/ y
  lo usan las pruebas de tests/navegador/escenarios/tv.mjs y tv-app.mjs.

## Modo app (ivcast, 1.4.0) — trampas
Adentro de hub-app (WebView de React Native) no hay Cast Web SDK: la app transmite con
el Cast NATIVO y le habla al reproductor por el protocolo `ivcast` v1. El diseño y el
contrato completo (mensajes, reglas a-m, secuencias) están FUERA del repo, en
`castear-hub-app-v2.md` §3 y en el pedido a hub-app §5; si difieren, manda el diseño.
**El shim es el simulado con la TV reemplazada por mensajes**: `src/castNativo.js` imita
la misma superficie del Web SDK que `cast-simulado.js`, y `CastPlayer` no cambia.
- `src/puenteApp.js`: `ReactNativeWebView` en la página (Android: en todos los marcos) o
  en `window.top` del mismo origen (iOS). La prueba de que hay app es el `hola-ok` en 3 s,
  no el objeto. `__ivcastRecibir` se registra en `window.top` (ahí inyecta la app).
  Comandos con id `<instancia>-<n>` y tope; respuestas de otra instancia, descartadas.
- 🔴 **En modo app NUNCA se inserta el script de gstatic** (cargarCast). Si el saludo
  falla, se olvida la carga: el próximo toque vuelve a saludar. El motivo (`sin-respuesta`,
  `version`, `sin-cast`) elige el texto del aviso (`infoApp()`).
- 🔴 **Un `media` idéntico al anterior se descarta SIN llamar a los oyentes**:
  `CastPlayer._actualizar` le pone la hora de llegada a cada estado y uno repetido atrasa
  el estimador del freno. `__ivCastDiag.puenteRepetidos` los cuenta.
- 🔴 **msid nuevo = otro objeto Media**; el anterior queda IDLE/INTERRUPTED SIN avisar a
  sus oyentes (CastPlayer decide con MEDIA_SESSION si es su video o se lo cambiaron). Uno
  más viejo que el actual se ignora. La renovación de la firma es un `cargar` más.
- El msid del `latido` sale del Media que tiene oyentes (sólo CastPlayer agrega): así no
  hubo que tocar CastPlayer. Sin oyentes (cargando, otra lección, sin CastPlayer), `null`.
- `requestSession` se cumple cuando la app MUESTRA el selector; la conexión llega por
  `sesion`. `detalle:'red_local'` se rechaza como `'cancel'` (la app ya avisó).
- La sesión del `hola-ok` se crea ANTES de que `cargarCast` resuelva: observarCast la
  informa como SESSION_RESUMED y `conectarCast` la adopta si es este video.
- 🔴 **"Actualizá la app" sólo con la casilla `appcastpublicada` prendida**
  (`MOODLE_CONTEXT.appCastPublicada`; pura en `ivplayer_app_cast_publicada`), salvo
  `error{version}`. El reproductor decide por `capacidades`, nunca por la versión de la app.
- 🔴 **iPhone: AirPlay sólo si la app declara `'airplay'`.** `airplayPosible()` da true en
  cualquier WKWebView: un iPhone con Chromecast y sin Apple TV no llegaba nunca a Chromecast.
  Sin TV de AirPlay: directo a Chromecast; con las dos: el selector (`menu==='destinoTV'`).
  Con el saludo de la carga sin contestar (`infoApp().capacidades` null) el toque NO va a
  Chromecast a ciegas: `tocarCast(true)` re-saluda y, si la app declara `'airplay'` y hay TV
  de AirPlay, abre el selector (el prompt de AirPlay ya no se puede abrir: pasó el gesto).
- Pruebas: `marco.html?app=fake&webview=1` (la app y la TV arriba, como view.php; el
  reproductor en el iframe sin Cast Web SDK ni Presentation API y con UA MoodleMobile).
  `app=mudo` (nadie contesta), `cast=0`, `holaLento`, `latPuente`, `duplicados=1`,
  `plataforma=ios` (+`airplayApp=0`), `appCastPublicada=1`. Ver puente-app-simulado.js.

## Subtítulos en la TV (1.4.0, Chromecast y modo app) — trampas
La TV baja el VTT ella sola, sin la cookie del campus: `mod/ivplayer/subtitulos.php`
(`id`, `e`, `s` = base64url HMAC-SHA256 de `"cmid|e"` con el ajuste `subtitulossecreto`).
`player.php` pone `subtitlesUrlTv` en `PLAYER_CONFIG` y `firma.php` devuelve `subtitulosTv`
con cada renovación. `CastPlayer` manda la pista en el LOAD y la prende/apaga con
EDIT_TRACKS_INFO. Uso, decisiones y pendientes: README ("Subtítulos en la TV"). El
contrato con hub-app (capacidad `'subtitulos'`, campos de `cargar` y `media`, comando
`pistas`) está FUERA del repo: `C:\dev\ivcast-adenda-pistas.md`, para sumar al pedido.
- 🔴 **subtitulos.php: `NO_MOODLE_COOKIES` y la firma ANTES de la base** (`hash_equals`,
  vigente y no más allá de `ivplayer_subtitulos_tv_tope`: duración del token + 1 h del
  redondeo + 5 min). No pide sesión ni mira la visibilidad del curso (decisión escrita en el
  archivo y en el README). 403 sin detalle; CORS abierto; `Cache-Control: private, max-age=300`.
- 🔴 **El vencimiento del enlace es el de la firma del video** (`$bunny['expires']`, o
  `ivplayer_bunny_expires` con Bunny sin firmar). Por eso el tope sale de la misma cuenta:
  un enlace legítimo pasa siempre (lo prueba correr.php con TTL mínimo, por defecto y máximo).
- 🔴 **El secreto no es un ajuste del panel**: lo crean `install.php` y el paso 2026101904
  (`mod_ivplayer_crear_secreto_subtitulos`, upgradelib) y no se pisa. `settings.php` sólo
  dice si está. Sin él no hay `subtitlesUrlTv` y el celular sigue dibujando (nunca "sin
  subtítulos en ningún lado").
- 🔴 **`ivplayer_subtitulos_cues` es `parseVTT` + `textoDeCue` en PHP**: la TV muestra los
  mismos cues que el celular. Si se toca uno, tocar el otro; `tests/php/vectores-subtitulos.json`
  los ata (correr.php y `tests/unit/subtitulos-tv.test.mjs`). El trim de JS saca los
  espacios de Unicode: en PHP, la clase `[\s\p{Zs}\x{FEFF}\x{2028}\x{2029}]`. Salida WebVTT
  estricta (HH:MM:SS.mmm, `&<>` escapados, sin renglones vacíos adentro de un cue).
- 🔴 **El celular NO dibuja los subtítulos con la pista en la TV** (`tv.subtitulos`, de
  `ad.subtitulosEnTV()`: enlace + SDK con pistas). Sin pista en la TV (SCORM, demo, sin
  secreto, app sin `'subtitulos'`, AirPlay) los dibuja como antes.
- 🔴 **La pista va en el LOAD aunque estén apagados** (`activeTrackIds: []`): prenderlos
  es un EDIT_TRACKS_INFO, no un LOAD. Un toque durante la carga lo corrige `_actualizar` al
  terminar (`k.subs`). Cada recarga (renovación, el video terminado) lleva el estado vigente
  y el enlace de la última renovación (`Renovador.subtitulosTv()`; una respuesta sin enlace
  no borra el que había).
- **Adoptar:** `pistasDe(m)` lee `activeTrackIds` (el botón toma lo de la TV,
  `onSubtitulos`) y si la media tiene la pista (`media.tracks` en el SDK de Google; la app
  no las informa: `null`, no se sabe). Sin la pista: prenderlos recarga con ella
  (`_recargarPorPista` en `_quizasRecargar`, en el acto). No sabiendo: EDIT_TRACKS_INFO y,
  si la TV lo rechaza, lo mismo. Los cambios hechos desde otro emisor después de adoptar
  NO se reflejan en el botón (manda el celular).
- 🔴 **castNativo: sin `'subtitulos'` en las capacidades no existen `Track`,
  `TextTrackStyle` ni `EditTracksInfoRequest`** (`pistasPosibles` da false) y el `cargar` es
  el de v1, sin claves nuevas: una app que no conoce las pistas las tiraría y los
  subtítulos no se verían en ningún lado. `activeTrackIds` entra en `claveMedia` (prender en
  pausa cambia sólo eso y no es un repetido) y un `media` sin el campo conserva el último.
- Simulados: la TV guarda las pistas, rechaza un id que no tiene (como el receptor) y BAJA
  el VTT de la prendida (`__tv.bajadas`); el servidor de pruebas tiene un `/subtitulos` que
  sólo sirve enlaces emitidos y vigentes, y `/firma` con `subs=1` trae `subtitulosTv`. La
  app simulada declara `'subtitulos'` (salvo `sinSubtitulos=1`) y descarta pistas de otro
  origen. `reanudarSubs=1`: la sesión que ya estaba trae la pista prendida. `subsTv=0`: sin
  enlace. Escenario: `escenarios/tv-subtitulos.mjs`; la renovación, en `firma.mjs`.
- Mutantes verificados (oct-2026): sin el enlace de la renovación, sin el "no dibujar" del
  celular, sin la corrección del toque durante la carga y sin `activeTrackIds` en
  `claveMedia`, cada uno lo agarra una prueba.

## Red de seguridad: Vimeo si Bunny falla (1.4.0, plan Bunny 0.4) — trampas
Con el ajuste del sitio `respaldovimeo` prendido (APAGADO por defecto) y la actividad con
ID de Vimeo, una falla del CDN de Bunny recarga la lección con Vimeo y retoma del avance.
Uso, cómo probarla y cómo contar los saltos: README ("Red de seguridad").
- 🔴 **NO cambia de motor en caliente**: guarda el avance, avisa a `respaldo.php` y recarga
  el iframe con `player.php?…&origen=vimeo`. El componente no sabe cambiar de motor (el
  efecto que crea el reproductor sale si ya hay uno) y el motor propio está atado a la
  firma, a la TV y al candado.
- 🔴 **Sólo fallas del CDN** (`causaDelRespaldo`, `src/respaldo.js`): 404, 5xx, red y
  medio, DESPUÉS de los reintentos del reproductor. **Nunca** 401/403/410 (la firma: la
  renueva firma.js), nunca con renovación 'sesion' u 'otro', nunca transmitiendo (`tvRef`
  o `playerRef.current.esTV`). La misma lista del lado del servidor
  (`ivplayer_respaldo_datos`): un reproductor viejo o tocado tampoco salta por la firma.
  El tipo de error 'otro' de hls.js (MUX, KEY_SYSTEM, OTHER) tampoco salta desde la
  revisión de la 1.4.0: no está en la lista del plan (red, 5xx, 404, medio).
- 🔴 **El HLS nativo le pregunta al CDN antes de dar el error** (`_fallarMedio` en
  nativePlayer → `src/sondeo.js`): el `<video>` no da el código HTTP y todo salía
  'medio' sin código, así que en iPhone la red saltaba con un 403 (con hls.js no) y el
  registro no separaba Bunny de la señal. Pide la fuente actual, la PRIMERA variante y su
  PRIMER segmento (sólo encabezados) y arma el error como hls.js (4xx → 'acceso', 5xx y
  sin respuesta → 'red', todo 200 → 'medio'; detalle `nativo-playlist|variante|segmento|medio`).
  Mientras pregunta (`_sondeando`, tope 8 s) no se cambia de fuente ni se vuelve a
  rescatar. Una variante o un segmento rotos que no sean los primeros siguen dando 'medio'.
  Lo prueban `sondeo.test.mjs` y las dos de "HLS nativo" de `escenarios/respaldo.mjs`.
- 🔴 **respaldo.php confirma ANTES de recargar**: con la sesión cerrada contesta 401 y el
  reproductor NO salta (cartel de la sesión: Reintentar recarga `window.top`). Saltar sin
  sesión era ver Vimeo sin guardar nada, y player.php sin sesión pone el login de Moodle
  adentro del iframe. Sin conexión con el campus tampoco salta (la señal del alumno; la
  recarga mostraría el error del navegador en el iframe). Sin `NO_SESSION_UPDATE` a
  propósito: así Moodle cierra en ese pedido una sesión vencida.
- 🔴 **El avance se guarda sólo con `avanceListo`** (se prende en el mismo render que lo
  restaurado). Un 404 del playlist llega ANTES de `ready`, con el tiempo en 0 y sin
  respondidas: guardar eso pisaba el avance del servidor (progress.php reemplaza la fila).
  Sin guardar, la carga con Vimeo retoma del `savedProgress` que ya estaba. Lo vigila
  `escenarios/respaldo.mjs` (verificado con la mutación).
- 🔴 **Una sola regla para player.php y respaldo.php** (`ivplayer_respaldo_vimeo`): ajuste
  '1' + ID de Vimeo. player.php la usa para respetar `origen=vimeo`
  (`ivplayer_respaldo_forzar`) y para ofrecer `respaldoUrl` en MOODLE_CONTEXT sólo en una
  carga de Bunny. Sin `respaldoUrl` el reproductor nunca salta. La carga forzada es de
  Vimeo, así que no puede volver a saltar: el tope es una vez por carga de view.php
  (además `yaEsRespaldo` mira la URL y `respaldoIntentadoRef` la página).
- 🔴 **El salto se registra en respaldo.php, nunca en player.php** (el iframe se recarga
  solo y contaría de más). Evento `\mod_ivplayer\event\respaldo_vimeo_usado`, nivel "otro",
  con `other` = causa/codigo/detalle. Clase nueva → subió `$plugin->version` (2026101902) y
  `ivplayer_respaldo_registrar` pregunta `class_exists` (antes del upgrade no rompe: salta
  sin registrar).
- Un 5xx en los segmentos tarda ~2 min 20 s en saltar (6 reintentos de hls.js por
  segmento × 4 rondas de nativePlayer): es lo que tardaba el cartel. Acortarlo es tocar
  los reintentos de todas las lecciones: decisión aparte.
- 🔴 Apagar el ajuste el día que los videos de Vimeo pasan a privados (si no, salta a un
  video que no se ve). Y en `scripts/build-demo.mjs`/SCORM no hay `respaldoUrl`: nunca salta.
- La prueba de navegador sirve el "Vimeo de mentira" (el mismo HLS sin firma) en la recarga:
  prueba la recarga y el retomar, no el SDK de Vimeo. El progress.php y el respaldo.php de
  mentira están en `apoyo/servidor.mjs` (`srv.respaldo`).

## Evento de vista (plan Bunny 0.3, oct-2026) — trampas
`view.php` → `ivplayer_view()` (`lib.php`): dispara `\mod_ivplayer\event\course_module_viewed`
(`classes/event/`) y después `set_module_viewed`, como `page_view()` de core. Cómo
verificarlo en el campus: README, "Vistas en el log del campus".
- 🔴 **Nunca en `player.php`** (ni en firma/progress/complete/answer): el iframe se recarga
  solo (giro en iOS, "Reintentar") y contaría vistas de más. Lo vigila `lib-php.test.mjs`.
- 🔴 **Una clase nueva en `classes/` la ve Moodle recién después del upgrade** (que purga el
  mapa de clases). Por eso subió `$plugin->version`, y por eso `ivplayer_view` pregunta
  `class_exists` antes: entre que se copian los archivos y corre el upgrade, sin la
  pregunta TODAS las lecciones daban "clase no encontrada". Vale para cualquier clase
  nueva del plugin.
- Ahora cualquier observador de `course_module_viewed` del campus (insignias,
  gamificación, `tool_monitor`, plugins propios) ve las lecciones: mirarlo en test-academy.

## Instalación en el campus (a mano desde el 18-oct-2026) — trampas
El cron de hPanel que corría `~/ivplayer-update.php` con cada release se borró el 18-oct:
un push a master publica el release y el configurador, pero el campus no cambia hasta
instalarlo. Procedimiento completo en el README ("Instalar el plugin en el campus").
- 🔴 **Tres comandos seguidos, de noche:** `php ~/ivplayer-update.php`,
  `php <moodle>/admin/cli/upgrade.php --non-interactive` y
  `php <moodle>/admin/cli/purge_caches.php`. Sin el upgrade las clases nuevas no existen
  (vistas y saltos sin registrar) y las casillas nuevas quedan apagadas.
- 🔴 **test-academy primero, con el ZIP de la rama** (`npm run build:plugin`). Nunca
  `workflow_dispatch` de `build-plugin.yml` desde una rama: publica un release
  `make_latest`, el que baja `ivplayer-update.php`.
- 🔴 `scripts/moodle-auto-update.php` deja el respaldo en `mod/ivplayer_backup/` (adentro
  de la carpeta web: se sirve y corre el reproductor viejo). En el servidor, `$BACKUP_DIR`
  fuera de la carpeta web (plan Bunny, tramo 0.2).
- Vuelta atrás: una versión nueva hacia adelante (1.4.1); Moodle no deja bajar.
- `ivplayer_view` no es pura: la prueba `correr.php` aparte, con reemplazos mínimos de
  `\core\event\course_module_viewed` y `completion_info` (el cableado, no el log).

## Glosario interactivo y avisos (1.4.0, pedido de Erick 18-oct-2026) — trampas
🔴 **Sólo transmitiendo a la TV (Erick, 19-oct-2026).** Los avisos (tic-tac, cuenta, plop, vibración, sus ajustes) y el glosario existen sólo mientras el video está en la TV: la persona mira la tele y el aviso le dice que vuelva a mirar la compu o el celular. **Sin transmitir, el reproductor es el de antes de la 1.4.0**: etiquetas en pantalla, sin sonidos ni glosario. Lo decide `enTV` en `InteractiveVideoPlayer.jsx`. Erick lo pidió así porque en la compu le cambiaba una experiencia que ya andaba bien. Lo que sigue describe el comportamiento transmitiendo; el pausado del panel que tapa el video quedó sin uso (transmitiendo no pausa).
Tic-tac 3 s antes de lo que frena, cuenta regresiva, "plop" + vibración al frenar, y las
etiquetas en un glosario que crece a medida que se nombran (o en pantalla, como antes,
por actividad). Uso y lo que falta probar en equipos reales: README ("Glosario
interactivo y avisos de las interacciones"). Lo puro: `src/avisos.js` y `src/glosario.js`;
los sonidos (Web Audio, sin archivos): `src/sonidos.js`.
- 🔴 **Los avisos NO tocan el candado.** Van en un efecto propio DESPUÉS del de disparo,
  con su propio `prevAvisoRef` (no `prevTimeRef`, que tiene sus reglas: ver "Candado").
  El único cambio en el efecto de disparo es el plop en `mostrar` (la réplica de
  `tests/unit/apoyo/simulador.mjs` no lo necesita). Qué "frena" es lo mismo que mira el
  bucle: todo menos `label`, también un tipo desconocido.
- 🔴 **"Reproduciendo" es `playingRef` SIN un salto pedido en vuelo (`seekTargetRef`) +
  un paso de hasta `umbralPaso(velocidad)`** (`SEEK_MIN`, el del candado, a 1× o menos;
  proporcional por encima: a 2× un tick de 1 s de reloj son 2 s de video). Todo salto
  (barra, ±10, transcripción, restaurar, la vuelta de la TV en pausa) es callado: ni
  tic-tac ni plop suave del glosario. El plop al FRENAR sí suena aunque se llegue
  saltando (la tarjeta aparece igual). 🔴 Sin `seekTargetRef`, el ±10 que frena EXACTO en
  una pendiente a menos de 2 s era un paso corto con el video andando y sonaba como
  reproducción (verificación del cierre, oct-2026). El candado sigue con `SEEK_MIN`.
- 🔴 **Sólo se anuncia la PRÓXIMA pendiente** (`ticsEntre`): con dos a menos de 3 s los
  tics se intercalaban, la cuenta saltaba de "1 Se viene una nota" a "3 Se viene una
  pregunta" y el tic de la segunda cortaba el `[60,40,60]` del freno de la primera
  (`vibrate()` reemplaza la vibración en curso). La segunda avisa después, con los tics
  que le queden.
- 🔴 **En el paso que frena suena sólo el plop** (`frenando = activeIA || activeIARef`):
  el efecto de disparo va antes y ya puso la tarjeta, pero `activeIA` de ESE render sigue
  en null. Mirar sólo `activeIA` dejaba pasar un tic de la siguiente y el plop suave de
  una etiqueta del mismo segundo. El término igual se suma (con "recién"), callado.
- 🔴 **Un tic tocado se olvida recién si el tiempo vuelve `OLVIDO_S` antes de su marca**
  (`olvidarTics`): el HLS nativo y el estimador de la TV retroceden centésimas, y sin eso
  sonaba dos veces. Dos marcas en un mismo paso suenan como UN tic (el último).
- 🔴 **Nada suena ni vibra antes del primer gesto** (`desbloquear()` en `togglePlay`, en
  `handleTouchEnd` —el play de los bordes sale 300 ms después—, en "Continuar", al
  prender los ajustes y en `tocarTV`: conectar la TV antes del play la hace arrancar sola
  y, sin eso, la primera interacción no sonaba ni vibraba). 🔴 NO desbloquear con
  cualquier clic o tecla del reproductor: rompe "con los sonidos apagados no se crea el
  AudioContext" (se probó y se descartó). Chrome bloquea `navigator.vibrate` sin gesto (aviso en consola) y
  un AudioContext creado fuera de un gesto queda suspendido. Un contexto suspendido no
  encola: se reanuda y ese aviso se pierde (si no, sonaba todo junto al volver).
  Con los sonidos apagados por el alumno el gesto sólo habilita la vibración
  (`desbloquear({audio:false})`): ni AudioContext ni sesión de audio.
- 🔴 **Vibración = `navigator.vibrate` Y pantalla táctil** (`vibracionPosible`): Chrome
  de escritorio tiene `vibrate` y no vibra; iPhone no lo tiene. En hub-app (Android) hace
  falta el permiso `VIBRATE` de la app: no se puede detectar desde la página.
- **El glosario sólo crece** (`nombrados`): volver para atrás no saca nada y al volver a
  cruzar no suena; Reiniciar lo vacía. Las notas entran por `completed` (también las de
  una sesión anterior, que vienen en el avance), sin sonido ni aviso.
- 🔴 **El panel cierra con una pregunta o un error** (como el menú de Ajustes) y, como el
  menú, un toque en la capa de toques SÓLO lo cierra (no pausa). Abrirlo no pausa,
  salvo que tape el video (ver el punto siguiente).
  Ajustes y glosario se excluyen. Va adentro del contenedor (pantalla completa, iframe,
  hub-app) con una capa `container-type: size` (`ivgl`) para medir ancho y alto.
  🔴 **Termina en `bottom: 56px`, sobre la fila de controles** (como `.iv-ajustes`): de
  borde a borde tapaba Glosario, TV, Ajustes y Pantalla completa (también la salida de
  la pantalla completa). Excepción: el reproductor bajo (≤300 px de alto) lo ocupa todo,
  controles incluidos. Tocar un control con el panel abierto hace lo suyo y lo cierra
  (el `pointerdown` de afuera). Con el panel abierto, un término nuevo va a
  `.iv-glosario-anuncio` (`aria-live`) porque el aviso visible no se muestra.
- 🔴 **El panel que TAPA el video lo pausa al abrir y lo retoma al cerrar** (Erick,
  19-oct-2026): más de `TAPA_MIN` (70 %) del contenedor, sólo reproduciendo y nunca
  transmitiendo (Chromecast o AirPlay: `transmitiendo` es el mismo de la red de
  seguridad). Un `useLayoutEffect` sobre `glosarioAbierto` mide al abrir con `offset*`
  del panel contra `clientWidth/Height` de su capa (no los mueven ni el giro de 90° ni
  la animación de entrada de 24 px) y lleva la marca `pausaGlosarioRef`; las decisiones
  son puras (`cobertura`, `pausarAlAbrir`, `pasoATapar`, `reanudarAlCerrar` en glosario.js). Casos: bajo
  (100 %), hoja de abajo angosta (78 %), lateral (26 % a 1280, 36 % a 900: no pausa).
  🔴 La pausa y la vuelta son las del BOTÓN (`playIntentRef=null` + `pause()`;
  `safePlay()`), no un camino propio: candado, avisos, avance y firma la ven como una
  pausa del alumno. 🔴 La marca la apaga **el manejador de 'play'** (alguien lo puso a
  andar en el medio: auriculares, pantalla de bloqueo; si después lo pausan, esa pausa
  no es del glosario) y **el `pointerdown` de afuera sobre el botón de reproducir**:
  si no, cerrar lo retomaba y el clic que viene detrás lo encontraba andando y lo
  pausaba. Sólo se ve con un clic LENTO en el BORDE del botón (`clicLento` de
  glosario.mjs): sobre el ícono, el ícono cambia (Reproducir → Pausar) entre el
  mousedown y el mouseup y Chrome no da el clic, así que la prueba pasaba con el error.
  `reanudarAlCerrar` no pregunta si está andando: con la marca prendida, a lo sumo la
  pausa todavía no llegó (abrir y cerrar enseguida) y retomar es lo correcto. Mutantes
  verificados (oct-2026): sin el apagado del pointerdown, sin el de 'play', sin
  `pregunta` y sin `transmitiendo`, cada uno lo agarra una prueba de glosario.mjs.
  🔴 **También la apaga la rama de pausa de `togglePlay`** (verificación del 19-oct):
  NO es equivalente al pointerdown. El toque al costado del video pausa 300 ms después
  (`singleTapTimer`, por el doble toque): si en ese rato se abrió el glosario, esa
  pausa del alumno llega con el panel abierto sin pasar por el pointerdown, y cerrar la
  retomaba. El pointerdown también mira el botón GRANDE (`.iv-big-play`): queda a la
  vista si, pausado por el glosario, el celular se acuesta; al retomar desaparecía bajo
  el dedo y el clic del toque caía en la capa de toques, que lo pausaba (la prueba es
  táctil: es el caso del celular).
  🔴 **Se vuelve a medir con el panel abierto** (`ResizeObserver` sobre la
  capa, `tapaGlosarioRef` con la última medida): medir sólo al abrir dejaba el video
  corriendo debajo si el celular se paraba con el panel al costado (o se salía de la
  pantalla completa con el atrás). Si PASA a tapar (`pasoATapar`) decide como al abrir;
  si deja de tapar, no retoma (lo hace cerrar). Las tres con prueba y mutante en
  glosario.mjs (el giro es el ancho del iframe de `/marco.html`, 900 → 375 → 900).
- 🔴 **El silencio del video calla los SONIDOS de aviso, no la vibración** (Erick,
  19-oct-2026): `comoAvisar` (avisos.js) con `silencioRef` = el estado `muted`, o sea el
  ícono del botón de volumen (botón, tecla M, barra en 0, lo que lee el manejador de
  'play' del motor). 🔴 También el arranque en silencio que fuerza el navegador (Vimeo
  en la app de Moodle): se evaluó dejarlo afuera (la propuesta anterior) y se descartó,
  un ícono tachado con tic-tac sonando parece una falla. Transmitiendo, el de la TV como
  lo refleja el ícono (al conectar y en cada play); `CastPlayer` no avisa los cambios de
  volumen de la TV, así que uno del control remoto entre dos play no cuenta hasta el
  próximo (queda el del control del celular). La muestra de "Sonidos de aviso" en
  Ajustes también calla en silencio (el toque igual desbloquea). El `AudioContext` se
  sigue creando en el play aunque el video esté en silencio: así suena apenas se quita,
  sin un desbloqueo nuevo en `toggleMute`.
- 🔴 **La fila de controles con el botón del glosario**: a 360 px con el de girar (o con
  el de la TV sin pantalla completa) el de SALIR de pantalla completa quedaba 10 px
  afuera. `.con-glosario` esconde la duración total hasta 400 px (styles.css);
  `angosto.mjs` mide de 320 a 400 con y sin pantalla completa. Un botón más en la fila,
  volver a medir.
- **Ajustes abre siempre en la vista principal** (ahí están "Sonidos de aviso" y
  "Vibración"); antes, sin calidades ni TV en el menú, abría en Velocidad.
- **Modo "pantalla"** (`PLAYER_CONFIG.etiquetas`, columna `etiquetas`, paso 2026101903):
  el reproductor de antes, con los avisos. Cualquier otro valor (o ninguno) es el
  glosario: en PHP `ivplayer_modo_etiquetas`, en el componente `!== 'pantalla'`. Las
  actividades que ya existían quedan con el glosario. `ivplayer_config_base` (pura) arma
  lo que va en `PLAYER_CONFIG`; correr.php prueba también el paso del upgrade con un
  XMLDB de mentira y que `install.xml` diga lo mismo.
- Pruebas: `?ias=glosario` (INTERACCIONES_GLOSARIO, con los textos de la lección 3.1),
  `?ias=juntas` (dos que frenan a menos de 3 s y una etiqueta en el mismo segundo que la
  segunda), `?etiquetas=pantalla`, `?sonido=simulado` (`simulados/sonido-simulado.js`: anota cada
  oscilador con el segundo del video, cada vibración, la cuenta que se vio y si el
  contexto se creó dentro del gesto). `escenarios/avisos.mjs` y `glosario.mjs`;
  `clicBarra(p, seg)` (avisos.mjs) hace un clic real en la barra en ese segundo.
- Sin animaciones infinitas en lo nuevo (lo mira `glosario.mjs`) y sin ninguna con
  `prefers-reduced-motion`.

## Tarjeta de fin del video (1.4.0, pedido de Erick 19-oct-2026) — trampas
Al terminar: "Lección completada" (o "Terminaste el video"), "Siguiente: <próxima>",
"Siguiente lección →" y "Volver a ver"; en la última, "Volver al curso"; sin la barra del
tema arriba, sólo "Volver a ver". Uso y pendientes: README ("Tarjeta de fin del video").
Lo puro, `src/finVideo.js`; el resto, "Tarjeta de fin" en el componente.
- 🔴 **El video ya NO vuelve a 0 al terminar, ni repite con `loop`.** `alTerminar` deja
  el estado en el fin (`setCurrent(fin)`) y pide la tarjeta (`finPendienteRef` +
  `senalFin`). El play con el video terminado (`terminoRef`) es `volverAEmpezar` (salto
  propio a 0 + safePlay), igual que "Volver a ver". Lo que había atado al rebobinado:
  - el avance guardado sigue siendo 0 terminado (`tiempoDelAvance`, en los tres
    guardados: el periódico, el de pagehide y el de la red de seguridad);
  - `senalFin` está en las dependencias del efecto de disparo: sin el 0 del rebobinado,
    el tiempo puede no cambiar y la pasada contra el fin (`evaluarEnFinRef`) no corría;
  - `conectarCast` con el video terminado carga la TV en 0 (en pausa), como cuando el
    celular volvía a 0; `volverALocal` conserva `terminoRef` (seekTo lo pone en false);
  - 🔴 **nativePlayer retoma la carga de hls.js en el evento 'play'** si quedó detenida
    desde 'ended' (salvo `_enEspera`, transmitiendo): un play de AFUERA (auriculares,
    pantalla de bloqueo) con el video terminado saltaba solo al 0 y se quedaba sin datos
    para siempre (lo agarra "un play de afuera…" de fin.mjs; verificado con la mutación).
- 🔴 **La tarjeta la abre un efecto DESPUÉS del de disparo**, nunca `alTerminar`: si el
  fin trae una pregunta pendiente (o la pasada contra el fin encuentra otra del mismo
  tramo), `mostrar` ya puso `activeIARef` y la tarjeta espera a que la respondan. Si se
  mueve ese efecto antes del de disparo, la tarjeta tapa la pregunta del final (mutante
  verificado).
- La tarjeta tapa todo como una pregunta: controles `inert`, sin capa de toques ni botón
  grande, cierra el menú y el glosario (y `reanudarAlCerrar` la cuenta como `pregunta`:
  cerrar el glosario no retoma nada). Escape y la X la cierran; el foco vuelve al botón de
  reproducir DESPUÉS del render (`devolverFocoFinRef`: antes los controles siguen inert).
  Se va sola con un play (manejador de 'play'), un salto de la transcripción o de la
  pantalla de bloqueo, ±10 y Reiniciar (`soltarFinRef`).
- 🔴 **Sólo enlaces http(s) del mismo origen que la página de arriba** (`destinoDeFin`), y
  se navega `window.top` en el mismo toque, después de salir de la pantalla completa (la
  de `top`, la propia o la simulada por mensaje a la madre).
- "Lección completada" = `registra` (MOODLE_CONTEXT.completeUrl o la API de SCORM) y (ya
  completada o todo respondido): la misma regla con que sale `complete.php`. No cambia
  cuándo se completa.
- Usa `.iv-card` (estilos de las preguntas) más `.iv-fin`: el ayudante de las pruebas
  (`A.tarjeta`) mira `.iv-card:not(.iv-fin)`. La capa es un contenedor de TAMAÑO (`ivfin`)
  con el fondo ADENTRO (una consulta no puede tocar a su propio contenedor): a 320 × 180
  entra entera sin el tope del 90 % de `.iv-card`.
- Pruebas: `escenarios/fin.mjs` con `marco.html?lnav=siguiente|ultima|marcar` (la barra
  con el marcado del tema), `completar=1` (complete.php y progress.php de mentira),
  `loop=1`, `ias=final` (un V/F en el segundo entero que sigue al fin). Mutantes
  verificados (oct-2026): la tarjeta sin esperar a la pregunta, el bucle de vuelta, sin
  salir de la pantalla completa, el avance en el fin, sin el foco y sin retomar la carga
  de hls.js: cada uno lo agarra una prueba.

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

## Subtítulos de la lección (oct-2026)
- Salen del VTT/SRT que el docente sube en "Editar transcripción" (formato hubcampus, filearea `format_hubcampus/transcriptvtt` del contexto del módulo): el MISMO archivo de la transcripción sincronizada del tema. player.php lo normaliza a UTF-8 (`ivplayer_subtitulos_normalizar`: BOM, UTF-16, Windows-1252, bytes rotos) y lo manda crudo en `subtitlesVtt`; lo parsea `parseVTT`.
- 🔴 `parseVTT` usa la MISMA regex de tiempo que `parse_timed_cues` del tema (campus-theme, hook_callbacks.php). Si se toca una, tocar la otra: si no, la pestaña de transcripción y el video leen distinto el mismo archivo. Probado con los 14 archivos reales de los cursos (869 cues, iguales). Y desde la 1.4.0 hay una tercera copia: `ivplayer_subtitulos_cues` (lib.php), la que arma el VTT de la TV (ver "Subtítulos en la TV").
- Con Vimeo, una pista propia de Vimeo gana; una AUTOGENERADA (`-x-autogen`) no le gana al archivo del docente.
- Pendiente fuera de este repo: el tema no normaliza la codificación (un SRT en UTF-16 no muestra transcripción) y el backup de format_hubcampus no copia `transcriptvtt` (al duplicar la actividad se pierden transcripción y subtítulos).

## Pruebas (oct-2026)
`npm test` corre tres capas en orden y no frena en la primera que falla
(`scripts/probar-todo.mjs`); en GitHub corre en cada push a master, en cada PR y a
mano (workflow_dispatch) (`.github/workflows/pruebas.yml`). El uso y qué protege
cada capa, en el README.
- 🔴 **Salteada no es "bien".** El nivel navegador se saltea adentro de node:test y
  sale con 0; antes el resumen decía "navegador bien" sin haber abierto Chrome. Ahora
  la capa avisa por el archivo de `IVP_AVISOS` (lo pone probar-todo) y el resumen dice
  `salteada` o "en parte salteada" (sin HLS nativo). En GitHub sale como
  `::warning::` y el job queda verde: mirar la advertencia.
- **Unitarias** (`tests/unit/`, node:test, sin dependencias): `src/candado.js`,
  `src/subtitulos.js`, `src/firma.js` (con fetch, timers y relojes de mentira), el
  espejo en Node de la firma de Bunny, `src/sondeo.js` (con un CDN de mentira) y `CastPlayer` de
  `src/cast.js` contra una TV falsa (sin SDK: con `window` vacío, `sdk()` da null y
  no se manda ningún comando; sólo se mira cómo lee los avisos de la TV). 🔴 `node
  --test tests/unit` NO anda en Node 22+ (toma la carpeta como archivo): usar
  `npm run test:unit` (`tests/unit/*.test.mjs`).
- 🔴 **El simulador del candado (`tests/unit/apoyo/simulador.mjs`) REPLICA el efecto
  de disparo del componente.** Con el JSX roto (guardia después del bucle, `prev` que
  avanza con la tarjeta abierta, restauración sin `tiempoAGuardar`, sin freno de
  'play') las unitarias pasan igual: sólo lo ve el nivel navegador. Verificado con
  mutaciones (oct-2026). Si se toca ese efecto, actualizar la réplica.
- **PHP** (`tests/php/correr.php`): lee las funciones puras de `lib.php` del archivo
  real al correr (ya no se copian a mano). El espejo de Node fija una huella del código de cada función:
  si se toca una en `lib.php`, esa prueba avisa que hay que re-traducir el espejo.
  `ivplayer_subtitulos_normalizar` no tiene espejo: `tests/unit/lib-php.test.mjs` fija
  su huella sólo para avisar que hay que correr la prueba PHP (antes un cambio ahí
  pasaba toda la suite local). No hay PHP en esta PC: correr.php corre en CI o en el
  servidor (alias SSH `hub-moodle`, PHP 8.3), en una carpeta descartable: copiar
  `tests/php` y `mod/ivplayer` a `~/wf-php`, `php tests/php/correr.php` y borrarla. Nada
  más en el servidor.
- **Navegador** (`tests/navegador/`): el bundle COMPILADO (a una carpeta temporal,
  `dist/` no se toca) en Chrome headless por CDP crudo, con clics y toques reales
  (`Input.dispatchMouseEvent` / `dispatchTouchEvent`). Los receptores simulados de la
  TV están en el repo (`tests/navegador/simulados/`).

Trampas del nivel navegador:
- 🔴 **Chrome del usuario**: siempre `--user-data-dir` propio y temporal, y matar
  sólo el PID lanzado (`taskkill /PID … /T /F`). **Nunca `chrome.exe --version` en
  Windows**: no imprime nada y abre una pestaña en la sesión abierta del usuario
  (pasó armando esta suite). La versión se lee de `navigator.userAgent`.
- 🔴 **El HLS nativo de Chrome no es el de Safari.** Sirve para probar el camino del
  iPhone (cambio de fuente, reintentos del salto), pero un salto hecho apenas llega la
  metadata —justo la restauración— a veces aterriza al PRINCIPIO del segmento (con el
  stream de Mux, 10,46 en vez de 15; casi siempre con el video en caché). Los saltos
  posteriores son precisos. `Pagina.abrir` lo reubica cuando la restauración es sólo
  para ubicarse; la prueba de "retomar" lo tolera hasta un segmento y lo anota. Falta
  ver si Safari hace lo mismo (en producción Chrome usa hls.js).
- 🔴 **La retención de eventos de nativePlayer no se ve "sola" en Chrome**: el reintento
  del salto sale en el mismo timeupdate que vería el 0 (una mutación que dejaba salir
  los eventos pasaba todo). Se prueba con una TRAMPA en el setter de `currentTime`
  del prototipo (`calidad.mjs`): el primer salto después del toque aterriza 6 s antes.
  Mismo recurso para imitar los descartes de iOS. La trampa vive en la página de esa
  prueba y se va con la navegación siguiente.
- **Mutantes equivalentes conocidos** (oct-2026, no buscarles prueba): la marca de
  salto propio de `seekTo` (todo salto propio hacia adelante frena en la primera
  pendiente y el render optimista ya la dispara: la guardia no tendría qué retomar;
  con el <video> no hay ticks atrasados), `marcarSaltoPropio(tt,3000)` de la vuelta
  de la TV (seekTo la pisa con 1,5 s en la línea siguiente) y `.iv-fs-btn {
  flex-shrink: 0 }` (los botones no bajan de su min-content: lo que hace entrar la
  fila a 320 px son las consultas de contenedor).
- 🔴 **`String.replace` con texto de reemplazo y código adentro**: `$'` (que aparece
  en `$('.iv-…')`) quiere decir "lo que sigue al hallazgo". El servidor inyecta con
  una función de reemplazo; no volver a pasarle un string.
- 🔴 **`fs.cpSync` de `src/` tumba Node 24.14 en esta PC** (sale con 127, sin
  excepción ni evento 'exit'). La ruta está en OneDrive y tiene "ó"; no se averiguó
  cuál de las dos lo causa. En scripts de prueba, copiar a mano
  (`readdirSync` + `readFileSync`/`writeFileSync`).
- **Firma de prueba** (`?firma=<s>` en el servidor de pruebas): el video va bajo
  `/bcdn_token=…&token_path=%2Fhls%2F<GUID>%2F&expires=E/hls/<GUID>/` y el servidor lo
  VALIDA como el CDN (403 con CORS si venció o no lo emitió él); `/firma` hace de
  firma.php (`renovar=falla | falla-hasta-403 | red-tras-403 | lenta`, y `demora=<s>`
  para la lenta). `rota=alta`: la playlist de la calidad más alta da 403 con cualquier
  firma (una variante rota, no el vencimiento). `renovada=<s>`: lo que duran las firmas
  que da `/firma`. Lleva la cuenta en `entorno.srv.firma` (`pedidos`, `servidos`,
  `rechazos`, `emitidas`). Para que un toque caiga DURANTE un rescate del HLS nativo, el
  salto tiene que ir LEJOS de lo bajado (de 30 a 52): con +10 el tramo a veces ya estaba
  en el buffer y no había ningún 403.
- 🔴 **Las pruebas de lo que pasa AL VENCER la primera firma llevan `renovada=60`.** Con
  firmas de 6-8 s también después, el HLS nativo cambia de fuente cada ~3 s reproduciendo
  y cada cambio cuesta un salto de 2-4 s (el 1080p de Mux son 8 MB por segmento): no
  avanzaba y fallaban según la red de ese día (oct-2026, también con el build de antes de
  los arreglos). Con firmas reales es un cambio por hora. Lo de vencer seguido lo prueba
  la primera ("con la firma venciendo cada 10 s").
- Video de prueba: local de ffmpeg (`npm run video-prueba` → `tests/navegador/.video/`,
  ignorada; el de CI), o el HLS público de Mux (Big Buck Bunny, 634 s, 5 calidades,
  audio adentro) o `IVP_VIDEO_URL`. El "sample" público de Bunny da 403 y los de
  Apple traen el audio aparte o no nombran RESOLUTION. Se sirve siempre por el
  servidor de pruebas bajo `/hls/<GUID sintético>/` (proxy con caché si es remoto),
  así la clave del avance y el "es este video" de la TV simulada salen del GUID.
- El ayudante de la página (`apoyo/ayudante-pagina.js`) lee el DOM del reproductor:
  `.iv-progress-fill` (el tiempo del componente), `.iv-card`, `.iv-tv-capa-titulo`,
  `.iv-tv-aviso`, `.iv-subtitle-text` y los `aria-label` de los botones. Si se
  renombra alguno, actualizarlo ahí o las pruebas fallan por la razón equivocada.
- `IVP_HTML=mod/ivplayer/player.html npm run test:navegador` prueba el bundle que va
  en el ZIP (puede estar viejo respecto de `src/`, ver "player.html viejo").
- Las dos pruebas `todo` de `candado-simulado.test.mjs` documentan problemas reales
  sin arreglar (`prevTimeRef` tras la guardia; tres pendientes pegadas con pausa
  lenta). Cuando se arreglen, sacarles el `todo`.
