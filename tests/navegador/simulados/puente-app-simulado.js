// hub-app SIMULADA: el Cast nativo de la app y su puente ivcast v1 con el reproductor,
// sobre la MISMA TV que usa el emisor de Chrome simulado (tv-simulada.js, que va antes).
// Lo inyecta el servidor de pruebas en la página de ARRIBA (marco.html, que hace de
// view.php) con ?app=fake. Se porta como pide el contrato (castear-hub-app-v2.md §3 y el
// PEDIDO a hub-app §5):
//   - window.ReactNativeWebView.postMessage(texto) recibe lo del reproductor; con
//     plataforma=ios está sólo acá (el reproductor lo lee de window.top), si no el
//     servidor pone otro en el iframe que manda a éste (Android: está en todos los marcos).
//   - contesta llamando a window.__ivcastRecibir(texto) de ESTA página (lo registra el shim
//     desde el iframe), como injectJavaScript: un mensaje por inyección, en orden, nunca
//     agrupados, y antes de un `ok` el `media` si cambió desde el último que mandó.
//   - no repite un `media` idéntico (salvo duplicados=1, a propósito).
// Parámetros (query de marco.html, que también le llega al reproductor):
//   app=fake       la app que contesta · app=mudo: el puente existe y nadie contesta
//   latPuente=30   latencia de UNA vía web↔app (ms)
//   duplicados=1   cada `media` vuelve a llegar, idéntico, a los dupMs (250) si no hubo otro
//                  en el medio: el shim tiene que descartarlo SIN renovarle la hora
//   holaLento=ms   contesta el hola recién a los ms
//   holaMudos=n    no contesta los primeros n saludos (el de la carga se pierde; el toque saluda de nuevo)
//   cast=0         hola-ok sin 'cast' (un teléfono sin Google Play Services)
//   version=0      contesta el hola con error{version}
//   plataforma=ios hola-ok con plataforma 'ios' y 'airplay' en capacidades (airplayApp=0 lo saca)
//   sinVelocidad=1 capacidades sin 'velocidad'
//   hayTV=0        NO_DEVICES_AVAILABLE · reanudar=70 (+ajeno, reanudarPausado): la app ya
//                  transmitía cuando el reproductor saluda · inicio=300 · nombre=… (de la TV)
// Deja window.__puente = { recibidos, latidos, adioses, holas } para las pruebas, y anota
// en window.__tv.log con los mismos nombres que el emisor de Chrome (requestSession,
// CMD LOAD, CMD play/pause/status/seek, MSG SET_PLAYBACK_RATE, endCurrentSession), más
// 'PUENTE <tipo>' por cada mensaje que llega.
(() => {
  const T = window.__tv;
  const q = T.q;
  const R = T.receptor;
  const anotar = T.anotar;
  const MUDO = q.get('app') === 'mudo';
  const LATP = Number(q.get('latPuente') || 30);
  const DUP_MS = Number(q.get('dupMs') || 250);
  const IOS = q.get('plataforma') === 'ios';
  const P = window.__puente = { recibidos: [], latidos: [], adioses: 0, holas: 0, inyectados: [] };

  // ---- Lo que viaja ------------------------------------------------------------
  // App → web: como injectJavaScript, con latencia, de a uno.
  const inyectar = (msg, demora = LATP) => {
    setTimeout(() => {
      P.inyectados.push({ ms: T.ms(), tipo: msg.tipo });
      try { if (typeof window.__ivcastRecibir === 'function') window.__ivcastRecibir(JSON.stringify({ ivcast: 1, ...msg })); } catch (e) {}
    }, demora);
  };
  const ok = (id, extra = {}) => inyectar({ tipo: 'ok', re: id, ...extra });
  const error = (id, codigo, detalle) => inyectar({ tipo: 'error', re: id, codigo, ...(detalle ? { detalle } : {}) });

  // Web → app.
  window.ReactNativeWebView = {
    postMessage(texto) {
      // Activación de usuario en el momento del pedido (para comparar con el emisor de
      // Chrome: la app no la necesita, pero el toque del alumno la da igual).
      const activo = !!(navigator.userActivation && navigator.userActivation.isActive);
      let m = null;
      try { m = JSON.parse(texto); } catch (e) {}
      if (!m || m.ivcast !== 1 || typeof m.tipo !== 'string') return;
      P.recibidos.push({ ms: T.ms(), tipo: m.tipo, m });
      if (m.tipo !== 'latido') anotar('PUENTE ' + m.tipo, { id: m.id });
      if (MUDO) return;
      setTimeout(() => atender(m, activo), LATP);
    },
  };

  // ---- El estado de la app (lo que llevaría TransmisionContext) -----------------
  let estadoCast = q.get('hayTV') === '0' ? 'NO_DEVICES_AVAILABLE' : 'NOT_CONNECTED';
  let sesion = null;                // { id, nombre }
  let silencio = false;
  const volumen = 0.4;
  const msids = new Map();          // "<sesion>|<item de la TV>" → msid (sube y no se repite)
  let proxMsid = 0;
  let ultimoMedia = null;           // clave del último `media` mandado
  let foto = null;                  // último estado de la TV (getMediaStatus)

  const msidDe = (itemTV) => {
    const k = `${sesion ? sesion.id : '-'}|${itemTV}`;
    if (!msids.has(k)) msids.set(k, ++proxMsid);
    return msids.get(k);
  };
  const mediaDe = (s) => {
    if (!s || !s.media) return null;
    return {
      msid: msidDe(s.msid), contentId: s.media.contentId, contentUrl: s.media.contentUrl || s.media.contentId,
      duracion: s.media.duration || null, estado: s.estado, motivo: s.estado === 'IDLE' ? (s.idleReason || null) : null,
      t: +Number(s.t).toFixed(3), rate: s.rate || 1,
    };
  };
  const clave = (m) => `${m.msid}|${m.estado}|${m.motivo}|${m.t}|${m.rate}`;
  const sesionDe = () => sesion && { id: sesion.id, nombre: sesion.nombre, silencio, volumen, media: foto ? mediaDe(foto) : null };
  // Manda el `media` si difiere del último (regla a); con duplicados=1, lo repite después.
  const mandarMedia = (s) => {
    const m = mediaDe(s);
    if (!m) return;
    const k = clave(m);
    if (k === ultimoMedia) return;
    ultimoMedia = k;
    inyectar({ tipo: 'media', ...m });
    if (q.get('duplicados')) setTimeout(() => { if (ultimoMedia === k) inyectar({ tipo: 'media', ...m }); }, DUP_MS);
  };
  T.alEstado = (s) => { if (!sesion) return; foto = s; mandarMedia(s); };
  T.alCortar = () => terminar();
  const mediaActual = () => (foto && foto.media ? mediaDe(foto) : null);

  const disponibilidad = (e) => { if (e === estadoCast) return; estadoCast = e; inyectar({ tipo: 'disponibilidad', estado: e }); };
  const iniciarSesion = (estado) => {
    sesion = { id: 'nat-' + Math.random().toString(36).slice(2, 8), nombre: T.nombre };
    disponibilidad('CONNECTED');
    inyectar({ tipo: 'sesion', estado, sesion: sesionDe() });
    inyectar({ tipo: 'volumen', silencio, volumen });
  };
  // Se corta (dejar de transmitir, Google Home): ENDING, ENDED.
  function terminar() {
    if (!sesion) return;
    T.cerrarApp();
    inyectar({ tipo: 'sesion', estado: 'SESSION_ENDING', sesion: sesionDe() });
    setTimeout(() => {
      sesion = null; foto = null; ultimoMedia = null;
      disponibilidad(estadoCast === 'NO_DEVICES_AVAILABLE' ? estadoCast : 'NOT_CONNECTED');
      inyectar({ tipo: 'sesion', estado: 'SESSION_ENDED', sesion: null });
    }, 100);
  }

  // ---- Los comandos -------------------------------------------------------------
  const conMsid = (m) => {
    if (!sesion) return 'sin_sesion';
    const actual = mediaActual();
    if (!actual) return 'sin_media';
    if (m.msid !== actual.msid) return 'msid_viejo';
    return null;
  };
  // Antes del ok: el media si cambió (regla a). Con el simulado ya salió con el estado.
  const okConMedia = (id, extra) => { if (foto) mandarMedia(foto); ok(id, extra); };

  function atender(m, activo) {
    const id = typeof m.id === 'string' ? m.id : null;
    switch (m.tipo) {
      case 'hola': {
        P.holas++;
        if (P.holas <= Number(q.get('holaMudos') || 0)) return;
        if (q.get('version') === '0' || !Array.isArray(m.soporta) || !m.soporta.includes(1)) return error(id, 'version');
        // reanudar=70: la app ya transmitía (otra lección, la app se reabrió).
        if (q.get('reanudar') != null && !sesion && !P.reanudada) {
          P.reanudada = true;
          sesion = { id: 'nat-previa', nombre: T.nombre };
          estadoCast = 'CONNECTED';
          foto = T.prepararReanudada({ t: q.get('reanudar'), pausado: !!q.get('reanudarPausado'), ajeno: !!q.get('ajeno') });
        }
        const caps = [];
        if (q.get('cast') !== '0') caps.push('cast');
        if (!q.get('sinVelocidad')) caps.push('velocidad');
        caps.push('silencio');
        if (IOS && q.get('airplayApp') !== '0') caps.push('airplay');
        const responder = () => {
          // Estado fresco antes del hola-ok (requestStatus): acá, la foto de la TV ahora.
          if (sesion && R.media) foto = { t: R.tiempo(), estado: R.estado, rate: R.rate, idleReason: R.idleReason, msid: R.msid, media: R.media };
          const s = sesionDe();
          if (s && s.media) ultimoMedia = clave(s.media);
          inyectar({ tipo: 'hola-ok', re: id, ivcast: 1, app: { version: 'simulada', plataforma: IOS ? 'ios' : 'android' }, capacidades: caps, cast: { receptor: 'CC1AD845', estado: estadoCast, sesion: s } });
        };
        const lento = Number(q.get('holaLento') || 0);
        return lento > 0 ? setTimeout(responder, lento) : responder();
      }
      case 'elegir': {
        T.gestos.push({ ms: T.ms(), que: 'requestSession', activo });
        anotar('requestSession', { activo });
        // El selector nativo se muestra siempre (también sin TVs: dice que no hay).
        ok(id, { mostrado: true });
        if (estadoCast === 'NO_DEVICES_AVAILABLE' || T.elegir === 'cancel') return;   // el SDK nativo no avisa la cancelación
        setTimeout(() => {
          inyectar({ tipo: 'sesion', estado: 'SESSION_STARTING', sesion: null });
          setTimeout(() => iniciarSesion('SESSION_STARTED'), Number(q.get('inicio') || 300));
        }, 250);
        return;
      }
      case 'terminar':
        anotar('endCurrentSession', { stop: m.detenerTV === true });
        ok(id);
        return terminar();
      case 'cargar': {
        if (!sesion) return error(id, 'sin_sesion');
        const md = m.media || {};
        const url = md.contentUrl || md.contentId;
        if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return error(id, 'url_no_permitida');
        return T.cargar({
          contentId: md.contentId, contentType: md.contentType, hls: md.hlsSegmentFormat, hlsv: md.hlsVideoSegmentFormat,
          titulo: md.titulo, poster: !!md.imagen, t: m.t, autoplay: m.autoplay !== false, rate: m.rate,
          media: { contentId: md.contentId, contentUrl: url, contentType: md.contentType, customData: md.customData || null },
        }, (s) => { if (sesion) { foto = s; mandarMedia(s); } }).then(
          () => { const a = mediaActual(); okConMedia(id, { msid: a ? a.msid : null }); },
          // La TV igual puede terminar reproduciendo: los `media` siguen saliendo.
          () => error(id, 'load_media_failed'));
      }
      case 'play': case 'pausa': case 'estado': {
        const mal = conMsid(m);
        if (mal) return error(id, mal);
        const nombre = m.tipo === 'pausa' ? 'pause' : m.tipo === 'estado' ? 'status' : 'play';
        return T.comando(nombre, R.msid).then(() => okConMedia(id), (c) => error(id, c || 'error'));
      }
      case 'saltar': {
        const mal = conMsid(m);
        if (mal) return error(id, mal);
        if (!Number.isFinite(m.t)) return error(id, 'invalido');
        return T.saltar(R.msid, m.t, m.reanudar === 'PLAYBACK_PAUSE' ? 'PLAYBACK_PAUSE' : 'PLAYBACK_START').then(() => okConMedia(id), (c) => error(id, c || 'error'));
      }
      case 'velocidad': {
        const mal = conMsid(m);
        if (mal) return error(id, mal);
        T.log.push({ ms: T.ms(), ev: 'MSG SET_PLAYBACK_RATE', msg: { type: 'SET_PLAYBACK_RATE', playbackRate: m.rate } });
        return T.velocidad(m.rate).then(() => ok(id));
      }
      case 'silenciar':
        if (!sesion) return error(id, 'sin_sesion');
        anotar('CMD setMute', { m: !!m.silencio });
        silencio = !!m.silencio;
        inyectar({ tipo: 'volumen', silencio, volumen });
        return ok(id);
      case 'latido':
        P.latidos.push({ ms: T.ms(), visible: m.visible, msid: m.msid });
        return;
      case 'adios':
        P.adioses++;
        return;
      default:
        // Incluye `parada`, que no es de v1.
        if (id) error(id, 'desconocido');
    }
  }
})();
