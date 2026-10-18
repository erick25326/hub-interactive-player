// La TV SIMULADA (el receptor de Cast), compartida por los dos emisores simulados:
//  - cast-simulado.js: el Cast Web SDK de Chrome (?cast=fake, en la página del reproductor).
//  - puente-app-simulado.js: hub-app con el Cast nativo, que le habla al reproductor por
//    el puente ivcast (?app=fake, en la página de ARRIBA, marco.html, como view.php).
// Se parte así para que las dos suites de la TV prueben contra la MISMA TV, con los mismos
// tiempos: si el reproductor anda en Chrome y no en la app, la diferencia es el puente.
//
// La TV corre sola (el segundo avanza con el reloj) y contesta con latencia. Deja
// window.__tv = { log, receptor, remoto, … }, que leen las pruebas y el ayudante de la
// página. El emisor se engancha con T.alEstado (cada estado que manda la TV) y
// T.alCortar (la sesión se cortó desde la TV: Google Home).
// Parámetros (query de la página):
//   lat=120       latencia de UNA vía emisor↔TV en ms
//   cargaFalla=1  el LOAD vuelve con error y la TV no carga nada
//   cargaTarde=1  el LOAD vuelve con error pero la TV carga igual a los 2,5 s
//   idlePrimero=1 al cargar, primero una media en IDLE (INTERRUPTED) y después la real
//   nombre=…      nombre de la TV
// Control remoto de la TV (window.__tv.remoto): adelantar(s), irA(t), play(), pause(),
// parar() (CANCELLED), cortarSesion() (Google Home "dejar de transmitir"), otroVideo().
(() => {
  const q = new URLSearchParams(location.search);
  const LAT = Number(q.get('lat') || 120);
  const T = window.__tv = { log: [], lat: LAT, gestos: [], nombre: q.get('nombre') || 'Living & Comedor', q, alEstado: null, alCortar: null };
  const t0 = performance.now();
  const ms = T.ms = () => Math.round(performance.now() - t0);
  const anotar = T.anotar = (ev, extra = {}) => T.log.push({ ms: ms(), ev, ...extra });
  const demora = T.demora = (fn, d = LAT) => setTimeout(fn, d);
  T.OTRO_VIDEO = 'https://otro.ejemplo.test/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/playlist.m3u8';

  // El reproductor puede estar en esta página o en el iframe de marco.html.
  const marcoReproductor = () => { try { const f = document.querySelector('iframe'); return f && f.contentWindow; } catch (e) { return null; } };
  T.duracionVideo = () => {
    const v = document.querySelector('video') || (marcoReproductor() && marcoReproductor().document.querySelector('video'));
    const d = v && v.duration;
    return Number.isFinite(d) && d > 0 ? d : 260;
  };
  T.videoUrl = () => (window.PLAYER_CONFIG || (marcoReproductor() && marcoReproductor().PLAYER_CONFIG) || {}).videoUrl;

  // ---- La TV (el receptor) ----------------------------------------------------
  const R = T.receptor = { base: 0, hBase: 0, estado: 'IDLE', rate: 1, media: null, idleReason: null, msid: 0, duracion: 260 };
  R.tiempo = () => R.estado === 'PLAYING' ? Math.min(R.duracion, R.base + (performance.now() - R.hBase) / 1000 * R.rate) : R.base;
  R.fijar = (t, estado) => { R.base = Math.max(0, Math.min(R.duracion, t)); R.hBase = performance.now(); R.estado = estado; };
  R.foto = () => ({ t: +R.tiempo().toFixed(3), estado: R.estado, rate: R.rate, idleReason: R.idleReason, msid: R.msid });
  // Fin del video en la TV.
  setInterval(() => {
    if (R.estado === 'PLAYING' && R.tiempo() >= R.duracion) { R.fijar(R.duracion, 'IDLE'); R.idleReason = 'FINISHED'; anotar('TV fin'); difundir(); }
  }, 30);
  // MEDIA_STATUS hacia el emisor (una vía de latencia). `alLlegar` corre después de
  // entregarlo: así la respuesta de un comando llega con su estado ya aplicado.
  const difundir = T.difundir = (alLlegar) => {
    const s = { t: R.tiempo(), estado: R.estado, rate: R.rate, idleReason: R.idleReason, msid: R.msid, media: R.media, h: performance.now() };
    demora(() => { if (T.alEstado) T.alEstado(s); if (alLlegar) alLlegar(); });
  };
  const aplicable = (msid) => !!R.media && R.msid === msid && R.estado !== 'IDLE';

  // play / pause / status: la TV los recibe una vía después, los aplica y avisa su estado;
  // la respuesta llega con ese estado. Rechaza ('session_error') si la media ya no es ésa.
  T.comando = (nombre, msid) => new Promise((ok, mal) => {
    anotar('CMD ' + nombre, { celular: true });
    demora(() => {
      if (!aplicable(msid)) { demora(() => mal('session_error')); return; }
      if (nombre === 'play') { R.fijar(R.tiempo(), 'PLAYING'); anotar('TV play', R.foto()); }
      else if (nombre === 'pause') { R.fijar(R.tiempo(), 'PAUSED'); anotar('TV pause', R.foto()); }
      difundir(ok);
    });
  });
  // Salto: BUFFERING enseguida y el estado final a los 250 ms (como un receptor real).
  T.saltar = (msid, t, resume) => new Promise((ok, mal) => {
    T.log.push({ ms: ms(), ev: 'CMD seek', t, resume });
    demora(() => {
      if (!aplicable(msid)) { demora(() => mal('session_error')); return; }
      const antes = R.estado;
      R.fijar(t, 'BUFFERING'); anotar('TV seek', { t, resume });
      difundir();
      setTimeout(() => {
        const final = resume === 'PLAYBACK_PAUSE' ? 'PAUSED' : resume === 'PLAYBACK_START' ? 'PLAYING' : (antes === 'PAUSED' ? 'PAUSED' : 'PLAYING');
        R.fijar(t, final); anotar('TV seek listo', R.foto());
        difundir(ok);
      }, 250);
    });
  });
  // SET_PLAYBACK_RATE (el log 'MSG …' lo hace cada emisor, con lo que recibió).
  T.velocidad = (rate) => new Promise((ok) => {
    demora(() => { const t = R.tiempo(); R.rate = rate; R.fijar(t, R.estado); difundir(ok); });
  });
  // LOAD. `c`: { contentId, contentType, hls, hlsv, titulo, poster, t, autoplay, rate,
  // media (lo que guarda la TV como su media) }. `alNuevaMedia(s)` entrega al emisor el
  // estado de la media NUEVA (antes de resolver), como el MEDIA_SESSION del SDK.
  T.cargar = (c, alNuevaMedia) => {
    T.log.push({ ms: ms(), ev: 'CMD LOAD', t: c.t, autoplay: c.autoplay, contentId: c.contentId, contentType: c.contentType, hls: c.hls, hlsv: c.hlsv, titulo: c.titulo, poster: c.poster, rate: c.rate });
    const dur = T.duracionVideo();
    return new Promise((ok, mal) => {
      if (q.get('cargaFalla')) { demora(() => mal('load_media_failed'), LAT * 2 + 300); return; }
      // cargaTarde=1: como la PRIMERA conexión con una TV real (prueba de Erick, oct-2026):
      // el pedido vuelve con error enseguida, pero la TV abre la app y carga igual.
      const tarde = q.get('cargaTarde') ? 2500 : 0;
      if (tarde) demora(() => mal('session_error'), LAT * 2 + 100);
      setTimeout(() => demora(() => {
        // idlePrimero=1: como un Chromecast real, primero aparece una media en IDLE con
        // motivo y recién después la de verdad, en BUFFERING.
        if (q.get('idlePrimero')) { R.msid++; alNuevaMedia({ t: 0, estado: 'IDLE', rate: 1, idleReason: 'INTERRUPTED', msid: R.msid, media: { ...c.media } }); }
        // La media anterior (si había) queda interrumpida.
        if (R.media && R.estado !== 'IDLE') { R.idleReason = 'INTERRUPTED'; }
        R.msid++; R.media = { ...c.media, duration: dur }; R.duracion = dur; R.idleReason = null; R.rate = c.rate || 1;
        R.fijar(c.t || 0, 'BUFFERING'); anotar('TV LOAD', R.foto());
        setTimeout(() => {
          R.fijar(c.t || 0, c.autoplay === false ? 'PAUSED' : 'PLAYING'); anotar('TV cargó', R.foto());
          const s = { t: R.tiempo(), estado: R.estado, rate: R.rate, idleReason: null, msid: R.msid, media: R.media };
          demora(() => { alNuevaMedia(s); ok(null); });
        }, 600);
      }), tarde);
    });
  };
  // Se cierra la app de la TV (dejar de transmitir deteniendo la TV).
  T.cerrarApp = () => { R.fijar(R.tiempo(), 'IDLE'); R.idleReason = 'CANCELLED'; R.media = null; anotar('TV app cerrada'); };
  // Una sesión que ya estaba (otra pestaña, otra lección, la app que ya transmitía): la
  // TV con ESTE video (u otro, con ajeno=1) en `t`, reproduciendo o en pausa.
  T.prepararReanudada = ({ t, pausado = false, ajeno = false }) => {
    const src = ajeno ? T.OTRO_VIDEO : T.videoUrl();
    R.msid++; R.media = { contentId: src, contentUrl: src, contentType: 'application/x-mpegurl', duration: 260, customData: ajeno ? null : { ivplayer: 1 } }; R.duracion = 260; R.idleReason = null;
    const est = pausado ? 'PAUSED' : 'PLAYING';
    R.fijar(Number(t), est);
    return { t: R.tiempo(), estado: est, rate: 1, idleReason: null, msid: R.msid, media: R.media };
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
    cortarSesion() { anotar('REMOTO cortarSesion', R.foto()); if (T.alCortar) T.alCortar(); },
    otroVideo() {
      anotar('REMOTO otroVideo');
      R.msid++; R.media = { contentId: T.OTRO_VIDEO, contentUrl: T.OTRO_VIDEO, duration: 100 }; R.idleReason = null; R.fijar(0, 'PLAYING'); difundir();
    },
  };
})();
