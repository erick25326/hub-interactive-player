// Los sonidos de aviso (tic-tac antes de una interacción que frena, "plop" al frenar y
// uno suave cuando se suma un término al glosario) y la vibración. Sintetizados con Web
// Audio: sin archivos, así el reproductor sigue siendo UN solo HTML. Los tonos son los
// del prototipo que aprobó Erick (18-oct-2026), a volumen moderado.
// Qué tocar y cuándo lo decide src/avisos.js (puro); acá sólo se toca.
//
// 🔴 El AudioContext se crea (o se reanuda) en el primer GESTO del alumno, el play:
// fuera de un gesto los navegadores lo dejan suspendido (y en iPhone mudo para siempre).
// Hasta entonces no suena ni vibra nada: Chrome además bloquea navigator.vibrate sin un
// toque previo, con un aviso en la consola.
// En iPhone/iPad se pide la sesión de audio 'playback' (Safari 16.4+), así el
// interruptor de silencio no apaga los avisos; donde no existe, no pasa nada.

/** ¿Este equipo puede vibrar? navigator.vibrate existe también en Chrome de escritorio
 *  (sin motor que vibre): se pide además una pantalla táctil. iPhone no lo tiene. */
export function vibracionPosible(ventana = typeof window !== "undefined" ? window : null) {
  const n = ventana && ventana.navigator;
  if (!n || typeof n.vibrate !== "function") return false;
  try { if (n.maxTouchPoints > 0) return true; } catch (e) {}
  try { return !!ventana.matchMedia && ventana.matchMedia("(any-pointer: coarse)").matches; } catch (e) { return false; }
}

export function crearSonidos(ventana = typeof window !== "undefined" ? window : null) {
  let ctx = null;
  let desbloqueado = false;

  // En el gesto (el play): crea o reanuda el contexto. Se puede llamar en cada play.
  // `audio: false` (el alumno apagó los sonidos): sólo anota el gesto, para vibrar; ni
  // contexto ni sesión de audio. Si después los prende, ese toque los crea.
  function desbloquear({ audio = true } = {}) {
    desbloqueado = true;
    if (!audio) return;
    try {
      const s = ventana.navigator.audioSession;
      if (s && s.type !== "playback") s.type = "playback";
    } catch (e) {}
    const Ctor = ventana && (ventana.AudioContext || ventana.webkitAudioContext);
    if (!Ctor) return;
    try {
      if (!ctx || ctx.state === "closed") ctx = new Ctor();
      if (ctx.state !== "running" && ctx.resume) ctx.resume().catch(() => {});
    } catch (e) { ctx = null; }
  }

  // Un tono con su envolvente (sube en 6 ms y se apaga exponencial: sin clic). Sólo con
  // el contexto andando: uno suspendido (la pestaña volvió de fondo, una llamada en
  // iPhone) se reanuda y este aviso se pierde, en vez de sonar tarde todo junto.
  function tono(f0, f1, dur, vol, tipo, retraso = 0) {
    if (!ctx) return false;
    try {
      if (ctx.state !== "running") { if (ctx.state !== "closed" && ctx.resume) ctx.resume().catch(() => {}); return false; }
      const t = ctx.currentTime + retraso;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = tipo;
      o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // connect() devuelve el destino en los navegadores nuevos, pero no en Safari viejo.
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
      return true;
    } catch (e) { return false; }
  }

  return {
    desbloquear,
    desbloqueado: () => desbloqueado,
    /** Tic de la cuenta regresiva: alto en el 3 y el 1, bajo en el 2. */
    tic(alto) { return tono(alto ? 1650 : 1250, null, 0.045, 0.2, "triangle"); },
    /** Al frenar y mostrarse una pregunta, nota o actividad. */
    plop() {
      const ok = tono(620, 170, 0.16, 0.3, "sine");
      tono(980, null, 0.05, 0.08, "sine", 0.02);
      return ok;
    },
    /** Cuando un término se suma al glosario: más corto, más agudo y más bajo. */
    plopSuave() { return tono(880, 520, 0.08, 0.12, "sine"); },
    /** Vibra si el equipo puede y ya hubo un gesto. */
    vibrar(patron) {
      if (!desbloqueado || !vibracionPosible(ventana)) return false;
      try { return !!ventana.navigator.vibrate(patron); } catch (e) { return false; }
    },
  };
}
