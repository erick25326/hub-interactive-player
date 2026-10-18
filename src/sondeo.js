// HLS nativo (Safari, iPhone, iPad): el <video> no dice el código HTTP de lo que falló.
// Antes de dar el error definitivo, nativePlayer le pregunta al CDN por la misma fuente
// (sondearFuente) y arma el error con lo que contestó (errorDelSondeo). Así el error sale
// igual que con hls.js, que sí tiene el código:
//   401/403/410 y otros 4xx → 'acceso' con el código: la firma o un permiso. La red de
//                             seguridad nunca salta por eso (src/respaldo.js); un 404, sí.
//   5xx                     → 'red' con el código: el CDN.
//   sin respuesta           → 'red' sin código (sin conexión, CORS, el tope de tiempo).
//   todo contesta bien      → 'medio': lo que falló es el video en sí.
// Sin esto, en iPhone todo terminaba como 'medio' sin código: la red de seguridad saltaba
// con un 403 (con hls.js no) y el registro no separaba "falla de Bunny" de "señal mala".
//
// Se pide la fuente que tenía el <video> (el master o la variante elegida); si es un
// master, la PRIMERA variante; y de ésa, el PRIMER segmento (sólo los encabezados: el
// resto se corta). Una variante o un segmento que fallen y no sean los primeros no se ven:
// ahí sale 'medio', como antes. El CDN de Bunny contesta con CORS (hls.js depende de eso).
//
// Puro salvo el fetch, que se puede reemplazar (tests/unit/sondeo.test.mjs). Lo de punta a
// punta con el HLS nativo de Chrome, en tests/navegador/escenarios/respaldo.mjs.

// Tope para toda la pregunta (los tres pedidos). Pasado, cuenta como sin respuesta.
export const SONDEO_TOPE_MS = 8000;

// La primera URI de un playlist (una línea que no es un comentario ni una etiqueta),
// resuelta contra `base`, o null. En un master es una variante; en uno de medios, un
// segmento. Las URI que van adentro de una etiqueta (#EXT-X-MEDIA, #EXT-X-MAP) no cuentan.
export function primeraUri(texto, base) {
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l[0] === '#') continue;
    try { return new URL(l, base).href; } catch (e) { return null; }
  }
  return null;
}

// Le pregunta al CDN por `url`. Devuelve { estado, paso }: el código HTTP del primer
// pedido que no anduvo (0 si no hubo respuesta) o 200 si anduvieron todos, y en qué paso
// ('playlist', 'variante' o 'segmento'). Nunca rechaza.
export async function sondearFuente(url, {
  fetchFn = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
  timers = { poner: (fn, ms) => setTimeout(fn, ms), quitar: (id) => clearTimeout(id) },
  topeMs = SONDEO_TOPE_MS,
} = {}) {
  let paso = 'playlist';
  if (!url || !fetchFn) return { estado: 0, paso };
  // AbortController a mano (no AbortSignal.timeout): Safari y WebViews viejos.
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const tope = timers.poner(() => { if (ac) ac.abort(); }, topeMs);
  const pedir = (u) => fetchFn(u, { cache: 'no-store', signal: ac ? ac.signal : undefined });
  try {
    let r = await pedir(url);
    if (!r || !r.ok) return { estado: (r && r.status) || 0, paso };
    let texto = await r.text();
    let base = r.url || url;
    if (/#EXT-X-STREAM-INF/i.test(texto)) {
      const variante = primeraUri(texto, base);
      if (!variante) return { estado: 200, paso };
      paso = 'variante';
      r = await pedir(variante);
      if (!r || !r.ok) return { estado: (r && r.status) || 0, paso };
      texto = await r.text();
      base = r.url || variante;
    }
    const segmento = primeraUri(texto, base);
    if (!segmento) return { estado: 200, paso };
    paso = 'segmento';
    r = await pedir(segmento);
    // Del segmento alcanza con el código: no se baja el resto (puede pesar megas).
    if (ac) ac.abort();
    if (!r || !r.ok) return { estado: (r && r.status) || 0, paso };
    return { estado: 200, paso };
  } catch (e) {
    return { estado: 0, paso };
  } finally {
    timers.quitar(tope);
  }
}

// El error de nativePlayer (tipo, código y detalle) para lo que contestó el CDN. El
// detalle va al registro de la red de seguridad: 'nativo-playlist', 'nativo-variante' o
// 'nativo-segmento' (el pedido que falló, como manifestLoadError, levelLoadError y
// fragLoadError con hls.js) o 'nativo-medio' (el CDN contestó bien).
export function errorDelSondeo({ estado, paso } = {}) {
  const code = Number(estado) || 0;
  const detalle = `nativo-${paso === 'variante' || paso === 'segmento' ? paso : 'playlist'}`;
  if (code >= 400 && code < 500) return { tipo: 'acceso', code, detalle };
  if (code >= 500 && code < 600) return { tipo: 'red', code, detalle };
  if (!code) return { tipo: 'red', code: null, detalle };
  return { tipo: 'medio', code: null, detalle: 'nativo-medio' };
}
