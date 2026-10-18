// El Cast Web SDK IMITADO sobre el puente con hub-app (ivcast v1).
//
// En la app no hay Cast Web SDK: el Chromecast lo maneja la app, con el SDK nativo. Esto
// arma `window.cast.framework` y `window.chrome.cast` con la MISMA forma que usa
// src/cast.js (la superficie que ya imitaba tests/navegador/simulados/cast-simulado.js),
// pero en vez de una TV simulada del otro lado hay mensajes: cada llamada del SDK sale
// como un comando del protocolo y cada evento de la app vuelve como el evento o el
// callback que habría dado el Web SDK. O sea: el shim es el simulado con la TV
// reemplazada por mensajes. CastPlayer, observarCast y el JSX no cambian de lógica: el
// freno en las preguntas, la medición del ida y vuelta, la renovación de la firma y la
// corrección de los controles de afuera son los mismos que en Chrome.
//
// Reglas del protocolo que viven acá (castear-hub-app-v2.md §3.6):
//   a. Un `media` IDÉNTICO al anterior (mismo msid, estado, motivo, t y rate) se descarta
//      SIN llamar a los oyentes: CastPlayer._actualizar le pone la hora de llegada a cada
//      estado, y uno repetido atrasaba el estimador y el freno.
//   c. Un msid nuevo es otro objeto Media: el anterior queda IDLE/INTERRUPTED (sin avisar a
//      sus oyentes: CastPlayer decide con MEDIA_SESSION si es su video o se lo cambiaron)
//      y se emite MEDIA_SESSION. Uno más viejo que el actual se ignora.
//   d. Los oyentes reciben vivo=false sólo con IDLE y un motivo.
//   e. requestSession se cumple cuando la app MUESTRA el selector (el SDK nativo no avisa
//      si se cierra sin elegir); la conexión llega por los eventos `sesion`. Un pedido nuevo
//      con otro en curso rechaza el viejo con 'cancel'; detalle 'red_local' (la app ya
//      mostró su aviso de permiso en iPhone) también es 'cancel', que el JSX calla.
//   f. La sesión que trae el hola-ok (la app ya transmitía: otra lección, recargar) se crea
//      ANTES de que cargarCast() resuelva, así observarCast la informa como SESSION_RESUMED.
//   i. Latido cada 2 s mientras hay sesión, con el msid del Media que tiene oyentes (el
//      único que agrega oyentes es CastPlayer: el que los tiene es el que maneja esta
//      página), o null.
// El silencio es el del EQUIPO (session.setMute, el mismo que lee isMute): el volumen de
// la TV no se toca nunca (ver CastPlayer.setVolume).
import * as puenteReal from "./puenteApp.js";

const TOPE_ELEGIR_MS = 10000;
// CastPlayer ya espera 20 s el LOAD y otros 20 a ver su video en la TV (cast.js): éste
// sólo limpia el pendiente.
const TOPE_CARGAR_MS = 25000;
// CastPlayer corta antes, a los 8 s (comando() de cast.js); éste sólo limpia.
const TOPE_COMANDO_MS = 10000;
const MEDIA_NS = "urn:x-cast:com.google.cast.media";

const PlayerState = { IDLE: "IDLE", PLAYING: "PLAYING", PAUSED: "PAUSED", BUFFERING: "BUFFERING" };
const IdleReason = { CANCELLED: "CANCELLED", INTERRUPTED: "INTERRUPTED", FINISHED: "FINISHED", ERROR: "ERROR" };
const CastState = { NO_DEVICES_AVAILABLE: "NO_DEVICES_AVAILABLE", NOT_CONNECTED: "NOT_CONNECTED", CONNECTING: "CONNECTING", CONNECTED: "CONNECTED" };
const SessionState = { NO_SESSION: "NO_SESSION", SESSION_STARTING: "SESSION_STARTING", SESSION_STARTED: "SESSION_STARTED", SESSION_START_FAILED: "SESSION_START_FAILED", SESSION_ENDING: "SESSION_ENDING", SESSION_ENDED: "SESSION_ENDED", SESSION_RESUMED: "SESSION_RESUMED" };
const CastContextEventType = { CAST_STATE_CHANGED: "caststatechanged", SESSION_STATE_CHANGED: "sessionstatechanged" };
const SessionEventType = { APPLICATION_STATUS_CHANGED: "applicationstatuschanged", APPLICATION_METADATA_CHANGED: "applicationmetadatachanged", ACTIVE_INPUT_STATE_CHANGED: "activeinputstatechanged", VOLUME_CHANGED: "volumechanged", MEDIA_SESSION: "mediasession" };

