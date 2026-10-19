// Web Audio y vibración de MENTIRA para las pruebas de los avisos (escenarios/avisos.mjs
// y glosario.mjs). El servidor lo inyecta con ?sonido=simulado, antes del bundle y
// después del ayudante de la página. En headless no se oye nada: acá se anota cada
// sonido que el reproductor sintetiza (tipo de onda, frecuencias y volumen, en qué
// segundo del VIDEO y en qué milisegundo de la página), cada vibración, si el contexto
// se creó dentro de un gesto, y los cambios de la cuenta regresiva.
// Lo que suena lo arma src/sonidos.js: tic = triangle 1650 (alto) / 1250 (bajo),
// plop = sine 620→170 (+ 980 corto), suave (glosario) = sine 880→520.
// También dice que hay pantalla táctil (maxTouchPoints): sin eso el reproductor no
// ofrece ni usa la vibración (en la compu navigator.vibrate existe pero no vibra).
(() => {
  if (window.__sonidos) return;
  const S = window.__sonidos = { contextos: [], osc: [], vib: [], cuentas: [], reanudar: 0 };
  const A = () => window.__ivp;
  const ms = () => (A() ? A().ms() : Math.round(performance.now()));
  const t = () => { try { return A() ? A().comp() : null; } catch (e) { return null; } };
  const activo = () => (navigator.userActivation ? navigator.userActivation.isActive : null);

  class Param {
    constructor(reg, k) { this.reg = reg; this.k = k; }
    setValueAtTime(v) { if (this.k === 'f' && this.reg.f0 == null) this.reg.f0 = v; return this; }
    exponentialRampToValueAtTime(v) { if (this.k === 'f') this.reg.f1 = v; else this.reg.vol = Math.max(this.reg.vol || 0, v); return this; }
    linearRampToValueAtTime() { return this; }
  }
  class Ganancia {
    constructor() { this.reg = {}; this.gain = new Param(this.reg, 'g'); }
    connect(d) { return d; }
    disconnect() {}
  }
  class Oscilador {
    constructor() { this.reg = { tipo: 'sine', f0: null, f1: null, vol: null }; this.frequency = new Param(this.reg, 'f'); this.g = null; }
    set type(v) { this.reg.tipo = v; }
    get type() { return this.reg.tipo; }
    connect(d) { this.g = d; return d; }
    disconnect() {}
    start() {
      const r = this.reg;
      const que = r.tipo === 'triangle' ? (r.f0 === 1650 ? 'tic-alto' : r.f0 === 1250 ? 'tic-bajo' : 'tic?')
        : r.f0 === 620 ? 'plop' : r.f0 === 980 ? 'plop-blip' : r.f0 === 880 ? 'suave' : 'otro';
      S.osc.push({ que, tipo: r.tipo, f0: r.f0, f1: r.f1, vol: this.g && this.g.reg ? this.g.reg.vol : null, ms: ms(), t: t() });
    }
    stop() {}
  }
  class Contexto {
    constructor() {
      // Como Chrome: creado dentro de un gesto arranca andando; fuera, suspendido.
      const enGesto = activo();
      this.state = enGesto ? 'running' : 'suspended';
      this.currentTime = 0;
      this.destination = {};
      S.contextos.push({ ms: ms(), enGesto });
    }
    resume() { S.reanudar++; if (activo() !== false) this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createOscillator() { return new Oscilador(); }
    createGain() { return new Ganancia(); }
  }
  window.AudioContext = Contexto;
  window.webkitAudioContext = Contexto;
  try {
    Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, writable: true, value: function (p) { S.vib.push({ ms: ms(), t: t(), patron: p }); return true; } });
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => 5 });
  } catch (e) {}

  // La cuenta regresiva que se ve ("3 Se viene una nota"): cada cambio, con el segundo
  // del video; null cuando ya no está.
  let ultima = null;
  const mirar = () => {
    const c = document.querySelector('.iv-cuenta');
    const parte = (s) => ((c && c.querySelector(s)) || {}).textContent || '';
    const txt = c ? `${parte('.iv-cuenta-num')} ${parte('.iv-cuenta-texto')}`.trim() : null;
    if (txt !== ultima) { ultima = txt; S.cuentas.push({ ms: ms(), t: t(), txt }); }
  };
  const arrancar = () => new MutationObserver(mirar).observe(document.body, { subtree: true, childList: true, characterData: true });
  if (document.body) arrancar(); else document.addEventListener('DOMContentLoaded', arrancar);
})();
