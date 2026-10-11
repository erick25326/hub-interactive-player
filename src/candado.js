// El CANDADO de preguntas: las decisiones puras que impiden pasar una pregunta sin
// verla. Viven acá, fuera de InteractiveVideoPlayer.jsx, para poder probarlas sin
// React ni navegador (tests/unit/candado*.test.mjs). El componente sólo las llama:
// los refs, el reloj (Date.now) y los efectos (seek, pausa, mostrar la tarjeta) se
// quedan allá. Si se cambia algo acá, correr las pruebas: es lo que no se puede romper.

/**
 * ¿Hay que frenar el video en una interacción que pausa (nota o pregunta)?
 *
 * 🔴 Reproduciendo, frena recién AL LLEGAR a su tiempo, nunca antes. Antes se
 * disparaba con |t − tiempo| < 0,8 s, así que un tick que caía a 7,3 s frenaba
 * una pregunta de los 8 s y se comía el final de la frase, justo donde se ubican
 * las preguntas: al terminar lo que se dice antes de la pausa. Ahora se frena
 * entre 0 y un tick (≤0,25 s) después, que cae en el silencio que sigue.
 *
 * En un seek (salto de más de 2 s entre ticks) se acepta caer un poco antes: el
 * skip y el scrub aterrizan EXACTO en la próxima interacción pendiente, y el
 * reproductor puede quedar unas centésimas antes de ese punto. Si no se frenara
 * ahí, el salto quedaría parado delante de la pregunta sin mostrarla.
 *
 * Un salto hacia adelante que CRUZA el tiempo no es un seek del alumno (el skip
 * y el scrub nunca cruzan una pendiente): es el hilo trabado unos segundos, con
 * React juntando varios timeupdate en un solo render. Se frena igual si el salto
 * es de hasta SALTO_CRUCE, o de cualquier tamaño si el render anterior ya estaba
 * a menos de DESPUES del tiempo (ahí el código viejo frenaba, antes de tiempo).
 *
 * `fin` es la duración REAL del medio. Una interacción en el último tramo, o
 * puesta después del fin (el configurador guarda segundos enteros y Vimeo
 * informa 79 s para un video de 78,72), se frena con el último tick.
 */
export const SEEK_MIN = 2;          // salto entre ticks que se considera seek
export const ANTES_SEEK = 0.25;     // tolerancia antes del tiempo, sólo en seeks
export const DESPUES = 0.8;         // hasta cuánto después todavía se frena
export const SALTO_CRUCE = 6;       // salto que cruza el tiempo: ticks trabados, no seek
// Después de un salto propio, hasta cuánto más allá de su destino puede caer el
// primer tick y seguir siendo de ese salto: a 2× con el tick de Vimeo atrasado
// ~1 s en un celular, el video ya avanzó un par de segundos.
export const PROPIO_TOLERANCIA = 3;
export function debeFrenar(tiempo, prev, t, fin = Infinity) {
  tiempo = Math.min(tiempo, fin - 0.05);
  const salto = t - prev;
  if (Math.abs(salto) > SEEK_MIN) {
    if (prev < tiempo && t >= tiempo && (salto <= SALTO_CRUCE || prev >= tiempo - DESPUES)) return true;
    return t >= tiempo - ANTES_SEEK && t < tiempo + DESPUES;
  }
  // Reproducción: llegó o pasó el tiempo y el tick anterior todavía no lo había
  // dejado atrás por más de DESPUES (cubre también una interacción en el 0).
  return t >= tiempo && prev < tiempo + DESPUES;
}

/**
 * Qué tiempo guardar como avance. Con una pregunta abierta se guarda SU tiempo
 * (acotado al fin real), no dónde está el video: a 2× con el pause lento queda
 * más de 0,8 s después, y una pregunta del final queda abierta con el video ya
 * rebobinado a 0. En los dos casos, al volver, la restauración no la mostraba más
 * (ni se completaba la actividad). Restaurar en su tiempo la frena por el seek.
 *
 * Tampoco se guarda más allá de una pendiente (no-label, sin completar) que quedó
 * atrás: la guardia la corrige en el MISMO commit en que este efecto guarda el
 * tiempo saltado, y con la tarjeta abierta no se vuelve a guardar. Al volver, se
 * restauraba pasada la pregunta y no aparecía más. De paso repara los avances
 * viejos que ya quedaron más allá de una pendiente: se retoma en ella.
 */
