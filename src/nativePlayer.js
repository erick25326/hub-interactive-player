// Reproductor NATIVO (<video> + hls.js) con la MISMA forma que el SDK de Vimeo.
//
// Por qué existe: con Vimeo, cada comando (play, pausa, saltar, leer el tiempo)
// viaja por postMessage a un iframe ajeno, y en celulares de gama media eso es
// lo que se siente torpe (ver los parches v1.2.3, v1.2.4 y v1.2.7). Con un
// <video> propio los comandos son inmediatos y la pantalla completa, el audio y
// AirPlay son del navegador.
//
// Imita sólo la parte del SDK de @vimeo/player que usa InteractiveVideoPlayer:
// ready(), on(), play/pause, get/setCurrentTime, volumen, mute, velocidad,
// pistas de texto y calidades. Todo devuelve Promises, igual que Vimeo, así el
// componente no distingue entre uno y otro. Un error que no se puede recuperar
// se emite como 'error' con { fatal: true } (Vimeo emite 'error' también por un
// play rechazado, sin `fatal`: el componente filtra por eso).
//
// Fuente: una URL HLS (.m3u8, p. ej. Bunny Stream) o un MP4 directo.
// Elección del motor (verificado oct-2026):
//   - Safari / iPhone / iPad → HLS NATIVO. hls.js en iPhone recién anda desde
//     iOS 17.1 y ahí apaga AirPlay; la app de Moodle soporta iOS 15+.
//   - Chrome / Android / Firefox → hls.js. Chrome 142+ responde "maybe" a
//     canPlayType('application/vnd.apple.mpegurl') pero falla con algunos
//     streams (hls.js #7827): por eso NO se prueba primero el nativo.
//
// 🔴 hls.js COMPLETO, no "hls.js/light": con light el video de Bunny se veía
// MUDO en Android. Ojo, la explicación que figuraba acá (audio en una pista
// aparte, #EXT-X-MEDIA:TYPE=AUDIO) NO coincide con el master de prueba bajado en
// oct-2026: ese trae el audio AAC multiplexado en los mismos .ts y ningún grupo
// de audio. Hasta revisar más masters de la biblioteca y entender ese "mudo", se
// queda el completo (light ahorraría ~69 KB gzip por alumno).

import Hls from "hls.js";

const HLS_MIME = "application/vnd.apple.mpegurl";
// Calidad de arranque: hls.js por defecto estima 500 kbps y empieza en 240p, que
// se ve feo los primeros segundos. Con 3 Mbps estimados arranca alto y el tope
// por tamaño del reproductor (capLevelToPlayerSize, más abajo) lo deja en lo que
// la pantalla aprovecha. Master de prueba de Bunny (oct-2026), pico declarado
// (BANDWIDTH): 480p ~1,2 Mbps, 720p ~2,0 y 1080p ~3,9. La ABR baja sola si no
// alcanza. OJO: no poner `startLevel: -1`, que dispara una prueba de ancho de
// banda en 240p y anula esta estimación (ver también setQuality('auto')).
const ARRANQUE_BPS = 3_000_000;
// Buffer: hasta el primer play se baja sólo un segmento (6 s de Bunny), para que
// abrir la lección sin mirar no gaste datos. Reproduciendo, 30 s. Hace falta
// maxMaxBufferLength: sin él hls.js calcula el objetivo con maxBufferSize (60 MB)
// y precargaba varios minutos.
const BUFFER_INICIAL = 6;
const BUFFER_REPRODUCIENDO = 30;
const MAX_REINTENTOS_RED = 3;

// Cambio de fuente del HLS nativo (calidad elegida a mano): si en este tiempo no
// aterrizó de vuelta en su segundo, se da por terminado igual (ver _vencioCambio).
const CAMBIO_TOPE_MS = 12000;
// Cuántas veces se vuelve a pedir el salto a su segundo durante un cambio, y cada
// cuánto se revisa si el pedido se descartó sin avisar (ver _volverASaltar).
const SALTOS_CAMBIO = 3;
const VIGIA_MS = 1500;

