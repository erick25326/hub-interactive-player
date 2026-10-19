// Los AVISOS de las interacciones que frenan (src/avisos.js): el tic-tac de los 3
// segundos antes, la cuenta regresiva y las preferencias del alumno. Y los sonidos
// (src/sonidos.js) contra un Web Audio y un navigator de mentira: que se creen en el
// gesto, que no suenen ni vibren antes, y el volumen. Lo que hace el componente con
// esto, el nivel navegador (tests/navegador/escenarios/avisos.mjs).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frena, queSeViene, textoCuenta, ticsEntre, olvidarTics, cuentaRegresiva,
  leerPreferencia, guardarPreferencia, AVISO_S, VIBRA_TIC, VIBRA_FRENO, OLVIDO_S, CLAVE_SONIDO, CLAVE_VIBRACION,
} from '../../src/avisos.js';
import { crearSonidos, vibracionPosible } from '../../src/sonidos.js';

const NOTA = { id: 'n10', type: 'note', time: 10, data: { title: 'Nota', text: 'Texto' } };
const MC = { id: 'mc20', type: 'multiple-choice', time: 20, data: { question: '¿?', options: [], correctId: 'a' } };
const VF = { id: 'vf30', type: 'true-false', time: 30, data: { statement: 'Sí', correct: true } };
const HS = { id: 'hs40', type: 'hotspot', time: 40, duration: 8, data: { spots: [] } };
const ETQ = { id: 'e15', type: 'label', time: 15, data: { text: 'Término', definition: 'Def' } };
const RARO = { id: 'x50', type: 'cosa-nueva', time: 50, data: {} };
const TODAS = [NOTA, MC, VF, HS, ETQ, RARO];
const vacio = () => new Set();

// Recorre el video de `desde` a `hasta` con ticks de `paso` s (como timeupdate) y junta
// los tics que tocaría el componente (el último de cada paso), dándolos por tocados.
function recorrer({ interactions = TODAS, desde, hasta, paso = 0.25, completed = vacio(), triggered = vacio(), tocados = new Map(), reproduciendo = true }) {
  const tocadosAhora = [];
  let prev = desde;
  for (let t = desde + paso; t <= hasta + 1e-9; t += paso) {
    tocados = olvidarTics(tocados, t);
    const tics = ticsEntre({ interactions, completed, triggered, prev, t, reproduciendo, tocados });
    for (const x of tics) tocados.set(x.clave, x.marca);
    if (tics.length) tocadosAhora.push({ t: +t.toFixed(3), ...tics[tics.length - 1] });
    prev = t;
  }
  return { tics: tocadosAhora, tocados };
}

test('las constantes de los avisos son las acordadas con Erick', () => {
  assert.deepEqual({ AVISO_S, VIBRA_TIC, VIBRA_FRENO, OLVIDO_S }, { AVISO_S: 3, VIBRA_TIC: 40, VIBRA_FRENO: [60, 40, 60], OLVIDO_S: 0.5 });
});

describe('qué frena y qué se anuncia', () => {
  test('frenan todas menos las etiquetas (también un tipo nuevo, como el efecto de disparo)', () => {
    assert.deepEqual(TODAS.map(frena), [true, true, true, true, false, true]);
    assert.equal(frena(null), false);
  });
  test('el cartel dice pregunta, nota o actividad', () => {
    assert.deepEqual([NOTA, MC, VF, HS, RARO].map(queSeViene), ['nota', 'pregunta', 'pregunta', 'actividad', 'actividad']);
    assert.equal(textoCuenta(MC), 'Se viene una pregunta');
    assert.equal(textoCuenta(NOTA), 'Se viene una nota');
    assert.equal(textoCuenta(HS), 'Se viene una actividad');
  });
});

