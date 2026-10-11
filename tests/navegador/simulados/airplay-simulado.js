// Copia, para la suite (tests/navegador), del simulado con que se verificó AirPlay
// (oct-2026). Lo inyecta el servidor de pruebas con ?airplay=1.
//
// AirPlay SIMULADO en Chrome: lo que se puede imitar de WebKit.
//  - window.WebKitPlaybackTargetAvailabilityEvent (la marca de WebKit que mira nativePlayer)
//  - HTMLMediaElement.prototype.remote: una RemotePlayback falsa (watchAvailability,
//    prompt que anota si había activación de usuario, eventos connecting/connect/disconnect)
//  - sin navigator.presentation (como Safari): cast.js no se ofrece.
// Lo que NO se puede: que el <video> de verdad salga por otra pantalla, que el
// celular deje de dibujarlo, y el cambio MMS→fuente alternativa de WebKit.
// Parámetros: drp=1 → el <video> nace con disableRemotePlayback (como hls.js + MMS).
(() => {
  const q = new URLSearchParams(location.search);
  window.WebKitPlaybackTargetAvailabilityEvent = function () {};
  try { Object.defineProperty(Navigator.prototype, 'presentation', { configurable: true, get: () => undefined }); } catch (e) {}
  // La PC del arnés tiene pantalla táctil (maxTouchPoints 10): con plataforma MacIntel
  // se leería como iPad. Una Mac real informa 0.
  if (q.get('mtp') != null) { const n = Number(q.get('mtp')); try { Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => n }); } catch (e) {} }
  const A = window.__airplay = { disponible: q.get('disp') !== '0', prompts: [], remotos: [], watch: [] };
  class RemoteFalso extends EventTarget {
    constructor(el) { super(); this.el = el; this.state = 'disconnected'; this._cbs = new Map(); this._id = 0; A.remotos.push(this); }
    watchAvailability(cb) {
      if (this.el.disableRemotePlayback) { A.watch.push('InvalidStateError'); return Promise.reject(new DOMException('disableRemotePlayback', 'InvalidStateError')); }
      const id = ++this._id; this._cbs.set(id, cb); A.watch.push('ok');
      setTimeout(() => cb(A.disponible), 30);
      return Promise.resolve(id);
    }
    cancelWatchAvailability(id) { this._cbs.delete(id); return Promise.resolve(); }
    prompt() {
      const activo = !!(navigator.userActivation && navigator.userActivation.isActive);
      A.prompts.push({ activo, readyState: this.el.readyState, src: (this.el.src || '').replace(/^.*\/([^/]+\/[^/]+)$/, '$1') });
      if (!activo) return Promise.reject(new DOMException('sin gesto', 'InvalidAccessError'));
      return new Promise((ok, mal) => { A._pendiente = { ok, mal }; });
    }
    _conectar() { this.state = 'connecting'; this.dispatchEvent(new Event('connecting')); setTimeout(() => { this.state = 'connected'; this.dispatchEvent(new Event('connect')); A._pendiente && A._pendiente.ok(); A._pendiente = null; }, 200); }
    _desconectar() { this.state = 'disconnected'; this.dispatchEvent(new Event('disconnect')); }
    _disp(d) { A.disponible = d; this._cbs.forEach((cb) => cb(d)); }
  }
  const mapa = new WeakMap();
  Object.defineProperty(HTMLMediaElement.prototype, 'remote', {
    configurable: true,
    get() { let r = mapa.get(this); if (!r) { r = new RemoteFalso(this); mapa.set(this, r); } return r; },
  });
  if (q.get('drp') === '1') {
    const crear = Document.prototype.createElement;
    Document.prototype.createElement = function (tag, ...rest) { const el = crear.call(this, tag, ...rest); if (String(tag).toLowerCase() === 'video') el.disableRemotePlayback = true; return el; };
  }
  A.conectar = () => A.remotos.forEach((r) => r._conectar());
  A.desconectar = () => A.remotos.forEach((r) => r._desconectar());
  A.disp = (d) => A.remotos.forEach((r) => r._disp(d));
  A.cancelar = () => { A._pendiente && A._pendiente.mal(new DOMException('cerrado', 'NotAllowedError')); A._pendiente = null; };
})();
