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
