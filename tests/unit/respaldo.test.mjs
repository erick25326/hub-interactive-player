// La red de seguridad (src/respaldo.js), sin navegador: con qué errores salta a Vimeo y
// con cuáles NO (la firma, la sesión, la TV, sin respaldo ofrecido), lo que se le manda a
// respaldo.php, cómo se lee su respuesta y la URL de la carga con Vimeo. Más el guardado
// del avance que espera la respuesta (scorm.js, moodleGuardarAvanceYa), contra un
// progress.php falso. Lo que pasa en el navegador (fallas simuladas del CDN, la recarga y
// el retomar), en tests/navegador/escenarios/respaldo.mjs; lo del servidor (player.php y
// respaldo.php), en tests/php/correr.php.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  causaDelRespaldo, decidirRespaldo, datosDelError, yaEsRespaldo, urlDeRespaldo, interpretarRespaldo, pedirRespaldo,
} from '../../src/respaldo.js';
import { errorDelSondeo } from '../../src/sondeo.js';

// Los errores como los emite nativePlayer (_fallar).
const err = (tipo, code = null, extra = {}) => ({ fatal: true, tipo, code, message: 'x', ...extra });

describe('con qué error salta (causaDelRespaldo)', () => {
  test('fallas del CDN: 404, 5xx, sin red y medio', () => {
    assert.equal(causaDelRespaldo(err('acceso', 404, { message: 'manifestLoadError' })), 'http-404');
    assert.equal(causaDelRespaldo(err('red', 503)), 'http-503');
    assert.equal(causaDelRespaldo(err('red', 500)), 'http-500');
    assert.equal(causaDelRespaldo(err('red', 0)), 'red');
    assert.equal(causaDelRespaldo(err('red', null)), 'red');
    assert.equal(causaDelRespaldo(err('red', 200)), 'red', 'un 200 que no sirve (un portal cautivo): red');
    assert.equal(causaDelRespaldo(err('medio')), 'medio');
  });

  test("cualquier otro fatal de hls.js ('otro': MUX, KEY_SYSTEM, OTHER) no salta: el plan cuenta sólo red, 5xx, 404 y medio", () => {
    assert.equal(causaDelRespaldo(err('otro')), null);
    assert.equal(causaDelRespaldo(err('otro', 503)), null);
  });

  test('NUNCA por la firma: 401, 403 o 410, con firma vencida o vigente, venga con el tipo que venga', () => {
    for (const code of [401, 403, 410]) {
      assert.equal(causaDelRespaldo(err('acceso', code)), null, `acceso ${code}`);
      assert.equal(causaDelRespaldo(err('acceso', code, { renovacion: null })), null, `acceso ${code} sin renovación`);
      assert.equal(causaDelRespaldo(err('red', code)), null, `red ${code}`);
      assert.equal(causaDelRespaldo(err('medio', code)), null, `medio ${code}`);
    }
    // El rescate del HLS nativo con la firma vencida: 'acceso' sin código.
    assert.equal(causaDelRespaldo(err('acceso', null)), null);
    assert.equal(causaDelRespaldo(err('acceso', null, { renovacion: 'red' })), null);
  });

  test('NUNCA con la sesión cerrada ni sin permiso (motivo de la renovación), aunque sea un 404', () => {
    assert.equal(causaDelRespaldo(err('acceso', 403, { renovacion: 'sesion' })), null);
    assert.equal(causaDelRespaldo(err('acceso', 404, { renovacion: 'sesion' })), null);
    assert.equal(causaDelRespaldo(err('acceso', 404, { renovacion: 'otro' })), null, "'otro' = sin permiso / ya no es Bunny");
    assert.equal(causaDelRespaldo(err('red', 503, { renovacion: 'sesion' })), null);
    assert.equal(causaDelRespaldo(err('medio', null, { renovacion: 'otro' })), null);
    // Un 404 con la última renovación fallida por red sí: el 404 lo dijo el CDN.
    assert.equal(causaDelRespaldo(err('acceso', 404, { renovacion: 'red' })), 'http-404');
  });

  // El HLS nativo (iPhone) arma el error con lo que contesta el CDN (src/sondeo.js): la
  // decisión tiene que ser la misma que con hls.js para el mismo código.
  test('el HLS nativo con el sondeo del CDN: la misma regla que hls.js', () => {
    const nativo = (estado, paso = 'playlist') => { const e = errorDelSondeo({ estado, paso }); return causaDelRespaldo(err(e.tipo, e.code)); };
    assert.equal(nativo(404), 'http-404', 'el playlist no está (un GUID que no existe)');
    assert.equal(nativo(404, 'segmento'), 'http-404');
    assert.equal(nativo(503, 'segmento'), 'http-503');
    assert.equal(nativo(0), 'red', 'sin respuesta del CDN');
    assert.equal(nativo(200, 'segmento'), 'medio', 'el CDN contesta bien: el medio');
    for (const code of [401, 403, 410]) {
      assert.equal(nativo(code), null, `${code} del playlist: la firma, no salta`);
      assert.equal(nativo(code, 'segmento'), null, `${code} de un segmento con la firma vigente: no salta (como hls.js)`);
    }
    assert.equal(nativo(429), null, 'otro 4xx: no salta (hls.js lo da como acceso)');
  });

  test('sin fuente, sin soporte, sin `fatal` (Vimeo: un play rechazado) o nada: no salta', () => {
    assert.equal(causaDelRespaldo(err('sin-fuente')), null);
    assert.equal(causaDelRespaldo(err('sin-soporte')), null);
    assert.equal(causaDelRespaldo({ tipo: 'red', code: 503 }), null);
    assert.equal(causaDelRespaldo({ fatal: false, tipo: 'medio' }), null);
    assert.equal(causaDelRespaldo(null), null);
    assert.equal(causaDelRespaldo(undefined), null);
    assert.equal(causaDelRespaldo(err('acceso', 400)), null, 'otro 4xx que no es 404');
  });
});

