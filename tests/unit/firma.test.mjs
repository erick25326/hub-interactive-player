// La renovación de la firma de Bunny (src/firma.js), sin navegador: leer la firma de
// una URL, reescribir las URLs del mismo video (master, variante, .ts y miniatura) con
// la firma nueva, los márgenes, el reloj que no depende de la hora del celular y el
// Renovador contra un firma.php falso (fetch, timers, relojes y documento de mentira).
// Las URLs se arman con el espejo de la firma de lib.php (apoyo/bunny-espejo.mjs): son
// las mismas que arma player.php, con datos sintéticos (repo público).
// Lo que hacen los motores con esto (hls.js reescribiendo pedidos, el HLS nativo
// cambiando de fuente) lo prueba el nivel navegador (escenarios/firma.mjs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './apoyo/bunny-espejo.mjs';
import {
  leerFirma, reescribir, sinFirma, margenes, crearReloj, interpretarRespuesta, Renovador,
  RENOVAR_ANTES_MS, URGENTE_MS, ANTES_DEL_PEDIDO_MS, ESPERA_TRAS_FALLO_MS, INSISTIR_MS,
} from '../../src/firma.js';

const HOST = 'vz-ejemplo.b-cdn.net';
const GUID = '11111111-2222-4333-8444-555555555555';
const OTRO = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const CLAVE = 'SecurityKey';
const E1 = 1598024587;            // el vencimiento de los vectores oficiales
const E2 = E1 + 6 * 3600;
const vieja = B.firmar(HOST, GUID, CLAVE, E1);
const nueva = B.firmar(HOST, GUID, CLAVE, E2);
// Lo que el playlist trae como relativo, resuelto como lo resuelve el navegador.
const rel = (ruta, base) => new URL(ruta, base).href;

