// Los AVISOS de las interacciones que frenan el video (preguntas, notas, puntos para
// tocar): el tic-tac de los 3 segundos antes, la cuenta regresiva que se ve en el
// reproductor y el "plop" al frenar. Pedido de Erick (18-oct-2026): el alumno que está
// mirando para otro lado (tomando nota, con el video en la TV) se entera de que viene
// algo que lo va a frenar, y el celular vibra.
// Las decisiones viven acá, puras (sin React, sin Web Audio, sin reloj), para probarlas
// sin navegador (tests/unit/avisos.test.mjs). El componente las llama en cada render
// del tiempo y hace lo que digan: tocar el sonido (src/sonidos.js), vibrar y mostrar la
// cuenta. El candado (src/candado.js) sigue siendo el que decide cuándo se FRENA: acá
// sólo se avisa antes, con su misma vara de "pendiente".

import { SEEK_MIN } from "./candado.js";

// Cuántos segundos antes avisa (en tiempo de VIDEO: a 2× suenan cada medio segundo).
export const AVISO_S = 3;
// Vibración de cada tic (corta) y la de frenar (un poco más larga, en dos golpes).
export const VIBRA_TIC = 40;
export const VIBRA_FRENO = [60, 40, 60];
// Un tic ya tocado se puede repetir recién cuando el tiempo vuelve más de esto antes de
// su marca (un salto hacia atrás de verdad). Un temblor del reloj (el HLS nativo que
// retrocede unas centésimas, el estimador de la TV que se corrige) no lo repite.
export const OLVIDO_S = 0.5;

// Las preferencias del ALUMNO (engranaje → "Sonidos de aviso" y "Vibración"), en el
// localStorage de su navegador. Por defecto, sí.
export const CLAVE_SONIDO = "iv_avisos_sonido";
export const CLAVE_VIBRACION = "iv_avisos_vibracion";

/** ¿Esta interacción frena el video? Todas menos las etiquetas (lo mismo que mira el
 *  efecto de disparo: un tipo desconocido también frena). */
export function frena(ia) {
  return !!ia && ia.type !== "label";
}

/** Qué se viene, en palabras del cartel: "pregunta", "nota" o "actividad". */
export function queSeViene(ia) {
  const t = ia && ia.type;
  if (t === "multiple-choice" || t === "true-false") return "pregunta";
  if (t === "note") return "nota";
  return "actividad";
}

/** El texto de la cuenta regresiva: "Se viene una pregunta". */
export function textoCuenta(ia) {
  return `Se viene una ${queSeViene(ia)}`;
}

// Pendiente para avisar: frena, no se respondió y no se mostró en esta pasada (si ya
// se vio o se respondió, el candado no la frena de nuevo y no hay nada que anunciar).
function pendiente(ia, completed, triggered) {
  return frena(ia) && !completed.has(ia.id) && !triggered.has(ia.id);
}

// El segundo en que de verdad frena (como debeFrenar: una puesta después del fin real
// se frena con el último tick).
function llegada(ia, fin) {
  return Math.min(ia.time, fin - 0.05);
}

/**
 * Los tics que tocan en el paso de `prev` a `t` (tiempo de video): uno a los 3, 2 y 1
 * segundos de cada interacción pendiente que frena, alternando tono alto y bajo (alto
 * en el 3 y el 1).
 *
 * 🔴 Sólo REPRODUCIENDO: si el alumno llega saltando (barra, ±10 s, la transcripción,
 * la restauración del avance), no hay aviso. Un paso de más de SEEK_MIN es un salto
 * aunque `reproduciendo` diga que sí (el mismo umbral que el candado), y uno hacia
 * atrás nunca toca nada.
 *
 * @param {object} p
 * @param {Array} p.interactions las del PLAYER_CONFIG
 * @param {Set} p.completed ids respondidas
 * @param {Set} p.triggered ids que ya se mostraron (triggered.current)
 * @param {number} p.prev tiempo del render anterior
 * @param {number} p.t tiempo de este render
 * @param {boolean} p.reproduciendo si el video se está reproduciendo (no es un salto en pausa)
 * @param {Map} [p.tocados] clave → marca de los tics ya tocados (ver olvidarTics)
 * @param {number} [p.fin] duración real del medio
 * @returns {Array<{clave: string, id: string, ia: object, restan: number, alto: boolean, marca: number}>}
 *          en orden de marca. El componente toca sólo el ÚLTIMO (dos en el mismo paso
 *          sonarían como uno) y da por tocados todos.
 */
export function ticsEntre({ interactions, completed, triggered, prev, t, reproduciendo, tocados = new Map(), fin = Infinity }) {
  const paso = t - prev;
  if (!reproduciendo || !(paso > 0) || paso > SEEK_MIN) return [];
  const out = [];
  for (const ia of interactions || []) {
    if (!pendiente(ia, completed, triggered)) continue;
    const l = llegada(ia, fin);
    for (let restan = AVISO_S; restan >= 1; restan--) {
      const marca = l - restan;
      const clave = `${ia.id}:${restan}`;
      if (prev < marca && marca <= t && !tocados.has(clave)) out.push({ clave, id: ia.id, ia, restan, alto: restan % 2 === 1, marca });
    }
  }
  return out.sort((a, b) => a.marca - b.marca);
}

/**
 * Los tics tocados que hay que olvidar porque el tiempo volvió antes de su marca (un
 * salto hacia atrás, Reiniciar): así el aviso se repite la próxima vez que se cruce.
 * Devuelve un Map nuevo (no toca el que recibe).
 */
export function olvidarTics(tocados, t) {
  const quedan = new Map();
  for (const [clave, marca] of tocados) if (!(t < marca - OLVIDO_S)) quedan.set(clave, marca);
  return quedan;
}

/**
 * Cuántos segundos muestra la cuenta regresiva de `ia` en el tiempo `t` (3, 2 o 1), o
 * null si `t` ya está fuera de los 3 segundos de aviso (llegó, o se fue para atrás).
 * Coincide con el tic: al cruzar la marca de los 3 s dice 3.
 */
export function cuentaRegresiva(ia, t, fin = Infinity) {
  if (!ia) return null;
  const restan = llegada(ia, fin) - t;
  if (!(restan > 0) || restan > AVISO_S + 0.05) return null;
  return Math.max(1, Math.min(AVISO_S, Math.ceil(restan - 1e-6)));
}

/** Una preferencia del alumno: sí salvo que esté guardado "0". Sin almacenamiento (modo
 *  privado, datos bloqueados), sí. */
export function leerPreferencia(clave, almacen) {
  try { return almacen.getItem(clave) !== "0"; } catch (e) { return true; }
}

/** La guarda; si el navegador no deja, vale para esta página y nada más. */
export function guardarPreferencia(clave, valor, almacen) {
  try { almacen.setItem(clave, valor ? "1" : "0"); } catch (e) {}
}