describe('¿salta esta carga? (decidirRespaldo)', () => {
  const base = { error: err('acceso', 404), respaldoUrl: 'https://campus.example/mod/ivplayer/respaldo.php' };
  test('con respaldo ofrecido y una falla del CDN: la causa', () => {
    assert.equal(decidirRespaldo(base), 'http-404');
  });
  test('sin respaldoUrl (ajuste apagado, actividad sin Vimeo, demo, SCORM): no', () => {
    assert.equal(decidirRespaldo({ ...base, respaldoUrl: undefined }), null);
    assert.equal(decidirRespaldo({ ...base, respaldoUrl: '' }), null);
    assert.equal(decidirRespaldo({ ...base, respaldoUrl: 42 }), null);
  });
  test('transmitiendo a la TV: no', () => {
    assert.equal(decidirRespaldo({ ...base, transmitiendo: true }), null);
  });
  test('una vez por carga: ya intentado, o la carga ya es la de respaldo: no', () => {
    assert.equal(decidirRespaldo({ ...base, intentado: true }), null);
    assert.equal(decidirRespaldo({ ...base, enRespaldo: true }), null);
  });
  test('con respaldo ofrecido pero un error de firma o de sesión: no', () => {
    assert.equal(decidirRespaldo({ ...base, error: err('acceso', 403) }), null);
    assert.equal(decidirRespaldo({ ...base, error: err('acceso', 403, { renovacion: 'sesion' }) }), null);
  });
  test('sin argumentos no rompe', () => {
    assert.equal(decidirRespaldo(), null);
  });
});

describe('lo que se registra (datosDelError)', () => {
  test('causa, código HTTP y el nombre del error de hls.js', () => {
    assert.deepEqual(datosDelError(err('acceso', 404, { message: 'manifestLoadError' }), 'http-404'), { causa: 'http-404', codigo: 404, detalle: 'manifestLoadError' });
    assert.deepEqual(datosDelError(err('red', 503, { message: 'fragLoadError' }), 'http-503'), { causa: 'http-503', codigo: 503, detalle: 'fragLoadError' });
  });
  test('sin código: 0; códigos raros: 0', () => {
    assert.equal(datosDelError(err('red', null), 'red').codigo, 0);
    assert.equal(datosDelError(err('red', 0), 'red').codigo, 0);
    assert.equal(datosDelError(err('red', 9999), 'red').codigo, 0);
    assert.equal(datosDelError(err('red', 'abc'), 'red').codigo, 0);
  });
  test('el detalle, limpio y corto (el mensaje del medio puede traer cualquier cosa)', () => {
    const d = datosDelError(err('medio', null, { message: 'PIPELINE_ERROR_DECODE: <b>"x"</b> ' + 'a'.repeat(200) }), 'medio');
    assert.match(d.detalle, /^[A-Za-z0-9_.:-]*$/);
    assert.ok(d.detalle.length <= 64);
    assert.ok(d.detalle.startsWith('PIPELINE_ERROR_DECODE:bx'));
    assert.equal(datosDelError(null, 'red').detalle, '');
  });
});

