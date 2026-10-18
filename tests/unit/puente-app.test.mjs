// El canal con hub-app (src/puenteApp.js, protocolo ivcast v1) sin navegador: un
// `window` de mentira con su ReactNativeWebView (lo que manda el reproductor) y
// window.__ivcastRecibir (lo que llamaría la app con injectJavaScript).
//
// Lo que se protege: que el reproductor acepte sólo sobres { ivcast: 1, tipo }, que las
// respuestas de otra instancia no le resuelvan nada, que cada comando tenga su tope, que
// el saludo sin respuesta no quede guardado (el próximo toque vuelve a saludar) y el
// latido y el adios del contrato.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
const P = await import('../../src/puenteApp.js');

// Un window con el puente de la app. `responder(fn)`: la app de mentira contesta a cada
// mensaje en el mismo turno (fn devuelve la respuesta, o null para no contestar).
function ventana({ arriba = null } = {}) {
  const enviados = [];
  const oyentes = {};
  const w = {
    ReactNativeWebView: { postMessage: (s) => { const m = JSON.parse(s); enviados.push(m); if (w._app) { const r = w._app(m); if (r) w.__ivcastRecibir(JSON.stringify(r)); } } },
    addEventListener: (t, fn) => { (oyentes[t] ||= []).push(fn); },
    disparar: (t, ev = {}) => (oyentes[t] || []).forEach((fn) => fn(ev)),
    enviados,
  };
  w.top = arriba || w;
  globalThis.window = w;
  return w;
}
const recibir = (w, m) => w.__ivcastRecibir(typeof m === 'string' ? m : JSON.stringify(m));

beforeEach(() => P._reiniciarParaPruebas());

test('puenteDisponible: el de la página (Android), el de arriba del mismo origen (iOS), y nada si el de arriba es de otro origen', () => {
  globalThis.window = {};
  window.top = window;
  assert.equal(P.puenteDisponible(), false, 'sin ReactNativeWebView no hay puente (Chrome, la app vieja)');
  ventana();
  assert.equal(P.puenteDisponible(), true);
  // iOS: el objeto está sólo en el marco principal.
  const arriba = { ReactNativeWebView: { postMessage() {} } };
  globalThis.window = { top: arriba };
  assert.equal(P.puenteDisponible(), true, 'en iOS se lee el de window.top');
  // Otro origen: leer window.top.algo tira SecurityError.
  globalThis.window = { get top() { return new Proxy({}, { get() { throw new Error('SecurityError'); } }); } };
  assert.equal(P.puenteDisponible(), false);
  // Un ReactNativeWebView sin postMessage no cuenta.
  globalThis.window = { ReactNativeWebView: {} };
  window.top = window;
  assert.equal(P.puenteDisponible(), false);
});

test('puenteDisponible: un <iframe name="ReactNativeWebView"> no es el puente, ni arriba de otro origen ni en la propia página', () => {
  // Así se ve un marco: un WindowProxy con postMessage y que es su propio `window`.
  const marco = { postMessage() {} };
  marco.window = marco;
  // Chrome común (verificado en Chrome headless): la página de arriba es de OTRO origen y
  // tiene un marco con ese nombre. Leer su `document` tira SecurityError, pero el nombre
  // del marco hijo sí se puede leer, y su postMessage es una función.
  globalThis.window = { top: new Proxy({}, { get(_, k) { if (k === 'ReactNativeWebView') return marco; throw new Error('SecurityError'); } }) };
  assert.equal(P.puenteDisponible(), false, 'arriba de otro origen no hay puente nuestro, aunque haya un marco con ese nombre');
  // Arriba del mismo origen, con un marco que se llama así: tampoco.
  globalThis.window = { top: { document: {}, ReactNativeWebView: marco } };
  assert.equal(P.puenteDisponible(), false);
  // En la propia página.
  globalThis.window = { ReactNativeWebView: marco };
  window.top = window;
  assert.equal(P.puenteDisponible(), false);
  // Y nada de esto llega a mandar el saludo.
  return P.conectarApp().then((r) => assert.equal(r.motivo, 'sin-puente'));
});

test('leerSobres: sólo { ivcast: 1, tipo }, de un texto, un objeto o un arreglo, en orden', () => {
  const ok = { ivcast: 1, tipo: 'media', msid: 1 };
  assert.deepEqual(P.leerSobres(JSON.stringify(ok)), [ok]);
  assert.deepEqual(P.leerSobres(ok), [ok]);
  assert.deepEqual(P.leerSobres([ok, JSON.stringify({ ivcast: 1, tipo: 'volumen' })]).map((m) => m.tipo), ['media', 'volumen']);
  assert.deepEqual(P.leerSobres(JSON.stringify([ok, { ivcast: 1, tipo: 'sesion' }])).map((m) => m.tipo), ['media', 'sesion']);
  for (const malo of ['{roto', 'null', 42, null, undefined, { ivcast: 2, tipo: 'media' }, { ivcast: '1', tipo: 'media' }, { ivcast: 1 }, { ivcast: 1, tipo: '' }, { ivcast: 1, tipo: 3 }, [[ok]], { type: 'ivplayer-fullscreen' }]) {
    assert.deepEqual(P.leerSobres(malo), [], `tenía que descartar ${JSON.stringify(malo)}`);
  }
});

