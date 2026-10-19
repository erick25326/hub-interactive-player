// El GLOSARIO INTERACTIVO (modo "glosario" de las etiquetas, el de por defecto desde la
// 1.4.0): las etiquetas ya no aparecen como pines sobre el video, que se iban a los
// pocos segundos sin dar tiempo a leerlas (pedido de Erick, 18-oct-2026). Cada término
// se suma a una lista en el momento en que se nombra, con un "plop" suave, y se toca
// para leer la definición. Las notas, después de verlas, también quedan ahí.
// Las decisiones viven acá, puras, para probarlas sin navegador
// (tests/unit/glosario.test.mjs): qué términos se suman en cada paso del tiempo, cuáles
// con sonido y qué se lista, en qué orden. El panel y el aviso son del componente.

import { umbralPaso } from "./avisos.js";

// Cuánto queda resaltado con "recién" lo último que se sumó.
export const RECIEN_MS = 6000;
// Cuánto dura el aviso "Nuevo en el glosario: …" con el panel cerrado.
export const AVISO_MS = 4500;
// Si el panel tapa más que esto del video, abrirlo lo PAUSA y cerrarlo lo retoma
// (decisión de Erick, 19-oct-2026; ver pausarAlAbrir).
export const TAPA_MIN = 0.7;

const limpio = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

/** El nombre con que se lista: el término de una etiqueta o el título de una nota (sin
 *  título, el principio del texto, sin el markdown). '' si no hay nada que mostrar. */
export function nombreDe(ia) {
  const d = (ia && ia.data) || {};
  if (ia && ia.type === "label") return limpio(d.text);
  if (ia && ia.type === "note") {
    const titulo = limpio(d.title);
    if (titulo) return titulo;
    const texto = limpio(String(d.text || "").replace(/[*_]/g, ""));
    return texto.length > 60 ? texto.slice(0, 57).trimEnd() + "…" : texto;
  }
  return "";
}

/** ¿Es un término del glosario? Una etiqueta con nombre. */
export function esTermino(ia) {
  return !!ia && ia.type === "label" && nombreDe(ia) !== "";
}

/** ¿Una nota que, después de verla, queda en el glosario? */
export function esNota(ia) {
  return !!ia && ia.type === "note" && nombreDe(ia) !== "";
}

/** ¿Esta actividad tiene algo que pueda ir al glosario? Sin eso no hay botón. */
export function hayGlosario(interactions) {
  return (interactions || []).some((ia) => esTermino(ia) || esNota(ia));
}

/** Cuántas entradas puede llegar a tener (para "3 de 11"). */
export function totalPosible(interactions) {
  return (interactions || []).filter((ia) => esTermino(ia) || esNota(ia)).length;
}

/**
 * Los términos que se suman en el paso de `prev` a `t`: toda etiqueta con nombre cuyo
 * tiempo ya llegó y que todavía no está en `nombrados`. El glosario sólo crece: lo que
 * ya se nombró no se va si el alumno vuelve para atrás.
 *
 * 🔴 Con sonido sólo los que se CRUZAN reproduciendo (un paso hacia adelante de hasta
 * umbralPaso(velocidad): SEEK_MIN, como el candado, y más a más de 1×). Un salto
 * hacia adelante, la restauración del avance o los de tiempo 0 al cargar se suman
 * callados: el alumno no los escuchó nombrar.
 *
 * @param {object} p
 * @param {Array} p.interactions las del PLAYER_CONFIG
 * @param {Set} p.nombrados ids ya sumados
 * @param {number} p.prev tiempo del render anterior
 * @param {number} p.t tiempo de este render
 * @param {boolean} p.reproduciendo si el video se está reproduciendo
 * @param {number} [p.velocidad] la del video (1, 2…): agranda el umbral del salto
 * @returns {Array<{id: string, nombre: string, sonido: boolean}>} en orden de tiempo
 */
export function terminosNuevos({ interactions, nombrados, prev, t, reproduciendo, velocidad = 1 }) {
  const paso = t - prev;
  const cruzando = !!reproduciendo && paso > 0 && paso <= umbralPaso(velocidad);
  return (interactions || [])
    .map((ia, i) => ({ ia, i }))
    .filter(({ ia }) => esTermino(ia) && !nombrados.has(ia.id) && ia.time <= t)
    .sort((a, b) => a.ia.time - b.ia.time || a.i - b.i)
    .map(({ ia }) => ({ id: ia.id, nombre: nombreDe(ia), sonido: cruzando && ia.time > prev }));
}

