// Lectura de los subtítulos de la lección (VTT o SRT). Puro, sin React: vive acá para
// poder probarlo sin navegador (tests/unit/subtitulos.test.mjs). Lo usa
// InteractiveVideoPlayer.jsx con el texto que inyecta player.php (subtitlesVtt) y con
// el que baja de subtitlesUrl.

// El texto de un cue se dibuja como TEXTO (React), no como HTML: las etiquetas de VTT
// (<i>, <b>, <v Docente>, <c.amarillo>, <00:00:02.500>) y de SRT (<font>) se verían tal
// cual. Se sacan SÓLO las que tienen forma de etiqueta: en SRT no se escapa nada y un
// "<" suelto ("Drones < 250 g") se comía el texto hasta el próximo ">". Después se
// resuelven las entidades (&amp; al final, así "&amp;lt;" queda "&lt;" literal).
export function textoDeCue(t) {
  const cp = (n) => (n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : "");
  return t.replace(/<\/?[a-zA-Z][^<>]*>|<\d{2,}:\d{2}[:.,\d]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&lrm;|&rlm;/g, "").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => cp(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => cp(parseInt(n, 16)))
    .replace(/&amp;/g, "&").trim();
}

// Tiempo de un cue: la MISMA regex que el tema usa para la transcripción
// (parse_timed_cues en hook_callbacks.php), así la pestaña y el video leen igual el
// mismo archivo: horas opcionales y de 1 o 2 dígitos, milisegundos de 1 a 3, coma o punto.
// 🔴 Si se toca una, tocar la otra (la prueba fija el texto de ésta para que no cambie
// sin querer).
export const RE_TIEMPO_CUE = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const segCue = (h, m, sg, f) => (+h || 0) * 3600 + (+m) * 60 + (+sg) + parseFloat("0." + f);

// VTT o SRT, línea por línea: una línea con tiempo abre un cue nuevo (aunque falte la
// línea en blanco), una línea en blanco o sólo con espacios lo cierra, y el número de
// un SRT pegado al tiempo siguiente no entra en el texto. Antes se partía por "\n\n" y
// un separador con un espacio metía los tiempos crudos del cue siguiente en pantalla.
export function parseVTT(text) {
  const cues = [];
  const lines = String(text).replace(/\r*\n|\r/g, "\n").split("\n");
  let cur = null;
  const cerrar = () => {
    if (cur) {
      const t = textoDeCue(cur.l.join("\n"));
      if (t && cur.end > cur.start) cues.push({ start: cur.start, end: cur.end, text: t });
    }
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(RE_TIEMPO_CUE);
    if (m) { cerrar(); cur = { start: segCue(m[1], m[2], m[3], m[4]), end: segCue(m[5], m[6], m[7], m[8]), l: [] }; continue; }
    if (!cur) continue;
    if (!lines[i].trim()) { if (cur.l.some((x) => x.trim())) cerrar(); continue; }
    if (/^\s*\d+\s*$/.test(lines[i]) && i + 1 < lines.length && RE_TIEMPO_CUE.test(lines[i + 1])) continue;
    cur.l.push(lines[i]);
  }
  cerrar();
  return cues;
}
