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
