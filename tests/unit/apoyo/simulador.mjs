// Simulador mínimo del reproductor alrededor del efecto de disparo, para probar el
// candado con secuencias de ticks realistas sin navegador.
//
// Qué es REAL y qué es MODELO:
// - Reales (importadas de src/candado.js): debeFrenar, esTickPropio, pendienteARetomar
//   y tiempoAGuardar. Son las decisiones; si cambian, estas pruebas lo ven.
// - Modelo (réplica a mano de InteractiveVideoPlayer.jsx, mantenerla al día si el
//   componente cambia): el orden del efecto de disparo (guardia ANTES del bucle, `prev`
//   que no se mueve con la tarjeta abierta), mostrar (pausa), dismiss (play y después
//   el render), safePlay con su vigía de 700 ms, el freno de 'play' con pregunta
//   abierta, seekTo (salto propio con marca de 1,5 s) y la restauración optimista
//   (marca de 3 s).
// - Modelo del medio: avanza a `rate`, manda un timeupdate cada ~250 ms de reloj con
//   jitter, y los comandos (play, pausa, salto) tardan en aplicarse: la "pausa lenta"
//   de Vimeo en un celular es justo lo que hacía saltear la segunda pregunta pegada.
// Todo con reloj simulado y azar con semilla: cada corrida es reproducible.
import { debeFrenar, esTickPropio, pendienteARetomar, tiempoAGuardar } from '../../../src/candado.js';

export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Interacciones de prueba, con la forma del PLAYER_CONFIG.
export const MC = (id, time) => ({ id, type: 'multiple-choice', time, data: { correctId: 'a' } });
export const NOTA = (id, time) => ({ id, type: 'note', time, data: {} });
export const VF = (id, time) => ({ id, type: 'true-false', time, data: { correct: false } });
export const HS = (id, time, duration) => ({ id, type: 'hotspot', time, ...(duration ? { duration } : {}), data: { spots: [] } });
export const ETIQUETA = (id, time) => ({ id, type: 'label', time, duration: 8, data: {} });

/**
 * @param {object} op
 * @param {Array} op.interactions
 * @param {number} [op.duracion] segundos de video
 * @param {number} [op.rate] velocidad de reproducción
 * @param {number} [op.tickMs] período del timeupdate (reloj)
 * @param {number} [op.jitterMs] ± sobre el período
 * @param {number} [op.latMs] lo que tarda en aplicarse un play o un salto
 * @param {number} [op.latPausaMs] lo que tarda en aplicarse una pausa
 * @param {number} [op.respuestaMs] lo que tarda el alumno en cerrar la tarjeta (null: no la cierra)
 * @param {number} [op.semilla]
 */
