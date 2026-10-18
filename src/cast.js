// Transmisión a la TV con Chromecast (Google Cast Web Sender, receptor por defecto).
//
// Qué hay acá:
//   - cuandoHayaTV(): avisa cuando el navegador ve una TV con Cast en la red, sin
//     bajar nada de Google (Presentation API). Recién ahí se llama a cargarCast().
//   - cargarCast(): baja el SDK de Google SÓLO donde existe (Chrome/Edge de
//     escritorio y Android). En iPhone, Firefox y Safari no gasta ni un pedido.
//   - contextoCast() / observarCast(): opciones y eventos del CastContext.
//   - CastPlayer: un ADAPTADOR con la misma forma que nativePlayer.js (y que el SDK
//     de Vimeo): ready/on/off/play/pause/get-setCurrentTime/getPaused/getDuration/
//     volumen/silencio/velocidad, calidades vacías. Mientras se transmite, el
//     componente le habla a ÉSTE en vez de al <video>, y como emite 'timeupdate',
//     'play', 'pause', 'seeked' y 'ended' con lo que pasa en la TV, el candado de
//     preguntas (debeFrenar, la guardia de saltos externos, el freno de 'play' con
//     una pregunta abierta, tiempoAGuardar) funciona sin cambios.
//
// 🔴 Con el receptor por defecto (CC1AD845, sin registro) la TV NO puede mostrar las
// preguntas ni negarse a un salto: cualquiera en la red (el control remoto por
// HDMI-CEC, Google Home, la notificación de Chrome) puede adelantar o dar play. Acá
// sólo se DETECTA y se CORRIGE después, con unos cientos de ms de video que se
// escapan. Hacerlo cumplir en la TV pide un receptor propio (castAppId, ver README).
//
// 🔴 El freno depende de que la página del celular siga viva. Oculta, Chrome corre
// los timers a 1 por segundo y, después de 5 min, los encadenados a 1 por MINUTO:
// por eso el freno se programa con un setTimeout de un disparo hacia la próxima
// pregunta desde los avisos de la TV (no desde el latido), y el componente pide
// Screen Wake Lock mientras se transmite.

import { leerFirma } from "./firma.js";

const SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
const MEDIA_NS = "urn:x-cast:com.google.cast.media";
const RECEPTOR_POR_DEFECTO = "CC1AD845";   // Default Media Receiver de Google
const TOPE_SDK_MS = 15000;
// 🔴 chrome.cast.media.timeout.* vale 0 y el SDK lo convierte en 10 MINUTOS: un
// comando sin respuesta tardaría eso en fallar. Cada comando lleva su propio tope.
const TOPE_COMANDO_MS = 8000;
const TOPE_CARGA_MS = 20000;
const LATIDO_MS = 200;          // timeupdate mientras la TV reproduce (el componente frena con ≤1 tick)
const ESTADO_CADA_MS = 5000;    // la TV avisa sólo cuando cambia de estado: corregir la deriva
const SALTO_EXTERNO = 1.5;      // diferencia con lo esperado que ya es un salto de otro
const TOL_SALTO = 1.5;          // un salto propio se da por aterrizado a esta distancia
const TOL_CARGA = 2;
const ESTADO_CARGA_MS = 1000;
const ESPERA_MEDIA_MS = 20000;   // si el LOAD no confirma, cuánto se espera a ver nuestro video en la TV    // mientras la TV carga, cada cuánto se le pregunta dónde está
const TOL_ANCLA = 0.3;          // la TV frenó más lejos que esto de donde se pidió: se la lleva
const RTT_INICIAL = 0.25;       // ida y vuelta celular↔TV hasta medirla
// La TV frena un ida y vuelta después del pedido (el estado que se extrapola ya llegó
// con una vía de atraso, y la pausa tarda otra). Se apunta a frenar este margen
// DESPUÉS de la pregunta, nunca antes: frenar antes corta el final de la frase, que
// es justo lo que debeFrenar evita en el celular ("frena al llegar, nunca antes").
const MARGEN_FRENO = 0.1;
// Un salto propio que la TV ya contestó y igual quedó lejos (el control remoto la
// movió después) se reenvía apenas llega ese estado, hasta este total de envíos.
const INTENTOS_SALTO = 4;

// 🔴 Todas las diferencias de tiempo de este archivo (el estimador, el ida y vuelta,
// el play de afuera, la consulta de estado) con el reloj MONOTÓNICO. Con Date.now(),
// un ajuste de la hora del celular (la red o NTP la corrigen solas) movía el segundo
// estimado de la TV: con +2 s el freno salía 2 s antes y la pausa anclada la llevaba
// HACIA ADELANTE hasta la pregunta, salteando el final de la frase.
const ahora = () => performance.now();

const esHls =(src) => /\.m3u8(\?|#|$)/i.test(src) || /\/playlist\.m3u8/i.test(src);
const RE_GUID = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

// Diagnóstico para el recuadro ?diag=1 de las páginas de prueba: en un celular no hay
// consola a mano, y "no aparece el botón" puede ser la TV, la red, el navegador o esto.
function anotar(k, v) {
  try { (window.__ivCastDiag = window.__ivCastDiag || {})[k] = v; } catch (e) {}
}

function sdk() { return window.cast && window.cast.framework && window.chrome && window.chrome.cast && window.chrome.cast.media ? window.chrome.cast : null; }

// ¿Este navegador puede transmitir a Chromecast? Lo mismo que mira el cargador de
// Google (window.chrome + Presentation API), más iOS afuera: ahí no hay emisor web
// ("Casting is not supported on the iOS Chrome browser"), y contexto seguro.
export function castPosible() {
  try {
    if (!window.isSecureContext) { anotar("posible", "no (sin https)"); return false; }
    if (!window.chrome || !navigator.presentation) { anotar("posible", "no (navegador sin Cast)"); return false; }
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod|CriOS|FxiOS|EdgiOS/.test(ua)) { anotar("posible", "no (iOS)"); return false; }
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) { anotar("posible", "no (iPadOS)"); return false; }
    anotar("posible", "sí");
    return true;
  } catch (e) { return false; }
}

// El receptor: el propio si la actividad trae castAppId (8 hexadecimales), si no el
// de Google.
function idReceptor(appId) {
  return /^[0-9a-f]{8}$/i.test(String(appId || "")) ? String(appId).toUpperCase() : RECEPTOR_POR_DEFECTO;
}

