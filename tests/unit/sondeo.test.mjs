// La pregunta al CDN del HLS nativo (src/sondeo.js), sin navegador: qué pide (la fuente,
// la primera variante si es un master y el primer segmento), qué devuelve con cada
// respuesta, el tope de tiempo, y el error que arma nativePlayer con eso. Con el HLS
// nativo de Chrome y el CDN de prueba, de punta a punta: tests/navegador/escenarios/
// respaldo.mjs. Datos sintéticos (repo público).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { primeraUri, sondearFuente, errorDelSondeo, SONDEO_TOPE_MS } from '../../src/sondeo.js';

const GUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BASE = `https://vz-ejemplo.b-cdn.net/bcdn_token=HS256-abc&token_path=%2F${GUID}%2F&expires=1800000000/${GUID}/`;
const MASTER = `${BASE}playlist.m3u8`;
const VARIANTE = `${BASE}480p/video.m3u8`;
const SEGMENTO = `${BASE}480p/video0.ts`;
const TEXTO_MASTER = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480\n480p/video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n1080p/video.m3u8\n';
const TEXTO_VARIANTE = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nvideo0.ts\n#EXTINF:4.0,\nvideo1.ts\n#EXT-X-ENDLIST\n';

// Un CDN de mentira: estado por URL (200 por defecto, con el texto del playlist si lo hay).
function cdn(estados = {}) {
  const pedidos = [];
  const abortados = [];
  const fetchFn = (url, opciones = {}) => {
    pedidos.push({ url, cache: opciones.cache });
    if (opciones.signal) opciones.signal.addEventListener('abort', () => abortados.push(url));
    const e = estados[url];
    if (e === 'sin-respuesta') return Promise.reject(new TypeError('Failed to fetch'));
    if (e === 'colgado') return new Promise((ok, mal) => { opciones.signal?.addEventListener('abort', () => mal(new DOMException('abortado', 'AbortError'))); });
    const status = typeof e === 'number' ? e : 200;
    const texto = url === MASTER ? TEXTO_MASTER : url === VARIANTE ? TEXTO_VARIANTE : 'segmento';
    return Promise.resolve({ ok: status >= 200 && status < 300, status, url, text: () => Promise.resolve(texto) });
  };
  return { fetchFn, pedidos, abortados };
}

describe('primeraUri: la primera línea que no es comentario, resuelta', () => {
  test('en un master, la primera variante (con el token de la ruta heredado)', () => assert.equal(primeraUri(TEXTO_MASTER, MASTER), VARIANTE));
  test('en uno de medios, el primer segmento', () => assert.equal(primeraUri(TEXTO_VARIANTE, VARIANTE), SEGMENTO));
  test('las URI adentro de etiquetas (#EXT-X-MAP, #EXT-X-MEDIA) no cuentan; con CRLF y espacios', () => {
    assert.equal(primeraUri('#EXTM3U\r\n#EXT-X-MAP:URI="init.mp4"\r\n#EXTINF:4,\r\n  seg0.m4s  \r\n', VARIANTE), `${BASE}480p/seg0.m4s`);
  });
  test('absoluta: queda como está', () => assert.equal(primeraUri('#EXTM3U\nhttps://otro.example/x.ts\n', VARIANTE), 'https://otro.example/x.ts'));
  test('sin ninguna, o sin texto: null', () => {
    assert.equal(primeraUri('#EXTM3U\n#EXT-X-ENDLIST\n', VARIANTE), null);
    assert.equal(primeraUri('', VARIANTE), null);
    assert.equal(primeraUri(undefined, VARIANTE), null);
  });
});