// Clases que sólo llevan datos, como las del Web SDK (y las de cast-simulado.js).
class MediaInfo { constructor(contentId, contentType) { this.contentId = contentId; this.contentUrl = null; this.contentType = contentType; this.streamType = "BUFFERED"; this.duration = null; this.metadata = null; this.customData = null; } }
class GenericMediaMetadata { constructor() { this.metadataType = 0; this.title = null; this.images = null; } }
class Image { constructor(url) { this.url = url; } }
class LoadRequest { constructor(media) { this.type = "LOAD"; this.media = media; this.autoplay = true; this.currentTime = null; this.playbackRate = 1; this.customData = null; } }
class SeekRequest { constructor() { this.currentTime = null; this.resumeState = null; } }
class PlayRequest {}
class PauseRequest {}
class GetStatusRequest {}

const valor = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const num = (x, def = null) => (typeof x === "number" && Number.isFinite(x) ? x : def);
const texto = (x) => (typeof x === "string" ? x : null);
// El código que se le pasa al SDK: el de la app, o 'timeout' si venció el tope.
const codigoDe = (e) => (e && typeof e.codigo === "string" ? e.codigo : typeof e === "string" ? e : "error");

// Un `media` (del evento o de la sesión del hola-ok) con los tipos en regla, o null.
export function leerMedia(d) {
  if (!d || typeof d !== "object") return null;
  const msid = num(valor(d, "msid"));
  const estado = texto(valor(d, "estado"));
  if (msid == null || !PlayerState[estado]) return null;
  const motivo = texto(valor(d, "motivo"));
  return {
    msid,
    estado,
    motivo: estado === "IDLE" && IdleReason[motivo] ? motivo : null,
    t: Math.max(0, num(valor(d, "t"), 0)),
    rate: num(valor(d, "rate"), 1) || 1,
    duracion: num(valor(d, "duracion")),
    contentId: texto(valor(d, "contentId")),
    contentUrl: texto(valor(d, "contentUrl")),
  };
}
const claveMedia = (m) => `${m.msid}|${m.estado}|${m.motivo}|${m.t}|${m.rate}`;

