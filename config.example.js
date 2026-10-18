/**
 * Ejemplo de configuración para un video interactivo.
 * 
 * Copiar este bloque dentro de un tag <script> en el HTML compilado,
 * ANTES del script principal (el <script type="module">).
 * 
 * No pegar un video en DEFAULT_CONFIG (src/configuracion.js) para probar: la config
 * por defecto viaja en cada build (player.html, el configurador, cada SCORM) y este
 * repo es público. Sin video, el reproductor muestra "No hay video para mostrar".
 *
 * Los IDs, hashes y URLs de acá son de MENTIRA (ID_DEL_VIDEO, vz-ejemplo…): así como
 * están, el reproductor dice que no hay video. Reemplazarlos por los del video propio,
 * sin commitearlos si es una clase del campus.
 */

window.PLAYER_CONFIG = {
  title: "Módulo 3 — Calibración Multiespectral",

  // ─── VIDEO ──────────────────────────────────────────────
  // Opción A: Vimeo, ID + hash (para videos privados o no listados)
  vimeoId: "ID_DEL_VIDEO",
  vimeoHash: "HASH_DEL_VIDEO",

  // Opción B: URL completa de Vimeo (se parsea automáticamente)
  // vimeoId: "https://vimeo.com/ID_DEL_VIDEO/HASH_DEL_VIDEO",

  // Opción C: Solo ID de Vimeo (para videos públicos)
  // vimeoId: "ID_DEL_VIDEO",

  // Opción D: video propio, HLS (Bunny Stream) o MP4 directo. Si está, manda sobre
  // vimeoId. En el campus lo arma y lo firma player.php: no se escribe a mano.
  // videoUrl: "https://vz-ejemplo.b-cdn.net/11111111-2222-4333-8444-555555555555/playlist.m3u8",

  // ─── SUBTÍTULOS ─────────────────────────────────────────
  // Opción A: Archivo .vtt externo
  subtitlesUrl: null, // "https://tu-servidor.com/subs.vtt"

  // Opción B: Cues inline (se ignoran si subtitlesUrl está definido)
  subtitlesCues: [
    { start: 0, end: 5, text: "Bienvenidos al módulo de calibración." },
    { start: 5, end: 10, text: "Hoy vamos a calibrar el sensor multiespectral." },
  ],

  // ─── INTERACCIONES ──────────────────────────────────────
  interactions: [
    // NOTA
    {
      id: "nota-1",
      type: "note",
      time: 10,         // Segundo del video
      data: {
        title: "📍 Antes de empezar",
        // Los textos de notas, etiquetas, preguntas y explicaciones aceptan un poco de
        // markdown: **negrita**, _cursiva_ y una línea en blanco para separar párrafos.
        text: "Asegurate de tener el panel de calibración **limpio** y sin sombras."
      }
    },

    // MULTIPLE CHOICE
    {
      id: "mc-1",
      type: "multiple-choice",
      time: 45,
      data: {
        question: "¿Cada cuánto se recomienda recalibrar el sensor durante un vuelo largo?",
        options: [
          { id: "a", text: "Cada 5 minutos" },
          { id: "b", text: "Cada 15-20 minutos" },
          { id: "c", text: "Solo al inicio del vuelo" },
          { id: "d", text: "No hace falta recalibrar" }
        ],
        correctId: "b",
        explanation: "Se recomienda cada 15-20 minutos o cuando cambian las condiciones de luz (nubes, ángulo solar)."
      }
    },

    // VERDADERO / FALSO
    {
      id: "vf-1",
      type: "true-false",
      time: 90,
      data: {
        statement: "El panel de calibración debe ser fotografiado a la misma altitud que el cultivo.",
        correct: false,
        explanation: "Falso. El panel se fotografía en tierra antes y/o después del vuelo, no a altitud de vuelo."
      }
    },

    // HOTSPOT
    {
      id: "hs-1",
      type: "hotspot",
      time: 120,
      duration: 8,      // Segundos que dura visible (default: 8)
      data: {
        spots: [
          {
            id: "h1",
            x: 30,      // Porcentaje horizontal (0-100)
            y: 40,      // Porcentaje vertical (0-100)
            label: "Panel blanco",
            info: "Referencia de reflectancia al 100%. Se usa para normalizar todas las bandas."
          },
          {
            id: "h2",
            x: 65,
            y: 55,
            label: "Panel gris",
            info: "Referencia al 50%. Útil para verificar la linealidad del sensor."
          }
        ]
      }
    }
  ]
};