describe('la URL de la carga con Vimeo', () => {
  const P = 'https://campus.example/mod/ivplayer/player.php?id=393';
  test('agrega origen=vimeo y conserva el resto', () => {
    const u = new URL(urlDeRespaldo(P));
    assert.equal(u.pathname, '/mod/ivplayer/player.php');
    assert.equal(u.searchParams.get('id'), '393');
    assert.equal(u.searchParams.get('origen'), 'vimeo');
  });
  test('no lo repite', () => {
    const u = new URL(urlDeRespaldo(urlDeRespaldo(P)));
    assert.deepEqual(u.searchParams.getAll('origen'), ['vimeo']);
  });
  test('yaEsRespaldo: sólo con origen=vimeo', () => {
    assert.equal(yaEsRespaldo(P), false);
    assert.equal(yaEsRespaldo(urlDeRespaldo(P)), true);
    assert.equal(yaEsRespaldo(P + '&origen=bunny'), false);
    assert.equal(yaEsRespaldo('no es una url'), false);
    assert.equal(yaEsRespaldo(undefined), false);
  });
});

describe('qué contestó respaldo.php (interpretarRespaldo)', () => {
  test('200 con ok: true → salta', () => {
    assert.deepEqual(interpretarRespaldo(200, { ok: true, registrado: true }), { ok: true });
    assert.deepEqual(interpretarRespaldo(200, { ok: true, registrado: false }), { ok: true }, 'sin registro (falta el upgrade) igual salta');
  });
  test('la sesión: 401, motivo sesion, o el JSON de error de Moodle', () => {
    assert.deepEqual(interpretarRespaldo(401, { ok: false, motivo: 'sesion' }), { ok: false, motivo: 'sesion' });
    assert.deepEqual(interpretarRespaldo(401, null), { ok: false, motivo: 'sesion' });
    assert.deepEqual(interpretarRespaldo(200, { error: 'x', errorcode: 'requireloginerror' }), { ok: false, motivo: 'sesion' });
    assert.deepEqual(interpretarRespaldo(200, { error: 'x', errorcode: 'invalidsesskey' }), { ok: false, motivo: 'sesion' });
  });
  test('sin respuesta, 5xx o algo que no es nuestro JSON (portal cautivo, el login): red', () => {
    assert.deepEqual(interpretarRespaldo(0, null), { ok: false, motivo: 'red' });
    assert.deepEqual(interpretarRespaldo(503, { ok: false, motivo: 'error' }), { ok: false, motivo: 'red' });
    assert.deepEqual(interpretarRespaldo(200, null), { ok: false, motivo: 'red' });
  });
  test('no lo deja (apagado, sin Vimeo, permiso, causa): otro', () => {
    assert.deepEqual(interpretarRespaldo(409, { ok: false, motivo: 'apagado' }), { ok: false, motivo: 'otro' });
    assert.deepEqual(interpretarRespaldo(403, { ok: false, motivo: 'permiso' }), { ok: false, motivo: 'otro' });
    assert.deepEqual(interpretarRespaldo(400, { ok: false, motivo: 'causa' }), { ok: false, motivo: 'otro' });
    assert.deepEqual(interpretarRespaldo(200, { ok: false }), { ok: false, motivo: 'otro' });
  });
});

