// Renovación de la firma de Bunny con la lección abierta.
//
// Por qué existe: player.php firma el playlist con un vencimiento (la duración del
// token, 6 h por defecto, llevada a la hora en punto siguiente) y Bunny valida ese
// vencimiento en CADA pedido. Si la lección quedaba abierta más que eso (el alumno
// pausa, se va a comer y vuelve), el próximo .ts daba 403 y el reproductor mostraba
// "El acceso al video venció". Ahora, antes de que venza, se le pide a Moodle una
// firma nueva (mod/ivplayer/firma.php) y los motores la usan sin cortar la clase:
//   - hls.js: cada pedido sale reescrito con la firma vigente (nativePlayer, xhrSetup).
//   - HLS nativo (iPhone) y AirPlay: no se pueden tocar los pedidos; se cambia la
//     fuente al mismo segundo, con el mecanismo del cambio de calidad.
//   - Chromecast: la TV vuelve a cargar el video, en el mismo segundo (cast.js).
//
// Lo de arriba de la clase son funciones PURAS (se prueban en tests/unit/firma.test.mjs
// sin navegador): leer la firma de una URL, reescribir una URL del mismo video con otra
// firma, los márgenes y el reloj. El Renovador es lo único que habla con Moodle.
//
// 🔴 La clave de Bunny nunca llega acá: firma.php devuelve URLs ya firmadas. De una
// URL se lee sólo lo que viaja en ella (token, token_path, expires).
// 🔴 Sin firmaUrl (página de prueba sin token, configurador, SCORM) o con una URL sin
// bcdn_token, el Renovador queda INACTIVO y nada cambia respecto de antes.

// Cuánto antes del vencimiento se pide la firma nueva. Con la duración mínima del
// ajuste (1 h) queda casi toda la hora útil y sobra tiempo para reintentar si el
// primer pedido falla (sin señal en el campo).
export const RENOVAR_ANTES_MS = 10 * 60 * 1000;
// HLS nativo y TV: hasta acá se espera un momento tranquilo para cambiar de fuente (el
// video en pausa). Pasado esto se cambia igual, reproduciendo: un tironcito de un
// segundo es mejor que un 403.
export const URGENTE_MS = 90 * 1000;
// hls.js: un pedido que sale con menos que esto de vida espera la firma nueva antes de
// salir (cubre la pestaña que estuvo dormida y se despierta pidiendo un segmento).
export const ANTES_DEL_PEDIDO_MS = 30 * 1000;
// Después de un pedido fallido, los que no son forzados no vuelven a molestar a Moodle
// por un rato (cada segmento lo pediría de nuevo).
export const ESPERA_TRAS_FALLO_MS = 5000;
const TOPE_PEDIDO_MS = 15000;
const REINTENTO_MAX_MS = 60000;
// Después de un 403 (el video ya NECESITA la firma nueva) y sin red: hasta cuánto se
// insiste antes del cartel, con reintentos a 1, 2 y 4 s (ver renovarYa).
export const INSISTIR_MS = 15000;
const INSISTIR_PRIMERO_MS = 1000;
const INSISTIR_MAX_ESPERA_MS = 4000;