export function crearSimulador(op) {
  const { interactions, duracion = 120, rate = 1, tickMs = 250, jitterMs = 40, latMs = 60, respuestaMs = 1500, semilla = 1 } = op;
  const latPausaMs = op.latPausaMs ?? latMs;
  const azar = mulberry32(semilla);
  let ahora = 0, seq = 0, eventos = 0;
  const cola = [];
  const at = (w, fn) => cola.push({ w, s: seq++, fn });

  // ── El medio ──
  const M = { reproduciendo: false, p0: 0, w0: 0, gen: 0, timeupdates: 0 };
  const pos = () => (M.reproduciendo ? Math.min(duracion, M.p0 + rate * (ahora - M.w0) / 1000) : M.p0);

  // ── El componente ──
  const C = {
    currentTime: 0, prev: 0, activa: null, completed: new Set(), triggered: new Set(),
    seekTarget: null, destinoPropio: null, propioHasta: 0, fin: Infinity, intento: null,
    mostradas: [], tiempos: [],
  };

  // timeupdate: llega unos ms después de medir la posición. Fija la duración real
  // (finRef) y pasa por setCurrent, que dispara el efecto si el tiempo cambió.
  const timeupdate = (p) => at(ahora + 3, () => { M.timeupdates++; C.fin = duracion; setCurrent(p); });
  function programarTicks() {
    const gen = ++M.gen;
    let primero = true;
    const sig = () => {
      const espera = primero ? azar() * tickMs : tickMs + (azar() * 2 - 1) * jitterMs;
      primero = false;
      at(ahora + espera, () => {
        if (M.gen !== gen || !M.reproduciendo) return;
        const p = pos();
        if (p >= duracion) { M.p0 = duracion; M.reproduciendo = false; M.gen++; timeupdate(duracion); return; }
        timeupdate(p);
        sig();
      });
    };
    sig();
  }
  // Comandos al medio, con su demora.
  const medioPlay = () => at(ahora + latMs, () => {
    if (M.reproduciendo || M.p0 >= duracion) return;
    M.reproduciendo = true; M.w0 = ahora; programarTicks();
    // Manejador de 'play' del componente: con una pregunta abierta, un play que no
    // pidió (auriculares, Centro de control) se vuelve a pausar.
    if (C.activa) medioPausa();
  });
  const medioPausa = () => at(ahora + latPausaMs, () => {
    if (!M.reproduciendo) return;
    M.p0 = pos(); M.w0 = ahora; M.reproduciendo = false; M.gen++;
    timeupdate(M.p0);
  });
  const medioSalto = (x, alAterrizar) => at(ahora + latMs, () => {
    M.p0 = x; M.w0 = ahora;
    if (M.reproduciendo) programarTicks(); else M.gen++;
    if (alAterrizar) alAterrizar();
    timeupdate(x);   // 'seeked' + timeupdate, también en pausa
  });

  // seekTo del componente: salto PROPIO (marca de 1,5 s con destino) y en vuelo hasta aterrizar.
  const seekTo = (x) => {
    C.destinoPropio = x; C.propioHasta = ahora + 1500; C.seekTarget = x;
    medioSalto(x, () => { if (C.seekTarget === x) C.seekTarget = null; });
  };
  // safePlay: play + vigía a los 700 ms (si el medio sigue en pausa y nadie anuló el
  // pedido, lo repite). Lo anulan mostrar una tarjeta y la pausa del alumno. Sin el
  // vigía, una pausa lenta que aterriza DESPUÉS de cerrar la tarjeta deja el video
  // parado para siempre (pasa en el componente real: por eso existe).
  const safePlay = () => {
    const intento = {};
    C.intento = intento;
    medioPlay();
    at(ahora + 700, () => { if (C.intento === intento && !M.reproduciendo && M.p0 < duracion) medioPlay(); });
  };
  const mostrar = (ia, porGuardia) => {
    C.triggered.add(ia.id); C.activa = ia; C.intento = null;
    C.mostradas.push({ id: ia.id, tiempo: ia.time, en: C.currentTime, w: ahora, porGuardia });
    medioPausa();
    if (respuestaMs != null) at(ahora + respuestaMs, cerrar);
  };
  // dismiss: completa, safePlay() en el handler y DESPUÉS el render (el efecto).
  function cerrar() {
    if (!C.activa) return;
    C.completed.add(C.activa.id); C.activa = null;
    safePlay();
    efecto();
  }

  // Réplica del efecto de disparo de InteractiveVideoPlayer.jsx (sin el bucle de
  // video ni la evaluación contra el fin, que no se simulan acá).
  function efecto() {
    const prev = C.prev;
    if (C.activa) return;
    const t = C.currentTime;
    C.prev = t;
    const tickPropio = esTickPropio(t, C.destinoPropio, C.propioHasta, ahora);
    if (C.seekTarget == null && !tickPropio) {
      const r = pendienteARetomar({ interactions, completed: C.completed, triggered: C.triggered, prev, t, currentTime: C.currentTime, fin: C.fin });
      // Igual que el componente: prev pasa a la vuelta (ver el 🔴 en el JSX).
      if (r) { C.prev = r.vuelta; C.currentTime = r.vuelta; seekTo(r.vuelta); mostrar(r.ia, true); return; }
    }
    for (const ia of interactions) {
      if (ia.type === 'label') continue;
      if (C.completed.has(ia.id) || C.triggered.has(ia.id)) continue;
      if (ia.type === 'hotspot') {
        if (C.currentTime >= ia.time && C.currentTime <= ia.time + (ia.duration || 8)) { mostrar(ia, false); return; }
      } else if (debeFrenar(ia.time, prev, t, C.fin)) { mostrar(ia, false); return; }
    }
  }
  function setCurrent(t) {
    if (t === C.currentTime) return;
    C.currentTime = t;
    C.tiempos.push({ w: ahora, t });
    efecto();
  }

  // ── Lo que hace el alumno (o el sistema) ──
  const api = {
    C, M, pos, at,
    get ahora() { return ahora; },
    // El reproductor quedó listo: primer render con el tiempo en 0.
    listo() { efecto(); },
    // Botón de play (con una pregunta abierta, los controles están inert: no hace nada).
    play() { if (!C.activa) safePlay(); },
    pausa() { C.intento = null; medioPausa(); },
    // Play que no pasó por el reproductor: Centro de control, auriculares, la TV.
    playDeAfuera() { medioPlay(); },
    // Salto que NO pidió el reproductor: ±15 s de la pantalla de bloqueo, auriculares.
    saltoExterno(x) { medioSalto(x); },
    // Salto propio a un destino que ya respeta el candado (skip/barra): optimista + seekTo.
    saltoPropio(x) { seekTo(x); setCurrent(x); },
    // Efecto de carga del avance guardado (la restauración optimista).
    restaurar({ completed = [], currentTime = 0 }) {
      for (const id of completed) { C.completed.add(id); C.triggered.add(id); }
      const tRetomar = currentTime ? tiempoAGuardar(currentTime, null, Infinity, interactions, new Set(completed)) : 0;
      if (tRetomar) {
        C.destinoPropio = tRetomar; C.propioHasta = ahora + 3000;   // marcarSaltoPropio(t, 3000)
        medioSalto(tRetomar);                                       // setCurrentTime directo, sin seekTo
        setCurrent(tRetomar);                                       // optimista: el render con el estado nuevo
      } else efecto();
    },
    cerrar,
    correrHasta,
    // Deja pasar `ms` de reloj procesando lo que haya. Con el video quieto la cola se
    // vacía y el reloj no avanzaría solo: para "esperar 1,5 s" usar esto, no correrHasta.
    esperar(ms) {
      let llego = false;
      at(ahora + ms, () => { llego = true; });
      correrHasta(() => llego);
    },
  };
  // Procesa eventos hasta que `cond()` dé true, se vacíe la cola o pase `maxMs` de reloj.
  function correrHasta(cond, maxMs = 20 * 60 * 1000) {
    while (cola.length) {
      if (cond && cond()) return true;
      cola.sort((a, b) => a.w - b.w || a.s - b.s);
      const e = cola.shift();
      ahora = e.w; e.fn();
      if (++eventos > 500000) throw new Error('el simulador no termina (¿un salto en bucle?)');
      if (ahora > maxMs) return !!(cond && cond());
    }
    return !!(cond && cond());
  }
  return api;
}