describe('ticsEntre: el tic-tac de los 3 segundos', () => {
  test('reproduciendo: un tic a los 3, 2 y 1 s de cada una que frena, alto-bajo-alto', () => {
    const { tics } = recorrer({ desde: 0, hasta: 52 });
    const por = (id) => tics.filter((x) => x.id === id).map((x) => [x.restan, x.alto, +x.marca.toFixed(3)]);
    assert.deepEqual(por('n10'), [[3, true, 7], [2, false, 8], [1, true, 9]]);
    assert.deepEqual(por('mc20'), [[3, true, 17], [2, false, 18], [1, true, 19]]);
    assert.deepEqual(por('vf30'), [[3, true, 27], [2, false, 28], [1, true, 29]]);
    assert.deepEqual(por('hs40'), [[3, true, 37], [2, false, 38], [1, true, 39]]);
    assert.deepEqual(por('x50'), [[3, true, 47], [2, false, 48], [1, true, 49]]);
    assert.equal(tics.filter((x) => x.id === 'e15').length, 0, 'las etiquetas no hacen tic-tac');
  });

  test('cada tic suena al CRUZAR su marca, nunca antes (con ticks de cualquier tamaño hasta 2 s)', () => {
    for (const paso of [0.1, 0.25, 0.5, 0.9, 1.5, 2]) {
      const { tics } = recorrer({ interactions: [MC], desde: 10, hasta: 19.99, paso });
      for (const x of tics) assert.ok(x.t >= x.marca - 1e-9 && x.t < x.marca + paso + 1e-9, `paso ${paso}: ${JSON.stringify(x)}`);
      // Con pasos de más de 1 s, dos marcas pueden caer en el mismo paso: suena una.
      assert.ok(tics.length >= Math.min(3, Math.floor(3 / paso)), `paso ${paso}: ${tics.length} tics`);
    }
  });

  test('en tiempo de VIDEO: a 2× (ticks de 0,5 s) suenan los mismos tres, cada medio segundo de reloj', () => {
    const { tics } = recorrer({ interactions: [MC], desde: 15, hasta: 19.9, paso: 0.5 });
    assert.deepEqual(tics.map((x) => x.restan), [3, 2, 1]);
  });

  test('llegar SALTANDO no avisa: un paso de más de 2 s, en pausa o hacia atrás no toca nada', () => {
    const base = { interactions: [MC], completed: vacio(), triggered: vacio() };
    assert.deepEqual(ticsEntre({ ...base, prev: 10, t: 18.5, reproduciendo: true }), [], 'salto de 8,5 s (barra, ±10 s)');
    assert.deepEqual(ticsEntre({ ...base, prev: 16.9, t: 19.5, reproduciendo: true }), [], 'salto de 2,6 s');
    assert.deepEqual(ticsEntre({ ...base, prev: 16.9, t: 17.2, reproduciendo: false }), [], 'en pausa (un salto chico con la barra, restaurar)');
    assert.deepEqual(ticsEntre({ ...base, prev: 19.5, t: 17.5, reproduciendo: true }), [], 'hacia atrás');
    assert.equal(ticsEntre({ ...base, prev: 16.9, t: 17.2, reproduciendo: true }).length, 1, 'y reproduciendo sí');
  });

  test('una ya respondida o ya mostrada no avisa (el candado no la frena)', () => {
    const r = recorrer({ interactions: [NOTA, MC], desde: 0, hasta: 19.9, completed: new Set(['n10']), triggered: new Set(['mc20']) });
    assert.deepEqual(r.tics, []);
  });

  test('un temblor del reloj no repite un tic; un salto hacia atrás de verdad sí, al volver a cruzarlo', () => {
    let tocados = new Map();
    const base = { interactions: [MC], completed: vacio(), triggered: vacio(), reproduciendo: true };
    const paso = (prev, t) => { tocados = olvidarTics(tocados, t); const xs = ticsEntre({ ...base, prev, t, tocados }); xs.forEach((x) => tocados.set(x.clave, x.marca)); return xs.map((x) => x.restan); };
    assert.deepEqual(paso(16.9, 17.1), [3]);
    assert.deepEqual(paso(17.1, 16.95), [], 'retrocede 0,15 s (HLS nativo, estimador de la TV)');
    assert.deepEqual(paso(16.95, 17.2), [], 'y al volver a pasar la marca no suena dos veces');
    // Salto hacia atrás a 12 (la barra): se olvida y al volver a cruzar, suena.
    assert.deepEqual(paso(17.2, 12), []);
    assert.deepEqual(paso(16.8, 17.05), [3]);
  });

  test('una interacción puesta después del fin real avisa antes del fin (frena con el último tick)', () => {
    const tarde = { id: 'tarde', type: 'note', time: 80, data: {} };
    // Frena en 78,67 (fin − 0,05): las marcas son 75,67, 76,67 y 77,67, no 77, 78 y 79.
    const xs = ticsEntre({ interactions: [tarde], completed: vacio(), triggered: vacio(), prev: 75.5, t: 75.8, reproduciendo: true, fin: 78.72 });
    assert.deepEqual(xs.map((x) => [x.restan, +x.marca.toFixed(2)]), [[3, 75.67]]);
    assert.equal(cuentaRegresiva(tarde, 77.8, 78.72), 1);
  });

  test('una al principio del video (en 1 o 2 s) no tiene tics que no se pueden cruzar', () => {
    const temprana = { id: 't1', type: 'true-false', time: 1.5, data: {} };
    const { tics } = recorrer({ interactions: [temprana], desde: 0, hasta: 1.4 });
    assert.deepEqual(tics.map((x) => x.restan), [1]);
  });
});