// Parámetros de la firma de Bunny cuando va en la query (?token=…). Los demás
// parámetros de una URL se conservan tal cual.
const CLAVES_FIRMA = new Set(['token', 'token_path', 'expires', 'token_countries', 'token_countries_blocked', 'token_ignore_params']);
// El tramo de la RUTA con la firma: /bcdn_token=HS256-…&token_path=%2F<guid>%2F&expires=E/
const RE_TRAMO = /\/bcdn_token=([^/?#]*)\//;

// Ruta (con esquema y host), query (sin "?", null si no hay) y fragmento (con "#").
// A mano y no con new URL(): así la URL vuelve con la misma codificación que trajo.
function partes(url) {
  const iHash = url.indexOf('#');
  const sinHash = iHash < 0 ? url : url.slice(0, iHash);
  const hash = iHash < 0 ? '' : url.slice(iHash);
  const iQ = sinHash.indexOf('?');
  return { ruta: iQ < 0 ? sinHash : sinHash.slice(0, iQ), query: iQ < 0 ? null : sinHash.slice(iQ + 1), hash };
}

const codificar = (pares) => pares.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

// Esquema + host (+ puerto) de una URL absoluta, o null. Sólo para COMPARAR: la URL que
// se reescribe no pasa por new URL() (ver partes).
function origenDe(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch (e) {
    return null;
  }
}

// La firma de Bunny de una URL, en la RUTA (el playlist, sus variantes y sus .ts) o en
// la QUERY (la miniatura), o null si no trae firma.
//   { token, tokenPath, expires, pares, tramo, origen }
// pares: los parámetros de la firma en orden, con el token como 'token' (la forma de la
// query). tramo: el texto del tramo de la ruta sin las barras ("bcdn_token=…"), tal
// cual lo armó el servidor si vino en la ruta. origen: el host de la URL (ver mismoVideo).
export function leerFirma(url) {
  if (typeof url !== 'string' || !url) return null;
  const { ruta, query } = partes(url);
  const m = RE_TRAMO.exec(ruta);
  let pares, tramo = null;
  if (m) {
    tramo = 'bcdn_token=' + m[1];
    pares = [...new URLSearchParams(tramo)].map(([k, v]) => [k === 'bcdn_token' ? 'token' : k, v]);
  } else if (query != null) {
    pares = [...new URLSearchParams(query)].filter(([k]) => CLAVES_FIRMA.has(k));
  } else {
    return null;
  }
  const valor = (k) => { const x = pares.find(([c]) => c === k); return x ? x[1] : null; };
  const token = valor('token');
  const expires = Number(valor('expires'));
  if (!token || !Number.isFinite(expires) || expires <= 0) return null;
  if (tramo == null) tramo = codificar(pares.map(([k, v]) => [k === 'token' ? 'bcdn_token' : k, v]));
  return { token, tokenPath: valor('token_path'), expires: Math.floor(expires), pares, tramo, origen: origenDe(url) };
}

// ¿Las dos firmas son del mismo video? El token es de DIRECTORIO (token_path=/<guid>/):
// una firma de otro directorio no sirve para estas URLs. Y del mismo HOST: el token
// vigente nunca se le pega a una URL de otro servidor que pase por hls.js, el cambio de
// fuente o la TV, aunque traiga algo con forma de firma (un /bcdn_token=…/ o un
// ?token=&expires=).
// 🔴 Sin token_path no hay con qué comparar y NO se reemplaza. Antes valía de comodín:
// cualquier URL con ?token=…&expires=… se llevaba el token vigente, también a otro host.
// Las de player.php y firma.php lo traen siempre (token de directorio).
const mismoVideo = (a, b) => a.origen != null && a.origen === b.origen && a.tokenPath != null && a.tokenPath === b.tokenPath;

// La misma URL con la firma `firma` en lugar de la que trae. Sirve para el master, las
// variantes, los .ts (firma en la ruta) y la miniatura (firma en la query). Una URL sin
// firma, o con la de otro video u otro host, vuelve tal cual: no se le agrega nada que
// no tenía.
export function reescribir(url, firma) {
  if (!firma || typeof url !== 'string' || !url) return url;
  const vieja = leerFirma(url);
  if (!vieja || !mismoVideo(vieja, firma)) return url;
  const { ruta, query, hash } = partes(url);
  const m = RE_TRAMO.exec(ruta);
  if (m) {
    // Con una función y no con texto de reemplazo: "$" en el token no tiene que
    // significar nada (ver la trampa de String.replace en el CLAUDE.md).
    const nueva = ruta.replace(RE_TRAMO, () => '/' + firma.tramo + '/');
    return nueva + (query != null ? '?' + query : '') + hash;
  }
  const resto = [...new URLSearchParams(query)].filter(([k]) => !CLAVES_FIRMA.has(k));
  return ruta + '?' + codificar([...firma.pares, ...resto]) + hash;
}

// La URL sin la firma: la misma "cosa" pedida con cualquier firma da la misma clave
// (el reproductor anota con qué firma salió cada pedido).
export function sinFirma(url) {
  if (typeof url !== 'string' || !url) return '';
  const { ruta, query, hash } = partes(url);
  const r = ruta.replace(RE_TRAMO, () => '/');
  if (query == null) return r + hash;
  const resto = [...new URLSearchParams(query)].filter(([k]) => !CLAVES_FIRMA.has(k));
  return r + (resto.length ? '?' + codificar(resto) : '') + hash;
}

// Márgenes según cuánto duraba la firma al recibirla. Con las duraciones reales (1 h
// o más) son los fijos de arriba; con firmas cortas (las pruebas usan segundos) se
// achican en proporción, si no se renovaría sin parar.
export function margenes(vigenciaMs) {
  const v = Math.max(0, Number(vigenciaMs) || 0);
  return {
    renovar: Math.min(RENOVAR_ANTES_MS, v / 2),
    urgente: Math.min(URGENTE_MS, v / 6),
    pedido: Math.min(ANTES_DEL_PEDIDO_MS, v / 4),
  };
}

// Cuánto le queda a la firma, medido desde que se recibió.
// 🔴 NO se compara Date.now() con el expires del servidor: el reloj de un celular puede
// estar corrido horas (zona mal puesta, hora a mano) y la firma "vencería" al cargar o
// nunca. Se toma lo que faltaba según el SERVIDOR al firmar (expires − su hora) y se le
// resta lo que pasó desde entonces en este equipo.
// Lo que pasó se mide con los dos relojes y gana el MAYOR: el monotónico no cuenta el
// tiempo que el equipo estuvo suspendido (en algunos sistemas) y el de pared puede
// saltar si cambian la hora. Un salto hacia adelante sólo adelanta la renovación (un
// pedido de más); uno hacia atrás no cuenta, porque manda el monotónico.
export function crearReloj(restanteMs, { mono = () => performance.now(), pared = () => Date.now() } = {}) {
  const m0 = mono(), p0 = pared();
  return {
    restanteMs: () => restanteMs - Math.max(mono() - m0, pared() - p0, 0),
  };
}

// Qué dijo firma.php. Devuelve { ok: true, playlist, poster, expires, ahora } o
// { ok: false, motivo } con motivo:
//   'sesion' → se cerró la sesión del campus (o el sesskey ya no vale): hay que recargar.
//   'red'    → no hubo respuesta usable (sin señal, el servidor caído): se reintenta.
//   'otro'   → no se puede renovar (la actividad ya no usa Bunny, sin permiso).
export function interpretarRespuesta(estado, json) {
  if (json && json.ok === true && typeof json.playlist === 'string') {
    return { ok: true, playlist: json.playlist, poster: typeof json.poster === 'string' ? json.poster : null, expires: Number(json.expires), ahora: Number(json.ahora) };
  }
  if (json && json.motivo === 'sesion') return { ok: false, motivo: 'sesion' };
  // Si algo se escapó al manejador propio de firma.php, Moodle contesta con su JSON de
  // error (AJAX_SCRIPT): el del login y el del sesskey también son "volvé a ingresar".
  if (json && /requirelogin|invalidsesskey|sessiontimeout|sesskey/i.test(String(json.errorcode || ''))) return { ok: false, motivo: 'sesion' };
  if (estado === 401) return { ok: false, motivo: 'sesion' };
  // El servidor no pudo (caído, sobrecargado) o no se llegó: vale la pena reintentar.
  if (!estado || estado >= 500 || estado === 408 || estado === 429) return { ok: false, motivo: 'red' };
  // Sin permiso, la actividad ya no usa Bunny, o una respuesta que no se entiende.
  return { ok: false, motivo: 'otro' };
}

// --- El que habla con Moodle -----------------------------------------------------
//
// new Renovador({ url, poster, firmaUrl, cmid, sesskey, ahoraServidor })
//   url: el playlist firmado con que arrancó la página (videoUrl).
//   firmaUrl, cmid, sesskey: de MOODLE_CONTEXT (player.php).
//   ahoraServidor: la hora del servidor al firmar (MOODLE_CONTEXT.firmaAhora), en
//     segundos. Sin ella se usa la del equipo.
// Eventos: 'renovada' (firma) cuando hay una firma nueva.
export class Renovador {
  constructor({
    url, poster = null, firmaUrl = null, cmid = null, sesskey = null, ahoraServidor = null,
    enUso = () => true,
    fetch: fetchFn = (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
    mono = () => performance.now(), pared = () => Date.now(),
    timers = { poner: (fn, ms) => setTimeout(fn, ms), quitar: (id) => clearTimeout(id) },
    ventana = (typeof window !== 'undefined' ? window : null),
    documento = (typeof document !== 'undefined' ? document : null),
  } = {}) {
    this._handlers = {};
    this._enUso = enUso;
    this._url = firmaUrl || null;
    this._cmid = cmid;
    this._sesskey = sesskey;
    this._fetch = fetchFn;
    this._mono = mono;
    this._pared = pared;
    this._timers = timers;
    this._ventana = ventana;
    this._documento = documento;
    this._poster = poster || null;
    this._enVuelo = null;
    this._fallo = null;            // { motivo, mono, pared }: el último pedido que no anduvo
    this._insistencia = null;      // renovarYa en curso: { promesa, timer, despertar, cancelar }
    this._timer = null;
    this._destruido = false;
    this._margenes = margenes(0);
    this._firma = leerFirma(url);
    if (!this.activa()) return;
    const a = Number(ahoraServidor);
    const ahora = ahoraServidor != null && ahoraServidor !== '' && Number.isFinite(a) && a > 0 ? a : pared() / 1000;
    // La hora del servidor es de cuando armó la página; desde entonces pasó la descarga y
    // el arranque (en un celular con poca señal, segundos). El monotónico cuenta desde
    // que empezó a cargar esta página: se descuenta entero, lo que da un poco de más
    // (también la ida del pedido), nunca de menos.
    const yaPaso = Math.max(0, Number(mono()) || 0);
    this._aplicar(this._firma, (this._firma.expires - ahora) * 1000 - yaPaso, null, false);
    // Al volver: la pantalla se prendió, la pestaña volvió a primer plano o salió del
    // congelamiento, o volvió la red. Oculta, el navegador frena los timers (Chrome, 1
    // por minuto; iOS, ninguno con la pantalla apagada) y el de la renovación pudo no
    // haber corrido: se mira de nuevo cuánto falta.
    this._alVolver = () => {
      if (this._documento && this._documento.visibilityState === 'hidden') return;
      this._revisar(true);
    };
    this._oyentes = [];
    const escuchar = (obj, ev) => { if (obj && obj.addEventListener) { obj.addEventListener(ev, this._alVolver); this._oyentes.push([obj, ev]); } };
    escuchar(this._documento, 'visibilitychange');
    escuchar(this._documento, 'resume');
    escuchar(this._ventana, 'pageshow');
    escuchar(this._ventana, 'online');
    escuchar(this._ventana, 'focus');
  }

  activa() { return !!(this._url && this._firma && this._fetch && !this._destruido); }
  // El alumno volvió a usar el video (play): si la firma está por vencer, se renueva ya.
  alUsar() { this._revisar(true); }
  actual() { return this._firma; }
  poster() { return this._poster; }
  reescribir(url) { return this.activa() ? reescribir(url, this._firma) : url; }
  restanteMs() { return this._reloj ? this._reloj.restanteMs() : Infinity; }
  // Cuánto le queda a OTRA firma del mismo video (la de la fuente que tiene cargada el
  // <video> o la TV, que puede ser la anterior). Los dos expires son del servidor: la
  // diferencia es exacta.
  restanteDe(expires) {
    if (!this._firma || expires == null) return this.restanteMs();
    return this.restanteMs() + (expires - this._firma.expires) * 1000;
  }
  urgenteDe(expires) { return this.restanteDe(expires) <= this._margenes.urgente; }
  vencidaDe(expires) { return this.restanteDe(expires) <= 0; }
  // ¿Un rechazo del CDN (403) de un pedido hecho con esta firma se puede explicar por el
  // vencimiento? Sí si le quedaba menos que el margen de renovación (con holgura: el reloj
  // del CDN no es el nuestro, y en ese tramo la renovación ya tendría que haber llegado).
  // Si le quedaba más, el 403 es por otra cosa (una calidad rota, una regla del CDN) y una
  // firma nueva no lo arregla: dentro de la misma hora firma.php devuelve LA MISMA.
  cercaDeVencer(expires) { return this.restanteDe(expires) <= this._margenes.renovar; }
  porVencer() { return this.restanteMs() <= this._margenes.pedido; }
  renovando() { return !!this._enVuelo || !!this._insistencia; }
  ultimoFallo() { return this._fallo ? this._fallo.motivo : null; }

  on(ev, fn) { (this._handlers[ev] ||= []).push(fn); }
  off(ev, fn) { this._handlers[ev] = (this._handlers[ev] || []).filter((x) => x !== fn); }
  _emitir(ev, x) { (this._handlers[ev] || []).slice().forEach((h) => { try { h(x); } catch (e) {} }); }

  // Pide la firma nueva. Un solo pedido a la vez: los que llegan mientras tanto
  // reciben el mismo (y, si se está insistiendo después de un 403, el resultado de esa
  // insistencia). Resuelve con la firma nueva o rechaza con el motivo ('sesion', 'red',
  // 'otro'). `forzar`: aunque el último pedido haya fallado hace un instante.
  renovar({ forzar = false } = {}) {
    if (!this.activa()) return Promise.reject('otro');
    if (this._insistencia) return this._insistencia.promesa;
    return this._renovarUnaVez(forzar);
  }

  // Después de un 403 o de un error del video con la firma vencida: el video ya NECESITA
  // la firma nueva. Como renovar({ forzar: true }), pero sin red no se rinde al primer
  // intento. Al desbloquear el celular la red tarda uno o dos segundos en volver (Wi-Fi o
  // datos) y el alumno ya tocó play o adelantó: con un solo pedido fallido aparecía el
  // cartel "Revisá tu conexión", con la red volviendo un segundo después.
  // Reintenta a 1, 2 y 4 s (enseguida si vuelve la red o la pestaña: _alVolver), hasta
  // INSISTIR_MS. Con la sesión cerrada o sin permiso no insiste: no se arregla solo.
  // Mientras tanto renovando() da true y renovar() devuelve esta misma promesa: un pedido
  // de hls.js o un segundo 403 esperan este resultado en vez de armar otra insistencia.
  renovarYa() {
    if (!this.activa()) return Promise.reject('otro');
    if (this._insistencia) return this._insistencia.promesa;
    const ins = { timer: null, despertar: null, cancelar: null, promesa: null };
    const m0 = this._mono(), p0 = this._pared();
    const transcurrido = () => Math.max(this._mono() - m0, this._pared() - p0, 0);
    ins.promesa = new Promise((ok, mal) => {
      let espera = INSISTIR_PRIMERO_MS;
      const intentar = () => {
        ins.timer = null;
        this._renovarUnaVez(true).then(ok, (motivo) => {
          if (motivo !== 'red' || this._destruido || transcurrido() + espera > INSISTIR_MS) return mal(motivo);
          ins.timer = this._timers.poner(intentar, espera);
          espera = Math.min(espera * 2, INSISTIR_MAX_ESPERA_MS);
        });
      };
      ins.despertar = () => { if (ins.timer != null) { this._timers.quitar(ins.timer); intentar(); } };
      ins.cancelar = () => { if (ins.timer != null) this._timers.quitar(ins.timer); ins.timer = null; mal('otro'); };
      intentar();
    });
    this._insistencia = ins;
    const terminar = () => { if (this._insistencia === ins) this._insistencia = null; };
    ins.promesa.then(terminar, terminar);
    return ins.promesa;
  }

  _renovarUnaVez(forzar) {
    if (!this.activa()) return Promise.reject('otro');
    if (this._enVuelo) return this._enVuelo;
    if (!forzar && this._desdeFallo() < ESPERA_TRAS_FALLO_MS) return Promise.reject(this._fallo.motivo);
    const p = this._pedir().then((r) => {
      if (this._destruido) throw 'otro';
      if (!r.ok) throw r.motivo;
      const f = leerFirma(r.playlist);
      // Una URL sin firma (sacaron la clave en el sitio), de otro video o de otro host
      // no se mezcla con lo que se está reproduciendo.
      if (!f || !mismoVideo(f, this._firma)) throw 'otro';
      const ahora = Number.isFinite(r.ahora) && r.ahora > 0 ? r.ahora : this._pared() / 1000;
      const restante = (f.expires - ahora) * 1000;
      if (!(restante > 0)) throw 'otro';
      this._aplicar(f, restante, r.poster, true);
      return f;
    }).catch((motivo) => {
      const m = motivo === 'sesion' || motivo === 'red' ? motivo : 'otro';
      if (!this._destruido) {
        this._fallo = { motivo: m, mono: this._mono(), pared: this._pared() };
        this._programarReintento(m);
      }
      throw m;
    }).finally(() => { if (this._enVuelo === p) this._enVuelo = null; });
    // El rechazo lo maneja quien llamó; éste es sólo para que no quede "sin atrapar".
    p.catch(() => {});
    this._enVuelo = p;
    return p;
  }

  // Cuánto pasó desde el último pedido fallido, con los dos relojes y gana el mayor (como
  // crearReloj): con el equipo suspendido el monotónico puede no avanzar, y medido sólo
  // con él un fallo de antes de bloquear la pantalla seguía "reciente" horas después.
  _desdeFallo() {
    const f = this._fallo;
    return f ? Math.max(this._mono() - f.mono, this._pared() - f.pared, 0) : Infinity;
  }

  destroy() {
    this._destruido = true;
    if (this._insistencia) this._insistencia.cancelar();
    this._insistencia = null;
    if (this._timer != null) this._timers.quitar(this._timer);
    this._timer = null;
    (this._oyentes || []).forEach(([obj, ev]) => { try { obj.removeEventListener(ev, this._alVolver); } catch (e) {} });
    this._oyentes = [];
    this._handlers = {};
  }

  // --- Interno ---------------------------------------------------------------------
  _aplicar(f, restanteMs, poster, avisar) {
    this._firma = f;
    if (poster) this._poster = poster;
    this._reloj = crearReloj(restanteMs, { mono: this._mono, pared: this._pared });
    this._margenes = margenes(restanteMs);
    this._fallo = null;
    this._programar();
    if (avisar) this._emitir('renovada', f);
  }

  _programar() {
    if (this._timer != null) this._timers.quitar(this._timer);
    this._timer = null;
    if (!this.activa()) return;
    const espera = Math.max(0, this.restanteMs() - this._margenes.renovar);
    this._timer = this._timers.poner(() => { this._timer = null; this._revisar(); }, espera);
  }

  // Sin señal se reintenta (cada vez más espaciado, hasta 1 por minuto) aunque ya haya
  // vencido: en pausa no hay ningún pedido de video que lo haga, y cuando vuelva la
  // red el alumno encuentra la firma lista. Con la sesión cerrada o sin permiso no: va
  // a seguir fallando, y lo dice el cartel cuando el video lo necesite.
  _programarReintento(motivo) {
    if (motivo !== 'red' || !this.activa()) return;
    if (this._timer != null) this._timers.quitar(this._timer);
    const espera = Math.min(REINTENTO_MAX_MS, Math.max(ESPERA_TRAS_FALLO_MS, Math.abs(this.restanteMs()) / 4));
    this._timer = this._timers.poner(() => { this._timer = null; this._revisar(); }, espera);
  }

  // alVolver: lo llama un evento de vuelta (pestaña visible, red, foco). Ahí se pide
  // aunque el último pedido haya fallado hace un instante: es un evento suelto, no la
  // tormenta de pedidos de segmentos que evita ESPERA_TRAS_FALLO_MS, y es justo cuando la
  // red vuelve. Si se está insistiendo después de un 403, se reintenta ya.
  _revisar(alVolver = false) {
    if (!this.activa()) return;
    // 🔴 La renovación por reloj sólo con el video EN USO (enUso: lo decide el
    // componente, hoy "reproduciendo o hace menos de 20 min"). Cada pedido a firma.php
    // pasa por require_login y le alarga la sesión al campus: con una lección olvidada
    // abierta, la sesión no vencía nunca. Fuera de uso no se pide nada; al volver (play:
    // alUsar; pestaña visible o foco: _alVolver) se renueva si hace falta, y si la sesión
    // ya venció el cartel lo dice.
    if (!alVolver && !this._enUso()) { this._timer = null; return; }
    if (this._insistencia) { if (alVolver) this._insistencia.despertar(); return; }
    if (this.restanteMs() <= this._margenes.renovar) this.renovar({ forzar: alVolver }).catch(() => {});
    else this._programar();
  }

  _pedir() {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const tope = this._timers.poner(() => { if (ac) ac.abort(); }, TOPE_PEDIDO_MS);
    const cuerpo = new URLSearchParams();
    cuerpo.set('cmid', String(this._cmid ?? ''));
    cuerpo.set('sesskey', String(this._sesskey ?? ''));
    let pedido;
    try {
      pedido = this._fetch(this._url, {
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
        // Sin JSON y redirigido al login: la sesión se cerró y algo nos mandó a la
        // página de ingreso en vez del error de firma.php.
        if (!json && r.redirected && /\/login\//.test(String(r.url || ''))) return { ok: false, motivo: 'sesion' };
        return interpretarRespuesta(r.status, json);
      }), () => ({ ok: false, motivo: 'red' }))
      .finally(() => this._timers.quitar(tope));
  }
}
