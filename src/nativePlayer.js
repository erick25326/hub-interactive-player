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
// 🔴 hls.js COMPLETO, no "hls.js/light": Bunny entrega el audio en una pista
// aparte (#EXT-X-MEDIA:TYPE=AUDIO) y el build light no la carga. Con light el
// video de Bunny se veía MUDO en Android (verificado contra un playlist real).

import Hls from "hls.js";

const HLS_MIME = "application/vnd.apple.mpegurl";
// Calidad de arranque: hls.js por defecto estima 500 kbps y empieza en 240p, que
// se ve feo los primeros segundos. Bunny declara para 480p un PICO (BANDWIDTH)
// de ~2,4 Mbps (promedio ~1,4) y hls.js elige por el pico con margen: con 3 Mbps
// arranca en 480p; con 1,6 arrancaba en 360p. La ABR baja sola si no alcanza.
// OJO: no poner `startLevel: -1`, que dispara una prueba de ancho de banda en
// 240p y anula esta estimación.
const ARRANQUE_BPS = 3_000_000;
// Buffer: hasta el primer play se baja sólo un segmento (6 s de Bunny), para que
// abrir la lección sin mirar no gaste datos. Reproduciendo, 30 s. Hace falta
// maxMaxBufferLength: sin él hls.js calcula el objetivo con maxBufferSize (60 MB)
// y precargaba varios minutos.
const BUFFER_INICIAL = 6;
const BUFFER_REPRODUCIENDO = 30;
const MAX_REINTENTOS_RED = 3;