describe('cuentaRegresiva: el número que se ve', () => {
  test('coincide con el tic y llega hasta 1', () => {
    assert.equal(cuentaRegresiva(MC, 17), 3);
    assert.equal(cuentaRegresiva(MC, 17.6), 3);
    assert.equal(cuentaRegresiva(MC, 18), 2);
    assert.equal(cuentaRegresiva(MC, 19.01), 1);
    assert.equal(cuentaRegresiva(MC, 19.99), 1);
  });
  test('fuera de los 3 segundos, nada: antes, al llegar o pasado', () => {
    assert.equal(cuentaRegresiva(MC, 16.5), null);
    assert.equal(cuentaRegresiva(MC, 20), null);
    assert.equal(cuentaRegresiva(MC, 25), null);
    assert.equal(cuentaRegresiva(null, 18), null);
  });
});

describe('preferencias del alumno (Sonidos de aviso, Vibración)', () => {
  const almacen = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
  test('por defecto, sí; se guardan como 1/0', () => {
    const a = almacen();
    assert.equal(leerPreferencia(CLAVE_SONIDO, a), true);
    guardarPreferencia(CLAVE_SONIDO, false, a);
    assert.equal(a.m.get(CLAVE_SONIDO), '0');
    assert.equal(leerPreferencia(CLAVE_SONIDO, a), false);
    guardarPreferencia(CLAVE_VIBRACION, true, a);
    assert.equal(leerPreferencia(CLAVE_VIBRACION, a), true);
    assert.notEqual(CLAVE_SONIDO, CLAVE_VIBRACION);
  });
  test('sin almacenamiento (modo privado, datos bloqueados) no rompe y vale sí', () => {
    const roto = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
    assert.equal(leerPreferencia(CLAVE_SONIDO, roto), true);
    assert.doesNotThrow(() => guardarPreferencia(CLAVE_SONIDO, false, roto));
    assert.equal(leerPreferencia(CLAVE_SONIDO, null), true);
  });
});