describe('leer la firma de una URL', () => {
  test('en la ruta (el playlist): token, token_path, expires y el tramo tal cual', () => {
    const f = leerFirma(vieja.playlist);
    assert.equal(f.expires, E1);
    assert.equal(f.tokenPath, `/${GUID}/`);
    assert.equal(f.token, B.token(CLAVE, `/${GUID}/`, E1));
    assert.equal(f.tramo, vieja.playlist.match(/\/(bcdn_token=[^/]*)\//)[1]);
  });

  test('en la query (la miniatura) da la misma firma', () => {
    const f = leerFirma(vieja.poster), g = leerFirma(vieja.playlist);
    assert.deepEqual({ token: f.token, tokenPath: f.tokenPath, expires: f.expires }, { token: g.token, tokenPath: g.tokenPath, expires: g.expires });
    assert.equal(f.tramo, g.tramo, 'el tramo armado desde la query es el mismo que el de la ruta');
  });

  test('las variantes y los .ts heredan la firma de la ruta', () => {
    const variante = rel('360p/video.m3u8', vieja.playlist);
    assert.equal(leerFirma(variante).expires, E1);
    assert.equal(leerFirma(rel('video0.ts', variante)).expires, E1);
  });

  test('sin firma, firma incompleta o algo que no es una URL: null', () => {
    for (const u of [
      `https://${HOST}/${GUID}/playlist.m3u8`,
      `https://${HOST}/${GUID}/thumbnail.jpg?width=320`,
      `https://${HOST}/bcdn_token=HS256-abc&token_path=%2F${GUID}%2F/${GUID}/playlist.m3u8`,   // sin expires
      `https://${HOST}/bcdn_token=&expires=123/${GUID}/playlist.m3u8`,                           // sin token
      `https://${HOST}/${GUID}/thumbnail.jpg?token=HS256-abc&expires=nada`,
      '', null, undefined, 42,
    ]) assert.equal(leerFirma(u), null, String(u));
  });
});

describe('reescribir una URL del mismo video con la firma nueva', () => {
  const fn = leerFirma(nueva.playlist);

  test('master: queda IGUAL a la que firmaría el servidor con el vencimiento nuevo', () => {
    assert.equal(reescribir(vieja.playlist, fn), nueva.playlist);
  });

  test('variante y .ts: igual a resolverlos desde el master nuevo', () => {
    const v = rel('360p/video.m3u8', vieja.playlist);
    assert.equal(reescribir(v, fn), rel('360p/video.m3u8', nueva.playlist));
    assert.equal(reescribir(rel('video12.ts', v), fn), rel('video12.ts', rel('360p/video.m3u8', nueva.playlist)));
  });

  test('miniatura (firma en la query): igual a la del servidor, y conserva sus otros parámetros', () => {
    assert.equal(reescribir(vieja.poster, fn), nueva.poster);
    const conAncho = vieja.poster.replace('thumbnail.jpg?', 'thumbnail.jpg?width=320&');
    const r = reescribir(conAncho, fn);
    assert.equal(new URL(r).searchParams.get('width'), '320');
    assert.equal(leerFirma(r).expires, E2);
    assert.equal(leerFirma(r).token, fn.token);
  });

  test('la firma nueva leída de la miniatura sirve igual para el playlist', () => {
    assert.equal(reescribir(vieja.playlist, leerFirma(nueva.poster)), nueva.playlist);
  });

  test('una URL sin firma, o de OTRO video, vuelve tal cual (no se le agrega nada)', () => {
    const plana = `https://${HOST}/${GUID}/playlist.m3u8`;
    assert.equal(reescribir(plana, fn), plana);
    const otra = B.firmar(HOST, OTRO, CLAVE, E1).playlist;
    assert.equal(reescribir(otra, fn), otra, 'token de directorio de otro video');
    assert.equal(reescribir(vieja.playlist, null), vieja.playlist);
    assert.equal(reescribir('', fn), '');
  });

  test('una URL de OTRO host (aunque traiga algo con forma de firma) o sin token_path vuelve tal cual: el token vigente no sale a otro servidor', () => {
    // Antes, un token_path ausente valía de comodín y el host no se miraba: las dos de
    // abajo salían con el token vigente (medido con src/firma.js, oct-2026).
    const ajenaQuery = 'https://otro-host.example/x.vtt?token=abc&expires=5';
    assert.equal(reescribir(ajenaQuery, fn), ajenaQuery);
    const ajenaRuta = 'https://otro-host.example/bcdn_token=abc&expires=5/cualquier/cosa.ts';
    assert.equal(reescribir(ajenaRuta, fn), ajenaRuta);
    const mismoDirOtroHost = `https://otro-host.example/bcdn_token=abc&token_path=%2F${GUID}%2F&expires=5/${GUID}/video0.ts`;
    assert.equal(reescribir(mismoDirOtroHost, fn), mismoDirOtroHost, 'el mismo directorio en otro host tampoco');
    const otroPuerto = vieja.playlist.replace(HOST, HOST + ':8443');
    assert.equal(reescribir(otroPuerto, fn), otroPuerto, 'otro puerto es otro origen');
    const sinPath = `https://${HOST}/${GUID}/captions/es.vtt?token=abc&expires=5`;
    assert.equal(reescribir(sinPath, fn), sinPath, 'sin token_path no hay con qué comparar');
    assert.equal(reescribir(vieja.playlist.replace('https://', 'HTTPS://'), fn), nueva.playlist.replace('https://', 'HTTPS://'), 'el mismo host escrito distinto sí es el mismo');
  });

  test('el GUID sigue siendo el primer tramo /<guid>/ (la clave del avance no cambia)', () => {
    const r = reescribir(rel('360p/video.m3u8', vieja.playlist), fn);
    assert.equal(r.match(/\/([0-9a-f]{8}-[0-9a-f-]{27,})\//i)[1], GUID);
  });

  test('un "$" en la firma se copia literal (String.replace con función)', () => {
    const rara = { ...fn, tramo: "bcdn_token=HS256-a$'b$&c&token_path=%2F" + GUID + '%2F&expires=' + E2 };
    assert.equal(reescribir(vieja.playlist, rara), `https://${HOST}/${rara.tramo}/${GUID}/playlist.m3u8`);
  });

  test('sinFirma: el mismo pedido con cualquier firma da la misma clave', () => {
    for (const r of ['', '360p/video.m3u8', '360p/video3.ts']) {
      const a = r ? rel(r, vieja.playlist) : vieja.playlist, b = r ? rel(r, nueva.playlist) : nueva.playlist;
      assert.equal(sinFirma(a), sinFirma(b), r || 'master');
    }
    assert.equal(sinFirma(vieja.playlist), `https://${HOST}/${GUID}/playlist.m3u8`);
    assert.equal(sinFirma(vieja.poster), `https://${HOST}/${GUID}/thumbnail.jpg`);
    assert.equal(sinFirma(vieja.poster.replace('?', '?width=320&')), `https://${HOST}/${GUID}/thumbnail.jpg?width=320`);
  });
});

describe('márgenes y reloj', () => {
  test('con las duraciones reales: 10 min antes, urgente a 90 s, el pedido espera desde 30 s', () => {
    assert.deepEqual(margenes(6 * 3600e3 + 1800e3), { renovar: RENOVAR_ANTES_MS, urgente: URGENTE_MS, pedido: ANTES_DEL_PEDIDO_MS });
    assert.deepEqual(margenes(3600e3), { renovar: RENOVAR_ANTES_MS, urgente: URGENTE_MS, pedido: ANTES_DEL_PEDIDO_MS });
  });

  test('con firmas cortas (pruebas) se achican en proporción: no renueva sin parar', () => {
    assert.deepEqual(margenes(12000), { renovar: 6000, urgente: 2000, pedido: 3000 });
    assert.deepEqual(margenes(-5), { renovar: 0, urgente: 0, pedido: 0 });
  });

  test('el reloj descuenta lo que pasó en el equipo, no la hora del equipo', () => {
    let mono = 1000, pared = 1e12;
    const r = crearReloj(60000, { mono: () => mono, pared: () => pared });
    assert.equal(r.restanteMs(), 60000);
    mono += 10000; pared += 10000;
    assert.equal(r.restanteMs(), 50000);
  });

  test('si cambian la hora hacia atrás, manda el monotónico (no "rejuvenece" la firma)', () => {
    let mono = 0, pared = 1e12;
    const r = crearReloj(60000, { mono: () => mono, pared: () => pared });
    mono += 5000; pared -= 3 * 3600e3;
    assert.equal(r.restanteMs(), 55000);
  });

  test('si el equipo estuvo suspendido (el monotónico no avanzó), manda el de pared', () => {
    let mono = 0, pared = 1e12;
    const r = crearReloj(6 * 3600e3, { mono: () => mono, pared: () => pared });
    mono += 1000; pared += 7 * 3600e3;
    assert.ok(r.restanteMs() < 0, 'tiene que darse por vencida');
  });
});

describe('qué dijo firma.php', () => {
  test('ok, sesión cerrada, sin red, sin permiso', () => {
    const ok = interpretarRespuesta(200, { ok: true, playlist: nueva.playlist, poster: nueva.poster, expires: E2, ahora: E1 });
    assert.deepEqual(ok, { ok: true, playlist: nueva.playlist, poster: nueva.poster, expires: E2, ahora: E1 });
    assert.equal(interpretarRespuesta(401, { ok: false, motivo: 'sesion' }).motivo, 'sesion');
    assert.equal(interpretarRespuesta(401, null).motivo, 'sesion');
    // El JSON de error de Moodle (AJAX_SCRIPT) por login o sesskey.
    assert.equal(interpretarRespuesta(200, { error: 'x', errorcode: 'requireloginerror' }).motivo, 'sesion');
    assert.equal(interpretarRespuesta(200, { error: 'x', errorcode: 'invalidsesskey' }).motivo, 'sesion');
    assert.equal(interpretarRespuesta(500, { ok: false, motivo: 'error' }).motivo, 'red', 'un 500 se reintenta');
    assert.equal(interpretarRespuesta(0, null).motivo, 'red');
    assert.equal(interpretarRespuesta(503, null).motivo, 'red');
    assert.equal(interpretarRespuesta(403, { ok: false, motivo: 'permiso' }).motivo, 'otro');
    assert.equal(interpretarRespuesta(409, { ok: false, motivo: 'sinbunny' }).motivo, 'otro');
    assert.equal(interpretarRespuesta(200, '<html>login</html>').motivo, 'otro');
  });
});

// --- El Renovador contra un firma.php de mentira ------------------------------------
function entorno({ ahoraServidor = E1 - 6 * 3600, pared0 = 1e12, respuestas = [] } = {}) {
  const x = { mono: 0, pared: pared0, timers: [], pedidos: [], respuestas: [...respuestas] };
  let id = 0;
  x.timersApi = {
    poner: (fn, ms) => { const t = { id: ++id, fn, ms, en: x.mono + ms }; x.timers.push(t); return t.id; },
    quitar: (i) => { x.timers = x.timers.filter((t) => t.id !== i); },
  };
  x.documento = new EventTarget();
  x.documento.visibilityState = 'visible';
  x.ventana = new EventTarget();
  x.fetch = (url, op) => {
    x.pedidos.push({ url, op, cuerpo: Object.fromEntries(op.body) });
    const r = x.respuestas.shift();
    if (!r) return Promise.reject(new TypeError('sin red'));
    if (r === 'red') return Promise.reject(new TypeError('sin red'));
    return Promise.resolve({ status: r.estado ?? 200, redirected: false, url, text: () => Promise.resolve(typeof r.cuerpo === 'string' ? r.cuerpo : JSON.stringify(r.cuerpo)) });
  };
  x.avanzar = (ms) => { x.mono += ms; x.pared += ms; };
  // El timer de la renovación (el que no es el tope del pedido).
  x.programado = () => x.timers.filter((t) => t.ms !== 15000).at(-1) || null;
  x.correr = async (t) => { x.timersApi.quitar(t.id); t.fn(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
  x.crear = (op = {}) => new Renovador({
    url: vieja.playlist, poster: vieja.poster, firmaUrl: 'https://campus.ejemplo.test/mod/ivplayer/firma.php',
    cmid: 7, sesskey: 'sk-prueba', ahoraServidor, fetch: x.fetch,
    mono: () => x.mono, pared: () => x.pared, timers: x.timersApi, ventana: x.ventana, documento: x.documento, ...op,
  });
  return x;
}
const respuestaOk = (expires, ahora) => ({ cuerpo: { ok: true, playlist: B.firmar(HOST, GUID, CLAVE, expires).playlist, poster: B.firmar(HOST, GUID, CLAVE, expires).poster, expires, ahora } });
const tanda = () => new Promise((r) => setImmediate(r));

describe('Renovador', () => {
  test('sin firmaUrl (página de prueba, configurador, SCORM) o con una URL sin firma: inactivo, no hace nada', () => {
    const x = entorno();
    const a = x.crear({ firmaUrl: null });
    const b = x.crear({ url: `https://${HOST}/${GUID}/playlist.m3u8` });
    for (const r of [a, b]) {
      assert.equal(r.activa(), false);
      assert.equal(r.reescribir(vieja.playlist), vieja.playlist);
    }
    assert.equal(x.timers.length, 0, 'ningún timer');
    assert.equal(x.pedidos.length, 0, 'ningún pedido');
  });

  test('con el reloj del celular corrido 3 h, lo que falta sale de la hora del SERVIDOR', () => {
    // El servidor firmó 6 h antes del vencimiento; el celular cree que es 3 h más tarde.
    const x = entorno({ ahoraServidor: E1 - 6 * 3600, pared0: (E1 - 3 * 3600) * 1000 });
    const r = x.crear();
    assert.equal(r.restanteMs(), 6 * 3600e3);
    assert.equal(x.programado().ms, 6 * 3600e3 - RENOVAR_ANTES_MS, 'renueva 10 min antes del vencimiento real');
    // Y con el reloj atrasado, lo mismo.
    const y = entorno({ ahoraServidor: E1 - 6 * 3600, pared0: (E1 - 30 * 3600) * 1000 });
    assert.equal(y.crear().restanteMs(), 6 * 3600e3);
  });

  test('lo que tardó la página en arrancar (desde que empezó a cargar) se descuenta de la firma', () => {
    const x = entorno();
    x.mono = 3000;   // performance.now() al construirlo: 3 s desde que se pidió la página
    const r = x.crear();
    assert.equal(r.restanteMs(), 6 * 3600e3 - 3000);
  });

  test('antes de vencer pide la firma nueva (POST con cmid y sesskey) y reescribe todo con ella', async () => {
    const x = entorno({ respuestas: [respuestaOk(E2, E1 - 600)] });
    const r = x.crear();
    const avisos = [];
    r.on('renovada', (f) => avisos.push(f.expires));
    const t = x.programado();
    x.avanzar(t.ms);
    await x.correr(t);
    assert.equal(x.pedidos.length, 1);
    const p = x.pedidos[0];
    assert.equal(p.op.method, 'POST');
    assert.equal(p.op.credentials, 'same-origin');
    assert.equal(p.op.cache, 'no-store');
    assert.deepEqual(p.cuerpo, { cmid: '7', sesskey: 'sk-prueba' });
    assert.deepEqual(avisos, [E2]);
    assert.equal(r.actual().expires, E2);
    assert.equal(r.poster(), nueva.poster);
    assert.equal(r.reescribir(rel('360p/video9.ts', rel('360p/video.m3u8', vieja.playlist))), rel('360p/video9.ts', rel('360p/video.m3u8', nueva.playlist)));
    // Lo que le queda a la vieja (la fuente que todavía tiene el <video> o la TV).
    assert.equal(r.restanteDe(E1), RENOVAR_ANTES_MS);
    assert.equal(r.urgenteDe(E1), false);
    x.avanzar(RENOVAR_ANTES_MS - URGENTE_MS);
    assert.equal(r.urgenteDe(E1), true);
    assert.equal(r.vencidaDe(E1), false);
    x.avanzar(URGENTE_MS);
    assert.equal(r.vencidaDe(E1), true);
    assert.equal(r.vencidaDe(E2), false);
    // La próxima, 10 min antes del vencimiento nuevo (6 h + 10 min después del pedido).
    assert.equal(x.programado().ms, (E2 - (E1 - 600)) * 1000 - RENOVAR_ANTES_MS);
  });

  test('pedidos simultáneos comparten UN pedido a Moodle', async () => {
    const x = entorno({ respuestas: [respuestaOk(E2, E1 - 60)] });
    const r = x.crear();
    const [a, b, c] = await Promise.all([r.renovar(), r.renovar(), r.renovar({ forzar: true })]);
    assert.equal(x.pedidos.length, 1);
    assert.equal(a.expires, E2); assert.equal(b, a); assert.equal(c, a);
  });

  test('sesión cerrada: rechaza con "sesion", no reintenta solo, y un 403 (forzado) vuelve a probar', async () => {
    const x = entorno({ respuestas: [{ estado: 401, cuerpo: { ok: false, motivo: 'sesion' } }, { estado: 401, cuerpo: { ok: false, motivo: 'sesion' } }] });
    const r = x.crear();
    await assert.rejects(r.renovar(), (m) => m === 'sesion');
    assert.equal(r.ultimoFallo(), 'sesion');
    assert.equal(x.programado().ms, 6 * 3600e3 - RENOVAR_ANTES_MS, 'con la sesión cerrada no se programa un reintento: queda el de siempre');
    await assert.rejects(r.renovar(), (m) => m === 'sesion');
    assert.equal(x.pedidos.length, 1, 'dentro de la espera no se vuelve a pedir');
    await assert.rejects(r.renovar({ forzar: true }), (m) => m === 'sesion');
    assert.equal(x.pedidos.length, 2, 'forzado (por un 403) sí');
    x.avanzar(ESPERA_TRAS_FALLO_MS + 1);
    assert.equal(r.actual().expires, E1, 'la firma vieja sigue: no se pisa con nada');
  });

  test('sin red: rechaza con "red" y reintenta solo, hasta que anda', async () => {
    const x = entorno({ respuestas: ['red', respuestaOk(E2, E1 - 300)] });
    const r = x.crear();
    x.avanzar(6 * 3600e3 - RENOVAR_ANTES_MS);
    await assert.rejects(r.renovar(), (m) => m === 'red');
    const reintento = x.programado();
    assert.ok(reintento && reintento.ms >= ESPERA_TRAS_FALLO_MS && reintento.ms <= 60000, JSON.stringify(reintento && reintento.ms));
    x.avanzar(reintento.ms);
    await x.correr(reintento);
    await tanda();
    assert.equal(r.actual().expires, E2);
    assert.equal(r.ultimoFallo(), null);
  });

  test('una respuesta de OTRO video, sin firma o ya vencida no se usa', async () => {
    const otro = B.firmar(HOST, OTRO, CLAVE, E2);
    const x = entorno({ respuestas: [
      { cuerpo: { ok: true, playlist: otro.playlist, poster: otro.poster, expires: E2, ahora: E1 } },
      { cuerpo: { ok: true, playlist: `https://${HOST}/${GUID}/playlist.m3u8`, expires: null, ahora: E1 } },
      { cuerpo: { ok: true, playlist: nueva.playlist, poster: nueva.poster, expires: E2, ahora: E2 + 10 } },
    ] });
    const r = x.crear();
    for (let i = 0; i < 3; i++) await assert.rejects(r.renovar({ forzar: true }), (m) => m === 'otro');
    assert.equal(r.actual().expires, E1);
  });

  test('una respuesta con el video en OTRO host no se usa', async () => {
    const ajeno = B.firmar('vz-otro.b-cdn.net', GUID, CLAVE, E2);
    const x = entorno({ respuestas: [{ cuerpo: { ok: true, playlist: ajeno.playlist, poster: ajeno.poster, expires: E2, ahora: E1 } }] });
    const r = x.crear();
    await assert.rejects(r.renovar({ forzar: true }), (m) => m === 'otro');
    assert.equal(r.actual().expires, E1);
  });

  test('al volver a la pestaña pide aunque el último pedido haya fallado hace un instante (la red vuelve justo ahí)', async () => {
    const x = entorno({ respuestas: ['red', respuestaOk(E2, E1 - 60)] });
    const r = x.crear();
    x.avanzar(6 * 3600e3 - 60e3);
    await assert.rejects(r.renovar(), (m) => m === 'red');
    x.avanzar(1000);
    x.documento.dispatchEvent(new Event('visibilitychange'));
    await tanda(); await tanda();
    assert.equal(x.pedidos.length, 2, 'el evento de vuelta no respeta la espera tras un fallo');
    assert.equal(r.actual().expires, E2);
  });

  test('la espera tras un fallo cuenta también el reloj de pared: un fallo de antes de suspender no frena el pedido de después', async () => {
    const x = entorno({ respuestas: ['red', respuestaOk(E2, E1 - 60)] });
    const r = x.crear();
    await assert.rejects(r.renovar(), (m) => m === 'red');
    x.mono += 1000; x.pared += 8 * 3600e3;   // equipo suspendido: el monotónico casi no avanzó
    assert.equal((await r.renovar()).expires, E2);
    assert.equal(x.pedidos.length, 2);
  });

  // Las esperas de la insistencia (renovarYa): los timers cortos. Los demás son el de la
  // renovación programada, el reintento de fondo (5 s o más) y el tope del pedido (15 s).
  const insistiendo = (x) => x.timers.filter((t) => t.ms <= 4000);

  test('renovarYa (después de un 403): sin red insiste a 1 y 2 s y anda cuando vuelve; mientras tanto todo espera eso mismo', async () => {
    const x = entorno({ respuestas: ['red', 'red', respuestaOk(E2, E1 - 60)] });
    const r = x.crear();
    const p = r.renovarYa();
    let resultado = null;
    p.then((f) => { resultado = f; }, (m) => { resultado = 'rechazó ' + m; });
    await tanda(); await tanda();
    assert.equal(x.pedidos.length, 1);
    assert.equal(r.renovando(), true, 'entre intentos sigue "renovando": un pedido de video espera la firma');
    assert.equal(r.renovar(), p, 'renovar() devuelve la misma insistencia (un solo pedido a la vez)');
    assert.equal(r.renovar({ forzar: true }), p);
    assert.equal(r.renovarYa(), p, 'un segundo 403 no arma otra insistencia');
    const esperas = [];
    for (let i = 0; i < 5 && resultado == null; i++) {
      const t = insistiendo(x).at(-1);
      assert.ok(t, `no quedó programado el reintento (${JSON.stringify(x.timers.map((y) => y.ms))})`);
      esperas.push(t.ms);
      x.avanzar(t.ms);
      await x.correr(t);
      await tanda();
    }
    assert.deepEqual(esperas, [1000, 2000]);
    assert.equal(x.pedidos.length, 3);
    assert.equal(resultado && resultado.expires, E2, String(resultado));
    assert.equal(r.renovando(), false);
  });

  test('renovarYa: si la red no vuelve, se rinde con "red" a los ~15 s (y recién ahí el cartel)', async () => {
    const x = entorno({ respuestas: [] });   // sin respuestas: todo es 'red'
    const r = x.crear();
    let resultado = null;
    r.renovarYa().then(() => { resultado = 'anduvo'; }, (m) => { resultado = m; });
    await tanda(); await tanda();
    const esperas = [];
    for (let i = 0; i < 20 && resultado == null; i++) {
      const t = insistiendo(x).at(-1);
      if (!t) break;
      esperas.push(t.ms);
      x.avanzar(t.ms);
      await x.correr(t);
      await tanda();
    }
    assert.equal(resultado, 'red');
    assert.deepEqual(esperas, [1000, 2000, 4000, 4000, 4000]);
    assert.ok(esperas.reduce((a, b) => a + b, 0) <= INSISTIR_MS);
    assert.equal(x.pedidos.length, esperas.length + 1);
    assert.equal(r.renovando(), false);
  });

  test('renovarYa: con la sesión cerrada no insiste (no se arregla sola)', async () => {
    const x = entorno({ respuestas: [{ estado: 401, cuerpo: { ok: false, motivo: 'sesion' } }] });
    const r = x.crear();
    await assert.rejects(r.renovarYa(), (m) => m === 'sesion');
    assert.equal(x.pedidos.length, 1);
    assert.equal(insistiendo(x).length, 0);
    assert.equal(r.renovando(), false);
  });

  test('renovarYa: si vuelve la red (evento online) reintenta ya, sin esperar el resto', async () => {
    const x = entorno({ respuestas: ['red', respuestaOk(E2, E1 - 60)] });
    const r = x.crear();
    const p = r.renovarYa();
    await tanda(); await tanda();
    assert.equal(x.pedidos.length, 1);
    x.avanzar(200);
    x.ventana.dispatchEvent(new Event('online'));
    await tanda(); await tanda();
    assert.equal(x.pedidos.length, 2);
    assert.equal((await p).expires, E2);
    assert.equal(insistiendo(x).length, 0, 'la espera que quedaba se quitó');
  });

  test('renovarYa: destroy en medio corta la insistencia', async () => {
    const x = entorno({ respuestas: [] });
    const r = x.crear();
    const p = r.renovarYa();
    await tanda(); await tanda();
    r.destroy();
    await assert.rejects(p, (m) => m === 'otro');
    assert.equal(insistiendo(x).length, 0);
  });

  test('cercaDeVencer: un 403 con una firma a la que le quedaba más que el margen de renovación no es por vencimiento', () => {
    const x = entorno();
    const r = x.crear();
    assert.equal(r.cercaDeVencer(E1), false, 'recién firmada (6 h): un 403 es por otra cosa');
    x.avanzar(6 * 3600e3 - RENOVAR_ANTES_MS);
    assert.equal(r.cercaDeVencer(E1), true, 'en los últimos 10 min sí puede ser el vencimiento (reloj del CDN)');
    assert.equal(r.cercaDeVencer(E1 + 3600), false, 'otra firma con una hora más, no');
  });

  test('al volver a la pestaña (o al salir del congelamiento) se fija cuánto falta: renueva si ya es hora', async () => {
    const x = entorno({ respuestas: [respuestaOk(E2, E1 - 60)] });
    const r = x.crear();
    // La pestaña estuvo oculta y el timer no corrió (Chrome, iOS): pasaron 6 h.
    x.avanzar(6 * 3600e3 - 60e3);
    x.documento.visibilityState = 'hidden';
    x.documento.dispatchEvent(new Event('visibilitychange'));
    assert.equal(x.pedidos.length, 0, 'oculta, nada');
    x.documento.visibilityState = 'visible';
    x.documento.dispatchEvent(new Event('visibilitychange'));
    await tanda(); await tanda();
    assert.equal(x.pedidos.length, 1);
    assert.equal(r.actual().expires, E2);
  });

  test('al volver con tiempo de sobra no pide nada: reprograma el timer', () => {
    const x = entorno();
    x.crear();
    x.avanzar(3600e3);
    x.ventana.dispatchEvent(new Event('pageshow'));
    assert.equal(x.pedidos.length, 0);
    assert.equal(x.programado().ms, 5 * 3600e3 - RENOVAR_ANTES_MS);
  });

  test('porVencer: los últimos 30 s (un pedido de video espera la firma nueva)', () => {
    const x = entorno();
    const r = x.crear();
    assert.equal(r.porVencer(), false);
    x.avanzar(6 * 3600e3 - ANTES_DEL_PEDIDO_MS);
    assert.equal(r.porVencer(), true);
  });

  test('destroy: suelta los oyentes y el timer; una respuesta tardía no cambia nada', async () => {
    let soltar;
    const x = entorno();
    x.fetch = () => new Promise((ok) => { soltar = ok; });
    const r = x.crear({ fetch: x.fetch });
    const p = r.renovar();
    r.destroy();
    soltar({ status: 200, redirected: false, text: () => Promise.resolve(JSON.stringify(respuestaOk(E2, E1).cuerpo)) });
    await assert.rejects(p);
    assert.equal(r.actual().expires, E1);
    assert.equal(x.programado(), null);
  });
});