const esHls = (src) => /\.m3u8(\?|#|$)/i.test(src) || /\/playlist\.m3u8/i.test(src);

// WebKit de Apple (Safari de escritorio y cualquier navegador en iOS/iPadOS).
function esApple() {
  const ua = navigator.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safariMac = /^((?!chrome|chromium|crios|fxios|android|edg).)*safari/i.test(ua);
  return ios || safariMac;
}

export default class NativePlayer {
  constructor(el, { src, poster } = {}) {
    this.handlers = {};
    this.hls = null;
    this.src = src;
    this._error = null;           // error fatal ya emitido (se re-entrega a quien se suscriba tarde)
    this._seekPendiente = null;   // posición pedida antes de que llegara la metadata
    this._reintentosRed = 0;
    this._tReintento = null;
    this._tRecover = -Infinity;
    this._swapHecho = false;
    this._detenido = false;       // hls.stopLoad() después de 'ended'

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
  }

  _cargar() {
    const v = this.video, src = this.src;
    if (!src) return this._fallar("sin-fuente", { details: "Falta la URL del video" });
    if (!esHls(src)) { v.src = src; return; }      // MP4 directo
    if (esApple() && v.canPlayType(HLS_MIME)) { v.src = src; return; }
    if (Hls.isSupported()) {
      const hls = new Hls({
        abrEwmaDefaultEstimate: ARRANQUE_BPS,
        capLevelToPlayerSize: true,   // no bajar 1080p para una ventana chica
        // Un celular de densidad 3 pedía 1080p para un video de 375 px de ancho.
        // Con tope 2: 720p en la vista normal y 1080p en pantalla completa.
        maxDevicePixelRatio: 2,
        maxBufferLength: BUFFER_INICIAL,
        maxMaxBufferLength: BUFFER_INICIAL,
        backBufferLength: 30,         // celulares con poca memoria
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { this._reintentosRed = 0; });
      hls.on(Hls.Events.ERROR, (_e, data) => this._errorHls(data));
      hls.loadSource(src);
      hls.attachMedia(v);
      this.hls = hls;
      return;
    }
    if (v.canPlayType(HLS_MIME)) { v.src = src; return; }   // último recurso
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
    if (this.hls) this.hls.stopLoad();
    this._error = { fatal: true, tipo, code: data?.response?.code ?? null, message: data?.details || data?.message || tipo };
    this._resolverReady?.();
    this._emit("error", this._error);
  }

  _conectarEventos() {
    const v = this.video;
    const datos = () => ({
      seconds: this._seekPendiente ?? v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      percent: v.duration ? v.currentTime / v.duration : 0,
    });
    // Sin datos (readyState 0: recién cargando o recuperándose) el currentTime es
    // 0 aunque el alumno esté en el minuto 3: no reenviarlo o se guarda 0.
    v.addEventListener("timeupdate", () => { if (v.readyState) this._emit("timeupdate", datos()); });
    v.addEventListener("play", () => {
      // Recién al reproducir se llena el buffer de verdad (ver BUFFER_INICIAL).
      if (this.hls) { this.hls.config.maxBufferLength = BUFFER_REPRODUCIENDO; this.hls.config.maxMaxBufferLength = BUFFER_REPRODUCIENDO; }
      this._emit("play", datos());
    });
    v.addEventListener("pause", () => this._emit("pause", datos()));
    // load() (que hace hls.js al recuperarse) pausa sin disparar 'pause': avisar.
    v.addEventListener("emptied", () => { if (v.paused) this._emit("pause", datos()); });
    v.addEventListener("ended", () => {
      // Terminó: dejar de bajar. Si no, al volver a 0 (lo hace el componente)
      // hls.js volvía a llenar el buffer con un video que ya se vio.
      if (this.hls) { this.hls.stopLoad(); this._detenido = true; }
      this._emit("ended", datos());
    });
    v.addEventListener("seeked", () => this._emit("seeked", datos()));
    v.addEventListener("durationchange", () => this._emit("durationchange", datos()));
    v.addEventListener("loadedmetadata", () => {
      if (this._seekPendiente == null) return;
      const d = v.duration, t = this._seekPendiente;
      this._seekPendiente = null;
      v.currentTime = Number.isFinite(d) && d > 0 ? Math.min(d - 0.05, t) : t;
    });
    // Equivalentes de bufferstart / bufferend de Vimeo
    v.addEventListener("waiting", () => this._emit("bufferstart", datos()));
    v.addEventListener("playing", () => this._emit("bufferend", datos()));
    v.addEventListener("canplay", () => this._emit("bufferend", datos()));
    // Con hls.js los errores del <video> los maneja hls.js (y los reintenta);
    // sólo con la fuente directa (HLS nativo de Apple o MP4) son definitivos.
    v.addEventListener("error", () => { if (!this.hls) this._fallar("medio", { message: v.error?.message || "error de video" }); });
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

  _emit(evento, datos) { (this.handlers[evento] || []).forEach((h) => { try { h(datos); } catch (e) {} }); }

  // --- API estilo @vimeo/player ---------------------------------------------
  on(evento, h) {
    (this.handlers[evento] ||= []).push(h);
    // Un error que pasó antes de suscribirse igual le llega.
    if (evento === "error" && this._error) { const e = this._error; queueMicrotask(() => h(e)); }
  }
  off(evento, h) { this.handlers[evento] = (this.handlers[evento] || []).filter((x) => x !== h); }
  ready() { return this._readyPromise; }

  play() {
    if (this._error) return Promise.reject(new Error(this._error.message));
    if (this.hls && this._detenido) { this._detenido = false; this.hls.startLoad(this.video.currentTime); }
    return this.video.play();
  }
  pause() { this.video.pause(); return Promise.resolve(); }
  getPaused() { return Promise.resolve(this.video.paused); }

  getDuration() { const d = this.video.duration; return Promise.resolve(Number.isFinite(d) ? d : 0); }
  getCurrentTime() { return Promise.resolve(this._seekPendiente ?? this.video.currentTime); }
  setCurrentTime(t) {
    const v = this.video;
    const destino0 = Math.max(0, Number(t) || 0);
    // Sin metadata, Safari descarta el seek: guardarlo y aplicarlo al llegar.
    // El timeupdate sintético deja al componente con la posición correcta, así
    // no guarda 0 si el alumno se va antes de que cargue.
    if (v.readyState < 1) {
      this._seekPendiente = destino0;
      queueMicrotask(() => this._emit("timeupdate", { seconds: destino0, duration: 0, percent: 0 }));
      return Promise.resolve(destino0);
    }
    const d = v.duration;
    const destino = Number.isFinite(d) && d > 0 ? Math.min(d - 0.05, destino0) : destino0;
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

  // La calidad la maneja hls.js sola (ABR + capLevelToPlayerSize, que sube al
  // pasar a pantalla completa). No exponer calidades evita que el componente la
  // FIJE en pantalla completa, que con datos móviles congelaba la imagen.
  getQualities() { return Promise.resolve([]); }
  setQuality() { return Promise.resolve(); }

  destroy() {
    clearTimeout(this._readyFallback);
    clearTimeout(this._tReintento);
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
    this.handlers = {};
    return Promise.resolve();
  }
}