/**
 * Lo que muestra el glosario: los términos ya nombrados y las notas ya vistas (las
 * respondidas: también las de una sesión anterior, que vienen en el avance), con lo
 * último ARRIBA. A igual tiempo, lo que está después en la configuración va primero.
 * Nunca la lista completa de golpe: lo que no se nombró todavía no está.
 *
 * @returns {Array<{id: string, tipo: 'termino'|'nota', nombre: string, texto: string, time: number}>}
 */
export function entradas({ interactions, nombrados, completed }) {
  return (interactions || [])
    .map((ia, i) => ({ ia, i }))
    .filter(({ ia }) => (esTermino(ia) && nombrados.has(ia.id)) || (esNota(ia) && completed.has(ia.id)))
    .sort((a, b) => b.ia.time - a.ia.time || b.i - a.i)
    .map(({ ia }) => {
      const d = ia.data || {};
      const texto = ia.type === "note" ? d.text : d.definition;
      return { id: ia.id, tipo: ia.type === "note" ? "nota" : "termino", nombre: nombreDe(ia), texto: typeof texto === "string" ? texto : "", time: ia.time };
    });
}

// ─── El panel que TAPA el video (decisión de Erick, 19-oct-2026) ─────────
// En un reproductor bajo (el iframe del campus con el celular parado mide ~210 px de
// alto; la pantalla completa con el celular parado, lo mismo: centra un 16:9) el panel
// ocupa todo y el video seguía corriendo sin verse. Ahora, si lo tapa, abrirlo lo pausa
// y cerrarlo lo retoma. En una pantalla ancha (el panel al costado, el video a la
// vista) sigue sin pausar. El componente mide y hace lo que digan estas tres.

/**
 * Qué fracción del área del video (0 a 1) tapa el panel. Rectángulos `{ x, y, ancho,
 * alto }` en las MISMAS coordenadas: el componente usa las del contenedor (offsetLeft y
 * compañía), que no cambian con el giro de 90° ni con la animación de entrada del panel.
 */
export function cobertura(panel, video) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  if (!panel || !video) return 0;
  const va = n(video.ancho) * n(video.alto);
  if (!(va > 0)) return 0;
  const ancho = Math.min(n(panel.x) + n(panel.ancho), n(video.x) + n(video.ancho)) - Math.max(n(panel.x), n(video.x));
  const alto = Math.min(n(panel.y) + n(panel.alto), n(video.y) + n(video.alto)) - Math.max(n(panel.y), n(video.y));
  if (!(ancho > 0) || !(alto > 0)) return 0;
  return Math.min(1, (ancho * alto) / va);
}

/**
 * ¿Abrir el glosario pausa el video? Sólo si se estaba reproduciendo, si el panel tapa
 * más de TAPA_MIN del video y si NO se transmite a la TV: ahí el video está en la TV y
 * el celular es sólo el control (lo que se tapa es el cartel "Reproduciendo en…").
 */
export function pausarAlAbrir({ reproduciendo, transmitiendo, cobertura: tapa }) {
  return !!reproduciendo && !transmitiendo && Number(tapa) > TAPA_MIN;
}

/**
 * ¿Cerrar el glosario retoma el video? Sólo si la pausa vigente es la del glosario y
 * nada más lo frenó o lo tomó en el medio: una pregunta abierta (la que cerró el panel),
 * un error o la TV.
 * `pausoElGlosario` lo lleva el componente: lo prende al pausar y lo apaga cualquier
 * play que llegue en el medio (el alumno con el botón, los auriculares, la pantalla de
 * bloqueo), aunque después lo vuelvan a pausar: esa pausa ya no es del glosario. Por
 * eso no hace falta preguntar si el video está andando: con la marca prendida, a lo
 * sumo la pausa del glosario todavía no llegó (abrir y cerrar enseguida), y retomarlo
 * es justo lo que corresponde.
 */
export function reanudarAlCerrar({ pausoElGlosario, pregunta, error, transmitiendo }) {
  return !!pausoElGlosario && !pregunta && !error && !transmitiendo;
}