// Llama a fn() UNA vez, cuando el navegador ve una TV con Cast en la red. Devuelve la
// función que deja de vigilar.
// 🔴 El SDK de Google (cast_sender + framework, ~90 KB y tres pedidos a gstatic) se
// bajaba en CADA vista en Chrome, hubiera o no una TV y aunque nadie diera play. La
// disponibilidad se pregunta con la Presentation API, que es lo mismo que hace el SDK
// por dentro y no le pide nada a Google: el SDK se baja recién con una TV a la vista
// (si aparece después, con el evento 'change'). Sin TV no hay botón, igual que antes.
// Si el navegador no puede vigilar (getAvailability rechaza: NotSupportedError en
// algunos Android) se baja como antes, para no perder el botón. Si el SDK ya está en
// la página (otra parte lo cargó, o el arnés que lo simula), fn() va directo.
export function cuandoHayaTV(appId, fn) {
  let vivo = true, disp = null;
  const listo = () => { if (!vivo) return; vivo = false; if (disp) disp.onchange = null; fn(); };
  const soltar = () => { vivo = false; if (disp) disp.onchange = null; };
  if (sdk()) { queueMicrotask(listo); return soltar; }
  if (!castPosible()) return soltar;
  // 🔴 En Android NO se pregunta: getAvailability() con "cast:<id>" pelado puede
  // contestar false para siempre aunque la TV esté (el SDK pregunta con otra URL, con
  // clientId y supportedAppTypes), y entonces el SDK no se bajaba y el botón no
  // aparecía nunca. Pasó en la primera prueba con una TV real (oct-2026). Ahí se baja
  // directo; el ahorro de la consulta queda para la compu.
  if (/Android/i.test(navigator.userAgent || "")) { anotar("aviso", "Android: sin consultar"); queueMicrotask(listo); return soltar; }
  try {
    if (typeof window.PresentationRequest !== "function") { queueMicrotask(listo); return soltar; }
    new window.PresentationRequest(`cast:${idReceptor(appId)}`).getAvailability().then((a) => {
      if (!vivo) return;
      // Se guarda la referencia: si se la suelta, el navegador puede dejar de avisar.
      disp = a;
      anotar("aviso", a.value ? "hay TV" : "sin TV (esperando)");
      if (a.value) return listo();
      a.onchange = () => { anotar("aviso", a.value ? "hay TV" : "sin TV (esperando)"); if (a.value) listo(); };
    }, (err) => { anotar("aviso", "error " + ((err && err.name) || "")); listo(); });
  } catch (e) { queueMicrotask(listo); }
  return soltar;
}

// Carga perezosa del SDK. Devuelve una Promise<boolean> que nunca rechaza: si el
// SDK no carga (bloqueado, sin red, navegador sin Cast) el reproductor sigue igual,
// sin botón.
// 🔴 El cargador de gstatic decide qué bajar mirando document.currentScript.src
// ("loadCastFramework=1"): tiene que ser un <script> CLÁSICO con esa URL. Inlineado
// por vite-plugin-singlefile, como módulo o copiado al repo, no carga el framework.
// 🔴 __onGCastApiAvailable se define ANTES de insertar el script: el cargador lo
// lee de window al ejecutarse.
// Si el SDK ya está en la página (otra parte lo cargó, o el arnés que lo simula) se
// usa ése.
let cargaSdk = null;
export function cargarCast() {
  if (cargaSdk) return cargaSdk;
  cargaSdk = new Promise((resolve) => {
    if (sdk()) return resolve(true);
    if (!castPosible()) return resolve(false);
    let hecho = false;
    anotar("sdk", "cargando");
    const fin = (ok, motivo) => {
      if (hecho) return; hecho = true; clearTimeout(tope);
      anotar("sdk", ok && sdk() ? "cargado" : "no cargó" + (motivo ? " (" + motivo + ")" : ""));
      resolve(!!ok && !!sdk());
    };
    const tope = setTimeout(() => fin(false), TOPE_SDK_MS);
    const previo = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (ok, motivo) => {
      try { if (typeof previo === "function") previo(ok, motivo); } catch (e) {}
      fin(ok, motivo);
    };
    try {
      const s = document.createElement("script");
      s.src = SDK_URL;
      s.async = true;
      s.onerror = () => fin(false);
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { fin(false); }
  });
  return cargaSdk;
}

// Opciones del contexto, una sola vez por página (setOptions tiene que ir antes que
// requestSession). Receptor por defecto salvo que la actividad traiga castAppId
// (8 hexadecimales): el receptor propio futuro, el único que podría mostrar las
// preguntas en la TV.
// ORIGIN_SCOPED: se reengancha sola con una sesión del mismo origen (recargar la
// lección, pasar a la siguiente) aunque sea otra pestaña.
let contexto = null;
export function contextoCast(appId) {
  if (contexto) return contexto;
  const cc = sdk();
  if (!cc) return null;
  const ctx = window.cast.framework.CastContext.getInstance();
  const id = idReceptor(appId);
  ctx.setOptions({
    receiverApplicationId: id,
    autoJoinPolicy: cc.AutoJoinPolicy.ORIGIN_SCOPED,
    resumeSavedSession: true,
    language: "es-AR",
    androidReceiverCompatible: false,
  });
  contexto = ctx;
  return ctx;
}

// Avisa si hay TVs en la red y los cambios de sesión. Devuelve la función que
// desuscribe. Una sesión que ya existía al suscribirse (reanudada al cargar la
// página) se informa como SESSION_RESUMED.
export function observarCast(ctx, { onDisponible, onSesion }) {
  const fw = window.cast.framework;
  const hayTV = (estado) => !!estado && estado !== fw.CastState.NO_DEVICES_AVAILABLE;
  const alEstado = (e) => { anotar("estado", e && e.castState); onDisponible(hayTV(e && e.castState)); };
  const alSesion = (e) => onSesion(e && e.sessionState, (e && e.session) || ctx.getCurrentSession(), e && e.errorCode);
  ctx.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, alEstado);
  ctx.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, alSesion);
  try { anotar("estado", ctx.getCastState()); onDisponible(hayTV(ctx.getCastState())); } catch (e) {}
  try { const s = ctx.getCurrentSession(); if (s) onSesion(fw.SessionState.SESSION_RESUMED, s, null); } catch (e) {}
  return () => {
    try { ctx.removeEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, alEstado); } catch (e) {}
    try { ctx.removeEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, alSesion); } catch (e) {}
  };
}

// Nombre de la TV para "Reproduciendo en …".
// 🔴 El SDK guarda friendlyName ESCAPADO como HTML (& → &amp;): sin unescape, la TV
// "Living & Comedor" se leería "Living &amp; Comedor". (Va a textContent igual.)
export function nombreDelEquipo(session) {
  try {
    const n = session && session.getCastDevice && session.getCastDevice() && session.getCastDevice().friendlyName;
    if (!n) return null;
    const un = window.chrome && window.chrome.cast && window.chrome.cast.unescape;
    const limpio = String(typeof un === "function" ? un(n) : n).trim();
    return limpio || null;
  } catch (e) { return null; }
}