test('el saludo: hola con id de la instancia, soporta [1] y la versión; hola-ok resuelve normalizado y queda guardado', async () => {
  const w = ventana();
  w._app = (m) => m.tipo === 'hola' ? { ivcast: 1, tipo: 'hola-ok', re: m.id, app: { version: '2.1.0', plataforma: 'android' }, capacidades: ['cast', 'velocidad', 7], cast: { receptor: 'CC1AD845', estado: 'NOT_CONNECTED', sesion: null } } : null;
  const r = await P.conectarApp();
  const hola = w.enviados[0];
  assert.equal(hola.ivcast, 1);
  assert.equal(hola.tipo, 'hola');
  assert.match(hola.id, /^[a-z0-9]+-1$/);
  assert.deepEqual(hola.soporta, [1]);
  assert.equal(hola.reproductor, P.VERSION_REPRODUCTOR);
  assert.equal(r.motivo, null);
  assert.deepEqual(r.hola.capacidades, ['cast', 'velocidad'], 'lo que no es texto se descarta');
  assert.deepEqual(r.hola.app, { version: '2.1.0', plataforma: 'android' });
  assert.equal(r.hola.cast.estado, 'NOT_CONNECTED');
  assert.equal(typeof w.__ivcastRecibir, 'function', 'se registra en el marco principal (acá, el mismo)');
  await P.conectarApp();
  assert.equal(w.enviados.filter((m) => m.tipo === 'hola').length, 1, 'dentro de una carga, la respuesta buena no se vuelve a pedir');
});

test('__ivcastRecibir va al marco de ARRIBA si es del mismo origen (ahí inyecta la app)', async () => {
  const arriba = { document: {}, ReactNativeWebView: { postMessage: (s) => { const m = JSON.parse(s); queueMicrotask(() => arriba.__ivcastRecibir(JSON.stringify({ ivcast: 1, tipo: 'hola-ok', re: m.id, capacidades: [] }))); } } };
  globalThis.window = { top: arriba, addEventListener() {} };
  const r = await P.conectarApp();
  assert.ok(r.hola, 'contestó por el __ivcastRecibir del marco principal');
  assert.equal(window.__ivcastRecibir, undefined, 'no en el iframe');
});

test('saludo sin respuesta en 3 s: null con el motivo, y el próximo intento vuelve a saludar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const w = ventana();
  const p1 = P.conectarApp();
  t.mock.timers.tick(P.TOPE_HOLA_MS - 1);
  await Promise.resolve();
  let resuelto = false;
  p1.then(() => { resuelto = true; });
  await Promise.resolve();
  assert.equal(resuelto, false, 'antes de los 3 s sigue esperando');
  t.mock.timers.tick(1);
  assert.deepEqual(await p1, { hola: null, motivo: 'sin-respuesta' });
  // No quedó guardado el fallo: otro hola.
  const p2 = P.conectarApp();
  const segundo = w.enviados.filter((m) => m.tipo === 'hola');
  assert.equal(segundo.length, 2, 'el próximo toque vuelve a saludar');
  assert.notEqual(segundo[0].id, segundo[1].id);
  recibir(w, { ivcast: 1, tipo: 'hola-ok', re: segundo[1].id, capacidades: ['cast'] });
  assert.equal((await p2).motivo, null);
});

test('error{version} al saludo: motivo "version"', async () => {
  const w = ventana();
  w._app = (m) => ({ ivcast: 1, tipo: 'error', re: m.id, codigo: 'version' });
  assert.deepEqual(await P.conectarApp(), { hola: null, motivo: 'version' });
});

test('sin puente, conectarApp resuelve sin mandar nada', async () => {
  globalThis.window = {};
  window.top = window;
  assert.deepEqual(await P.conectarApp(), { hola: null, motivo: 'sin-puente' });
});