// Un Web Audio de mentira que anota cada oscilador (tipo, frecuencias, volumen).
function ventanaFalsa({ vibrar = true, tactil = true, audio = true, audioSession = true } = {}) {
  const reg = { contextos: 0, reanudar: 0, osc: [], vib: [] };
  class Param { constructor(o, k) { this.o = o; this.k = k; } setValueAtTime(v) { if (this.k === 'f' && this.o.f0 == null) this.o.f0 = v; return this; } exponentialRampToValueAtTime(v) { if (this.k === 'f') this.o.f1 = v; else this.o.vol = Math.max(this.o.vol || 0, v); return this; } }
  class Ctx {
    constructor() { reg.contextos++; this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
    resume() { reg.reanudar++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() { const r = { tipo: null, f0: null, f1: null }; const o = { frequency: new Param(r, 'f'), connect: (g) => { r.g = g; }, start: () => { r.vol = r.g && r.g._r.vol; reg.osc.push(r); }, stop() {} }; Object.defineProperty(o, 'type', { set: (v) => { r.tipo = v; } }); return o; }
    createGain() { const r = {}; return { _r: r, gain: new Param(r, 'g'), connect() {} }; }
  }
  const navigator = { maxTouchPoints: tactil ? 5 : 0 };
  if (vibrar) navigator.vibrate = (p) => { reg.vib.push(p); return true; };
  if (audioSession) navigator.audioSession = { type: 'auto' };
  return { reg, ventana: { navigator, AudioContext: audio ? Ctx : undefined, matchMedia: () => ({ matches: false }) } };
}

describe('sonidos (src/sonidos.js) con Web Audio de mentira', () => {
  test('antes del primer gesto no suena ni vibra nada, y no crea el contexto', () => {
    const { reg, ventana } = ventanaFalsa();
    const s = crearSonidos(ventana);
    assert.equal(s.tic(true), false);
    assert.equal(s.plop(), false);
    assert.equal(s.vibrar(VIBRA_FRENO), false);
    assert.deepEqual([reg.contextos, reg.osc.length, reg.vib.length], [0, 0, 0]);
  });

  test('en el gesto crea y reanuda el contexto, y pide la sesión de audio playback (iPhone)', async () => {
    const { reg, ventana } = ventanaFalsa();
    const s = crearSonidos(ventana);
    s.desbloquear();
    await Promise.resolve();
    assert.equal(reg.contextos, 1);
    assert.equal(reg.reanudar, 1);
    assert.equal(ventana.navigator.audioSession.type, 'playback');
    s.desbloquear();
    assert.equal(reg.contextos, 1, 'un solo contexto aunque se toque play muchas veces');
  });

  test('con los sonidos apagados por el alumno, el gesto sólo habilita la vibración: ni contexto ni sesión de audio', () => {
    const { reg, ventana } = ventanaFalsa();
    const s = crearSonidos(ventana);
    s.desbloquear({ audio: false });
    assert.equal(reg.contextos, 0);
    assert.equal(ventana.navigator.audioSession.type, 'auto');
    assert.equal(s.vibrar(VIBRA_TIC), true);
    assert.equal(s.tic(true), false);
    s.desbloquear();   // los prende: ese toque crea el contexto
    assert.equal(reg.contextos, 1);
    assert.equal(s.tic(true), true);
  });

  test('tic alto/bajo, plop y plop suave: tonos distintos y a volumen moderado', () => {
    const { reg, ventana } = ventanaFalsa();
    const s = crearSonidos(ventana);
    s.desbloquear();
    assert.equal(s.tic(true), true);
    s.tic(false);
    s.plop();
    s.plopSuave();
    const [alto, bajo, plop, blip, suave] = reg.osc;
    assert.deepEqual([alto.tipo, alto.f0], ['triangle', 1650]);
    assert.deepEqual([bajo.tipo, bajo.f0], ['triangle', 1250]);
    assert.deepEqual([plop.tipo, plop.f0, plop.f1], ['sine', 620, 170]);
    assert.deepEqual([blip.f0], [980]);
    assert.deepEqual([suave.tipo, suave.f0, suave.f1], ['sine', 880, 520]);
    for (const o of reg.osc) assert.ok(o.vol > 0 && o.vol <= 0.3, `volumen ${o.vol}`);
    assert.ok(suave.vol < plop.vol, 'el del glosario es más bajo que el de frenar');
  });

  test('con el contexto suspendido (pestaña de fondo, llamada) no encola: lo reanuda y ese aviso se pierde', () => {
    const { reg, ventana } = ventanaFalsa();
    const s = crearSonidos(ventana);
    s.desbloquear();
    reg.osc.length = 0;
    // El contexto que se creó: se lo suspende como haría el sistema.
    const Ctx = ventana.AudioContext;
    let ctx;
    ventana.AudioContext = class extends Ctx { constructor() { super(); ctx = this; } };
    const s2 = crearSonidos(ventana);
    s2.desbloquear();
    ctx.state = 'suspended';
    const antes = reg.reanudar;
    assert.equal(s2.tic(true), false);
    assert.equal(reg.osc.length, 0);
    assert.equal(reg.reanudar, antes + 1);
  });

  test('vibra con el gesto y en un equipo táctil; en la compu (sin pantalla táctil) o en iPhone (sin vibrate), no', () => {
    const tel = ventanaFalsa();
    const s = crearSonidos(tel.ventana);
    s.desbloquear();
    assert.equal(s.vibrar(VIBRA_TIC), true);
    assert.deepEqual(tel.reg.vib, [40]);
    assert.equal(vibracionPosible(tel.ventana), true);
    const compu = ventanaFalsa({ tactil: false });
    assert.equal(vibracionPosible(compu.ventana), false);
    const iphone = ventanaFalsa({ vibrar: false });
    assert.equal(vibracionPosible(iphone.ventana), false);
    const s3 = crearSonidos(iphone.ventana);
    s3.desbloquear();
    assert.equal(s3.vibrar(VIBRA_FRENO), false);
  });

  test('sin Web Audio ni sesión de audio (navegador viejo) no rompe nada', () => {
    const { ventana } = ventanaFalsa({ audio: false, audioSession: false });
    const s = crearSonidos(ventana);
    assert.doesNotThrow(() => s.desbloquear());
    assert.equal(s.tic(true), false);
    assert.equal(s.plop(), false);
    assert.equal(crearSonidos(null).tic(true), false);
  });
});
