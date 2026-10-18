// Red de seguridad: si el video de Bunny no se puede reproducir por una falla del
// servidor de video, la lección se vuelve a cargar con Vimeo y retoma desde el avance
// guardado (plan de migración a Bunny, tramo 0.4). Mientras siga pagándose Vimeo, cada
// actividad migrada conserva su ID de Vimeo, y esto lo usa de respaldo.
//
// Cómo: NO se cambia de motor en caliente (el componente no sabe hacerlo y el motor
// propio está atado a la firma, a la TV y al candado). Se guarda el avance, se le avisa
// a Moodle (mod/ivplayer/respaldo.php, que registra el salto con su causa y confirma
// que se puede) y se recarga player.php con ?origen=vimeo. player.php lo respeta sólo
// con el ajuste del sitio prendido y la actividad con ID de Vimeo; si no, lo ignora.
// La carga nueva es Vimeo, así que no puede volver a saltar: el tope es una vez por
// carga de la página de la lección.
//
// Cuándo salta (causaDelRespaldo): SÓLO una falla del CDN, después de los reintentos
// que ya hace el reproductor (nativePlayer.js):
//   'http-404'  el playlist o un segmento no está (también: firmado con la
//               autenticación de Bunny apagada, o un GUID que no existe).
//   'http-5NN'  el CDN contesta con error del servidor.
//   'red'       no se llega al CDN (sin respuesta, conexión rechazada) o lo que llega
//               no se puede usar.
//   'medio'     error fatal del medio (hls.js después de recover/swap, o el MediaError
//               del HLS nativo después de renovar y recargar una vez, con el CDN
//               contestando bien).
// Con el HLS nativo (iPhone, iPad, Safari) el <video> no da el código HTTP: antes del
// error, nativePlayer le pregunta al CDN por la misma fuente (src/sondeo.js), así que
// las causas y la regla del 403 son las mismas que con hls.js.
// Cuándo NO salta nunca:
//   - la firma (401/403/410 del CDN): vencida o a punto de vencer la renueva firma.js
//     sola; si no puede, el cartel dice por qué. Un 403 con la firma vigente tampoco: no
//     es "el servidor se cayó".
//   - cualquier otro error de hls.js ('otro': MUX, KEY_SYSTEM, OTHER): el plan cuenta sólo
//     la red, un 5xx, un 404 o un error fatal del medio. Va al cartel de siempre.
//   - la sesión cerrada o sin permiso (renovación con motivo 'sesion' u 'otro'). Si
//     saltara, el alumno vería el video con Vimeo sin que se guarde nada: ni avance, ni
//     respuestas, ni finalización (progress, answer y complete piden la sesión).
//   - transmitiendo a la TV (Chromecast o AirPlay).
//   - sin respaldoUrl en MOODLE_CONTEXT: player.php lo pone sólo si esta carga es de
//     Bunny, el ajuste del sitio está prendido y la actividad tiene ID de Vimeo.
//   - si respaldo.php no confirma: sesión cerrada (ahí el cartel es el de la sesión, y
//     "Reintentar" recarga la página entera), sin conexión con el campus (es la señal del
//     alumno, no Bunny: recargar mostraría la página de error del navegador adentro del
//     video), o el ajuste apagado mientras tanto.
//
// Las funciones de arriba son PURAS (tests/unit/respaldo.test.mjs). Lo que pasa en el
// navegador (las fallas simuladas, la recarga y el retomar) lo prueba
// tests/navegador/escenarios/respaldo.mjs.

const TOPE_PEDIDO_MS = 10000;
// Cuánto se espera el guardado del avance antes de recargar (si tarda, queda en la cola
// de scorm.js y lo manda la carga siguiente).
export const GUARDAR_AVANCE_MS = 8000;
// Lo que se manda como detalle (el nombre del error de hls.js: manifestLoadError,
// fragLoadError…): sólo letras, números y _.:- y corto. respaldo.php lo vuelve a limpiar.
const DETALLE_MAX = 64;

// La causa del salto para un error fatal del video propio (el que emite nativePlayer:
// { fatal, tipo, code, message, renovacion? }), o null si con ese error no se salta.
export function causaDelRespaldo(error) {
  if (!error || !error.fatal) return null;
  // 🔴 Nunca por la sesión ni por falta de permiso, venga en el error que venga.
  if (error.renovacion === 'sesion' || error.renovacion === 'otro') return null;
  const code = Number(error.code) || 0;
  // Ni la firma: un 401/403/410 del CDN nunca, aunque llegue con otro tipo.
  if (code === 401 || code === 403 || code === 410) return null;
  if (error.tipo === 'acceso') return code === 404 ? 'http-404' : null;
  if (error.tipo === 'red') return code >= 500 && code <= 599 ? `http-${code}` : 'red';
  if (error.tipo === 'medio') return 'medio';
  // 'otro' (cualquier otro fatal de hls.js), 'sin-fuente' y 'sin-soporte' no son fallas
  // del CDN.
  return null;
}

