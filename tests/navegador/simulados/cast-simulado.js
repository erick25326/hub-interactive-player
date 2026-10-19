// Copia, para la suite (tests/navegador), del simulado con que se verificó la etapa
// 3 de la TV (oct-2026). Lo inyecta el servidor de pruebas con ?cast=fake, DESPUÉS de
// tv-simulada.js (la TV, que comparte con el puente de la app simulada). No es el SDK de
// Google ni lo reemplaza: imita sólo lo que usa src/cast.js, con latencia.
//
// El emisor de Cast de Chrome SIMULADO: un falso `cast.framework` + `chrome.cast` con la
// forma del Web Sender SDK 1.0.15 (lo que usa src/cast.js) sobre la TV de window.__tv.
// Se inyecta ANTES del reproductor. Parámetros (query de la página), además de los de
// la TV (tv-simulada.js):
//   hayTV=0      CastState NO_DEVICES_AVAILABLE (el botón está igual; requestSession falla)
//   reanudar=70  al llamar setOptions, aparece una sesión REANUDADA con este video en 70 s, reproduciendo
//   ajeno=1      …pero con OTRO video cargado
//   inicio=300   cuánto tarda la sesión en arrancar después de elegir la TV
//   nombre=…     friendlyName (se entrega escapado como HTML, como el SDK real)
//   reanudarSubs=1  la sesión reanudada trae la pista de subtítulos prendida
(() => {
  const T = window.__tv;
  const q = T.q;
  const R = T.receptor;
  const anotar = T.anotar;

  const PlayerState = { IDLE: 'IDLE', PLAYING: 'PLAYING', PAUSED: 'PAUSED', BUFFERING: 'BUFFERING' };
  const IdleReason = { CANCELLED: 'CANCELLED', INTERRUPTED: 'INTERRUPTED', FINISHED: 'FINISHED', ERROR: 'ERROR' };
  class MediaInfo { constructor(contentId, contentType) { this.contentId = contentId; this.contentType = contentType; this.streamType = 'BUFFERED'; this.duration = null; this.metadata = null; this.customData = null; } }
  class GenericMediaMetadata { constructor() { this.metadataType = 0; this.title = null; this.images = null; } }
  class Image { constructor(url) { this.url = url; } }
  class LoadRequest { constructor(media) { this.type = 'LOAD'; this.media = media; this.autoplay = true; this.currentTime = null; this.playbackRate = 1; } }
  class SeekRequest { constructor() { this.currentTime = null; this.resumeState = null; } }
  class PlayRequest {} class PauseRequest {} class GetStatusRequest {}
  // Las pistas de texto, como las del Web Sender SDK.
  class Track { constructor(trackId, type) { this.trackId = trackId; this.type = type; this.trackContentId = null; this.trackContentType = null; this.subtype = null; this.name = null; this.language = null; this.customData = null; } }
  class TextTrackStyle { constructor() { this.foregroundColor = null; this.backgroundColor = null; this.edgeType = null; this.edgeColor = null; this.windowType = null; this.windowColor = null; this.windowRoundedCornerRadius = null; this.fontScale = null; this.fontFamily = null; this.fontGenericFamily = null; this.fontStyle = null; this.customData = null; } }
  class EditTracksInfoRequest { constructor(activeTrackIds, textTrackStyle) { this.activeTrackIds = activeTrackIds || null; this.textTrackStyle = textTrackStyle || null; } }
  const copiar = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
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
      Track, TextTrackStyle, EditTracksInfoRequest,
      TrackType: { TEXT: 'TEXT', AUDIO: 'AUDIO', VIDEO: 'VIDEO' },
      TextTrackType: { SUBTITLES: 'SUBTITLES', CAPTIONS: 'CAPTIONS', DESCRIPTIONS: 'DESCRIPTIONS', CHAPTERS: 'CHAPTERS', METADATA: 'METADATA' },
      TextTrackEdgeType: { NONE: 'NONE', OUTLINE: 'OUTLINE', DROP_SHADOW: 'DROP_SHADOW', RAISED: 'RAISED', DEPRESSED: 'DEPRESSED' },
      TextTrackFontGenericFamily: { SANS_SERIF: 'SANS_SERIF', MONOSPACED_SANS_SERIF: 'MONOSPACED_SANS_SERIF', SERIF: 'SERIF', MONOSPACED_SERIF: 'MONOSPACED_SERIF', CASUAL: 'CASUAL', CURSIVE: 'CURSIVE', SMALL_CAPITALS: 'SMALL_CAPITALS' },
      TextTrackFontStyle: { NORMAL: 'NORMAL', BOLD: 'BOLD', BOLD_ITALIC: 'BOLD_ITALIC', ITALIC: 'ITALIC' },
      TextTrackWindowType: { NONE: 'NONE', NORMAL: 'NORMAL', ROUNDED_CORNERS: 'ROUNDED_CORNERS' },
    },
  };

  // Los estados de la TV le llegan a la sesión de este emisor.
  T.alEstado = (s) => { if (sesion) sesion._recibirEstado(s); };
  T.alCortar = () => ctx._terminar(true);

  // ---- El celular (emisor) ------------------------------------------------------
  class Media {
    constructor(s) { this._s = s; this.mediaSessionId = s.msid; this.media = s.media; this.playerState = s.estado; this.currentTime = s.t; this.playbackRate = s.rate; this.idleReason = s.idleReason || null; this.activeTrackIds = s.activeTrackIds || []; this._oy = []; this._h = performance.now(); }
    addUpdateListener(fn) { this._oy.push(fn); }
    removeUpdateListener(fn) { this._oy = this._oy.filter((x) => x !== fn); }
    getEstimatedTime() { return this.playerState === 'PLAYING' ? this.currentTime + (performance.now() - this._h) / 1000 * this.playbackRate : this.currentTime; }
    supportsCommand() { return true; }
    _cmd(p, ok, mal) { p.then(() => ok && ok(), (c) => mal && mal({ code: c })); }
    play(req, ok, mal) { this._cmd(T.comando('play', this.mediaSessionId), ok, mal); }
    pause(req, ok, mal) { this._cmd(T.comando('pause', this.mediaSessionId), ok, mal); }
    getStatus(req, ok, mal) { this._cmd(T.comando('status', this.mediaSessionId), ok, mal); }
    seek(req, ok, mal) { this._cmd(T.saltar(this.mediaSessionId, req.currentTime, req.resumeState), ok, mal); }
    editTracksInfo(req, ok, mal) { this._cmd(T.pistas(this.mediaSessionId, req && req.activeTrackIds), ok, mal); }
    _aplicar(s) {
      this.playerState = s.estado; this.currentTime = s.t; this.playbackRate = s.rate; this.idleReason = s.estado === 'IDLE' ? s.idleReason : null; this._h = performance.now();
      if (Array.isArray(s.activeTrackIds)) this.activeTrackIds = s.activeTrackIds.slice();
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
      T.log.push({ ms: T.ms(), ev: 'MSG ' + (msg && msg.type), ns, msg });
      if (msg && msg.type === 'SET_PLAYBACK_RATE') T.velocidad(msg.playbackRate);
      return Promise.resolve();
    }
    loadMedia(req) {
      const m = req.media;
      return T.cargar({
        contentId: m.contentId, contentType: m.contentType, hls: m.hlsSegmentFormat, hlsv: m.hlsVideoSegmentFormat,
        titulo: m.metadata && m.metadata.title, poster: !!(m.metadata && m.metadata.images && m.metadata.images[0]),
        t: req.currentTime, autoplay: req.autoplay, rate: req.playbackRate, media: { ...m },
        tracks: copiar(m.tracks), estilo: copiar(m.textTrackStyle), activeTrackIds: Array.isArray(req.activeTrackIds) ? req.activeTrackIds.slice() : null,
      }, (s) => this._nuevaMedia(s));
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
          const s = T.prepararReanudada({ t: tr, pausado: !!q.get('reanudarPausado'), ajeno: !!q.get('ajeno'), subs: !!q.get('reanudarSubs') });
          sesion._media = new Media(s);
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
      T.gestos.push({ ms: T.ms(), que: 'requestSession', activo });
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
      if (stop) T.cerrarApp();
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
})();