export function tiempoAGuardar(t, activeIA, fin = Infinity, interactions = [], completed = new Set()) {
  if (activeIA) return Math.min(activeIA.time, fin - 0.05);
  let p = Infinity;
  for (const ia of interactions) if (ia.type !== "label" && !completed.has(ia.id) && ia.time < t && ia.time < p) p = ia.time;
  return p < t ? Math.max(0, Math.min(p, fin - 0.05)) : t;
}

/**
 * ¿Este tick es el aterrizaje de un salto PROPIO (barra, skip, transcripción,
 * restaurar, la vuelta de la TV)? Entonces la guardia de saltos no lo toca.
 *
 * `destino` y `hasta` son los que dejó marcarSaltoPropio en el componente: a dónde
 * se pidió saltar y hasta qué hora (Date.now) vale la marca. `ahora` es Date.now().
 *
 * 🔴 El destino importa tanto como el reloj: con sólo la ventana de tiempo, un
 * salto EXTERNO que llegaba en esos 1,5 s (3 s después de restaurar) —pantalla
 * de bloqueo, auriculares, Vimeo— pasaba sin guardia y salteaba preguntas. Un
 * tick que cae lejos del destino pedido es externo aunque llegue en la ventana.
 */
export function esTickPropio(t, destino, hasta, ahora) {
  return ahora <= hasta && destino != null && t >= destino - 1 && t <= destino + PROPIO_TOLERANCIA;
}

/**
 * La DECISIÓN de la guardia de saltos que NO pidió el reproductor (los ±15 s de la
 * pantalla de bloqueo, el Centro de control o los auriculares, o un hilo trabado
 * largo): ¿el salto de `prev` a `t` dejó atrás una pregunta pendiente que haya que
 * retomar? Devuelve `{ ia, vuelta }` (la MÁS TEMPRANA de las cruzadas y el segundo
 * al que hay que volver, acotado al fin) o null si no hay que hacer nada.
 *
 * El componente la llama sólo cuando no hay un salto propio en vuelo ni aterrizando
 * (ver esTickPropio), y ANTES del bucle de disparo: si el salto aterrizaba en la
 * ventana de otra pendiente (o dentro de los 8 s de un hotspot), el bucle frenaba
 * ésa y las anteriores quedaban salteadas para siempre.
 *
 * Si cruzó una sola y el bucle igual la frena (tick lento, hilo trabado corto), se
 * deja como estaba: null, sin un seek de más.
 *
 * `currentTime` es el tiempo del estado y `t` el que se evalúa: son distintos cuando
 * se evalúa contra el fin con el video ya rebobinado. La ventana del hotspot se mira
 * en `currentTime`, igual que en el bucle.
 *
 * @param {object} p
 * @param {Array} p.interactions las del PLAYER_CONFIG
 * @param {Set} p.completed ids completadas
 * @param {Set} p.triggered ids que ya se mostraron (triggered.current)
 * @param {number} p.prev tiempo del render anterior
 * @param {number} p.t tiempo que se evalúa
 * @param {number} p.currentTime tiempo del estado
 * @param {number} [p.fin] duración real del medio
 */
export function pendienteARetomar({ interactions, completed, triggered, prev, t, currentTime, fin = Infinity }) {
  if (!(t > prev + DESPUES)) return null;
  const cruzadas = interactions.filter(ia => ia.type !== "label" && !completed.has(ia.id) && !triggered.has(ia.id) && ia.time > prev && ia.time < t).sort((a, b) => a.time - b.time);
  const saltada = cruzadas[0];
  if (!saltada) return null;
  const laFrenaElBucle = saltada.type === "hotspot"
    ? currentTime >= saltada.time && currentTime <= saltada.time + (saltada.duration || 8)
    : debeFrenar(saltada.time, prev, t, fin);
  if (cruzadas.length === 1 && laFrenaElBucle) return null;
  return { ia: saltada, vuelta: Math.max(0, Math.min(saltada.time, fin - 0.05)) };
}