// Arma el SDK imitado sobre `puente` (enviar, escuchar, latir, dejarDeLatir: los de
// puenteApp.js, o uno en memoria en las pruebas) a partir del hola-ok normalizado.
// Devuelve { cast, chrome } para colgar de window, más `_diag` para las pruebas.
export function crearCastNativo(hola, puente = puenteReal, { anotar = () => {} } = {}) {
  const cast0 = (hola && hola.cast) || {};
  // Lo que la app dice que sabe hacer. Sin 'velocidad' o sin 'silencio' esos comandos no
  // se mandan: se rechazan acá y CastPlayer sigue (la velocidad la confirma el estado de
  // la TV; el silencio queda como está).
  const caps = new Set(Array.isArray(hola && hola.capacidades) ? hola.capacidades : []);
  const diag = { repetidos: 0, eventos: 0, receptorPedido: null };
  let estadoCast = CastState[cast0.estado] ? cast0.estado : CastState.NO_DEVICES_AVAILABLE;
  let sesion = null;          // la Sesion actual (el mismo objeto para el mismo id)
  let elegirEnCurso = null;   // el requestSession pendiente

  const emitir = (oyentes, tipo, ev) => { (oyentes[tipo] || []).slice().forEach((fn) => { try { fn(ev); } catch (e) {} }); };

  class Media {
    constructor(s, m) {
      this._sesion = s;
      this._oy = [];
      this.mediaSessionId = m.msid;
      this.media = { contentId: m.contentId || m.contentUrl, contentUrl: m.contentUrl || m.contentId, duration: m.duracion };
      this._clave = null;
      this._poner(m);
    }
    _poner(m) {
      this.playerState = m.estado;
      this.idleReason = m.estado === "IDLE" ? m.motivo : null;
      this.currentTime = m.t;   // el último informado, SIN extrapolar (lo extrapola CastPlayer)
      this.playbackRate = m.rate;
      if (m.duracion > 0) this.media.duration = m.duracion;
      if (m.contentId || m.contentUrl) { this.media.contentId = m.contentId || m.contentUrl; this.media.contentUrl = m.contentUrl || m.contentId; }
      this._clave = claveMedia(m);
    }
    // Un estado nuevo de ESTE msid. Idéntico al anterior: nada (ni oyentes ni hora).
    _aplicar(m) {
      if (claveMedia(m) === this._clave) {
        diag.repetidos++;
        if (m.duracion > 0) this.media.duration = m.duracion;
        return;
      }
      this._poner(m);
      const vivo = !(m.estado === "IDLE" && m.motivo);
      this._oy.slice().forEach((fn) => { try { fn(vivo); } catch (e) {} });
    }
    // Otro msid ocupó la TV: éste queda interrumpido, sin avisar (ver arriba, regla c).
    _interrumpir() { this.playerState = "IDLE"; this.idleReason = "INTERRUPTED"; this._clave = null; }
    addUpdateListener(fn) { if (typeof fn === "function") this._oy.push(fn); }
    removeUpdateListener(fn) { this._oy = this._oy.filter((x) => x !== fn); }
    getEstimatedTime() { return this.currentTime; }
    supportsCommand() { return true; }
    // Cada callback, una sola vez: con la respuesta, con el error o al vencer el tope.
    _cmd(tipo, datos, ok, mal) {
      let listo = false;
      const fin = (fn, x) => { if (listo) return; listo = true; try { if (typeof fn === "function") fn(x); } catch (e) {} };
      puente.enviar(tipo, { msid: this.mediaSessionId, ...datos }, { tope: TOPE_COMANDO_MS })
        .then(() => fin(ok), (e) => fin(mal, { code: codigoDe(e) }));
    }
    play(req, ok, mal) { this._cmd("play", {}, ok, mal); }
    pause(req, ok, mal) { this._cmd("pausa", {}, ok, mal); }
    getStatus(req, ok, mal) { this._cmd("estado", {}, ok, mal); }
    seek(req, ok, mal) {
      const t = num(req && req.currentTime);
      if (t == null) { try { if (typeof mal === "function") mal({ code: "invalid_parameter" }); } catch (e) {} return; }
      const datos = { t };
      // Sin resumeState el Web SDK deja el estado como está; el protocolo no tiene esa
      // opción y la app lo toma como reproducir. CastPlayer siempre lo manda.
      if (req.resumeState === "PLAYBACK_START" || req.resumeState === "PLAYBACK_PAUSE") datos.reanudar = req.resumeState;
      this._cmd("saltar", datos, ok, mal);
    }
  }

  class Sesion {
    constructor(d) { this._id = d.id; this._oy = {}; this._media = null; this._nombre = null; this._silencio = false; this._volumen = 1; this._datos(d); }
    _datos(d) {
      if (typeof d.nombre === "string") this._nombre = d.nombre;
      if (typeof d.silencio === "boolean") this._silencio = d.silencio;
      if (num(d.volumen) != null) this._volumen = Math.max(0, Math.min(1, d.volumen));
    }
    getSessionId() { return this._id; }
    // El nombre llega en texto plano (chrome.cast.unescape es la identidad, ver abajo).
    getCastDevice() { return { friendlyName: this._nombre || "", label: this._id, receiverType: "cast" }; }
    getMediaSession() { return this._media; }
    isMute() { return this._silencio; }
    getVolume() { return this._volumen; }
    addEventListener(tipo, fn) { (this._oy[tipo] ||= []).push(fn); }
    removeEventListener(tipo, fn) { this._oy[tipo] = (this._oy[tipo] || []).filter((x) => x !== fn); }
    // El silencio del equipo. La app contesta con `volumen` y después `ok`.
    setMute(m) {
      if (!caps.has("silencio")) return Promise.reject("not_implemented");
      return puente.enviar("silenciar", { silencio: !!m }, { tope: TOPE_COMANDO_MS }).then(() => undefined, (e) => Promise.reject(codigoDe(e)));
    }
    // El volumen no viaja por el protocolo (y el reproductor no lo toca nunca).
    setVolume() { return Promise.reject("invalid_parameter"); }
    loadMedia(req) {
      const info = req && req.media;
      if (!info) return Promise.reject("invalid_parameter");
      const md = info.metadata || {};
      const img = Array.isArray(md.images) && md.images[0] && typeof md.images[0].url === "string" ? md.images[0].url : null;
      const datos = {
        media: {
          contentId: info.contentId,
          contentUrl: info.contentUrl || info.contentId,
          contentType: info.contentType,
          streamType: info.streamType,
          hlsSegmentFormat: info.hlsSegmentFormat,
          hlsVideoSegmentFormat: info.hlsVideoSegmentFormat,
          titulo: typeof md.title === "string" ? md.title : null,
          imagen: img,
          customData: info.customData || null,
        },
        t: num(req.currentTime, 0),
        autoplay: req.autoplay !== false,
        rate: num(req.playbackRate, 1) || 1,
      };
      return puente.enviar("cargar", datos, { tope: TOPE_CARGAR_MS }).then(() => undefined, (e) => Promise.reject(codigoDe(e)));
    }
    // Del protocolo de media sólo la velocidad (es lo único que cast.js manda a mano).
    sendMessage(ns, msg) {
      if (ns !== MEDIA_NS || !msg || msg.type !== "SET_PLAYBACK_RATE" || num(msg.playbackRate) == null) return Promise.reject("invalid_parameter");
      if (!caps.has("velocidad")) return Promise.reject("not_implemented");
      const msid = num(msg.mediaSessionId, this._media ? this._media.mediaSessionId : null);
      return puente.enviar("velocidad", { msid, rate: msg.playbackRate }, { tope: TOPE_COMANDO_MS }).then(() => undefined, (e) => Promise.reject(codigoDe(e)));
    }
    endSession(stop) { ctx.endCurrentSession(stop); }
  }

  // El msid que maneja el CastPlayer de esta página: el del Media con oyentes.
  const msidActivo = () => {
    const m = sesion && sesion._media;
    return m && m._oy.length ? m.mediaSessionId : null;
  };
  const latirSiHaySesion = () => {
    if (sesion) puente.latir(msidActivo);
    else puente.dejarDeLatir();
  };

  const obtenerSesion = (d) => {
    const id = texto(d && d.id);
    if (!id) return null;
    if (!sesion || sesion._id !== id) sesion = new Sesion(d);
    else sesion._datos(d);
    return sesion;
  };

  // Un media para la sesión `s`: actualiza el actual, o crea otro con un msid nuevo.
  const aplicarMedia = (s, d) => {
    const m = leerMedia(d);
    if (!s || !m) return;
    const actual = s._media;
    if (actual && m.msid === actual.mediaSessionId) { actual._aplicar(m); return; }
    if (actual && m.msid < actual.mediaSessionId) return;   // viejo: ya hay uno más nuevo
    if (actual) actual._interrumpir();
    const nueva = new Media(s, m);
    s._media = nueva;
    emitir(s._oy, SessionEventType.MEDIA_SESSION, { type: SessionEventType.MEDIA_SESSION, mediaSession: nueva });
  };

  const ctxOy = {};
  const ctx = {
    setOptions(o) {
      const pedido = o && o.receiverApplicationId;
      // El receptor lo fija la app al compilar: si la actividad pidiera otro (castAppId),
      // se anota para el diagnóstico; la app sigue con el suyo.
      if (pedido && cast0.receptor && String(pedido).toUpperCase() !== String(cast0.receptor).toUpperCase()) {
        diag.receptorPedido = pedido;
        anotar("puenteReceptor", `pedido ${pedido}, la app usa ${cast0.receptor}`);
      }
    },
    getCastState() { return estadoCast; },
    getCurrentSession() { return sesion; },
    getSessionState() { return sesion ? SessionState.SESSION_STARTED : SessionState.NO_SESSION; },
    addEventListener(tipo, fn) { (ctxOy[tipo] ||= []).push(fn); },
    removeEventListener(tipo, fn) { ctxOy[tipo] = (ctxOy[tipo] || []).filter((x) => x !== fn); },
    requestSession() {
      if (elegirEnCurso) elegirEnCurso.cancelar();
      return new Promise((ok, mal) => {
        let vivo = true;
        const este = { cancelar: () => { if (!vivo) return; vivo = false; mal("cancel"); } };
        elegirEnCurso = este;
        const soltar = () => { vivo = false; if (elegirEnCurso === este) elegirEnCurso = null; };
        puente.enviar("elegir", {}, { tope: TOPE_ELEGIR_MS }).then(
          () => { if (!vivo) return; soltar(); ok(null); },
          (e) => {
            if (!vivo) return;
            soltar();
            mal(e && e.codigo === "session_error" && e.detalle === "red_local" ? "cancel" : codigoDe(e));
          });
      });
    },
    // 🔴 Siempre deteniendo la TV (detenerTV:true): con false la TV se desconecta y sigue
    // reproduciendo sin nadie que frene en las preguntas. No se espera la respuesta: el
    // corte llega por los eventos `sesion` (ENDING y ENDED).
    endCurrentSession() {
      puente.enviar("terminar", { detenerTV: true }, { tope: TOPE_COMANDO_MS }).catch(() => {});
    },
  };

  // Eventos de la app (los comandos y sus respuestas los resuelve puenteApp.js).
  const alEvento = (m) => {
    diag.eventos++;
    if (m.tipo === "disponibilidad") {
      if (!CastState[m.estado] || m.estado === estadoCast) return;
      estadoCast = m.estado;
      anotar("estado", estadoCast);
      emitir(ctxOy, CastContextEventType.CAST_STATE_CHANGED, { type: CastContextEventType.CAST_STATE_CHANGED, castState: estadoCast });
      return;
    }
    if (m.tipo === "sesion") {
      const est = m.estado;
      if (!SessionState[est]) return;
      let s = null;
      if (est === SessionState.SESSION_STARTED || est === SessionState.SESSION_RESUMED) {
        s = obtenerSesion(m.sesion);
        if (!s) return;
        if (m.sesion.media) aplicarMedia(s, m.sesion.media);
      } else if (est === SessionState.SESSION_ENDING) {
        s = sesion;
      } else if (est === SessionState.SESSION_ENDED) {
        s = sesion;
        sesion = null;
      }
      latirSiHaySesion();
      const error = est === SessionState.SESSION_START_FAILED ? (texto(m.error) || "session_error") : texto(m.error);
      emitir(ctxOy, CastContextEventType.SESSION_STATE_CHANGED, { type: CastContextEventType.SESSION_STATE_CHANGED, sessionState: est, session: s, errorCode: error });
      return;
    }
    if (m.tipo === "media") { aplicarMedia(sesion, m); return; }
    if (m.tipo === "volumen") { if (sesion) sesion._datos(m); return; }
    // Un evento que no se conoce (de una versión más nueva de la app): se ignora.
  };
  puente.escuchar(alEvento);

  // La app ya transmitía (regla f): sesión y Media antes de que cargarCast resuelva.
  if (cast0.sesion) {
    const s = obtenerSesion(cast0.sesion);
    if (s && cast0.sesion.media) aplicarMedia(s, cast0.sesion.media);
    latirSiHaySesion();
  }

  const chromeCast = {
    VERSION: [1, 2],
    AutoJoinPolicy: { TAB_AND_ORIGIN_SCOPED: "tab_and_origin_scoped", ORIGIN_SCOPED: "origin_scoped", PAGE_SCOPED: "page_scoped" },
    Image,
    // El nombre de la TV llega en texto plano desde la app: no hay nada que desescapar.
    unescape: (s) => s,
    media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
      MediaInfo, GenericMediaMetadata, LoadRequest, SeekRequest, PlayRequest, PauseRequest, GetStatusRequest,
      PlayerState, IdleReason,
      ResumeState: { PLAYBACK_START: "PLAYBACK_START", PLAYBACK_PAUSE: "PLAYBACK_PAUSE" },
      StreamType: { BUFFERED: "BUFFERED", LIVE: "LIVE", OTHER: "OTHER" },
      HlsSegmentFormat: { AAC: "aac", AC3: "ac3", MP3: "mp3", TS: "ts", TS_AAC: "ts_aac", E_AC3: "e_ac3", FMP4: "fmp4" },
      HlsVideoSegmentFormat: { MPEG2_TS: "mpeg2_ts", FMP4: "fmp4" },
    },
  };
  const framework = {
    VERSION: "hub-app-ivcast-1",
    CastContext: { getInstance: () => ctx },
    CastContextEventType, CastState, SessionState, SessionEventType,
  };
  return { cast: { framework }, chrome: { cast: chromeCast }, _diag: diag, _msidActivo: msidActivo };
}

// Lo cuelga de window (o de `w`, en las pruebas). Devuelve lo que armó.
export function instalarCastNativo(hola, puente = puenteReal, w = window) {
  const anotar = (k, v) => { try { (w.__ivCastDiag = w.__ivCastDiag || {})[k] = v; } catch (e) {} };
  const sdk = crearCastNativo(hola, puente, { anotar });
  w.cast = sdk.cast;
  try { if (!w.chrome || typeof w.chrome !== "object") w.chrome = {}; } catch (e) {}
  w.chrome.cast = sdk.chrome.cast;
  anotar("puenteRepetidos", 0);
  // Para el diagnóstico (?diag=1) y las pruebas: cuántos estados repetidos se descartaron.
  try { Object.defineProperty(w.__ivCastDiag, "puenteRepetidos", { configurable: true, enumerable: true, get: () => sdk._diag.repetidos }); } catch (e) {}
  return sdk;
}
