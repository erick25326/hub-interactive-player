// Los TRAMOS VISTOS de un video (la curva de retención, 1.5.0): el video se parte en
// tramos de 5 s y, mientras se reproduce DE CORRIDO, cada tramo en el que se entra suma 1
// (tope 9). Volver a entrar después de retroceder suma otra vez; quedarse en el mismo
// tramo (una pausa, retomar) no. Un salto (la barra, ±10 s, la transcripción, restaurar
// el avance, un salto de afuera) no suma los tramos que saltea: el tramo donde aterriza
// cuenta recién si desde ahí se sigue reproduciendo.
//
// Lo puro vive acá para probarlo sin React ni navegador (tests/unit/vistas.test.mjs). El
// componente le pasa cada timeupdate del motor activo (el <video>, Vimeo o la TV) con el
// reloj (performance.now) y si ese tick cuenta: reproduciendo, sin un salto en vuelo, sin
// una pregunta abierta y con la pestaña a la vista (o transmitiendo a la TV, que se mira
// en la TV aunque el celular esté bloqueado). Lo que se manda a progress.php sale de
// entradasParaEnviar; el servidor (ivplayer_vistas_combinar, lib.php) suma por alumno,
// video y DÍA.
//
// 🔴 Lo que viaja es ABSOLUTO por sesión de la página (lo que vio esta carga, ese día), no
// lo nuevo desde el último envío: la cola de scorm.js reemplaza el envío pendiente de la
// lección, el beacon de pagehide llega además del reenvío de la cola y un POST cuya
// respuesta se perdió se reintenta. El servidor guarda lo último que sumó de cada sesión y
// suma sólo la diferencia, así un envío repetido no cuenta dos veces.

export const TRAMO_S = 5;
export const TOPE = 9;
// "De corrido": entre dos ticks el video no avanzó más de lo que deja el reloj (por la
// velocidad) más esta holgura. Más que eso es un salto hacia adelante. Medido con el reloj
// y no con un umbral fijo: con la pestaña oculta transmitiendo, los timers se espacian (un
// tick por segundo, o por minuto) y la TV sigue reproduciendo: eso sí es de corrido.
export const HOLGURA_S = 1.5;
// Un paso atrás menor que esto es ruido, no un retroceso: el estimador de la TV se corrige
// unas décimas cuando llega el estado real. Se descarta el tick (si no, una corrección en el
// borde de un tramo lo contaba otra vez).
export const RUIDO_ATRAS_S = 1.5;
// Entradas por envío: la sesión de hoy, la de ayer si la página pasó la medianoche, y las
// de otras cargas que quedaron en la cola sin llegar (juntarEntradas).
export const MAX_ENTRADAS = 4;

export const cantidadDeTramos = (duracion) => (duracion > 0 ? Math.ceil(duracion / TRAMO_S - 1e-9) : 0);

/** El tramo de un segundo, acotado al último (el fin exacto de un video de 60 s es el tramo 11). */
export function tramoDe(t, n) {
  const i = Math.floor(Math.max(0, t) / TRAMO_S);
  return n > 0 ? Math.min(i, n - 1) : i;
}

/** El día LOCAL del alumno, como entero AAAAMMDD (20261115). */
export function diaDe(fecha) {
  return fecha.getFullYear() * 10000 + (fecha.getMonth() + 1) * 100 + fecha.getDate();
}

/** Una sesión nueva (una carga de la lección). `sesion` es su id, al azar (lo pone el componente). */
export function crearVistas(sesion) {
  return { sesion, duracion: 0, dias: {}, orden: [], ultimo: -1, base: null };
}

function delDia(v, dia) {
  let d = v.dias[dia];
  if (!d) {
    d = { cuentas: [], segundos: 0 };
    v.dias[dia] = d;
    v.orden.push(dia);
  }
  return d;
}

/**
 * Un timeupdate. Devuelve la misma sesión (la modifica: corre 4 o 5 veces por segundo).
 * @param {object} v la sesión (crearVistas)
 * @param {object} p
 * @param {number} p.t segundo del video
 * @param {number} p.reloj performance.now() del tick, en ms
 * @param {boolean} p.cuenta si este tick puede sumar (ver arriba)
 * @param {number} [p.duracion] la del medio, si se conoce
 * @param {number} [p.velocidad] la de reproducción
 * @param {number} p.dia el día local (diaDe)
 */
export function registrarTick(v, { t, reloj, cuenta, duracion = 0, velocidad = 1, dia }) {
  if (!Number.isFinite(t)) return v;
  if (duracion > 0) v.duracion = duracion;
  // Pausa, pestaña oculta, salto en vuelo o pregunta abierta: no suma y el próximo tick
  // que cuente arranca de nuevo (no se sabe qué pasó en el medio). `ultimo` queda: retomar
  // en el mismo tramo no lo cuenta otra vez.
  if (!cuenta) { v.base = null; return v; }
  if (!v.base) { v.base = { t, reloj }; return v; }
  const d = t - v.base.t;
  if (d < 0) {
    if (d >= -RUIDO_ATRAS_S) return v;           // ruido del reloj: se descarta el tick
    v.base = { t, reloj };                        // retrocedió: el próximo tramo cuenta de nuevo
    return v;
  }
  const w = Math.max(0, reloj - v.base.reloj) / 1000;
  if (d > w * Math.max(0.25, velocidad || 1) + HOLGURA_S) { v.base = { t, reloj }; return v; } // salto adelante
  const n = cantidadDeTramos(v.duracion);
  const desde = tramoDe(v.base.t, n), hasta = tramoDe(t, n);
  const hoy = delDia(v, dia);
  hoy.segundos += d;
  for (let i = desde; i <= hasta; i++) {
    if (i === v.ultimo) continue;
    while (hoy.cuentas.length <= i) hoy.cuentas.push(0);
    hoy.cuentas[i] = Math.min(TOPE, hoy.cuentas[i] + 1);
    v.ultimo = i;
  }
  v.base = { t, reloj };
  return v;
}

/**
 * Lo que va a progress.php: una entrada por día de esta sesión (los dos últimos), con los
 * tramos como una cifra por tramo ("0111222100…", tantas como tramos tiene el video).
 * Vacío si todavía no se vio nada o no se conoce la duración.
 * @returns {Array<{sesion:string, dia:number, tramos:string, segundos:number, duracion:number}>}
 */
export function entradasParaEnviar(v) {
  const n = cantidadDeTramos(v.duracion);
  if (!n) return [];
  return v.orden.slice(-2).map((dia) => {
    const { cuentas, segundos } = v.dias[dia];
    let tramos = "";
    for (let i = 0; i < n; i++) tramos += String(cuentas[i] || 0);
    return { sesion: v.sesion, dia, tramos, segundos: Math.round(segundos), duracion: Math.round(v.duracion) };
  }).filter((e) => /[1-9]/.test(e.tramos));
}

/**
 * Junta las entradas de un envío pendiente con las del nuevo, para la cola de scorm.js
 * (que guarda UN envío por lección y el nuevo reemplaza al viejo). Las de otra sesión u
 * otro día que no llegaron viajan con el nuevo; de la misma sesión y día gana la nueva
 * (es absoluta y más completa). Se quedan las últimas MAX_ENTRADAS.
 */
export function juntarEntradas(anteriores, nuevas) {
  const clave = (e) => `${e.sesion}|${e.dia}`;
  const nuevasClaves = new Set((nuevas || []).map(clave));
  const quedan = (anteriores || []).filter((e) => e && !nuevasClaves.has(clave(e)));
  return [...quedan, ...(nuevas || [])].slice(-MAX_ENTRADAS);
}