describe('sondearFuente: qué pide y qué devuelve', () => {
  test('todo bien: master → primera variante → primer segmento, sin caché, y el segmento se corta', async () => {
    const c = cdn();
    assert.deepEqual(await sondearFuente(MASTER, { fetchFn: c.fetchFn }), { estado: 200, paso: 'segmento' });
    assert.deepEqual(c.pedidos.map((p) => p.url), [MASTER, VARIANTE, SEGMENTO]);
    assert.ok(c.pedidos.every((p) => p.cache === 'no-store'), 'sin caché: si no, la respuesta vieja tapa la de ahora');
    assert.ok(c.abortados.includes(SEGMENTO), 'el segmento no se baja entero');
  });
  test('la fuente es una variante (calidad elegida): directo al segmento', async () => {
    const c = cdn();
    assert.deepEqual(await sondearFuente(VARIANTE, { fetchFn: c.fetchFn }), { estado: 200, paso: 'segmento' });
    assert.deepEqual(c.pedidos.map((p) => p.url), [VARIANTE, SEGMENTO]);
  });
  test('el playlist da 404 (un GUID que no existe): 404 en el playlist, sin pedir más', async () => {
    const c = cdn({ [MASTER]: 404 });
    assert.deepEqual(await sondearFuente(MASTER, { fetchFn: c.fetchFn }), { estado: 404, paso: 'playlist' });
    assert.equal(c.pedidos.length, 1);
  });
  test('403 del playlist (cuenta suspendida, dominios restringidos): 403', async () => {
    assert.deepEqual(await sondearFuente(MASTER, { fetchFn: cdn({ [MASTER]: 403 }).fetchFn }), { estado: 403, paso: 'playlist' });
  });
  test('la variante da 503: 503 en la variante', async () => {
    assert.deepEqual(await sondearFuente(MASTER, { fetchFn: cdn({ [VARIANTE]: 503 }).fetchFn }), { estado: 503, paso: 'variante' });
  });
  test('el segmento da 403 con el playlist bien (la firma vigente): 403 en el segmento', async () => {
    assert.deepEqual(await sondearFuente(MASTER, { fetchFn: cdn({ [SEGMENTO]: 403 }).fetchFn }), { estado: 403, paso: 'segmento' });
  });
  test('sin respuesta (sin red, CORS): 0, en el paso donde se cortó', async () => {
    assert.deepEqual(await sondearFuente(MASTER, { fetchFn: cdn({ [MASTER]: 'sin-respuesta' }).fetchFn }), { estado: 0, paso: 'playlist' });
    assert.deepEqual(await sondearFuente(MASTER, { fetchFn: cdn({ [SEGMENTO]: 'sin-respuesta' }).fetchFn }), { estado: 0, paso: 'segmento' });
  });
  test('un fetch que tira en el acto: 0, no rechaza', async () => {
    assert.deepEqual(await sondearFuente(MASTER, { fetchFn: () => { throw new Error('x'); } }), { estado: 0, paso: 'playlist' });
  });
  test('el CDN colgado: al tope corta todo y da 0 (sin respuesta)', async () => {
    let disparar = null;
    let quitado = false;
    const timers = { poner: (fn, ms) => { assert.equal(ms, SONDEO_TOPE_MS); disparar = fn; return 1; }, quitar: () => { quitado = true; } };
    const c = cdn({ [VARIANTE]: 'colgado' });
    const p = sondearFuente(MASTER, { fetchFn: c.fetchFn, timers });
    await new Promise((r) => setTimeout(r, 10));
    disparar();
    assert.deepEqual(await p, { estado: 0, paso: 'variante' });
    assert.ok(quitado, 'el tope se limpia');
  });
  test('un master sin variantes, o una variante sin segmentos: 200 (no hay qué más preguntar)', async () => {
    const vacio = (url) => Promise.resolve({ ok: true, status: 200, url, text: () => Promise.resolve('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n') });
    assert.deepEqual(await sondearFuente(MASTER, { fetchFn: vacio }), { estado: 200, paso: 'playlist' });
  });
  test('sin URL o sin fetch: 0 sin pedir nada', async () => {
    assert.deepEqual(await sondearFuente('', { fetchFn: () => assert.fail('pidió') }), { estado: 0, paso: 'playlist' });
    assert.deepEqual(await sondearFuente(MASTER, { fetchFn: null }), { estado: 0, paso: 'playlist' });
  });
});

describe('errorDelSondeo: el error de nativePlayer para lo que contestó el CDN', () => {
  const casos = [
    [{ estado: 404, paso: 'playlist' }, { tipo: 'acceso', code: 404, detalle: 'nativo-playlist' }],
    [{ estado: 403, paso: 'segmento' }, { tipo: 'acceso', code: 403, detalle: 'nativo-segmento' }],
    [{ estado: 401, paso: 'variante' }, { tipo: 'acceso', code: 401, detalle: 'nativo-variante' }],
    [{ estado: 410, paso: 'playlist' }, { tipo: 'acceso', code: 410, detalle: 'nativo-playlist' }],
    [{ estado: 503, paso: 'segmento' }, { tipo: 'red', code: 503, detalle: 'nativo-segmento' }],
    [{ estado: 0, paso: 'playlist' }, { tipo: 'red', code: null, detalle: 'nativo-playlist' }],
    [{ estado: 200, paso: 'segmento' }, { tipo: 'medio', code: null, detalle: 'nativo-medio' }],
    [{ estado: 404, paso: 'raro' }, { tipo: 'acceso', code: 404, detalle: 'nativo-playlist' }],
    [{}, { tipo: 'red', code: null, detalle: 'nativo-playlist' }],
  ];
  for (const [r, esperado] of casos) {
    test(JSON.stringify(r), () => assert.deepEqual(errorDelSondeo(r), esperado));
  }
  test('el detalle pasa entero el filtro del registro (letras, números y _.:-)', () => {
    for (const [r] of casos) assert.match(errorDelSondeo(r).detalle, /^[A-Za-z0-9_.:-]{1,64}$/);
  });
});