describe('el pedido a respaldo.php (pedirRespaldo)', () => {
  const timers = { poner: () => 0, quitar: () => {} };
  const respuesta = (status, cuerpo, extra = {}) => Promise.resolve({ status, text: () => Promise.resolve(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)), ...extra });
  const datos = { url: '/mod/ivplayer/respaldo.php', cmid: 393, sesskey: 'sk', causa: 'http-404', codigo: 404, detalle: 'manifestLoadError' };

  test('POST con cmid, sesskey, causa, código y detalle, con la sesión del campus', async () => {
    let visto = null;
    const r = await pedirRespaldo(datos, { timers, fetchFn: (url, op) => { visto = { url, op }; return respuesta(200, { ok: true, registrado: true }); } });
    assert.deepEqual(r, { ok: true });
    assert.equal(visto.url, '/mod/ivplayer/respaldo.php');
    assert.equal(visto.op.method, 'POST');
    assert.equal(visto.op.credentials, 'same-origin');
    assert.equal(visto.op.cache, 'no-store');
    assert.deepEqual(Object.fromEntries(visto.op.body), { cmid: '393', sesskey: 'sk', causa: 'http-404', codigo: '404', detalle: 'manifestLoadError' });
  });

  test('sin conexión (fetch rechaza o tira): red, nunca una excepción', async () => {
    assert.deepEqual(await pedirRespaldo(datos, { timers, fetchFn: () => Promise.reject(new TypeError('Failed to fetch')) }), { ok: false, motivo: 'red' });
    assert.deepEqual(await pedirRespaldo(datos, { timers, fetchFn: () => { throw new Error('x'); } }), { ok: false, motivo: 'red' });
  });

  test('redirigido a la página del login (sin JSON): sesion', async () => {
    const r = await pedirRespaldo(datos, { timers, fetchFn: () => respuesta(200, '<html>login</html>', { redirected: true, url: 'https://campus.example/login/index.php' }) });
    assert.deepEqual(r, { ok: false, motivo: 'sesion' });
  });

  test('con tope: si no contesta, aborta (y queda red)', async () => {
    let abortado = false;
    const tPoner = (fn) => { setTimeout(fn, 5); return 1; };
    const r = await pedirRespaldo(datos, {
      timers: { poner: tPoner, quitar: () => {} },
      fetchFn: (_u, op) => new Promise((_, no) => op.signal.addEventListener('abort', () => { abortado = true; no(new Error('abort')); })),
    });
    assert.equal(abortado, true);
    assert.deepEqual(r, { ok: false, motivo: 'red' });
  });

  test('sin URL: no pide nada', async () => {
    let pidio = false;
    assert.deepEqual(await pedirRespaldo({ ...datos, url: '' }, { timers, fetchFn: () => { pidio = true; return respuesta(200, { ok: true }); } }), { ok: false, motivo: 'otro' });
    assert.equal(pidio, false);
  });
});

// scorm.js lee window al importarse: se arma un window mínimo ANTES (sin localStorage: la
// cola anda igual, sin disco) y se importa una sola vez.
describe('guardar el avance antes de recargar (moodleGuardarAvanceYa)', async () => {
  const pedidos = [];
  let contestar = () => ({ ok: true, json: { success: true } });
  globalThis.window = globalThis.window || { addEventListener() {} };
  window.MOODLE_CONTEXT = { cmid: 393, sesskey: 'sk', progressUrl: '/mod/ivplayer/progress.php' };
  const fetch0 = globalThis.fetch;
  globalThis.fetch = async (url, op) => {
    const campos = Object.fromEntries(op.body);
    pedidos.push({ url, campos });
    const r = contestar(campos);
    if (r.red) throw new TypeError('Failed to fetch');
    return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => r.json };
  };
  const { moodleGuardarAvanceYa } = await import('../../src/scorm.js');

  test('manda el avance a progress.php y espera la respuesta', async () => {
    pedidos.length = 0;
    const ok = await moodleGuardarAvanceYa({ completed: ['n8'], currentTime: 18.5 });
    assert.equal(ok, true);
    const p = pedidos.find((x) => x.url === '/mod/ivplayer/progress.php');
    assert.ok(p, 'no llegó nada a progress.php');
    assert.equal(p.campos.cmid, '393');
    assert.equal(p.campos.sesskey, 'sk');
    assert.deepEqual(JSON.parse(p.campos.data), { completed: ['n8'], currentTime: 18.5 });
  });

  test('si el servidor lo rechaza o no hay red: false (y no tira)', async () => {
    contestar = () => ({ ok: true, json: { success: false } });
    assert.equal(await moodleGuardarAvanceYa({ completed: [], currentTime: 3 }), false);
    contestar = () => ({ red: true });
    assert.equal(await moodleGuardarAvanceYa({ completed: [], currentTime: 3 }), false);
    // El que falló quedó en la cola; uno que llega lo reemplaza y, aceptado, la vacía.
    // (Si quedara, el despacho de scorm.js a los 1,5 s lo reintentaría para siempre y
    // este proceso no terminaría.)
    contestar = () => ({ ok: true, json: { success: true } });
    pedidos.length = 0;
    assert.equal(await moodleGuardarAvanceYa({ completed: [], currentTime: 4 }), true);
    assert.equal(pedidos.length, 1, 'el más nuevo reemplaza al que esperaba: un solo pedido');
    assert.deepEqual(JSON.parse(pedidos[0].campos.data), { completed: [], currentTime: 4 });
  });

  test('fuera de Moodle (sin progressUrl): false sin pedir nada', async () => {
    const ctx = window.MOODLE_CONTEXT;
    window.MOODLE_CONTEXT = { cmid: 1 };
    pedidos.length = 0;
    assert.equal(await moodleGuardarAvanceYa({ completed: [], currentTime: 1 }), false);
    assert.equal(pedidos.length, 0);
    window.MOODLE_CONTEXT = ctx;
    globalThis.fetch = fetch0;
  });
});
