// Copia, para la suite (tests/navegador), del simulado con que se verificó la etapa
// 3 de la TV (oct-2026). Lo inyecta el servidor de pruebas con ?cast=fake. No es el
// SDK de Google ni lo reemplaza: imita sólo lo que usa src/cast.js, con latencia.
//
// Receptor de Cast SIMULADO: un falso `cast.framework` + `chrome.cast` con la forma
// del Web Sender SDK 1.0.15 (lo que usa src/cast.js), y una "TV" que corre sola.
// Se inyecta ANTES del reproductor. Parámetros (query de la página):
//   lat=120      latencia de UNA vía celular↔TV en ms
//   hayTV=0      CastState NO_DEVICES_AVAILABLE (el botón está igual; requestSession falla)
//   reanudar=70  al llamar setOptions, aparece una sesión REANUDADA con este video en 70 s, reproduciendo
//   ajeno=1      …pero con OTRO video cargado
//   nombre=…     friendlyName (se entrega escapado como HTML, como el SDK real)
// Control remoto de la TV (window.__tv.remoto): adelantar(s), irA(t), play(), pause(),
// parar() (CANCELLED), cortarSesion() (Google Home "dejar de transmitir"), otroVideo().
(() => {
  const q = new URLSearchParams(location.search);
  const LAT = Number(q.get('lat') || 120);
  const T = window.__tv = { log: [], lat: LAT, gestos: [], nombre: q.get('nombre') || 'Living & Comedor' };
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const anotar = (ev, extra = {}) => T.log.push({ ms: ms(), ev, ...extra });
  const demora = (fn, d = LAT) => setTimeout(fn, d);

  const PlayerState = { IDLE: 'IDLE', PLAYING: 'PLAYING', PAUSED: 'PAUSED', BUFFERING: 'BUFFERING' };
  const IdleReason = { CANCELLED: 'CANCELLED', INTERRUPTED: 'INTERRUPTED', FINISHED: 'FINISHED', ERROR: 'ERROR' };
  class MediaInfo { constructor(contentId, contentType) { this.contentId = contentId; this.contentType = contentType; this.streamType = 'BUFFERED'; this.duration = null; this.metadata = null; this.customData = null; } }
  class GenericMediaMetadata { constructor() { this.metadataType = 0; this.title = null; this.images = null; } }
  class Image { constructor(url) { this.url = url; } }
  class LoadRequest { constructor(media) { this.type = 'LOAD'; this.media = media; this.autoplay = true; this.currentTime = null; this.playbackRate = 1; } }
  class SeekRequest { constructor() { this.currentTime = null; this.resumeState = null; } }
  class PlayRequest {} class PauseRequest {} class GetStatusRequest {}
  const escapar = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const unescape = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

  window.chrome = window.chrome || {};
  window.chrome.cast = {
    VERSION: [1, 2],
    AutoJoinPolicy: { TAB_AND_ORIGIN_SCOPED: 'tab_and_origin_scoped', ORIGIN_SCOPED: 'origin_scoped', PAGE_SCOPED: 'page_scoped' },
    Image, unescape,
    media: {
      DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
      MediaInfo, GenericMediaMetadata, LoadRequest, SeekRequest, PlayRequest, PauseRequest, GetStatusRequest,
      PlayerState, IdleReason,
      ResumeState: { PLAYBACK_START: 'PLAYBACK_START', PLAYBACK_PAUSE: 'PLAYBACK_PAUSE' },
      StreamType: { BUFFERED: 'BUFFERED', LIVE: 'LIVE', OTHER: 'OTHER' },
      HlsSegmentFormat: { AAC: 'aac', AC3: 'ac3', MP3: 'mp3', TS: 'ts', TS_AAC: 'ts_aac', E_AC3: 'e_ac3', FMP4: 'fmp4' },
      HlsVideoSegmentFormat: { MPEG2_TS: 'mpeg2_ts', FMP4: 'fmp4' },
    },
  };

  // ---- La TV (el receptor) ----------------------------------------------------
  const R = T.receptor = { base: 0, hBase: 0, estado: 'IDLE', rate: 1, media: null, idleReason: null, msid: 0, duracion: 260 };
  R.tiempo = () => R.estado === 'PLAYING' ? Math.min(R.duracion, R.base + (performance.now() - R.hBase) / 1000 * R.rate) : R.base;
  R.fijar = (t, estado) => { R.base = Math.max(0, Math.min(R.duracion, t)); R.hBase = performance.now(); R.estado = estado; };
  R.foto = () => ({ t: +R.tiempo().toFixed(3), estado: R.estado, rate: R.rate, idleReason: R.idleReason, msid: R.msid });
  // Fin del video en la TV.
  setInterval(() => {
    if (R.estado === 'PLAYING' && R.tiempo() >= R.duracion) { R.fijar(R.duracion, 'IDLE'); R.idleReason = 'FINISHED'; anotar('TV fin'); difundir(); }
  }, 30);
  // MEDIA_STATUS hacia el celular (una vía de latencia).
  function difundir(alLlegar) {
    const s = { t: R.tiempo(), estado: R.estado, rate: R.rate, idleReason: R.idleReason, msid: R.msid, media: R.media, h: performance.now() };
    demora(() => { if (sesion) sesion._recibirEstado(s); if (alLlegar) alLlegar(); });
  }

  // ---- El celular (emisor) ------------------------------------------------------
  class Media {
    constructor(s) { this._s = s; this.mediaSessionId = s.msid; this.media = s.media; this.playerState = s.estado; this.currentTime = s.t; this.playbackRate = s.rate; this.idleReason = null; this._oy = []; this._h = performance.now(); }
    addUpdateListener(fn) { this._oy.push(fn); }
    removeUpdateListener(fn) { this._oy = this._oy.filter((x) => x !== fn); }
    getEstimatedTime() { return this.playerState === 'PLAYING' ? this.currentTime + (performance.now() - this._h) / 1000 * this.playbackRate : this.currentTime; }
    supportsCommand() { return true; }
    _cmd(nombre, ok, mal, alRecibir) {
      anotar('CMD ' + nombre, { celular: true });
      demora(() => {
        if (!R.media || R.msid !== this.mediaSessionId || R.estado === 'IDLE') { demora(() => mal && mal({ code: 'session_error' })); return; }
        alRecibir(() => difundir(() => ok && ok()));
      });
    }
    play(req, ok, mal) { this._cmd('play', ok, mal, (resp) => { R.fijar(R.tiempo(), 'PLAYING'); anotar('TV play', R.foto()); resp(); }); }
    pause(req, ok, mal) { this._cmd('pause', ok, mal, (resp) => { R.fijar(R.tiempo(), 'PAUSED'); anotar('TV pause', R.foto()); resp(); }); }
    getStatus(req, ok, mal) { this._cmd('status', ok, mal, (resp) => resp()); }
    seek(req, ok, mal) {
      T.log.push({ ms: ms(), ev: 'CMD seek', t: req.currentTime, resume: req.resumeState });
      demora(() => {
        if (!R.media || R.msid !== this.mediaSessionId || R.estado === 'IDLE') { demora(() => mal && mal({ code: 'session_error' })); return; }
        const antes = R.estado;
        R.fijar(req.currentTime, 'BUFFERING'); anotar('TV seek', { t: req.currentTime, resume: req.resumeState });
        difundir();
        setTimeout(() => {
          const final = req.resumeState === 'PLAYBACK_PAUSE' ? 'PAUSED' : req.resumeState === 'PLAYBACK_START' ? 'PLAYING' : (antes === 'PAUSED' ? 'PAUSED' : 'PLAYING');
          R.fijar(req.currentTime, final); anotar('TV seek listo', R.foto());
          difundir(() => ok && ok());
        }, 250);
      });
    }
    _aplicar(s) {
      this.playerState = s.estado; this.currentTime = s.t; this.playbackRate = s.rate; this.idleReason = s.estado === 'IDLE' ? s.idleReason : null; this._h = performance.now();
      if (s.media && s.media.duration) this.media.duration = s.media.duration;
      const vivo = !(s.estado === 'IDLE' && s.idleReason);
      this._oy.slice().forEach((fn) => { try { fn(vivo); } catch (e) { console.error(e); } });
    }
  }

  let sesion = null;
  class CastSession {
    constructor() { this._oy = {}; this._media = null; this._mute = false; this._vol = 0.4; this._id = 'ses-' + Math.random().toString(36).slice(2); }
    getSessionId() { return this._id; }
    getCastDevice() { return { friendlyName: escapar(T.nombre), receiverType: 'cast', label: 'X' }; }
    getMediaSession() { return this._media; }
    addEventListener(t, fn) { (this._oy[t] ||= []).push(fn); }
    removeEventListener(t, fn) { this._oy[t] = (this._oy[t] || []).filter((x) => x !== fn); }
    _emitir(t, e) { (this._oy[t] || []).slice().forEach((fn) => fn(e)); }
    getVolume() { return this._vol; }
    isMute() { return this._mute; }
    setVolume(v) { anotar('CMD setVolume', { v }); this._vol = v; return Promise.resolve(); }
    setMute(m) { anotar('CMD setMute', { m }); this._mute = m; return Promise.resolve(); }
    sendMessage(ns, msg) {
      T.log.push({ ms: ms(), ev: 'MSG ' + (msg && msg.type), ns, msg });
      if (msg && msg.type === 'SET_PLAYBACK_RATE') demora(() => { const t = R.tiempo(); R.rate = msg.playbackRate; R.fijar(t, R.estado); difundir(); });
      return Promise.resolve();
    }
    loadMedia(req) {
      const dur = (document.querySelector('video') && document.querySelector('video').duration) || 260;
      T.log.push({ ms: ms(), ev: 'CMD LOAD', t: req.currentTime, autoplay: req.autoplay, contentId: req.media.contentId, contentType: req.media.contentType, hls: req.media.hlsSegmentFormat, hlsv: req.media.hlsVideoSegmentFormat, titulo: req.media.metadata && req.media.metadata.title, poster: !!(req.media.metadata && req.media.metadata.images && req.media.metadata.images[0]), rate: req.playbackRate });
      return new Promise((ok, mal) => {
        if (q.get('cargaFalla')) { demora(() => mal('load_media_failed'), LAT * 2 + 300); return; }
        demora(() => {
          // La media anterior (si había) queda interrumpida.
          if (R.media && R.estado !== 'IDLE') { R.idleReason = 'INTERRUPTED'; }
          R.msid++; R.media = { ...req.media, duration: Number.isFinite(dur) ? dur : 260 }; R.duracion = R.media.duration; R.idleReason = null; R.rate = req.playbackRate || 1;
          R.fijar(req.currentTime || 0, 'BUFFERING'); anotar('TV LOAD', R.foto());
          setTimeout(() => {
            R.fijar(req.currentTime || 0, req.autoplay === false ? 'PAUSED' : 'PLAYING'); anotar('TV cargó', R.foto());
            const s = { t: R.tiempo(), estado: R.estado, rate: R.rate, idleReason: null, msid: R.msid, media: R.media };
            demora(() => { this._nuevaMedia(s); ok(null); });
          }, 600);
        });
      });
    }
    _nuevaMedia(s) {
      this._media = new Media(s);
      this._emitir('mediasession', { type: 'mediasession', mediaSession: this._media });
    }
    _recibirEstado(s) {
      const m = this._media;
      if (!m) return;
      if (s.msid !== m.mediaSessionId) {
        // Otra media en la TV: la vieja queda interrumpida y aparece la nueva.
        if (s.msid > m.mediaSessionId) { m._aplicar({ ...s, estado: 'IDLE', idleReason: 'INTERRUPTED', t: m.currentTime }); this._nuevaMedia(s); }
        return;
      }
      m._aplicar(s);
    }
    endSession(stop) { anotar('CMD endSession', { stop }); ctx._terminar(stop); }
  }

  const SS = { NO_SESSION: 'NO_SESSION', SESSION_STARTING: 'SESSION_STARTING', SESSION_STARTED: 'SESSION_STARTED', SESSION_START_FAILED: 'SESSION_START_FAILED', SESSION_ENDING: 'SESSION_ENDING', SESSION_ENDED: 'SESSION_ENDED', SESSION_RESUMED: 'SESSION_RESUMED' };
  const CS = { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE', NOT_CONNECTED: 'NOT_CONNECTED', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED' };
  const ctx = T.ctx = {
    _oy: {}, _opciones: null, _estado: q.get('hayTV') === '0' ? CS.NO_DEVICES_AVAILABLE : CS.NOT_CONNECTED,
    addEventListener(t, fn) { (this._oy[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this._oy[t] = (this._oy[t] || []).filter((x) => x !== fn); },
    _emitir(t, e) { anotar('EV ' + t, { estado: e.sessionState || e.castState }); (this._oy[t] || []).slice().forEach((fn) => fn(e)); },
    setOptions(o) {
      T.opciones = o; this._opciones = o; anotar('setOptions', { o });
      const tr = q.get('reanudar');
      if (tr != null && !this._reanudada) {
        this._reanudada = true;
        setTimeout(() => {
          sesion = new CastSession();
          const src = q.get('ajeno') ? 'https://otro.ejemplo.test/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/playlist.m3u8' : window.PLAYER_CONFIG.videoUrl;
          R.msid++; R.media = { contentId: src, contentType: 'application/x-mpegurl', duration: 260 }; R.duracion = 260; R.idleReason = null;
          const EST = q.get('reanudarPausado') ? 'PAUSED' : 'PLAYING'; R.fijar(Number(tr), EST);
          sesion._media = new Media({ t: R.tiempo(), estado: EST, rate: 1, msid: R.msid, media: R.media });
          this._estado = CS.CONNECTED;
          this._emitir('caststatechanged', { castState: CS.CONNECTED });
          this._emitir('sessionstatechanged', { sessionState: SS.SESSION_RESUMED, session: sesion });
        }, Number(q.get('reanudarMs') || 400));
      }
    },
    getCastState() { return this._estado; },
    getCurrentSession() { return sesion; },
    getSessionState() { return sesion ? SS.SESSION_STARTED : SS.NO_SESSION; },
    requestSession() {
      const activo = !!(navigator.userActivation && navigator.userActivation.isActive);
      T.gestos.push({ ms: ms(), que: 'requestSession', activo });
      anotar('requestSession', { activo });
      if (!this._opciones) return Promise.reject('invalid_parameter');
      if (!activo) return Promise.reject('session_error');   // como PresentationRequest.start sin gesto
      // Sin TV en la red: el SDK real (Chrome 152, medido) rechaza con session_error y el
      // CastState sigue en NO_DEVICES_AVAILABLE.
      if (this._estado === CS.NO_DEVICES_AVAILABLE) return Promise.reject('session_error');
      return new Promise((ok, mal) => {
        setTimeout(() => {
          if (T.elegir === 'cancel') { this._emitir('sessionstatechanged', { sessionState: SS.SESSION_START_FAILED, errorCode: 'cancel' }); return mal('cancel'); }
          this._emitir('sessionstatechanged', { sessionState: SS.SESSION_STARTING });
          setTimeout(() => {
            sesion = new CastSession();
            this._estado = CS.CONNECTED;
            this._emitir('caststatechanged', { castState: CS.CONNECTED });
            this._emitir('sessionstatechanged', { sessionState: SS.SESSION_STARTED, session: sesion });
            ok(null);
          }, Number(q.get('inicio') || 300));
        }, 250);
      });
    },
    endCurrentSession(stop) { anotar('endCurrentSession', { stop }); this._terminar(stop); },
    _terminar(stop) {
      if (!sesion) return;
      const s = sesion;
      if (stop) { R.fijar(R.tiempo(), 'IDLE'); R.idleReason = 'CANCELLED'; R.media = null; anotar('TV app cerrada'); }
      this._emitir('sessionstatechanged', { sessionState: SS.SESSION_ENDING, session: s });
      setTimeout(() => {
        sesion = null;
        this._estado = this._estado === CS.NO_DEVICES_AVAILABLE ? this._estado : CS.NOT_CONNECTED;
        this._emitir('caststatechanged', { castState: this._estado });
        this._emitir('sessionstatechanged', { sessionState: SS.SESSION_ENDED, session: s });
      }, 100);
    },
  };
  window.cast = {
    framework: {
      VERSION: 'simulado',
      CastContext: { getInstance: () => ctx },
      CastContextEventType: { CAST_STATE_CHANGED: 'caststatechanged', SESSION_STATE_CHANGED: 'sessionstatechanged' },
      CastState: CS, SessionState: SS,
      SessionEventType: { APPLICATION_STATUS_CHANGED: 'applicationstatuschanged', APPLICATION_METADATA_CHANGED: 'applicationmetadatachanged', ACTIVE_INPUT_STATE_CHANGED: 'activeinputstatechanged', VOLUME_CHANGED: 'volumechanged', MEDIA_SESSION: 'mediasession' },
    },
  };

  // ---- Control remoto de la TV (HDMI-CEC / Google Home) -------------------------
  T.remoto = {
    adelantar(s) { T.remoto.irA(R.tiempo() + s); },
    irA(t) {
      const antes = R.estado; anotar('REMOTO irA', { t, antes });
      R.fijar(t, 'BUFFERING'); difundir();
      setTimeout(() => { R.fijar(t, antes === 'PAUSED' ? 'PAUSED' : 'PLAYING'); anotar('REMOTO irA listo', R.foto()); difundir(); }, 250);
    },
    play() { anotar('REMOTO play', R.foto()); R.fijar(R.tiempo(), 'PLAYING'); difundir(); },
    pause() { anotar('REMOTO pause', R.foto()); R.fijar(R.tiempo(), 'PAUSED'); difundir(); },
    parar() { anotar('REMOTO parar'); R.fijar(R.tiempo(), 'IDLE'); R.idleReason = 'CANCELLED'; difundir(); },
    cortarSesion() { anotar('REMOTO cortarSesion', R.foto()); ctx._terminar(true); },
    otroVideo() {
      anotar('REMOTO otroVideo');
      R.msid++; R.media = { contentId: 'https://otro.ejemplo.test/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/playlist.m3u8', duration: 100 }; R.idleReason = null; R.fijar(0, 'PLAYING'); difundir();
    },
  };
})();