// ¿Esta media de la TV es nuestro video? Por el tramo /<guid>/ de Bunny, que no
// cambia al renovar el token (va antes el /bcdn_token=…/, y token_path lleva %2F).
// Sin GUID, la URL sin el token ni la query.
export function mismoVideo(a, b) {
  if (!a || !b) return false;
  const ga = RE_GUID.exec(a), gb = RE_GUID.exec(b);
  if (ga && gb) return ga[1].toLowerCase() === gb[1].toLowerCase();
  const limpio = (u) => String(u).replace(/\/bcdn_token=[^/]*\//, "/").replace(/[?#].*$/, "");
  return limpio(a) === limpio(b);
}

// Envuelve un comando de chrome.cast.media.Media (callbacks) con su propio tope.
function comando(fn, tope = TOPE_COMANDO_MS) {
  return new Promise((resolve, reject) => {
    let listo = false;
    const t = setTimeout(() => { if (!listo) { listo = true; reject("timeout"); } }, tope);
    const ok = () => { if (!listo) { listo = true; clearTimeout(t); resolve(); } };
    const mal = (e) => { if (!listo) { listo = true; clearTimeout(t); reject((e && e.code) || e || "error"); } };
    try { fn(ok, mal); } catch (e) { mal(e); }
  });
}

export class CastPlayer {
  // opts: src (la URL firmada, la MISMA del <video>), titulo, poster, inicio
  // (segundo del celular), reproducir (si seguía), velocidad, duracion (la del
  // <video>, hasta que la TV informe la suya), adoptar (sesión reanudada que ya
  // tiene ESTE video cargado: no se vuelve a cargar), firma (el Renovador de
  // firma.js, o null), onListo() y onFin(motivo, { t, seguia }) cuando la TV deja de
  // ser la que reproduce.
  constructor(session, opts = {}) {
    this.esTV = true;
    this.session = session;
    this.handlers = {};
    this.src = opts.src;
    this.titulo = opts.titulo || "";
    this.poster = opts.poster || null;
    // Firma de Bunny que se renueva con la lección abierta (ver firma.js). La TV pide
    // el video SOLA, con la URL que se le pasó en el LOAD: cuando esa firma vence, el
    // próximo segmento le da 403 y la TV corta (vuelve al celular con "no pudo
    // reproducir"). Por eso, con una firma nueva, la TV vuelve a CARGAR el video con
    // la URL nueva en el mismo segundo (_quizasRecargar): en pausa enseguida, y
    // reproduciendo recién cuando falta poco (un LOAD es una ruedita en la TV).
    this._firma = opts.firma && typeof opts.firma.activa === "function" && opts.firma.activa() ? opts.firma : null;
    this._expiresCargado = null;    // firma de la URL que tiene la TV (null: no se sabe o no tiene)
    if (this._firma) {
      this._alRenovar = () => this._quizasRecargar();
      this._firma.on("renovada", this._alRenovar);
    }
    this._onListo = opts.onListo || (() => {});
    this._onFin = opts.onFin || (() => {});
    this._duracion = opts.duracion > 0 ? opts.duracion : 0;
    this._velocidad = opts.velocidad || 1;
    // Estado LÓGICO: lo último que pidió el componente, o lo que hizo la TV sola
    // (control remoto). Es lo que devuelve getPaused y lo que decide el
    // resumeState de los saltos.
    this._pausado = !opts.reproducir;
    // Segundo que se informa mientras la TV todavía no está donde se le pidió (carga,
    // salto propio, pausa anclada). Mientras no es null, el componente ve ese
    // número fijo y no el 0 de la TV cargando ni el ida y vuelta de un salto.
    this._fijo = Math.max(0, Number(opts.inicio) || 0);
    this._ultimo = this._fijo;      // último segundo informado al componente
    this._carga = null;             // { t, h, reproducir }: LOAD en curso
    this._salto = null;             // { t, enviado, intentos, timer }: salto propio
    this._ancla = null;             // pausa pedida: la TV tiene que quedar en este segundo
    this._anclaCorregida = false;
    this._reanudar = false;         // play() antes de que la TV confirmara la pausa anclada
    this._freno = null;             // próxima pregunta pendiente (ver frenarEn)
    this._tFreno = null;
    this._pend = 0;                 // comandos propios sin respuesta
    this._rtt = RTT_INICIAL;
    this._medidasRtt = [];
    this._previo = null;            // último estado de la TV: { t, h, estado, rate }
    this._muerta = false;           // la media de la TV terminó: play/salto vuelven a cargar
    this._reinicio = null;          // segundo pedido con la media muerta
    // Si la TV ya está en silencio al conectar, el ícono lo muestra (ver conectarCast)
    // y "Activar sonido" es un pedido explícito del alumno: cuenta como propio. Las
    // llamadas automáticas (setVolume con cada play) no lo levantan porque el
    // componente sólo las hace con el ícono en "con sonido".
    this._silencioPropio = false;
    try { this._silencioPropio = !!session.isMute(); } catch (e) {}
    this._buffer = false;
    this._playExterno = null;       // { t, h }: un play que no pidió nadie de acá
    this._reintentosPausa = 0;
    this._ultimoPedidoEstado = ahora();
    this._reqId = 7e6 + Math.floor(Math.random() * 1e6);
    this._media = null;
    this._finalizado = false;
    this._destruido = false;
    this._alActualizar = (vivo) => this._actualizar(vivo);
    this._alMediaSession = (ev) => this._nuevaMedia(ev && ev.mediaSession);
    try { session.addEventListener(window.cast.framework.SessionEventType.MEDIA_SESSION, this._alMediaSession); } catch (e) {}
    this._latidoId = setInterval(() => this._latido(), LATIDO_MS);
    if (opts.adoptar) {
      // Sesión reanudada con este video: se toma lo que está pasando en la TV. El
      // componente recibe su segundo como cualquier tick: si dejó atrás una
      // pregunta pendiente, la guardia de saltos la vuelve a ella.
      this._fijo = null;
      const m = session.getMediaSession && session.getMediaSession();
      if (m) { this._enganchar(m); this._anotarFirmaDe(m); }
      queueMicrotask(() => { if (!this._destruido) { this._onListo(); this._actualizar(true, true); this._quizasRecargar(); } });
    } else {
      this._cargar(this._fijo, !this._pausado);
    }
  }

  // --- Eventos (como nativePlayer) -------------------------------------------
  on(evento, h) { (this.handlers[evento] ||= []).push(h); }
  off(evento, h) { this.handlers[evento] = (this.handlers[evento] || []).filter((x) => x !== h); }
  _emit(evento, datos) { (this.handlers[evento] || []).forEach((h) => { try { h(datos); } catch (e) {} }); }
  _datos(t = this._ultimo) {
    const d = this._duracion;
    return { seconds: t, duration: d, percent: d > 0 ? t / d : 0 };
  }
  _informar(t) {
    if (!Number.isFinite(t)) return;
    this._ultimo = t;
    this._emit("timeupdate", this._datos(t));
  }

  // --- API estilo @vimeo/player ----------------------------------------------
  ready() { return Promise.resolve(); }
  getPaused() { return Promise.resolve(this._pausado); }
  getDuration() { return Promise.resolve(this._duracion); }
  getCurrentTime() { return Promise.resolve(this.tiempo()); }
  // Sincrónicos, para el componente al cortar la transmisión.
  tiempo() { return this._estimar(); }
  pausado() { return this._pausado; }

  play() {
    if (this._destruido) return Promise.reject(new Error("transmisión terminada"));
    this._playExterno = null;
    // La media de la TV ya no existe (terminó el video): con seek(0) no alcanza, hay
    // que volver a cargarla. Desde el principio si el pedido quedó en el fin.
    if (this._muerta) {
      let t = this._reinicio != null ? this._reinicio : this._ultimo;
      if (this._duracion > 0 && t >= this._duracion - 0.5) t = 0;
      this._reinicio = null;
      this._pausado = false;
      this._emit("play", this._datos());
      this._cargar(t, true);
      return Promise.resolve();
    }
    if (!this._pausado && this._ancla == null) return Promise.resolve();
    const ancla = this._ancla;
    this._pausado = false;
    // 🔴 Una pausa anclada que la TV todavía no confirmó (latencia alta, o el alumno
    // respondió rápido): la TV pudo frenar MÁS ALLÁ de la pregunta y la corrección
    // de la pausa anclada todavía no salió. Un play acá la dejaba seguir desde donde
    // se pasó. Se espera el estado de esa pausa y el paso 3 de _actualizar decide:
    // si se pasó, a SU segundo y a reproducir en un solo pedido (PLAYBACK_START);
    // si no, play. No se manda el salto ya: el estado de la pausa que viene en camino
    // cae cerca del destino y se tomaba como su aterrizaje (el reloj retrocedía 0,6 s).
    // Con la corrección ya en vuelo (salto al ancla), ésa sale de nuevo reproduciendo.
    if (ancla != null && this._media && !this._carga && !this._muerta) {
      if (this._salto) { this._ancla = null; this._pedirSalto(ancla); }
      else this._reanudar = true;
      this._emit("play", this._datos());
      return Promise.resolve();
    }
    this._ancla = null;
    // Con un salto esperando salir, va con PLAYBACK_START; con la carga en curso lo
    // reconcilia _actualizar al terminar.
    if (this._media && !(this._salto && !this._salto.enviado) && !this._carga) this._enviar("play");
    if (this._fijo != null && !this._salto && !this._carga) this._fijo = null;
    this._emit("play", this._datos());
    this._armarFreno();
    return Promise.resolve();
  }

  pause() {
    if (this._destruido) return Promise.resolve();
    // Un play de afuera (control remoto) que el componente rechazó enseguida (una
    // pregunta abierta): la TV vuelve a donde estaba, no a donde llegó a correr.
    // 🔴 Sólo si la TV sigue reproduciendo ese play. Si ya la frenó otro (el freno de
    // la pregunta siguiente, _prefrenar), esta pausa no es un rechazo: con un play
    // desde el control 1 s antes de una pregunta, la TV volvía a ese segundo y
    // repetía el final de la frase al responder.
    const deAfuera = !this._pausado && this._playExterno && ahora() - this._playExterno.h < 2500 ? this._playExterno.t : null;
    this._playExterno = null;
    // Ya en pausa: se avisa igual. Barato, y el botón nunca queda en "Pausar" con la
    // TV quieta (pasaba al adoptar una sesión reanudada en pausa: cada toque llamaba
    // pause() y no pasaba nada).
    if (this._pausado) { this._emit("pause", this._datos()); return Promise.resolve(); }
    this._pausado = true;
    this._reanudar = false;
    clearTimeout(this._tFreno);
    if (this._media && !this._muerta && !this._carga && !(this._salto && !this._salto.enviado)) {
      // La TV frena un ida y vuelta más tarde que el pedido: se ancla la pausa en
      // el segundo que vio el alumno y, si frenó más allá, se la lleva ahí.
      const t = deAfuera != null ? deAfuera : this._salto ? this._salto.t : this._estimar();
      this._ancla = t;
      this._anclaCorregida = false;
      this._fijo = t;
      this._reintentosPausa = 0;
      this._enviar("pause");
      if (Math.abs(t - this._ultimo) > 0.05) this._informar(t);
    }
    this._emit("pause", this._datos());
    return Promise.resolve();
  }

  setCurrentTime(t) {
    let x = Math.max(0, Number(t) || 0);
    if (this._duracion > 0) x = Math.min(x, this._duracion - 0.05);
    this._pedirSalto(x);
    return Promise.resolve(x);
  }

  // 🔴 El VOLUMEN de la TV no se toca: setVolume del reproductor se llama con cada
  // play (para levantar un silencio forzado en el iframe) y le pondría la TV al
  // 100%. Sólo silencio: setVolume(0)/setMuted(true) silencian, y el sonido vuelve
  // sólo si lo silenciamos nosotros (no si lo silenciaron con el control remoto).
  getVolume() {
    try { const v = this.session.getVolume(); return Promise.resolve(typeof v === "number" ? v : 1); } catch (e) { return Promise.resolve(1); }
  }
  setVolume(v) {
    const x = Math.max(0, Math.min(1, Number(v) || 0));
    if (x === 0) this._silenciar(true);
    else if (this._silencioPropio) this._silenciar(false);
    return Promise.resolve(x);
  }
  getMuted() { try { return Promise.resolve(!!this.session.isMute()); } catch (e) { return Promise.resolve(false); } }
  setMuted(m) {
    if (m) this._silenciar(true);
    else if (this._silencioPropio) this._silenciar(false);
    return Promise.resolve(!!m);
  }
  _silenciar(m) {
    this._silencioPropio = !!m;
    // El botón llama setMuted y setVolume juntos: un solo pedido a la TV.
    if (this._muteEnviado === !!m) return;
    this._muteEnviado = !!m;
    try { const p = this.session.setMute(!!m); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }

  // El emisor web no tiene método para la velocidad: se manda el mensaje del
  // protocolo de media a mano (como Video.js 10). Si el receptor no la soporta, lo
  // dirá su próximo estado (playbackRate) y el estimador sigue al de la TV.
  // 🔴 El estimador NO se acelera hasta que la TV confirme la velocidad nueva: con un
  // receptor que ignora el mensaje, a 2× se estimaba el doble de lo que avanzaba la
  // TV, el freno salía 3,75 s antes y la pausa anclada la llevaba hacia adelante
  // hasta la pregunta. Un estimador atrasado hace que la TV se pase (eso se corrige,
  // vuelve a su segundo); uno adelantado la frena antes (eso no). Por lo mismo, al
  // BAJAR la velocidad sí se aplica al instante.
  setPlaybackRate(r) {
    const x = Number(r) || 1;
    this._velocidad = x;
    const m = this._media;
    if (m && !this._muerta) {
      try {
        const p = this.session.sendMessage(MEDIA_NS, { type: "SET_PLAYBACK_RATE", playbackRate: x, mediaSessionId: m.mediaSessionId, requestId: ++this._reqId });
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
      if (this._previo && x < (this._previo.rate || 1)) {
        const t = this._estimar();
        this._previo = { ...this._previo, t, h: ahora(), rate: x };
        this._armarFreno();
      }
      // La confirmación (o no) de la TV, sin esperar a que avise sola.
      this._enviar("estado");
    }
    return Promise.resolve(x);
  }

  // Los subtítulos los sigue dibujando el componente en el celular; la calidad la
  // elige la TV (ABR del receptor, sin API para fijarla): no hay nada que ofrecer.
  getTextTracks() { return Promise.resolve([]); }
  enableTextTrack() { return Promise.resolve(); }
  disableTextTrack() { return Promise.resolve(); }
  getQualities() { return Promise.resolve([]); }
  getQuality() { return Promise.resolve("auto"); }
  setQuality() { return Promise.resolve("auto"); }

  // Próxima pregunta pendiente (segundos) o null. La pausa sale un ida y vuelta
  // ANTES (anticipo medido, menos MARGEN_FRENO) para que la TV frene justo después
  // de su segundo, nunca antes, y no medio segundo más tarde con el audio de la
  // frase siguiente ya sonando. Se informa exactamente ese segundo, así el
  // componente la dispara con el mismo debeFrenar de siempre.
  frenarEn(t) {
    if (t == null || !Number.isFinite(t) || t <= this._ultimo - 0.05) {
      this._freno = null;
      clearTimeout(this._tFreno);
      return;
    }
    if (t === this._freno) return;
    this._freno = t;
    this._armarFreno();
  }

  // Al irse de la página (pagehide) la TV queda en pausa en vez de seguir sola sin
  // nadie que frene en las preguntas. Al volver, la sesión se reengancha y, si es
  // este video, se retoma desde ahí.
  pausarAlSalir() {
    try { if (this._media && !this._muerta && !this._pausado) this._media.pause(new window.chrome.cast.media.PauseRequest(), () => {}, () => {}); } catch (e) {}
  }

  destroy() {
    this._destruido = true;
    if (this._firma && this._alRenovar) this._firma.off("renovada", this._alRenovar);
    clearInterval(this._latidoId);
    clearTimeout(this._tFreno);
    if (this._salto) clearTimeout(this._salto.timer);
    try { this.session.removeEventListener(window.cast.framework.SessionEventType.MEDIA_SESSION, this._alMediaSession); } catch (e) {}
    this._soltarMedia();
    this.handlers = {};
    return Promise.resolve();
  }

  // --- Interno ---------------------------------------------------------------
  _estimar() {
    if (this._fijo != null) return this._fijo;
    if (this._muerta) return this._reinicio != null ? this._reinicio : this._ultimo;
    const p = this._previo;
    if (!p) return this._ultimo;
    let t = p.t;
    if (p.estado === "PLAYING") t += ((ahora() - p.h) / 1000) * (p.rate || 1);
    if (this._duracion > 0) t = Math.min(t, this._duracion);
    return Math.max(0, t);
  }

  _anticipo() {
    const rate = (this._previo && this._previo.rate) || this._velocidad || 1;
    return Math.max(0, Math.min(0.8, this._rtt) * rate - MARGEN_FRENO);
  }

  _cargar(t, reproducir) {
    const cc = sdk();
    if (!cc || this._destruido) return;
    this._soltarMedia();
    this._muerta = false;
    this._carga = { t, h: ahora(), reproducir };
    this._fijo = t;
    this._salto = null;
    this._ancla = null;
    this._reanudar = false;
    this._playExterno = null;
    this._previo = null;
    const hls = esHls(this.src);
    // Con la firma vigente (la del celular pudo haberse renovado desde que arrancó).
    const src = this._firma ? this._firma.reescribir(this.src) : this.src;
    this._expiresCargado = this._firma ? this._firma.actual().expires : null;
    const info = new cc.media.MediaInfo(src, hls ? "application/x-mpegurl" : "video/mp4");
    info.contentUrl = src;
    info.streamType = cc.media.StreamType.BUFFERED;
    if (hls) {
      // Bunny: TS con el AAC adentro. 🔴 HlsVideoSegmentFormat tiene MPEG2_TS y
      // FMP4, no TS (Video.js usa .TS, que es undefined, y el campo queda vacío).
      info.hlsSegmentFormat = cc.media.HlsSegmentFormat.TS;
      info.hlsVideoSegmentFormat = cc.media.HlsVideoSegmentFormat.MPEG2_TS;
    }
    const md = new cc.media.GenericMediaMetadata();
    md.title = this.titulo;
    const poster = (this._firma && this._firma.poster()) || this.poster;
    if (poster) md.images = [new cc.Image(poster)];
    info.metadata = md;
    // Sin secretos: cualquier emisor de la red ve el estado de la media.
    info.customData = { ivplayer: 1 };
    const req = new cc.media.LoadRequest(info);
    req.currentTime = t;
    req.autoplay = !!reproducir;
    if (this._velocidad !== 1) req.playbackRate = this._velocidad;
    let p;
    try { p = this.session.loadMedia(req); } catch (e) { p = Promise.reject(e); }
    // 🔴 La PRIMERA vez la TV tiene que abrir su aplicación, y en una TV real (prueba de
    // Erick, oct-2026) el pedido de carga volvía con error o sin media aunque la TV
    // terminaba cargando y reproduciendo NUESTRO video: la compu se daba por vencida
    // ("la TV no pudo reproducir"), seguía en el celular y la TV corría sola, desfasada.
    // La segunda vez andaba porque la aplicación ya estaba abierta. Ahora, si no hay
    // confirmación, se espera a ver nuestro video en la TV antes de rendirse.
    const carga = this._carga;
    Promise.race([p, new Promise((_, no) => setTimeout(() => no("timeout"), TOPE_CARGA_MS))]).then(
      () => { if (!this._engancharNuestra()) this._esperarNuestra(carga); },
      () => this._esperarNuestra(carga));
  }

  // ¿La TV tiene NUESTRO video? Si sí, se engancha y sigue la carga normal (devuelve true).
  _engancharNuestra() {
    if (this._destruido) return true;
    const m = this.session.getMediaSession && this.session.getMediaSession();
    const id = m && m.media && (m.media.contentId || m.media.contentUrl);
    if (!m || !mismoVideo(id, this.src)) return false;
    if (this._media !== m) { this._enganchar(m); this._onListo(); }
    this._actualizar(true);
    return true;
  }

  // Sin confirmación del LOAD: mirar cada medio segundo si la TV ya tiene nuestro video.
  // Con un LOAD nuevo de por medio (otra carga), ésta deja de esperar.
  _esperarNuestra(carga) {
    if (this._destruido) return;
    const desde = ahora();
    const mirar = () => {
      if (this._destruido || this._carga !== carga) return;
      if (this._engancharNuestra()) return;
      if (ahora() - desde > ESPERA_MEDIA_MS) { this._terminarTransmision("error"); return; }
      setTimeout(mirar, 500);
    };
    mirar();
  }

  _enganchar(m) {
    if (this._media === m) return;
    this._soltarMedia();
    this._media = m;
    try { m.addUpdateListener(this._alActualizar); } catch (e) {}
    const d = m.media && m.media.duration;
    if (d > 0 && Math.abs(d - this._duracion) > 0.01) { this._duracion = d; this._emit("durationchange", this._datos()); }
  }
  _soltarMedia() {
    if (this._media) { try { this._media.removeUpdateListener(this._alActualizar); } catch (e) {} }
    this._media = null;
  }

  // Otra media en la sesión. Si es este video (nuestra carga, u otra pestaña con la
  // misma lección), se sigue con ésa; si es otro, alguien cargó otra cosa en la TV.
  _nuevaMedia(m) {
    if (!m || this._destruido || m === this._media) return;
    const id = m.media && (m.media.contentId || m.media.contentUrl);
    // Durante la carga: si es nuestro video, engancharlo ya (el LOAD puede no confirmar
    // nunca en la primera conexión; ver _cargar). Si es otro, esperar a nuestra carga.
    if (this._carga) { if (mismoVideo(id, this.src)) this._engancharNuestra(); return; }
    if (mismoVideo(id, this.src)) { this._enganchar(m); this._anotarFirmaDe(m); this._actualizar(true); }
    else this._terminarTransmision("reemplazado");
  }

  // Con qué firma tiene cargado el video la TV (una sesión reanudada, u otra pestaña
  // que lo cargó): si es anterior a la vigente, _quizasRecargar la pone al día.
  _anotarFirmaDe(m) {
    if (!this._firma) return;
    const f = leerFirma(String((m && m.media && (m.media.contentId || m.media.contentUrl)) || ""));
    this._expiresCargado = f ? f.expires : null;
  }

  // La TV tiene el video con una firma anterior a la vigente: se lo vuelve a cargar con
  // la nueva, en el mismo segundo y estado (es el LOAD de siempre: mientras carga, el
  // componente ve fijo ese segundo). En pausa, ya: la TV queda quieta en el mismo
  // cuadro. Reproduciendo, recién cuando a la firma de la TV le falta poco, o en la
  // próxima pausa. Nunca con un salto, una pausa sin confirmar o otra carga en vuelo:
  // los resuelve _actualizar y después se vuelve a mirar (lo llama el latido).
  _quizasRecargar() {
    const f = this._firma;
    if (!f || this._destruido || this._finalizado || this._muerta || this._expiresCargado == null) return;
    if (this._expiresCargado === f.actual().expires) return;
    if (this._carga || this._salto || this._ancla != null || this._reanudar || !this._media) return;
    if (!this._pausado && !f.urgenteDe(this._expiresCargado)) return;
    this._cargar(this._estimar(), !this._pausado);
  }

  // Ida y vuelta medida con lo que la TV contesta sin hacer nada más: pausa y
  // pedido de estado. 🔴 No con LOAD, play ni salto, que incluyen bajar video
  // (el LOAD del simulador la llevaba de 0,25 a 0,43 s y la TV frenaba ANTES).
  // El MÍNIMO de las últimas medidas, no un promedio: pasarse se corrige (la pausa
  // anclada lleva la TV a su segundo), frenar ANTES no (se cortó el final de la
  // frase). Una medida lenta (la TV ocupada, un pico de la red) no tiene que adelantar
  // el freno. Y la primera reemplaza al valor inicial: con 300 ms por vía el promedio
  // tardaba varias medidas en llegar y la TV se pasaba de la pregunta.
  _medirRtt(ms) {
    if (!(ms > 0) || ms > 3000) return;
    this._medidasRtt.push(ms / 1000);
    if (this._medidasRtt.length > 5) this._medidasRtt.shift();
    this._rtt = Math.min(...this._medidasRtt);
  }

  // Comandos de media con su tope. _pend cuenta los propios en vuelo: mientras hay
  // alguno, un cambio de estado de la TV se atribuye a nosotros, no a un control
  // de afuera.
  _enviar(tipo, extra = {}) {
    const m = this._media, cc = sdk();
    if (!m || !cc || this._muerta) return;
    const cm = cc.media;
    const h0 = ahora();
    const cuenta = tipo !== "estado";
    if (cuenta) this._pend++;
    const fin = () => { if (cuenta) this._pend = Math.max(0, this._pend - 1); };
    let fn;
    if (tipo === "play") fn = (ok, mal) => m.play(new cm.PlayRequest(), ok, mal);
    else if (tipo === "pause") fn = (ok, mal) => m.pause(new cm.PauseRequest(), ok, mal);
    else if (tipo === "seek") {
      fn = (ok, mal) => {
        const r = new cm.SeekRequest();
        r.currentTime = extra.t;
        r.resumeState = extra.pausar ? cm.ResumeState.PLAYBACK_PAUSE : cm.ResumeState.PLAYBACK_START;
        m.seek(r, ok, mal);
      };
    } else if (tipo === "estado") fn = (ok, mal) => m.getStatus(new cm.GetStatusRequest(), ok, mal);
    else return fin();
    comando(fn).then(() => {
      fin();
      // Las consultas durante la carga no miden: la TV está ocupada cargando y la ida y
      // vuelta saldría inflada (el freno se adelantaría).
      if ((tipo === "pause" || tipo === "estado") && !extra.sinRtt) this._medirRtt(ahora() - h0);
      if (extra.alResponder && !this._destruido) extra.alResponder();
    }, () => {
      fin();
      if (this._destruido) return;
      // 🔴 Sin respuesta (o con error) NO se supone nada: se le pregunta el estado a la
      // TV y _actualizar acepta lo que de verdad hace. Antes un play sin respuesta se
      // daba por rechazado (_pausado y el botón en "Reproducir") cuando la TV sí lo
      // había aplicado: con el estado viejo en PAUSED el latido no estimaba ni armaba
      // el freno, y la TV corría sin freno hasta el final, pasando las preguntas.
      // Si la TV de verdad no reprodujo, su estado PAUSED pone el botón en
      // "Reproducir" solo (paso 4).
      if (tipo === "play" || tipo === "pause" || tipo === "seek") this._enviar("estado");
    });
  }

  // Salto propio. Se manda en una microtarea: si en el mismo turno llega una pausa
  // (la guardia hace seekTo + mostrar), el salto sale con PLAYBACK_PAUSE y la TV no
  // corre ni un cuadro después de llegar.
  _pedirSalto(t) {
    this._ancla = null;
    this._reanudar = false;
    // Un salto nuestro decide dónde queda la TV: una pausa que venga después ancla
    // ahí, no en el segundo de un play de afuera anterior.
    this._playExterno = null;
    if (this._muerta || (!this._media && !this._carga)) {
      this._reinicio = t;
      queueMicrotask(() => { if (!this._destruido) this._informar(t); });
      return;
    }
    if (this._carga) {
      // Todavía cargando: el salto pasa a ser el segundo de la carga. La TV arranca
      // donde se le pidió primero y _actualizar la lleva a éste al confirmar.
      this._carga.t = t;
      this._fijo = t;
      queueMicrotask(() => { if (!this._destruido) this._informar(t); });
      return;
    }
    if (this._salto && !this._salto.enviado) { this._salto.t = t; this._fijo = t; return; }
    if (this._salto) clearTimeout(this._salto.timer);
    const s = this._salto = { t, enviado: false, intentos: 0, timer: null };
    this._fijo = t;
    queueMicrotask(() => this._enviarSalto(s));
  }

  _enviarSalto(s) {
    if (this._destruido || this._salto !== s) return;
    s.enviado = true;
    s.intentos++;
    s.respondido = false;
    s.enviadoEn = ahora();
    this._enviar("seek", { t: s.t, pausar: this._pausado, alResponder: () => this._saltoRespondido(s) });
    if (Math.abs(s.t - this._ultimo) > 0.01) this._informar(s.t);
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      if (this._salto !== s || this._destruido) return;
      if (s.intentos < 2) return this._enviarSalto(s);
      // No aterrizó: se deja de sostener el destino y se informa lo que diga la TV.
      // Si quedó más allá de una pregunta, la guardia de saltos la frena.
      this._salto = null;
      this._fijo = this._ancla != null ? this._ancla : null;
    }, TOPE_COMANDO_MS);
  }

  // La TV contestó este salto. Si para entonces todavía no aterrizó y su último estado
  // está quieto o reproduciendo LEJOS del destino, otro la movió después de nuestro
  // pedido (el control remoto con la guardia volviendo a una pregunta): se reenvía ya.
  // 🔴 Antes se esperaba al reintento de los 8 s, y mientras tanto el paso 2 de
  // _actualizar descartaba todo estado lejos del destino: la TV reproducía sin
  // vigilancia, con la pregunta abierta en el celular y pasando de largo la siguiente.
  _saltoRespondido(s) {
    if (this._salto !== s) return;
    s.respondido = true;
    // Sólo con un estado que llegó DESPUÉS del pedido: si el SDK avisara la respuesta
    // antes de aplicar su estado, el último sería el de antes del salto.
    const p = this._previo;
    if (p && p.h >= s.enviadoEn && (p.estado === "PLAYING" || p.estado === "PAUSED") && Math.abs(p.t - s.t) > TOL_SALTO) this._reenviarSalto(s);
  }
  _reenviarSalto(s) {
    if (s.intentos >= INTENTOS_SALTO) return;   // el tope de los 8 s decide qué aceptar
    this._enviarSalto(s);
  }

  // La TV avisó algo (nuevo estado, o la respuesta a un comando). `vivo` en false:
  // la media de la TV terminó.
  _actualizar(vivo, inicial = false) {
    if (this._destruido || this._finalizado) return;
    const m = this._media;
    if (!m) return;
    // Estados e IdleReason del SDK son estos textos (chrome.cast.media.PlayerState.*).
    const estado = m.playerState;
    if (!vivo || estado === "IDLE") {
      const motivo = m.idleReason;
      if (vivo && !motivo) return;   // IDLE recién cargada, todavía sin arrancar
      if (motivo === "FINISHED") return this._terminoElVideo();
      if (motivo === "INTERRUPTED") return this._terminarTransmision("reemplazado");
      if (motivo === "ERROR") return this._terminarTransmision("error");
      return this._terminarTransmision("detenido");   // CANCELLED: lo pararon desde otro lado
    }
    const ya = ahora();
    const c = Math.max(0, Number(m.currentTime) || 0);
    const prev = this._previo;
    // La velocidad que DICE la TV; si no la informa, la última confirmada (nunca la
    // pedida: ver setPlaybackRate).
    const rate = Number(m.playbackRate) || (prev && prev.rate) || 1;
    const esperado = prev ? prev.t + (prev.estado === "PLAYING" ? ((ya - prev.h) / 1000) * (prev.rate || 1) : 0) : null;
    this._previo = { t: c, h: ya, estado, rate };
    this._ultimoPedidoEstado = ya;

    const d = m.media && m.media.duration;
    if (d > 0 && Math.abs(d - this._duracion) > 0.01) { this._duracion = d; this._emit("durationchange", this._datos()); }
    const enBuffer = estado === "BUFFERING";
    if (enBuffer !== this._buffer) { this._buffer = enBuffer; this._emit(enBuffer ? "bufferstart" : "bufferend", this._datos()); }

    // 1) Carga en curso: hasta que la TV esté en su segundo, se sigue informando ése.
    if (this._carga) {
      const k = this._carga;
      // 🔴 Reproduciendo, la TV pudo avanzar desde que arrancó en k.t antes de que llegara
      // su aviso: si está entre k.t y lo que cabe en el tiempo transcurrido, es nuestra
      // carga y se la sigue. Antes se comparaba sólo con k.t (±2 s): un aviso que llegaba
      // tarde se tomaba como "arrancó en otro lado", se la mandaba de vuelta al segundo de
      // partida y la compu y la TV quedaban desfasadas (prueba de Erick, oct-2026).
      const transcurrido = Math.max(0, (ya - k.h) / 1000) * (this._velocidad || 1);
      const enSuSegundo = (estado === "PLAYING" || estado === "PAUSED") &&
        c >= k.t - TOL_CARGA && c <= k.t + (estado === "PLAYING" ? transcurrido : 0) + TOL_CARGA;
      if (!enSuSegundo) {
        // La TV arrancó en otro lado (ignoró currentTime): llevarla.
        if (ya - k.h > TOPE_CARGA_MS || (estado === "PLAYING" || estado === "PAUSED")) {
          this._carga = null;
          this._pedirSalto(k.t);
        }
        return;
      }
      this._carga = null;
      this._fijo = null;
      // Una medida de la ida y vuelta antes de la primera pregunta (ver _medirRtt).
      if (!this._medidasRtt.length) { this._ultimoPedidoEstado = ahora(); this._enviar("estado"); }
      // Una velocidad elegida durante "Conectando…" no viajó en el LOAD.
      if (Math.abs(rate - this._velocidad) > 0.01) this.setPlaybackRate(this._velocidad);
      // Lo que pidió el componente mientras cargaba manda (pausó en "Conectando…",
      // o tocó reproducir).
      if (this._pausado && estado !== "PAUSED") { this._ancla = k.t; this._anclaCorregida = false; this._fijo = k.t; this._enviar("pause"); return; }
      if (!this._pausado && estado === "PAUSED") this._enviar("play");
      this._informar(c);
      this._armarFreno();
      return;
    }

    // 2) Salto propio en vuelo: se sigue informando el destino hasta que aterrice.
    // 🔴 El aviso que lo confirma está lejos de lo esperado ANTES del salto: no se
    // lo compara (paso 4) o se leería como un salto de afuera.
    let propio = false;
    if (this._salto) {
      const s = this._salto;
      if (!s.enviado) return;
      if (Math.abs(c - s.t) > TOL_SALTO) {
        // Lejos del destino. Si la TV ya contestó este salto y está quieta o
        // reproduciendo, alguien la movió después: se reenvía ya (ver _saltoRespondido).
        // Mientras carga (BUFFERING), o sin respuesta todavía, se espera.
        if (s.respondido && (estado === "PLAYING" || estado === "PAUSED")) this._reenviarSalto(s);
        return;
      }
      clearTimeout(s.timer);
      this._salto = null;
      propio = true;
      this._fijo = this._ancla;
      if (this._ancla == null) {
        this._informar(c);
        this._emit("seeked", this._datos(c));
      } else {
        this._emit("seeked", this._datos(this._ancla));
      }
    }

    // 3) Pausa anclada: la TV tiene que quedar en el segundo que se pidió.
    if (this._ancla != null) {
      const a = this._ancla;
      // Ya pidieron reproducir (ver play()): con el estado de la pausa se decide.
      if (this._reanudar) {
        if (estado !== "PAUSED" && this._pend > 0) return;   // la pausa todavía no llegó
        this._reanudar = false;
        this._ancla = null;
        this._anclaCorregida = false;
        // Se pasó: a su segundo, reproduciendo (_pedirSalto lo informa y lo sostiene).
        if (c > a + TOL_ANCLA) { this._pedirSalto(a); return; }
        // En su segundo, o antes (no se la adelanta, ver abajo): sigue desde ahí.
        this._fijo = null;
        if (estado === "PAUSED") this._enviar("play");
        if (estado !== "PLAYING" && Math.abs(c - this._ultimo) > 0.05) this._informar(c);
        this._armarFreno();
        return;
      }
      if (estado === "PAUSED") {
        // Frenó MÁS ALLÁ: llevarla, quieta, a su segundo. Una sola vez: un receptor
        // que aterriza siempre medio segundo corrido (salto por cuadro clave) haría un
        // ida y vuelta sin fin.
        if (c > a + TOL_ANCLA && !this._anclaCorregida) {
          this._anclaCorregida = true;
          this._pedirSalto(a);
          this._ancla = a;   // _pedirSalto lo limpia; se sigue anclado hasta aterrizar
          return;
        }
        this._ancla = null;
        this._anclaCorregida = false;
        // 🔴 Frenó ANTES (el estimado iba adelantado: un receptor que informa el
        // tiempo con error, una velocidad que no aplicó): NO se la lleva hacia
        // adelante, que saltearía justo el final de la frase que el freno cuida. Se
        // queda donde frenó y al componente se le sigue informando el segundo pedido
        // (_fijo) hasta el próximo play o salto: así, con la pregunta abierta, el
        // efecto que deshace los saltos de la TV no lo lee como uno. Al reproducir,
        // la TV sigue desde donde frenó (repite ese tramo, ya con la pregunta
        // respondida).
        if (c < a - TOL_ANCLA) { this._fijo = a; return; }
        this._fijo = null;
        if (Math.abs(c - this._ultimo) > 0.05) this._informar(c);
        return;
      }
      if (this._pend > 0) return;   // la pausa todavía no llegó
      // La TV sigue sin un comando nuestro en vuelo: la pausa se perdió. Otra vez.
      if (this._reintentosPausa++ < 2) { this._enviar("pause"); return; }
      // Si la TV no frena, se acepta lo que hace: se informa como un play de afuera.
      this._ancla = null;
      this._fijo = null;
    }

    // 4) Lo que no pidió este reproductor: el control remoto (HDMI-CEC), Google
    // Home, la notificación de Chrome u otra pestaña. El estado de la TV no dice
    // quién lo mandó: se infiere comparando con lo pedido y con lo esperado.
    const salto = !propio && !inicial && esperado != null && Math.abs(c - esperado) > SALTO_EXTERNO && this._pend === 0;
    // Llegado acá, un _fijo puesto es el de una TV que frenó antes de su segundo
    // (paso 3). Un salto o un play de afuera lo terminan: manda lo que hace la TV.
    if (salto) this._fijo = null;
    if (salto || inicial) {
      // El segundo nuevo primero: el componente lo pasa por la guardia de saltos
      // (vuelve a la primera pregunta pendiente que haya quedado atrás).
      this._informar(c);
      if (salto) this._emit("seeked", this._datos(c));
    }
    if (this._pend === 0) {
      if (estado === "PAUSED" && !this._pausado) {
        this._pausado = true;
        clearTimeout(this._tFreno);
        if (Math.abs(c - this._ultimo) > 0.05) this._informar(c);
        this._emit("pause", this._datos());
      } else if (estado === "PLAYING" && this._pausado) {
        // Un play de afuera. Si el componente lo rechaza (pregunta abierta), pause()
        // devuelve la TV a este segundo (ver _playExterno).
        this._playExterno = { t: this._ultimo, h: ya };
        this._pausado = false;
        this._fijo = null;
        this._emit("play", this._datos());
      }
    }
    if (!salto && !inicial && estado !== "PLAYING" && this._fijo == null) {
      if (Math.abs(c - this._ultimo) > 0.05) this._informar(c);
    }
    this._armarFreno();
  }

  // Latido: el tiempo que avanza mientras la TV reproduce (la TV no lo manda: avisa
  // sólo los cambios de estado). Extrapola del último estado, como getEstimatedTime.
  _latido() {
    if (this._destruido || this._finalizado || this._muerta) return;
    // Sin noticias de la TV en 5 s: preguntarle, SIEMPRE que haya media. Los avisos
    // llegan sólo con cambios de estado, y uno perdido dejaba el segundo congelado o,
    // peor, el estado viejo en pausa con la TV reproduciendo (un play cuya respuesta
    // se perdió): ahí el latido no estimaba ni frenaba. Así cualquier diferencia con
    // la TV se ve en 5 s o menos (también con una pregunta abierta y la TV quieta).
    if (this._media && !this._carga && ahora() - this._ultimoPedidoEstado > ESTADO_CADA_MS) {
      this._ultimoPedidoEstado = ahora();
      this._enviar("estado");
    }
    // 🔴 Durante la carga también, y más seguido. Con una TV real (Erick, oct-2026) el
    // aviso de "ya reproduzco" puede no llegar: la TV arrancaba y la compu quedaba
    // congelada en el segundo de partida, sin preguntar, hasta el tope de 20 s.
    if (this._media && this._carga && ahora() - this._ultimoPedidoEstado > ESTADO_CARGA_MS) {
      this._ultimoPedidoEstado = ahora();
      this._enviar("estado", { sinRtt: true });
    }
    // Una firma nueva esperando un momento (o a que le falte poco a la de la TV).
    this._quizasRecargar();
    if (this._fijo != null || this._pausado) return;
    const p = this._previo;
    if (!p || p.estado !== "PLAYING") return;
    const t = this._estimar();
    if (this._freno != null && t >= this._freno - this._anticipo()) { this._prefrenar(); return; }
    // Una corrección chica hacia atrás (deriva) no se informa: el reloj no retrocede
    // por décimas. La alcanza solo.
    if (t < this._ultimo && this._ultimo - t < 0.6) return;
    this._informar(t);
  }

  // Freno de un disparo hacia la próxima pregunta. Se arma desde los avisos de la TV
  // y desde play/frenarEn, NO desde el latido: oculta, la página corre los timers
  // encadenados a 1 por minuto, y uno de un disparo sigue llegando a tiempo
  // (alineado al segundo).
  _armarFreno() {
    clearTimeout(this._tFreno);
    this._tFreno = null;
    const p = this._previo;
    if (this._freno == null || this._pausado || this._fijo != null || !p || p.estado !== "PLAYING") return;
    const falta = (this._freno - this._anticipo() - this._estimar()) / (p.rate || 1);
    if (falta <= 0) return this._prefrenar();
    this._tFreno = setTimeout(() => {
      this._tFreno = null;
      if (this._pausado || this._freno == null) return;
      if (this._estimar() >= this._freno - this._anticipo() - 0.03) this._prefrenar();
      else this._armarFreno();
    }, falta * 1000);
  }

  _prefrenar() {
    const t = this._freno;
    this._freno = null;
    clearTimeout(this._tFreno);
    // Un freno que ya quedó atrás (salto de afuera más allá) no vale: el segundo no
    // puede retroceder hasta él sin que el componente lo vea como un salto.
    if (t == null || this._pausado || t < this._ultimo - 0.05) return;
    this._pausado = true;
    this._ancla = t;
    this._anclaCorregida = false;
    this._fijo = t;
    this._reintentosPausa = 0;
    // Frenó el adaptador: la pausa que el componente pide enseguida (al mostrar la
    // pregunta) no es el rechazo de un play de afuera (ver pause()).
    this._playExterno = null;
    this._enviar("pause");
    this._informar(t);
    this._emit("pause", this._datos(t));
  }

  _terminoElVideo() {
    if (this._muerta) return;
    const d = this._duracion || this._ultimo;
    this._soltarMedia();
    this._muerta = true;
    this._carga = null;
    if (this._salto) clearTimeout(this._salto.timer);
    this._salto = null;
    this._ancla = null;
    this._reanudar = false;
    this._fijo = null;
    this._freno = null;
    this._playExterno = null;
    clearTimeout(this._tFreno);
    this._reinicio = d;
    const seguia = !this._pausado;
    this._pausado = true;
    // Como el <video>: el último segundo, la pausa y 'ended' (el componente guarda
    // la finalización igual que en local, y vuelve a 0: ver play()).
    this._informar(d);
    if (seguia) this._emit("pause", this._datos(d));
    this._emit("ended", { seconds: d, duration: d, percent: 1 });
  }

  // La TV dejó de ser la que reproduce (la pararon, otra media, error, se cortó la
  // sesión). El componente vuelve al <video> en este segundo.
  // Si la pararon o le cargaron otra cosa desde otro emisor, alguien tomó la TV a
  // propósito: el celular vuelve EN PAUSA (que de golpe suene el celular sería peor).
  // Si se cortó la sesión o falló, vuelve como estaba.
  _terminarTransmision(motivo) {
    if (this._finalizado || this._destruido) return;
    this._finalizado = true;
    const t = this._muerta ? (this._reinicio != null ? this._reinicio : this._ultimo) : this._estimar();
    const tomada = motivo === "detenido" || motivo === "reemplazado";
    this._onFin(motivo, { t, seguia: !tomada && !this._pausado && !this._muerta });
  }
}
