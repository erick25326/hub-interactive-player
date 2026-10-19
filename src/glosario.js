// El GLOSARIO EN VIVO: mientras el video está en la TV, la pantalla de la compu o del
// celular muestra la lista de los términos (las etiquetas) que ya se nombraron, con el
// más nuevo arriba (diseño "Glosario en vivo", Erick, 19-oct-2026). Sin transmitir no
// existe: el reproductor es el de antes (etiquetas en pantalla).
// 🔴 La lista SALE DEL TIEMPO, no de lo que se fue sumando: visible = etiqueta con
// `time <= currentTime`. Volver para atrás saca las posteriores y volver a ver el video
// las trae de nuevo al cruzarlas (con la lista que "sólo crecía", la segunda vista no
// mostraba nada nuevo, y dos etiquetas del mismo segundo se pisaban en pantalla).
// Las notas ya no van en la lista: siguen frenando como siempre.
// Lo puro vive acá (tests/unit/glosario.test.mjs); la pantalla es del componente.

import { umbralPaso, frena } from "./avisos.js";

// Un término se ve un pelito ANTES de su segundo: un salto a ese segundo ("Ver en el
// video", la barra) aterriza con el HLS nativo o el estimador de la TV unas centésimas
// antes, y el término se iba y volvía. Imperceptible para el que mira.
export const ANTICIPO_S = 0.25;
// Cuánto dura el aviso "Volviendo a M:SS en la TV".
export const TOAST_MS = 2600;
// Cuánto dura la animación de entrada del término nuevo (la marca `entra`).
export const ENTRADA_MS = 320;

const limpio = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

/** El nombre del término: el texto de la etiqueta. '' si no hay nada que mostrar. */
export function nombreDe(ia) {
  return ia && ia.type === "label" ? limpio((ia.data || {}).text) : "";
}

/** ¿Es un término del glosario? Una etiqueta con nombre. */
export function esTermino(ia) {
  return !!ia && ia.type === "label" && nombreDe(ia) !== "";
}

/** ¿La actividad tiene términos? Sin ninguno, la pantalla no muestra la columna. */
export function hayTerminos(interactions) {
  return (interactions || []).some(esTermino);
}

const visibleEn = (ia, t) => Number(ia.time) - ANTICIPO_S <= Number(t);

/**
 * Los términos que se ven en el tiempo `t`, del MÁS NUEVO al más viejo (a igual
 * segundo, el que está después en la configuración va arriba). El primero es el que
 * lleva "NUEVO". `imagen`: `data.image` de la etiqueta si es texto (el mismo campo que
 * usan notas y preguntas); null si no hay.
 *
 * @returns {Array<{id: string, nombre: string, texto: string, imagen: string|null, time: number}>}
 */
export function terminosVisibles(interactions, t) {
  return (interactions || [])
    .map((ia, i) => ({ ia, i }))
    .filter(({ ia }) => esTermino(ia) && visibleEn(ia, t))
    .sort((a, b) => b.ia.time - a.ia.time || b.i - a.i)
    .map(({ ia }) => {
      const d = ia.data || {};
      return {
        id: ia.id, nombre: nombreDe(ia), time: ia.time,
        texto: typeof d.definition === "string" ? d.definition : "",
        imagen: typeof d.image === "string" && d.image.trim() ? d.image : null,
      };
    });
}

/**
 * Los términos que aparecen en el paso de `prev` a `t` REPRODUCIENDO (un paso hacia
 * adelante de hasta umbralPaso(velocidad), como los tics): suenan con el plop suave y
 * entran animados. Un salto (la barra, ±10, "Ver en el video", restaurar) los muestra
 * callados. En orden de tiempo. Volver a ver el video los vuelve a cruzar: suenan otra vez.
 */
export function terminosCruzados({ interactions, prev, t, reproduciendo, velocidad = 1 }) {
  const paso = t - prev;
  if (!reproduciendo || !(paso > 0) || paso > umbralPaso(velocidad)) return [];
  return (interactions || [])
    .map((ia, i) => ({ ia, i }))
    .filter(({ ia }) => esTermino(ia) && visibleEn(ia, t) && !visibleEn(ia, prev))
    .sort((a, b) => a.ia.time - b.ia.time || a.i - b.i)
    .map(({ ia }) => ({ id: ia.id, nombre: nombreDe(ia) }));
}

/**
 * Las marcas de la barra en la pantalla del glosario: los términos son rayitas y lo
 * que frena (preguntas, notas, puntos para tocar) cuadraditos; `visto` si su segundo
 * ya pasó. `left` en porcentaje. Sin duración, ninguna.
 *
 * @returns {Array<{id: string, tipo: 'termino'|'frena', left: number, visto: boolean}>}
 */
export function marcadores(interactions, t, duracion) {
  const d = Number(duracion);
  if (!(d > 0)) return [];
  return (interactions || [])
    .filter((ia) => esTermino(ia) || frena(ia))
    .map((ia) => ({
      id: ia.id, tipo: esTermino(ia) ? "termino" : "frena",
      left: Math.max(0, Math.min(100, (Number(ia.time) / d) * 100)),
      visto: visibleEn(ia, t),
    }));
}

/**
 * ¿Cerrar (plegar) un término retoma la TV? Expandirlo la PAUSA (Erick: "no se frena
 * cuando hago click en las etiquetas") y plegarlo la retoma, salvo que mientras tanto
 * la haya pausado el alumno (eso apaga `pausoElTermino`: el botón, la barra de
 * espacio, cualquier play o pausa del medio) o la haya frenado una pregunta, una nota,
 * la tarjeta de fin o un error.
 */
export function retomarAlCerrar({ pausoElTermino, pregunta, error }) {
  return !!pausoElTermino && !pregunta && !error;
}