// ¿Salta esta carga? Devuelve la causa o null. Junta lo que no sale del error:
//   respaldoUrl   MOODLE_CONTEXT.respaldoUrl (sin ella, la red está apagada para esta carga)
//   transmitiendo hay una TV conectada o conectándose (Chromecast o AirPlay)
//   intentado     ya se intentó en esta carga (y respaldo.php no confirmó)
//   enRespaldo    esta carga ya es la de respaldo (?origen=vimeo en la URL)
export function decidirRespaldo({ error, respaldoUrl, transmitiendo = false, intentado = false, enRespaldo = false } = {}) {
  if (!respaldoUrl || typeof respaldoUrl !== 'string' || transmitiendo || intentado || enRespaldo) return null;
  return causaDelRespaldo(error);
}

// Lo que se le manda a respaldo.php para el registro: la causa, el código HTTP (0 si no
// hubo) y el detalle (el nombre del error de hls.js, o el del medio).
export function datosDelError(error, causa) {
  const code = Number(error && error.code);
  const detalle = String((error && error.message) || '').replace(/[^A-Za-z0-9_.:-]+/g, '').slice(0, DETALLE_MAX);
  return { causa, codigo: Number.isInteger(code) && code > 0 && code < 600 ? code : 0, detalle };
}

// ¿Esta carga ya es la de respaldo? (player.php?id=…&origen=vimeo)
export function yaEsRespaldo(href) {
  try { return new URL(String(href)).searchParams.get('origen') === 'vimeo'; } catch (e) { return false; }
}

// La URL de esta misma carga con ?origen=vimeo (el resto de la query, igual).
export function urlDeRespaldo(href) {
  const u = new URL(String(href));
  u.searchParams.set('origen', 'vimeo');
  return u.href;
}

// Qué contestó respaldo.php: { ok: true } o { ok: false, motivo } con motivo
//   'sesion' → no hay sesión (o el sesskey ya no vale): el cartel de la sesión.
//   'red'    → no se llegó al campus o contestó con error del servidor.
//   'otro'   → no lo deja (ajuste apagado, sin Vimeo, sin permiso, causa rechazada).
export function interpretarRespaldo(estado, json) {
  if (estado >= 200 && estado < 300 && json && json.ok === true) return { ok: true };
  if (json && json.motivo === 'sesion') return { ok: false, motivo: 'sesion' };
  // El JSON de error de Moodle (AJAX_SCRIPT) si algo se escapó al manejador propio.
  if (json && /requirelogin|invalidsesskey|sessiontimeout|sesskey/i.test(String(json.errorcode || ''))) return { ok: false, motivo: 'sesion' };
  if (estado === 401) return { ok: false, motivo: 'sesion' };
  // Sin respuesta, error del servidor, o un 200 que no es nuestro JSON (un portal
  // cautivo, la página del login): no se salta.
  if (!estado || estado >= 500 || !json) return { ok: false, motivo: 'red' };
  return { ok: false, motivo: 'otro' };
}

// Le avisa a respaldo.php (POST) y devuelve lo que contestó (interpretarRespaldo). Nunca
// rechaza. `fetchFn` y `timers` se pueden reemplazar (pruebas).
export function pedirRespaldo({ url, cmid, sesskey, causa, codigo = 0, detalle = '' }, {
  fetchFn = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
  timers = { poner: (fn, ms) => setTimeout(fn, ms), quitar: (id) => clearTimeout(id) },
  topeMs = TOPE_PEDIDO_MS,
} = {}) {
  if (!url || !fetchFn) return Promise.resolve({ ok: false, motivo: 'otro' });
  // AbortController a mano (no AbortSignal.timeout): WebViews de Android viejos.
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const tope = timers.poner(() => { if (ac) ac.abort(); }, topeMs);
  const cuerpo = new URLSearchParams();
  cuerpo.set('cmid', String(cmid ?? ''));
  cuerpo.set('sesskey', String(sesskey ?? ''));
  cuerpo.set('causa', String(causa ?? ''));
  cuerpo.set('codigo', String(codigo ?? 0));
  cuerpo.set('detalle', String(detalle ?? ''));
  let pedido;
  try {
    pedido = fetchFn(url, {
      method: 'POST', body: cuerpo, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: ac ? ac.signal : undefined,
    });
  } catch (e) {
    pedido = Promise.reject(e);
  }
  return Promise.resolve(pedido)
    .then((r) => r.text().then((txt) => {
      let json = null;
      try { json = JSON.parse(txt); } catch (e) { json = null; }
      if (!json && r.redirected && /\/login\//.test(String(r.url || ''))) return { ok: false, motivo: 'sesion' };
      return interpretarRespaldo(r.status, json);
    }), () => ({ ok: false, motivo: 'red' }))
    .finally(() => timers.quitar(tope));
}