test('las respuestas de otra instancia (otra carga del reproductor) no resuelven nada; las propias sí', async () => {
  const w = ventana();
  const p = P.enviar('play', { msid: 3 });
  const id = w.enviados[0].id;
  const [inst] = id.split('-');
  let resuelto = null;
  p.then((m) => { resuelto = m; }, (e) => { resuelto = e; });
  recibir(w, { ivcast: 1, tipo: 'ok', re: 'zzzz-1' });
  recibir(w, { ivcast: 1, tipo: 'ok', re: inst + 'x-1' });
  recibir(w, { ivcast: 1, tipo: 'ok', re: id.replace(/-\d+$/, '-99') });
  recibir(w, { ivcast: 2, tipo: 'ok', re: id });
  await Promise.resolve();
  assert.equal(resuelto, null, 'nada de eso era la respuesta');
  recibir(w, { ivcast: 1, tipo: 'ok', re: id, extra: 1 });
  await p;
  assert.equal(resuelto.extra, 1);
  // Una segunda respuesta al mismo id ya no encuentra a nadie (y no rompe).
  recibir(w, { ivcast: 1, tipo: 'error', re: id, codigo: 'x' });
});

test('enviar: error → { codigo, detalle }; tope → { codigo: "timeout" }; respuesta en el mismo turno también llega', async (t) => {
  const w = ventana();
  w._app = (m) => m.tipo === 'elegir' ? { ivcast: 1, tipo: 'error', re: m.id, codigo: 'session_error', detalle: 'sin_boton' } : m.tipo === 'estado' ? { ivcast: 1, tipo: 'ok', re: m.id } : null;
  await assert.rejects(P.enviar('elegir'), { codigo: 'session_error', detalle: 'sin_boton' });
  await P.enviar('estado', { msid: 1 });   // contestó adentro de postMessage
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = P.enviar('pausa', { msid: 1 }, { tope: 10000 });
  assert.equal(w.enviados.at(-1).msid, 1);
  assert.equal(w.enviados.at(-1).ivcast, 1);
  t.mock.timers.tick(10000);
  await assert.rejects(p, { codigo: 'timeout' });
});

test('los eventos (sin re) van a los oyentes, en orden, también de a varios en un arreglo', () => {
  const w = ventana();
  P.conectarApp();
  const vistos = [];
  const quitar = P.escuchar((m) => vistos.push(m.tipo));
  recibir(w, [{ ivcast: 1, tipo: 'disponibilidad', estado: 'CONNECTED' }, { ivcast: 1, tipo: 'sesion', estado: 'SESSION_STARTED' }, { ivcast: 2, tipo: 'media' }]);
  recibir(w, { ivcast: 1, tipo: 'media', msid: 1 });
  recibir(w, 'no es json');
  assert.deepEqual(vistos, ['disponibilidad', 'sesion', 'media']);
  quitar();
  recibir(w, { ivcast: 1, tipo: 'media', msid: 2 });
  assert.equal(vistos.length, 3);
});

test('latido: uno enseguida y uno cada 2 s con el msid que diga castNativo, hasta dejarDeLatir', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const w = ventana();
  let msid = null;
  P.latir(() => msid);
  msid = 4;
  t.mock.timers.tick(P.LATIDO_MS);
  P.latir(() => 9);   // ya latía: cambia de dónde sale el msid, no arma otro intervalo
  t.mock.timers.tick(P.LATIDO_MS);
  P.dejarDeLatir();
  t.mock.timers.tick(P.LATIDO_MS * 3);
  const latidos = w.enviados.filter((m) => m.tipo === 'latido');
  assert.deepEqual(latidos.map((m) => m.msid), [null, 4, 9]);
  assert.ok(latidos.every((m) => m.ivcast === 1 && m.visible === true && !('id' in m)), JSON.stringify(latidos));
});

test('pagehide: adios (sin id), deja de latir y suelta __ivcastRecibir', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const w = ventana();
  w._app = (m) => m.tipo === 'hola' ? { ivcast: 1, tipo: 'hola-ok', re: m.id, capacidades: ['cast'] } : null;
  await P.conectarApp();
  P.latir(() => 2);
  w.disparar('pagehide');
  t.mock.timers.tick(P.LATIDO_MS * 2);
  const adios = w.enviados.filter((m) => m.tipo === 'adios');
  assert.equal(adios.length, 1);
  assert.ok(!('id' in adios[0]));
  assert.equal(w.enviados.filter((m) => m.tipo === 'latido').length, 1, 'después del adios no late más');
  assert.equal(w.__ivcastRecibir, undefined);
  // Vuelve del bfcache: se registra otra vez y retoma el latido.
  w.disparar('pageshow', { persisted: true });
  assert.equal(typeof w.__ivcastRecibir, 'function');
  assert.equal(w.enviados.filter((m) => m.tipo === 'latido').length, 2);
});

test('pareceApp: el UA de MoodleMobile (la app de Hub Education y la oficial de Moodle)', () => {
  const ua0 = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 MoodleMobile' } });
    assert.equal(P.pareceApp(), true);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 Chrome/141' } });
    assert.equal(P.pareceApp(), false);
  } finally {
    if (ua0) Object.defineProperty(globalThis, 'navigator', ua0);
  }
});