const esHls = (src) => /\.m3u8(\?|#|$)/i.test(src) || /\/playlist\.m3u8/i.test(src);

// "720p" es el lado CORTO de la imagen, como lo nombra YouTube: un video vertical
// de 1080×1920 es "1080p", no "1920p".
const altoDe = (w, h) => (w > 0 && h > 0 ? Math.min(w, h) : h || 0);

// Variantes de un master HLS, para elegir calidad con el HLS NATIVO de Safari,
// que no tiene API para fijar una variante (Apple DTS, foro 675282): lo único que
// se puede es cargar la playlist de esa variante como fuente. Devuelve
// [{ alto, url }] de mayor a menor, o [] si no hay nada que elegir.
// 🔴 Con el audio en un grupo aparte (#EXT-X-MEDIA:TYPE=AUDIO, o AUDIO= en la
// variante) la playlist de la variante no lo trae y el video sonaría MUDO: en ese
// caso no se ofrece la elección. El master de Bunny de oct-2026 lo trae adentro.
export function variantesDelMaster(texto, urlMaster) {
  const lineas = String(texto || "").split(/\r?\n/);
  if (!/^#EXTM3U/.test((lineas[0] || "").trim())) return [];
  if (/^#EXT-X-MEDIA:.*TYPE=AUDIO/im.test(texto)) return [];
  const porAlto = new Map();
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (!l.startsWith("#EXT-X-STREAM-INF:")) continue;   // las I-FRAME no: no se reproducen
    const attrs = l.slice(18);
    if (/(^|,)AUDIO=/.test(attrs)) return [];
    const res = /(?:^|,)RESOLUTION=(\d+)x(\d+)/.exec(attrs);
    const bw = Number((/(?:^|,)BANDWIDTH=(\d+)/.exec(attrs) || [])[1]) || 0;
    let uri = null;
    for (let j = i + 1; j < lineas.length; j++) {
      const u = lineas[j].trim();
      if (!u || u.startsWith("#")) continue;
      uri = u; break;
    }
    if (!res || !uri) continue;
    let url;
    try {
      // Relativa al master: conserva un token de Bunny que vaya en la RUTA
      // (bcdn_token/token_path). Si el token va en la query y la variante no trae
      // la suya, se le copia la del master.
      const u = new URL(uri, urlMaster);
      const m = new URL(urlMaster);
      if (!u.search && m.search) u.search = m.search;
      url = u.href;
    } catch (e) { continue; }
    const alto = altoDe(Number(res[1]), Number(res[2]));
    const prev = porAlto.get(alto);
    if (alto > 0 && (!prev || prev.bw < bw)) porAlto.set(alto, { alto, url, bw });
  }
  const lista = [...porAlto.values()].sort((a, b) => b.alto - a.alto).map(({ alto, url }) => ({ alto, url }));
  return lista.length >= 2 ? lista : [];
}

// WebKit de Apple (Safari de escritorio y cualquier navegador en iOS/iPadOS).
function esIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function esApple() {
  const ua = navigator.userAgent || "";
  const safariMac = /^((?!chrome|chromium|crios|fxios|android|edg).)*safari/i.test(ua);
  return esIOS() || safariMac;
}

export default class NativePlayer {
  constructor(el, { src, poster, motor = "auto" } = {}) {
    this.handlers = {};
    this.hls = null;
    this.src = src;
    this.motorPedido = motor;     // 'auto' | 'hls' | 'nativo' (prueba en iPhone: ?motor=)
    this.motor = null;            // el que quedó: 'hls' | 'nativo' | 'mp4'
    this._finEmitido = false;
    this._error = null;           // error fatal ya emitido (se re-entrega a quien se suscriba tarde)
    this._seekPendiente = null;   // posición pedida antes de que llegara la metadata
    this._reintentosRed = 0;
    this._tReintento = null;
    this._tRecover = -Infinity;
    this._swapHecho = false;
    this._detenido = false;       // hls.stopLoad() después de 'ended'
    // Calidad (ver setQuality). La elección dura lo que la página: no se guarda,
    // porque un 1080p fijo que queda puesto con datos móviles corta y cuesta plata.
    this._calidad = "auto";       // la elegida: 'auto' o '720p'
    this._viendo = null;          // alto que se está viendo, para "Automática (480p)"
    this._altoPedido = null;      // hls.js: alto fijado a mano (por ALTO: los índices cambian)
    this._variantes = null;       // HLS nativo: [{ alto, url }] del master; [] = no se puede elegir
    this._variantesPromesa = null;
    this._srcActual = src;        // HLS nativo: el master o la playlist de una variante
    this._cambio = null;          // HLS nativo: cambio de fuente en curso (ver _cambiarFuente)
    this._calidadEnCola = null;   // pedida durante un cambio: se aplica al terminar
    // HLS nativo: fuente elegida a mano que todavía no mostró ningún cuadro, con la
    // anterior a la que volver si falla (ver _revertirSinConfirmar). Dura más que
    // _cambio: el tope de 12 s cierra el cambio, no la posibilidad de que falle.
    this._sinConfirmar = null;
    this._pausadoVisto = true;    // último play/pause que se le avisó al componente

    const v = document.createElement("video");
    v.setAttribute("playsinline", "");          // iPhone: no saltar solo a pantalla completa
    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("x-webkit-airplay", "allow");
    v.preload = "metadata";
    v.controls = false;
    v.disablePictureInPicture = true;
    if (poster) v.poster = poster;
    el.appendChild(v);
    this.video = v;

    this._readyPromise = new Promise((resolve) => {
      let hecho = false;
      this._resolverReady = () => { if (!hecho) { hecho = true; clearTimeout(this._readyFallback); resolve(); } };
      v.addEventListener("loadedmetadata", this._resolverReady, { once: true });
      // iOS a veces no baja metadata hasta el primer toque: no dejar el spinner
      // eterno. Con la duración en 0 el componente igual arranca, y el evento
      // durationchange la corrige apenas llegue.
      this._readyFallback = setTimeout(this._resolverReady, 4000);
    });

    this._conectarEventos();
    this._apagarPistasNativas();
    this._cargar();
    // Después de _cargar: hls.js con ManagedMediaSource ya puso disableRemotePlayback.
    this._iniciarAirPlay();
  }

  // Qué motor usar. Hoy el iPhone va por defecto al HLS de Safari, que arranca por
  // la PRIMERA variante del master (Bunny pone 360p) y espera a no cortarse antes
  // de retomar un salto. hls.js en iPhone usa ManagedMediaSource (iOS 17.1+):
  // arranca por estimación y retoma con un segmento. Con ?motor= se comparan.
  _elegirMotor() {
    const hlsOk = Hls.isSupported();
    const natOk = !!this.video.canPlayType(HLS_MIME);
    if (this.motorPedido === "nativo" && natOk) return "nativo";
    if (this.motorPedido === "hls" && hlsOk) return "hls";
    if (esApple()) return natOk ? "nativo" : (hlsOk ? "hls" : null);
    return hlsOk ? "hls" : (natOk ? "nativo" : null);
  }

  _cargar() {
    const v = this.video, src = this.src;
    if (!src) return this._fallar("sin-fuente", { details: "Falta la URL del video" });
    if (!esHls(src)) { this.motor = "mp4"; v.dataset.motor = "mp4"; v.src = src; return; }      // MP4 directo
    const motor = this._elegirMotor();
    this.motor = motor; v.dataset.motor = motor || "";
    if (motor === "nativo") { v.src = src; return; }
    if (motor === "hls") {
      const hls = new Hls({
        // En Apple (iPad/Mac con MSE clásico) preferir ManagedMediaSource: es el que
        // existe en iPhone y el que Apple recomienda por batería.
        preferManagedMediaSource: esApple(),
        abrEwmaDefaultEstimate: ARRANQUE_BPS,
        // No bajar 1080p para una ventana chica. Sólo limita a la ABR: una calidad
        // elegida a mano en el menú (setQuality) pasa por encima del tope.
        capLevelToPlayerSize: true,
        // Un celular de densidad 3 pedía 1080p para un video de 375 px de ancho.
        // Con tope 2 (lado mayor × 2, primer nivel que lo cubre): con el celular
        // parado lo típico es 480p (360p en 320 px, 720p desde ~430 px) y en
        // pantalla completa acostado, 1080p.
        maxDevicePixelRatio: 2,
        maxBufferLength: BUFFER_INICIAL,
        maxMaxBufferLength: BUFFER_INICIAL,
        backBufferLength: 30,         // celulares con poca memoria
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { this._reintentosRed = 0; });
      hls.on(Hls.Events.ERROR, (_e, data) => { this._revisarVueltaAAuto(); this._errorHls(data); });
      // Lista de calidades lista. Si fue un loadSource() de reintento, que borra la
      // elección manual (resetLevels), se la repone por ALTO.
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (this._altoPedido != null) {
          const i = this._indiceDeAlto(this._altoPedido);
          if (i >= 0) hls.loadLevel = i;   // sin vaciar nada: todavía no hay buffer
          else { this._altoPedido = null; this._calidad = "auto"; }
        }
        this._emitirCalidad();
      });
      hls.on(Hls.Events.LEVEL_SWITCHING, () => this._revisarVueltaAAuto());
      // removeLevel() (un nivel que falla) renumera: el menú se arma de nuevo y, si
      // el alto elegido ya no está, vuelve a automático.
      hls.on(Hls.Events.LEVELS_UPDATED, () => {
        if (this._altoPedido != null) {
          const i = this._indiceDeAlto(this._altoPedido);
          if (i < 0) {
            this._altoPedido = null; this._calidad = "auto";
            if (!hls.autoLevelEnabled) hls.nextLevel = -1;
          } else if (!hls.autoLevelEnabled && hls.manualLevel !== i) {
            hls.loadLevel = i;   // removeLevel() deja el manual en el índice "actual", no en el elegido
          }
        }
        this._emitirCalidad();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        const nivel = hls.levels[data.level];
        if (nivel) {
          v.dataset.nivel = String(nivel.height || "");
          this._viendo = altoDe(nivel.width, nivel.height) || null;
          this._emitirCalidad();
        }
      });
      // Seguro: con MSE el navegador a veces no despacha 'ended' (hls.js lo
      // compensa con MEDIA_ENDED). Sin 'ended' no se registra la finalización.
      hls.on(Hls.Events.MEDIA_ENDED, () => {
        if (this._finEmitido) return;
        this._finEmitido = true;
        this._emit("ended", { seconds: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : 0, percent: 1 });
      });
      hls.loadSource(src);
      hls.attachMedia(v);
      this.hls = hls;
      return;
    }
    this._fallar("sin-soporte", { details: "Este navegador no puede reproducir el video" });
  }

  // Errores de hls.js: reintentar con espera y tope; si no se arregla, avisar.
  // Antes se reintentaba al instante y sin límite: un token vencido (403) hacía
  // un bucle de pedidos para siempre con el spinner girando.
  _errorHls(data) {
    if (!data.fatal || !this.hls || this._error) return;
    const hls = this.hls;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      const code = data.response?.code;
      // 4xx: token vencido o sin permiso. Reintentar no lo arregla; recargar la
      // página sí (Moodle firma un token nuevo).
      if (code >= 400 && code < 500) return this._fallar("acceso", data);
      if (this._reintentosRed >= MAX_REINTENTOS_RED) return this._fallar("red", data);
      const espera = 2000 * 2 ** this._reintentosRed;   // 2, 4 y 8 s (señal que va y viene)
      this._reintentosRed++;
      clearTimeout(this._tReintento);
      this._tReintento = setTimeout(() => {
        if (!this.hls || this._error) return;
        if (!this.hls.levels || !this.hls.levels.length) this.hls.loadSource(this.src);
        else this.hls.startLoad();
      }, espera);
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      // Receta de hls.js: recover; si vuelve a fallar enseguida, swapAudioCodec +
      // recover; y si sigue, darse por vencido.
      const ahora = performance.now();
      const seguia = !this.video.paused;
      if (ahora - this._tRecover > 10000) { this._tRecover = ahora; hls.recoverMediaError(); }
      else if (!this._swapHecho) { this._swapHecho = true; this._tRecover = ahora; hls.swapAudioCodec(); hls.recoverMediaError(); }
      else return this._fallar("medio", data);
      // recoverMediaError() deja el <video> pausado sin emitir 'pause': retomar.
      if (seguia) this.video.addEventListener("canplay", () => this.video.play().catch(() => {}), { once: true });
      return;
    }
    this._fallar("otro", data);
  }

  _fallar(tipo, data) {
    if (this._error) return;
    clearTimeout(this._tReintento);
    this._sinConfirmar = null;
    if (this.hls) this.hls.stopLoad();
    this._error = { fatal: true, tipo, code: data?.response?.code ?? null, message: data?.details || data?.message || tipo };
    this._resolverReady?.();
    this._emit("error", this._error);
  }

  _datos() {
    const v = this.video;
    return {
      seconds: this._seekPendiente ?? v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      percent: v.duration ? v.currentTime / v.duration : 0,
    };
  }

  _conectarEventos() {
    const v = this.video;
    const datos = () => this._datos();
    // 🔴 Mientras dura un cambio de fuente del HLS nativo (calidad elegida a mano,
    // ver _cambiarFuente) el <video> pasa por currentTime 0, pausa, play y espera
    // antes de volver a su segundo. Nada de eso le llega al componente: una caída
    // a 0 seguida de un salto de vuelta la leería la guardia de saltos (o
    // debeFrenar) como un salto que cruza preguntas. Al terminar se le informa el
    // estado final de una sola vez.
    // Sin datos (readyState 0: recién cargando o recuperándose) el currentTime es
    // 0 aunque el alumno esté en el minuto 3: no reenviarlo o se guarda 0.
    // Durante un cambio, los timeupdate sirven para vigilar que el medio no corra
    // lejos de su segundo (ver _vigilarCambio).
    v.addEventListener("timeupdate", () => {
      if (this._cambio) return this._vigilarCambio();
      if (v.readyState) this._emit("timeupdate", datos());
    });
    v.addEventListener("play", () => {
      this._finEmitido = false;
      // Recién al reproducir se llena el buffer de verdad (ver BUFFER_INICIAL).
      if (this.hls) { this.hls.config.maxBufferLength = BUFFER_REPRODUCIENDO; this.hls.config.maxMaxBufferLength = BUFFER_REPRODUCIENDO; }
      if (!this._cambio) this._emit("play", datos());
    });
    v.addEventListener("seeking", () => { this._finEmitido = false; });
    v.addEventListener("pause", () => { if (!this._cambio) this._emit("pause", datos()); });
    // load() (que hace hls.js al recuperarse) pausa sin disparar 'pause': avisar.
    v.addEventListener("emptied", () => { if (!this._cambio && v.paused) this._emit("pause", datos()); });
    v.addEventListener("ended", () => {
      // Terminó: dejar de bajar. Si no, al volver a 0 (lo hace el componente)
      // hls.js volvía a llenar el buffer con un video que ya se vio.
      if (this.hls) { this.hls.stopLoad(); this._detenido = true; }
      if (this._finEmitido) return;   // ya lo emitió MEDIA_ENDED de hls.js
      this._finEmitido = true;
      this._emit("ended", datos());
    });
    v.addEventListener("seeked", () => {
      if (this._cambio) return this._quizasTerminarCambio(true);
      this._emit("seeked", datos());
    });
    v.addEventListener("durationchange", () => { if (!this._cambio) this._emit("durationchange", datos()); });
    v.addEventListener("loadedmetadata", () => {
      // HLS nativo: leer las variantes del master para el menú de calidad (una vez).
      if (this.motor === "nativo" && !this._variantesPromesa) this._leerVariantes();
      if (this._seekPendiente == null) return;
      const d = v.duration, t = this._seekPendiente;
      this._seekPendiente = null;
      v.currentTime = Number.isFinite(d) && d > 0 ? Math.min(d - 0.05, t) : t;
    });
    // Primer cuadro de la fuente nueva: la variante elegida anda (su playlist y al
    // menos un segmento llegaron, con el token incluido). Ya no hace falta poder
    // volver a la anterior.
    v.addEventListener("loadeddata", () => { this._sinConfirmar = null; });
    // Equivalentes de bufferstart / bufferend de Vimeo
    v.addEventListener("waiting", () => { if (!this._cambio) this._emit("bufferstart", datos()); });
    v.addEventListener("playing", () => { if (!this._cambio) this._emit("bufferend", datos()); });
    v.addEventListener("canplay", () => {
      if (this._cambio) return this._quizasTerminarCambio(false);
      this._emit("bufferend", datos());
    });
    // Lo que se ve: la etiqueta "Automática (480p)". Con hls.js la pone también
    // LEVEL_SWITCHED; con el HLS nativo es la única forma de saberlo.
    v.addEventListener("resize", () => { if (!this.hls) this._actualizarViendo(); });
    // Con hls.js los errores del <video> los maneja hls.js (y los reintenta);
    // sólo con la fuente directa (HLS nativo de Apple o MP4) son definitivos.
    // Durante un cambio de calidad no: se vuelve a la fuente anterior.
    // 🔴 También DESPUÉS del tope de 12 s, si la variante todavía no mostró nada:
    // una que tarda 13 s y responde 403 (datos móviles malos, token vencido)
    // terminaba en la pantalla de error, con el video anterior andando bien.
    v.addEventListener("error", () => {
      if (this._cambio) return this._fallaCambio();
      if (this._sinConfirmar) return this._revertirSinConfirmar();
      if (!this.hls) this._fallar("medio", { message: v.error?.message || "error de video" });
    });
  }

  // Si el playlist de Bunny trae subtítulos, Safari los muestra solo y nuestro
  // botón no los apagaría. Los subtítulos los dibuja el componente.
  _apagarPistasNativas() {
    const tt = this.video.textTracks;
    if (!tt || !tt.addEventListener) return;
    const apagar = () => { for (let i = 0; i < tt.length; i++) if (tt[i].mode !== "disabled") tt[i].mode = "disabled"; };
    tt.addEventListener("addtrack", apagar);
    tt.addEventListener("change", apagar);
  }

  _emit(evento, datos) {
    if (evento === "play") this._pausadoVisto = false;
    else if (evento === "pause") this._pausadoVisto = true;
    (this.handlers[evento] || []).forEach((h) => { try { h(datos); } catch (e) {} });
  }

  // --- API estilo @vimeo/player ---------------------------------------------
  on(evento, h) {
    (this.handlers[evento] ||= []).push(h);
    // Un error que pasó antes de suscribirse igual le llega.
    if (evento === "error" && this._error) { const e = this._error; queueMicrotask(() => h(e)); }
    // AirPlay: la disponibilidad pudo llegar antes de que el componente se suscriba.
    if (evento === "remotechange" && this._airplay && (this._airplay.disponible || this._airplay.estado !== "disconnected")) {
      const d = this._estadoAirPlay(); queueMicrotask(() => h(d));
    }
  }
  off(evento, h) { this.handlers[evento] = (this.handlers[evento] || []).filter((x) => x !== h); }
  ready() { return this._readyPromise; }

  play() {
    if (this._error) return Promise.reject(new Error(this._error.message));
    if (this.hls && this._detenido) { this._detenido = false; this.hls.startLoad(this.video.currentTime); }
    if (this._sinConfirmar) this._sinConfirmar.seguia = true;
    if (this._cambio) {
      this._cambio.seguia = true;   // su 'play' lo informa el fin del cambio
      // Lo pausó _volverASaltar mientras busca su segundo: lo retoma _terminarCambio.
      // Un play acá haría correr el medio desde 0 detrás de la ruedita.
      if (this._cambio.pausadoPorMi) return Promise.resolve();
    }
    return this.video.play();
  }
  pause() {
    this.video.pause();
    if (this._sinConfirmar) this._sinConfirmar.seguia = false;
    // Durante un cambio de fuente los eventos del <video> no salen: avisar ya, así
    // el botón y el candado (una pregunta que pausa) no esperan a que termine.
    if (this._cambio) { this._cambio.seguia = false; if (!this._pausadoVisto) this._emit("pause", this._datos()); }
    return Promise.resolve();
  }
  getPaused() { return Promise.resolve(this.video.paused); }

  getDuration() { const d = this.video.duration; return Promise.resolve(Number.isFinite(d) ? d : 0); }
  getCurrentTime() { return Promise.resolve(this._seekPendiente ?? this.video.currentTime); }
  // Sincrónico, para pasarle a la TV el segundo EXACTO: el último timeupdate que vio
  // el componente puede estar ~250 ms atrás. Durante un cambio de fuente, su segundo
  // (el <video> pasa por 0 mientras recarga).
  tiempo() { return this._cambio ? this._cambio.t : (this._seekPendiente ?? this.video.currentTime); }
  setCurrentTime(t) {
    const v = this.video;
    const destino0 = Math.max(0, Number(t) || 0);
    // Sin metadata, Safari descarta el seek: guardarlo y aplicarlo al llegar.
    // El timeupdate sintético deja al componente con la posición correcta, así
    // no guarda 0 si el alumno se va antes de que cargue.
    if (v.readyState < 1) {
      this._seekPendiente = destino0;
      if (this._cambio) this._cambio.t = destino0;   // el cambio de calidad aterriza acá
      if (this._sinConfirmar) this._sinConfirmar.t = destino0;   // y si falla, se vuelve acá
      queueMicrotask(() => this._emit("timeupdate", { seconds: destino0, duration: 0, percent: 0 }));
      return Promise.resolve(destino0);
    }
    const d = v.duration;
    const destino = Number.isFinite(d) && d > 0 ? Math.min(d - 0.05, destino0) : destino0;
    if (this._cambio) this._cambio.t = destino;
    if (this._sinConfirmar) this._sinConfirmar.t = destino;
    v.currentTime = destino;
    // Después de 'ended' hls.js quedó detenido (stopLoad) y el principio ya no
    // está en el buffer: sin esto el seek no terminaba nunca (ni 'seeked' ni
    // timeupdate) y el reloj, la transcripción y el avance quedaban en el final.
    // Pausado alcanza con un segmento; el listener de 'play' sube el buffer.
    if (this.hls && this._detenido) {
      this._detenido = false;
      this.hls.config.maxBufferLength = BUFFER_INICIAL;
      this.hls.config.maxMaxBufferLength = BUFFER_INICIAL;
      this.hls.startLoad(destino);
    }
    return Promise.resolve(destino);
  }

  // La TV (Chromecast) tomó la reproducción: el <video> queda en pausa y sin bajar
  // nada, pero VIVO, así la vuelta al celular es inmediata. play() y
  // setCurrentTime() ya saben retomar la carga (ver _detenido).
  detenerCarga() {
    if (this.hls && !this._detenido) { this.hls.stopLoad(); this._detenido = true; }
  }

  getVolume() { return Promise.resolve(this.video.volume); }
  setVolume(vol) {
    const x = Math.max(0, Math.min(1, Number(vol) || 0));
    try { this.video.volume = x; } catch (e) {}   // iOS: el volumen es de sólo lectura
    // El componente asume que subir el volumen devuelve el sonido y que 0 silencia
    // (con Vimeo era así). En iOS, muted es lo único que de verdad silencia.
    this.video.muted = x === 0;
    return Promise.resolve(x);
  }
  getMuted() { return Promise.resolve(this.video.muted); }
  setMuted(m) { this.video.muted = !!m; return Promise.resolve(!!m); }
  setPlaybackRate(r) {
    this.video.defaultPlaybackRate = r;   // sobrevive a un load() de recuperación
    this.video.playbackRate = r;
    return Promise.resolve(r);
  }

  // Los subtítulos los dibuja el SubtitleDisplay propio (config.subtitlesUrl,
  // p. ej. el captions/es.vtt de Bunny), así que el video no expone pistas.
  getTextTracks() { return Promise.resolve([]); }
  enableTextTrack() { return Promise.resolve(); }
  disableTextTrack() { return Promise.resolve(); }

  // --- Calidad --------------------------------------------------------------
  // Misma forma que el SDK de Vimeo, así el mismo menú sirve con los dos:
  //   getQualities() → [{ id:'1080p', label:'1080p', active }, …, { id:'auto', label:'Automática', active }]
  //   getQuality() / setQuality(id) y el evento 'qualitychange' { quality, viendo }.
  // En automático la maneja hls.js (ABR + capLevelToPlayerSize, que sube sola al
  // pasar a pantalla completa): el componente NO fija calidades al entrar en
  // pantalla completa con video propio (ver el efecto en InteractiveVideoPlayer).
  // Lo que se ofrece es sólo lo que de verdad se puede elegir en este motor; si no
  // hay nada (MP4, master con audio aparte, una sola variante), la lista es [].
  _altos() {
    if (this.hls) {
      const set = new Set();
      (this.hls.levels || []).forEach((l) => { const a = altoDe(l.width, l.height); if (a) set.add(a); });
      const lista = [...set].sort((a, b) => b - a);
      return lista.length >= 2 ? lista : [];
    }
    if (this.motor === "nativo") {
      if (this._variantes == null) this._leerVariantes();
      return (this._variantes || []).map((x) => x.alto);
    }
    return [];
  }

  // Índice de hls.levels para un alto (el de más bitrate si hubiera dos). Se busca
  // cada vez: los índices cambian si hls.js descarta un nivel (removeLevel).
  // (Sin findLastIndex: es de Safari 15.4 y la app de Moodle soporta iOS 15.)
  _indiceDeAlto(alto) {
    let i = -1, mejor = -1;
    (this.hls?.levels || []).forEach((l, k) => {
      if (altoDe(l.width, l.height) === alto && (l.bitrate || 0) > mejor) { mejor = l.bitrate || 0; i = k; }
    });
    return i;
  }

  _emitirCalidad() { this._emit("qualitychange", { quality: this._calidad, viendo: this._viendo }); }

  // 🔴 hls.js vuelve SOLO a automático ante un error de fragmento o de playlist con
  // un nivel fijo (preserveManualLevelOnError viene en false, y está bien: con mala
  // señal es mejor bajar que cortarse). Que el menú lo diga en vez de seguir
  // mostrando "1080p".
  _revisarVueltaAAuto() {
    if (this._altoPedido != null && this.hls && this.hls.autoLevelEnabled) {
      this._altoPedido = null;
      this._calidad = "auto";
      this._emitirCalidad();
    }
  }

  _leerVariantes() {
    if (this._variantesPromesa) return this._variantesPromesa;
    // El master pesa menos de 1 KB y Bunny lo sirve con CORS abierto. Si no se puede
    // leer, no hay menú de calidad: el video sigue en automático como siempre.
    this._variantesPromesa = fetch(this.src, { credentials: "omit" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((txt) => variantesDelMaster(txt, this.src))
      .catch(() => [])
      .then((vs) => { this._variantes = vs; this._actualizarViendo(true); return vs; });
    return this._variantesPromesa;
  }

  // Sin hls.js lo que se ve sale del tamaño del cuadro decodificado. Se lo lleva a
  // la variante más cercana: Chrome informa 481 de alto para la de 480 (854×480
  // del master), y el menú decía "Automática (481p)".
  _actualizarViendo(avisarIgual = false) {
    const v = this.video;
    let a = altoDe(v.videoWidth, v.videoHeight);
    if (a) {
      let cerca = null;
      (this._variantes || []).forEach((x) => {
        const d = Math.abs(x.alto - a);
        if (d <= 8 && (cerca == null || d < Math.abs(cerca - a))) cerca = x.alto;
      });
      if (cerca) a = cerca;
      v.dataset.nivel = String(a);
    }
    if (a && a !== this._viendo) { this._viendo = a; this._emitirCalidad(); }
    else if (avisarIgual) this._emitirCalidad();
  }

  getQualities() {
    const altos = this._altos();
    if (!altos.length) return Promise.resolve([]);
    return Promise.resolve([
      ...altos.map((a) => ({ id: `${a}p`, label: `${a}p`, active: this._calidad === `${a}p` })),
      { id: "auto", label: "Automática", active: this._calidad === "auto" },
    ]);
  }
  getQuality() { return Promise.resolve(this._calidad); }

  // 🔴 Llamarla DENTRO del toque del menú, sin await antes: con el HLS nativo
  // retoma con video.play(), y iOS sólo lo permite dentro de un gesto.
  setQuality(id) {
    id = String(id || "auto");
    if (this._error) return Promise.resolve(this._calidad);
    if (this.hls) return Promise.resolve(this._calidadHls(id));
    if (this.motor === "nativo") {
      // Un cambio por vez: el pedido que llega en el medio se aplica al terminar.
      if (this._cambio) { this._calidadEnCola = id; return Promise.resolve(id); }
      if (id === this._calidad) return Promise.resolve(id);
      const url = id === "auto" ? this.src : (this._variantes || []).find((x) => `${x.alto}p` === id)?.url;
      if (!url) return Promise.resolve(this._calidad);
      this._cambiarFuente(url, id);
      return Promise.resolve(id);
    }
    return Promise.resolve(this._calidad);
  }

  // hls.js: ninguna de estas formas mueve currentTime, así que el candado de
  // preguntas no se entera. Por eso tampoco se marca como salto propio: si
  // gap-controller "salta un hueco" después de vaciar el buffer, la guardia de
  // saltos del componente sigue mirando.
  _calidadHls(id) {
    const hls = this.hls;
    if (id === "auto") {
      this._altoPedido = null;
      this._calidad = "auto";
      // 🔴 NUNCA -1 si ya está en automático: el primer uso del setter de
      // manualLevel fija startLevel, y con -1 el próximo arranque sin fragmentos
      // (recoverMediaError) haría la prueba de ancho de banda en 240p que
      // ARRANQUE_BPS evita. nextLevel y no currentLevel: bajar no necesita cortar.
      if (!hls.autoLevelEnabled) hls.nextLevel = -1;
    } else {
      const alto = parseInt(id, 10);
      const i = this._indiceDeAlto(alto);
      if (i < 0) return this._calidad;
      this._altoPedido = alto;
      this._calidad = `${alto}p`;
      if (hls.manualLevel !== i) {
        // SUBIR: currentLevel, que vacía el buffer y vuelve a bajar desde el
        // segundo actual. Se ve enseguida (como YouTube), con una ruedita breve:
        // quien pide más calidad la quiere ver ya, no dentro de 8 s. BAJAR:
        // nextLevel, que conserva el fragmento en curso y no corta; si baja porque
        // se traba, no conviene tirar lo que ya llegó. (loadLevel recién entraba
        // al acabarse el buffer: hasta 30 s, parecía que no había andado.)
        const subir = !(this._viendo > 0) || alto > this._viendo;
        if (subir) hls.currentLevel = i;
        else hls.nextLevel = i;
      }
    }
    this._emitirCalidad();
    return this._calidad;
  }

  // HLS nativo (Safari/iPhone): cambiar de calidad es cambiar de FUENTE (la
  // playlist de la variante, o el master para volver a automático) y volver al
  // mismo segundo y al mismo estado. Medido en Chrome con HLS nativo (oct-2026):
  // al asignar src, currentTime pasa a 0 en el mismo tick; ~190 ms después llega
  // loadedmetadata (todavía en 0), ahí se salta a t y ~700 ms después llega
  // seeked. La velocidad sobrevive por defaultPlaybackRate; muted y volumen son
  // del elemento y no se tocan con la carga.
  // Mientras dura, los eventos del <video> no salen (ver _conectarEventos):
  // getCurrentTime() y _datos() siguen diciendo t gracias a _seekPendiente (y,
  // después de loadedmetadata, porque currentTime ya es t). No se marca como
  // salto propio: si iOS aterriza más allá de t y cruza una pregunta, la guardia
  // de saltos del componente la frena.
  // Una variante fija no tiene ABR: con mala señal se corta en vez de bajar.
  // Por eso la elección no se recuerda entre videos.
  _cambiarFuente(url, id) {
    const v = this.video;
    const t = this._seekPendiente ?? v.currentTime;
    // A dónde volver si la nueva falla: la última fuente que MOSTRÓ imagen. Si la
    // actual todavía no lo hizo (un cambio anterior que se pasó del tope), la de
    // antes de ella: volver a una variante que tampoco cargó sería fallar dos veces.
    const previa = this._sinConfirmar || { anterior: this._srcActual, calidadAnterior: this._calidad };
    const anterior = previa.anterior, calidadAnterior = previa.calidadAnterior;
    const seguia = !v.paused;
    this._sinConfirmar = { anterior, calidadAnterior, t, seguia };
    this._calidad = id;
    this._srcActual = url;
    // Sin metadata todavía (iOS no baja nada hasta el primer toque): no hay ningún
    // segundo que cuidar. Se cambia la fuente y el salto pendiente sigue.
    // 🔴 Pero sin metadata NO quiere decir en pausa: después del tope de un cambio
    // lento (ver _vencioCambio) el play puede seguir pendiente, con el botón en
    // "Pausar". Asignar src pausa el <video> (algoritmo de carga) y su 'emptied'
    // le avisaba la pausa al componente: el video se cortaba solo. Se retoma en el
    // mismo tick, como en el cambio con metadata; si iOS rechaza ese play (fuera
    // del toque), el 'emptied' avisa la pausa y aparece el botón grande.
    if (v.readyState < 1) {
      if (t > 0) this._seekPendiente = t;
      v.src = url;
      if (seguia) v.play().catch(() => {});
      this._emitirCalidad();
      return;
    }
    this._cambio = { t, seguia, anterior, calidadAnterior, saltos: 0, revirtiendo: false, pausadoPorMi: false };
    this._cambio.timer = setTimeout(() => this._vencioCambio(), CAMBIO_TOPE_MS);
    // Sin póster: al cargar la fuente nueva el navegador lo vuelve a mostrar hasta
    // el salto, y la miniatura del principio parece "volvió al comienzo".
    if (t > 0.5 && v.getAttribute("poster")) v.removeAttribute("poster");
    this._emit("bufferstart", this._datos());   // la ruedita mientras recarga
    this._seekPendiente = t;                     // ANTES del src: lo aplica loadedmetadata
    v.src = url;
    // En el MISMO toque del menú: fuera del gesto iOS rechaza el play. Si igual lo
    // rechaza (modo de bajo consumo), al terminar se avisa la pausa y aparece el
    // botón grande.
    if (seguia) v.play().catch(() => {});
    this._emitirCalidad();
  }

  // ¿Volvió a su segundo? Se llama en 'seeked' y en 'canplay' durante un cambio.
  _quizasTerminarCambio(porSeeked) {
    const c = this._cambio, v = this.video;
    if (!c || this._seekPendiente != null || v.seeking) return;
    if (!porSeeked && v.readyState < 2) return;
    // Aterrizó lejos (algunas versiones de iOS descartan el salto hecho en
    // loadedmetadata con HLS): pedirlo otra vez, como seekTo.
    if (Math.abs(v.currentTime - c.t) > 1 && this._volverASaltar(c)) return;
    this._terminarCambio();
  }

  // Vuelve a pedir el salto a c.t, hasta SALTOS_CAMBIO veces. Devuelve false si ya
  // no quedan intentos.
  // 🔴 Desde el SEGUNDO pedido pausa el <video> sin avisar al componente. Si iOS
  // descarta también el reintento, 'seeked' no llega, 'canplay' ya pasó y nada
  // vuelve a mirar: el medio corría desde 0 —con sonido— detrás de la ruedita
  // hasta el tope de 12 s (simulado en Chrome, oct-2026). El candado no se rompía
  // (los eventos no salen), pero el alumno veía y escuchaba el principio. El play
  // lo devuelve _terminarCambio, si el alumno no pausó en el medio (c.seguia).
  _volverASaltar(c) {
    const v = this.video;
    if (c.saltos >= SALTOS_CAMBIO) return false;
    c.saltos++;
    if (c.saltos > 1 && !v.paused) { c.pausadoPorMi = true; v.pause(); }
    v.currentTime = c.t;
    // Si este también se descarta tampoco llega 'seeked', y en pausa no hay
    // timeupdate que avise: revisar igual en un rato.
    clearTimeout(c.vigia);
    c.vigia = setTimeout(() => { if (this._cambio === c) this._vigilarCambio(); }, VIGIA_MS);
    return true;
  }

  // Durante un cambio, después de un salto pedido de nuevo: ¿el medio sigue lejos
  // de su segundo? (lo llaman los timeupdate del cambio y el vigía). Antes del
  // primer reintento no hace nada: el camino normal lo cierran 'seeked'/'canplay'.
  _vigilarCambio() {
    const c = this._cambio, v = this.video;
    if (!c || !c.saltos || this._seekPendiente != null || v.seeking || v.readyState < 1) return;
    if (Math.abs(v.currentTime - c.t) <= 1) {
      // Ya está: si el 'seeked' de ese salto no llegó a cerrarlo, cerrarlo acá.
      if (v.readyState >= 2) this._terminarCambio();
      return;
    }
    if (!this._volverASaltar(c) && !v.paused) { c.pausadoPorMi = true; v.pause(); }
  }

  _vencioCambio() {
    const c = this._cambio, v = this.video;
    if (!c) return;
    // No llegó a aterrizar. Si ya hay metadata, pedir el salto otra vez; si no, el
    // _seekPendiente sigue puesto y lo aplica loadedmetadata cuando llegue. En los
    // dos casos el componente sigue viendo t, nunca el 0 del medio cargando.
    // (Si la fuente nueva falla después de esto, _sinConfirmar vuelve a la anterior.)
    if (v.readyState >= 1 && this._seekPendiente == null && Math.abs(v.currentTime - c.t) > 1) v.currentTime = c.t;
    this._terminarCambio();
  }

  _terminarCambio() {
    const c = this._cambio, v = this.video;
    if (!c) return;
    clearTimeout(c.timer);
    clearTimeout(c.vigia);
    this._cambio = null;
    // Lo había pausado _volverASaltar, no el alumno: retomar.
    if (c.pausadoPorMi && c.seguia && v.paused) v.play().catch(() => {});
    // El estado final, de una sola vez: dónde quedó, si sigue o no reproduciendo
    // (el play pudo rechazarse) y la ruedita apagada si ya hay datos para seguir.
    if (v.readyState >= 1 || this._seekPendiente != null) this._emit("timeupdate", this._datos());
    if (v.paused !== this._pausadoVisto) this._emit(v.paused ? "pause" : "play", this._datos());
    if (v.paused || v.readyState >= 3) this._emit("bufferend", this._datos());
    this._emitirCalidad();
    const q = this._calidadEnCola;
    this._calidadEnCola = null;
    if (q != null && q !== this._calidad) this.setQuality(q);
  }

  // La variante no cargó (red, token): volver a la fuente de antes, en el mismo
  // segundo. Sólo si eso también falla es un error definitivo.
  _fallaCambio() {
    const c = this._cambio, v = this.video;
    if (!c) return;
    if (c.revirtiendo) {
      clearTimeout(c.timer);
      clearTimeout(c.vigia);
      this._cambio = null;
      return this._fallar("medio", { message: v.error?.message || "error de video" });
    }
    this._revertir(c);
  }

  // La variante falló DESPUÉS del tope de 12 s, sin haber mostrado ningún cuadro:
  // el cambio ya se había cerrado, pero la vuelta es la misma. Se abre un cambio
  // nuevo para que la caída a 0 de la recarga tampoco le llegue al componente.
  // Sin cuadros no hubo reproducción: el segundo es el del cambio (o el del último
  // salto pedido, ver setCurrentTime), y si seguía o no es lo último que pidió el
  // componente (play/pause), no v.paused, que el navegador puede tocar al fallar.
  _revertirSinConfirmar() {
    const x = this._sinConfirmar;
    this._revertir({ t: x.t, seguia: x.seguia, anterior: x.anterior, calidadAnterior: x.calidadAnterior });
    this._emit("bufferstart", this._datos());   // la ruedita mientras recarga la anterior
  }

  // Vuelve a la fuente anterior en c.t, con los eventos retenidos como en un cambio.
  // La anterior ya mostró imagen: si también falla (c.revirtiendo), es definitivo.
  _revertir(c) {
    const v = this.video;
    clearTimeout(c.timer);
    clearTimeout(c.vigia);
    this._sinConfirmar = null;
    c.revirtiendo = true;
    c.saltos = 0;
    c.pausadoPorMi = false;   // la recarga reinicia el estado: decide c.seguia
    this._cambio = c;
    c.timer = setTimeout(() => this._vencioCambio(), CAMBIO_TOPE_MS);
    this._calidad = c.calidadAnterior;
    this._srcActual = c.anterior;
    this._seekPendiente = c.t;
    v.src = c.anterior;
    if (c.seguia) v.play().catch(() => {});
    this._emitirCalidad();
  }

  // --- AirPlay (sólo WebKit de Apple) ------------------------------------------
  // Con AirPlay el <video> SIGUE siendo el dueño: play, pausa y saltos van a la TV
  // por el mismo elemento, y lo que pasa en la TV (el control del Apple TV, el
  // Centro de control) vuelve como sus eventos de siempre (play/pause/timeupdate).
  // Por eso el candado de preguntas no necesita nada: lo único nuevo es el botón y
  // avisarle al componente el estado ('remotechange' { disponible, estado }).
  // Se usa la Remote Playback API estándar (Safari 13.1 / iOS 13.4) y, si no está
  // (Modo Aislamiento la apaga), las webkit* de siempre.
  // 🔴 Sólo en WebKit: en Chrome `video.remote` también existe pero transmite a
  // CHROMECAST, y eso lo maneja cast.js con su propio receptor.
  // 🔴 hls.js con ManagedMediaSource (?motor=hls en Apple) pone
  // disableRemotePlayback y AirPlay queda apagado: no se ofrece. No hay "parche":
  // agregar un <source> HLS después de attachMedia lo deshace la recuperación
  // interna de hls.js (MEDIA_SOURCE_REQUIRES_RESET → recoverMediaError).
  _iniciarAirPlay() {
    this._airplay = { disponible: false, estado: "disconnected", id: null, oyentes: [], porWatch: false, porEvento: false };
    const v = this.video, a = this._airplay;
    // Diagnóstico (data-airplay-*): lo lee el recuadro ?diag=1 de las páginas de prueba.
    // En un iPhone no hay consola a mano, y "no aparece el botón" puede ser la TV, la
    // red o el navegador: esto dice cuál.
    const diag = (k, val) => { try { v.dataset[k] = val; } catch (e) {} };
    if (typeof window === "undefined" || !window.WebKitPlaybackTargetAvailabilityEvent) { diag("airplayApi", "no"); return; }
    diag("airplayApi", v.remote && typeof v.remote.watchAvailability === "function" ? "remote+webkit" : "webkit");
    const avisar = () => this._emit("remotechange", this._estadoAirPlay());
    const escuchar = (obj, ev, fn) => { obj.addEventListener(ev, fn); a.oyentes.push([obj, ev, fn]); };
    const recalcular = () => { a.disponible = a.porWatch || a.porEvento; avisar(); };
    // 🔴 Las DOS fuentes de disponibilidad, siempre. En iPhone watchAvailability puede
    // rechazar con NotSupportedError (la spec lo permite donde vigilar todo el tiempo
    // gasta batería) o no avisar nunca; cuando se escuchaba sólo esa, el botón no
    // aparecía aunque hubiera un Apple TV al lado (prueba de Erick, oct-2026). El
    // evento webkit* de siempre sí avisa en iOS.
    escuchar(v, "webkitplaybacktargetavailabilitychanged", (e) => {
      a.porEvento = e.availability === "available";
      diag("airplayEvento", e.availability || "?");
      recalcular();
    });
    escuchar(v, "webkitcurrentplaybacktargetiswirelesschanged", () => {
      a.estado = v.webkitCurrentPlaybackTargetIsWireless ? "connected" : "disconnected";
      if (a.estado === "connected") this._alConectarAirPlay();
      avisar();
    });
    const r = v.remote;
    if (r && typeof r.watchAvailability === "function") {
      escuchar(r, "connecting", () => { a.estado = "connecting"; avisar(); });
      escuchar(r, "connect", () => { a.estado = "connected"; this._alConectarAirPlay(); avisar(); });
      escuchar(r, "disconnect", () => { a.estado = "disconnected"; avisar(); });
      if (v.disableRemotePlayback) { diag("airplayWatch", "apagado (motor hls)"); return; }
      // Sin esto prompt() rechaza siempre (WebKit arranca con m_available en false).
      // Apple pide escuchar sólo mientras haga falta (batería): se cancela en destroy().
      r.watchAvailability((disp) => { a.porWatch = !!disp; diag("airplayWatch", disp ? "hay TV" : "sin TV"); recalcular(); })
        .then((id) => { if (this.video) a.id = id; }, (err) => { a.watchFallo = true; diag("airplayWatch", "error " + ((err && err.name) || "")); });
    }
  }

  _estadoAirPlay() {
    return { disponible: this.transmisionDisponible(), estado: this._airplay ? this._airplay.estado : "disconnected" };
  }

  // ¿Este navegador puede transmitir por AirPlay? (aunque ahora no haya una TV).
  airplayPosible() {
    return !!(this._airplay && typeof window !== "undefined" && window.WebKitPlaybackTargetAvailabilityEvent && !this.video.disableRemotePlayback);
  }

  transmisionDisponible() {
    return !!(this._airplay && this._airplay.disponible && !this.video.disableRemotePlayback);
  }

  // Con una variante fija (calidad elegida a mano en el HLS nativo) la TV recibiría
  // ESA playlist sola, sin ABR, y el menú de Calidad no se ve mientras se transmite:
  // se vuelve a automático (el master). En iPhone/iPad ya se hizo antes del
  // selector (ver transmitir); esto cubre la Mac.
  _alConectarAirPlay() {
    if (this.motor === "nativo" && this._calidad !== "auto") this.setQuality("auto");
  }

  // Abre el selector de AirPlay. 🔴 Llamarla DENTRO del toque y SIN await antes:
  // prompt() toma el gesto en el momento de la llamada (RemotePlayback.cpp), igual
  // que setQuality con el HLS nativo. Cerrar el selector sin elegir rechaza con
  // NotAllowedError: el estado lo dan los eventos, no esta promesa.
  transmitir() {
    const v = this.video;
    const a = this._airplay;
    // Se intenta SIEMPRE: el botón está siempre a la vista y el selector del sistema es
    // el que muestra qué TVs hay (o que no hay ninguna).
    if (!a || !this.airplayPosible()) return Promise.resolve(false);
    try {
      // En iPhone/iPad prompt() no pide metadata, así que el master puede ir ANTES
      // del selector: la TV arranca con ABR y no hay que recargar en plena
      // transmisión. En la Mac sí la pide (readyState ≥ HAVE_METADATA): ahí se
      // cambia al conectar.
      const previa = this._calidad;
      const alMaster = esIOS() && this.motor === "nativo" && previa !== "auto" && a.estado === "disconnected";
      if (alMaster) this.setQuality("auto");
      // Si la TV la avisó sólo el evento webkit (watchAvailability falló o no avisó),
      // prompt() rechazaría: ahí va el selector webkit de siempre.
      const usarPrompt = v.remote && typeof v.remote.prompt === "function" && (a.porWatch || a.estado !== "disconnected");
      if (!usarPrompt && typeof v.webkitShowPlaybackTargetPicker === "function") { v.webkitShowPlaybackTargetPicker(); return Promise.resolve(true); }
      if (v.remote && typeof v.remote.prompt === "function") {
        return v.remote.prompt().then(() => true, () => {
          // 🔴 Cerró el selector sin elegir TV: se vuelve a la calidad que había fijado.
          // Si no, quedaba en Automática sin haberlo pedido (con datos móviles, puede
          // subir a 1080p). Fuera del toque: si iOS rechaza el play del cambio, queda
          // en pausa con el botón grande, como cualquier cambio de calidad que falla.
          if (alMaster && this._airplay && this._airplay.estado === "disconnected" && this._calidad === "auto") this.setQuality(previa);
          return false;
        });
      }
      if (typeof v.webkitShowPlaybackTargetPicker === "function") { v.webkitShowPlaybackTargetPicker(); return Promise.resolve(true); }
    } catch (e) {}
    return Promise.resolve(false);
  }

  destroy() {
    clearTimeout(this._readyFallback);
    clearTimeout(this._tReintento);
    if (this._airplay) {
      try { if (this._airplay.id != null) this.video.remote.cancelWatchAvailability(this._airplay.id); } catch (e) {}
      this._airplay.oyentes.forEach(([o, ev, fn]) => { try { o.removeEventListener(ev, fn); } catch (e) {} });
      this._airplay = null;
    }
    this._sinConfirmar = null;
    if (this._cambio) { clearTimeout(this._cambio.timer); clearTimeout(this._cambio.vigia); this._cambio = null; }
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
    this.handlers = {};
    return Promise.resolve();
  }
}
