// El Cast Web SDK imitado sobre el puente (src/castNativo.js) contra un canal EN
// MEMORIA: del otro lado no hay app ni TV, sólo lo que mandaría la app (eventos) y lo
// que contesta a cada comando. Sin navegador.
//
// Lo que se protege: un Media por msid (el anterior IDLE/INTERRUPTED sin avisar), vivo=false
// sólo con IDLE y motivo, cada callback una sola vez, los rechazos de requestSession con
// el texto que compara el JSX ('cancel' al pisarse y con red_local), un media repetido
// que NO llama a los oyentes (le renovaría la hora al estimador del freno), la sesión del
// hola-ok antes de que cargarCast resuelva, el msid del latido, y el mapeo de cada
// llamada del SDK al comando del protocolo. Al final, CastPlayer de verdad a través del
// shim (lo mismo que cast-player.test.mjs, con la TV del lado "nativo").
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
const { crearCastNativo, instalarCastNativo, leerMedia } = await import('../../src/castNativo.js');
const { CastPlayer } = await import('../../src/cast.js');

const GUID = '11111111-2222-4333-8444-555555555555';
const SRC = `https://cdn.ejemplo.test/${GUID}/playlist.m3u8`;

// El canal en memoria: lo que manda el shim queda en `enviados` con su promesa a mano.
function puenteFalso() {
  const enviados = [];
  const oyentes = new Set();
  const latidos = { prendido: false, msid: null, veces: 0, apagado: 0 };
  return {
    enviados, latidos,
    enviar(tipo, datos = {}, { tope } = {}) {
      return new Promise((resolver, rechazar) => enviados.push({ tipo, datos, tope, resolver, rechazar }));
    },
    escuchar(fn) { oyentes.add(fn); return () => oyentes.delete(fn); },
    latir(fn) { latidos.prendido = true; latidos.msid = fn; latidos.veces++; },
    dejarDeLatir() { latidos.prendido = false; latidos.apagado++; },
    // La app manda un evento.
    evento(m) { for (const fn of [...oyentes]) fn({ ivcast: 1, ...m }); },
    ultimo(tipo) { return [...enviados].reverse().find((e) => e.tipo === tipo); },
  };
}
const holaOk = (cast = {}) => ({ app: { version: 'x', plataforma: 'android' }, capacidades: ['cast', 'velocidad', 'silencio'], cast: { receptor: 'CC1AD845', estado: 'NOT_CONNECTED', sesion: null, ...cast } });
const media = (m) => ({ tipo: 'media', contentId: SRC, contentUrl: SRC, duracion: 78, motivo: null, rate: 1, ...m });
const sesionIniciada = (puente, extra = {}) => puente.evento({ tipo: 'sesion', estado: 'SESSION_STARTED', sesion: { id: 's1', nombre: 'Living & Comedor', silencio: false, volumen: 0.4, media: null, ...extra } });
const tick = () => new Promise((r) => setImmediate(r));

function armar(cast) {
  const puente = puenteFalso();
  const sdk = crearCastNativo(holaOk(cast), puente);
  const fw = sdk.cast.framework;
  const ctx = fw.CastContext.getInstance();
  return { puente, sdk, fw, ctx, cc: sdk.chrome.cast };
}

test('leerMedia: tipos en regla o null (un estado que no existe no entra)', () => {
  assert.equal(leerMedia({ msid: 1, estado: 'JUGANDO', t: 3 }), null);
  assert.equal(leerMedia({ msid: '1', estado: 'PLAYING' }), null);
  assert.equal(leerMedia(null), null);
  const m = leerMedia({ msid: 2, estado: 'IDLE', motivo: 'FINISHED', t: -3, rate: 0 });
  assert.deepEqual([m.motivo, m.t, m.rate], ['FINISHED', 0, 1]);
  assert.equal(leerMedia({ msid: 2, estado: 'PLAYING', motivo: 'FINISHED' }).motivo, null, 'el motivo sólo con IDLE');
});

test('un Media por msid: MEDIA_SESSION con el nuevo, el anterior queda IDLE/INTERRUPTED sin llamar a sus oyentes, y uno viejo se ignora', () => {
  const { puente, fw, ctx } = armar();
  sesionIniciada(puente);
  const s = ctx.getCurrentSession();
  const nuevas = [];
  s.addEventListener(fw.SessionEventType.MEDIA_SESSION, (e) => nuevas.push(e.mediaSession));
  puente.evento(media({ msid: 1, estado: 'PLAYING', t: 10 }));
  const m1 = s.getMediaSession();
  assert.equal(nuevas.length, 1);
  assert.equal(nuevas[0], m1);
  assert.equal(m1.mediaSessionId, 1);
  assert.equal(m1.media.contentId, SRC);
  assert.equal(m1.media.duration, 78);
  const llamadas = [];
  m1.addUpdateListener((vivo) => llamadas.push(vivo));
  puente.evento(media({ msid: 2, estado: 'BUFFERING', t: 10 }));
  const m2 = s.getMediaSession();
  assert.notEqual(m2, m1, 'otro objeto: CastPlayer compara por identidad');
  assert.equal(nuevas.length, 2);
  assert.equal(nuevas[1], m2);
  assert.deepEqual([m1.playerState, m1.idleReason], ['IDLE', 'INTERRUPTED']);
  assert.deepEqual(llamadas, [], 'al viejo no se le avisa: CastPlayer decide con MEDIA_SESSION');
  puente.evento(media({ msid: 1, estado: 'PAUSED', t: 11 }));
  assert.equal(s.getMediaSession(), m2, 'un msid más viejo que el actual no cambia nada');
  assert.equal(nuevas.length, 2);
});

test('vivo=false sólo con IDLE y un motivo', () => {
  const { puente, ctx } = armar();
  sesionIniciada(puente);
  puente.evento(media({ msid: 1, estado: 'BUFFERING', t: 0 }));
  const m = ctx.getCurrentSession().getMediaSession();
  const vivos = [];
  m.addUpdateListener((v) => vivos.push(v));
  puente.evento(media({ msid: 1, estado: 'IDLE', motivo: null, t: 0 }));
  puente.evento(media({ msid: 1, estado: 'PLAYING', t: 0.1 }));
  puente.evento(media({ msid: 1, estado: 'IDLE', motivo: 'FINISHED', t: 78 }));
  assert.deepEqual(vivos, [true, true, false]);
  assert.equal(m.idleReason, 'FINISHED');
});

test('un media IDÉNTICO al anterior no llama a los oyentes (no le renueva la hora al estimador); uno distinto sí', () => {
  const { puente, ctx, sdk } = armar();
  sesionIniciada(puente);
  puente.evento(media({ msid: 1, estado: 'PLAYING', t: 20 }));
  const m = ctx.getCurrentSession().getMediaSession();
  const vistos = [];
  m.addUpdateListener(() => vistos.push(m.currentTime));
  puente.evento(media({ msid: 1, estado: 'PLAYING', t: 20 }));
  puente.evento(media({ msid: 1, estado: 'PLAYING', t: 20, duracion: 79 }));
  assert.deepEqual(vistos, [], 'repetido: ningún oyente');
  assert.equal(sdk._diag.repetidos, 2);
  assert.equal(m.media.duration, 79, 'la duración se actualiza igual, en silencio');
  puente.evento(media({ msid: 1, estado: 'PLAYING', t: 21.5 }));
  puente.evento(media({ msid: 1, estado: 'PLAYING', t: 21.5, rate: 1.5 }));
  puente.evento(media({ msid: 1, estado: 'PAUSED', t: 21.5, rate: 1.5 }));
  assert.deepEqual(vistos, [21.5, 21.5, 21.5]);
  assert.equal(m.currentTime, 21.5, 'currentTime es el último informado, sin extrapolar');
});

test('los comandos del Media: el del protocolo con el msid, y cada callback UNA vez (con la respuesta, el error o el tope)', async () => {
  const { puente, ctx, cc } = armar();
  sesionIniciada(puente);
  puente.evento(media({ msid: 7, estado: 'PLAYING', t: 5 }));
  const m = ctx.getCurrentSession().getMediaSession();
  const r = [];
  m.play(new cc.media.PlayRequest(), () => r.push('ok play'), (e) => r.push('mal play ' + e.code));
  let e = puente.ultimo('play');
  assert.deepEqual([e.datos, e.tope], [{ msid: 7 }, 10000]);
  e.resolver({}); e.rechazar({ codigo: 'x' });
  m.pause(new cc.media.PauseRequest(), () => r.push('ok pausa'), (x) => r.push('mal pausa ' + x.code));
  e = puente.ultimo('pausa');
  e.rechazar({ codigo: 'timeout' }); e.resolver({});
  m.getStatus(new cc.media.GetStatusRequest(), () => r.push('ok estado'), (x) => r.push('mal estado ' + x.code));
  puente.ultimo('estado').rechazar({ codigo: 'sin_media' });
  const sr = new cc.media.SeekRequest();
  sr.currentTime = 25.04; sr.resumeState = cc.media.ResumeState.PLAYBACK_PAUSE;
  m.seek(sr, () => r.push('ok salto'), () => r.push('mal salto'));
  e = puente.ultimo('saltar');
  assert.deepEqual(e.datos, { msid: 7, t: 25.04, reanudar: 'PLAYBACK_PAUSE' });
  e.resolver({});
  await tick();
  assert.deepEqual(r, ['ok play', 'mal pausa timeout', 'mal estado sin_media', 'ok salto']);
});

test('requestSession: se cumple con el selector mostrado; rechaza con el TEXTO del código; "cancel" al pisarse y con red_local', async () => {
  const { puente, ctx } = armar();
  const p1 = ctx.requestSession();
  assert.deepEqual(puente.ultimo('elegir').tope, 10000);
  puente.ultimo('elegir').resolver({ mostrado: true });
  await p1;   // el resultado de la conexión llega por los eventos `sesion`
  const p2 = ctx.requestSession();
  puente.ultimo('elegir').rechazar({ codigo: 'session_error', detalle: 'sin_boton' });
  await assert.rejects(p2, (x) => x === 'session_error');
  const p3 = ctx.requestSession();
  puente.ultimo('elegir').rechazar({ codigo: 'session_error', detalle: 'red_local' });
  await assert.rejects(p3, (x) => x === 'cancel', 'en iPhone la app ya mostró su aviso: el JSX lo calla');
  const p4 = ctx.requestSession();
  const viejo = puente.ultimo('elegir');
  const p5 = ctx.requestSession();
  await assert.rejects(p4, (x) => x === 'cancel', 'un pedido nuevo cancela el anterior');
  viejo.resolver({ mostrado: true });   // la respuesta tardía del viejo no hace nada
  puente.ultimo('elegir').rechazar({ codigo: 'timeout' });
  await assert.rejects(p5, (x) => x === 'timeout');
});

test('sesión: SESSION_STATE_CHANGED con el mismo objeto por id, nombre en texto plano, latido mientras dura y getCurrentSession null después de ENDED', () => {
  const { puente, fw, ctx, cc } = armar();
  const ev = [];
  ctx.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, (e) => ev.push([e.sessionState, e.session, e.errorCode]));
  puente.evento({ tipo: 'sesion', estado: 'SESSION_STARTING', sesion: null });
  assert.equal(ctx.getCurrentSession(), null);
  sesionIniciada(puente);
  const s = ctx.getCurrentSession();
  assert.equal(s.getSessionId(), 's1');
  assert.equal(s.getCastDevice().friendlyName, 'Living & Comedor');
  assert.equal(cc.unescape(s.getCastDevice().friendlyName), 'Living & Comedor', 'unescape es la identidad: no hay nada escapado');
  assert.equal(puente.latidos.prendido, true);
  puente.evento({ tipo: 'sesion', estado: 'SESSION_RESUMED', sesion: { id: 's1', nombre: 'Living' } });
  assert.equal(ctx.getCurrentSession(), s, 'mismo id, mismo objeto');
  assert.equal(s.getCastDevice().friendlyName, 'Living');
  puente.evento({ tipo: 'sesion', estado: 'SESSION_ENDING' });
  puente.evento({ tipo: 'sesion', estado: 'SESSION_ENDED' });
  assert.equal(ctx.getCurrentSession(), null);
  assert.equal(puente.latidos.prendido, false);
  puente.evento({ tipo: 'sesion', estado: 'SESSION_START_FAILED' });
  puente.evento({ tipo: 'sesion', estado: 'CUALQUIERA' });
  assert.deepEqual(ev.map(([e, ses, err]) => [e, ses === s, err]), [
    ['SESSION_STARTING', false, null], ['SESSION_STARTED', true, null], ['SESSION_RESUMED', true, null],
    ['SESSION_ENDING', true, null], ['SESSION_ENDED', true, null], ['SESSION_START_FAILED', false, 'session_error'],
  ]);
});

test('disponibilidad: CAST_STATE_CHANGED sólo cuando cambia, y getCastState desde la caché', () => {
  const { puente, fw, ctx } = armar({ estado: 'NO_DEVICES_AVAILABLE' });
  const ev = [];
  ctx.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, (e) => ev.push(e.castState));
  assert.equal(ctx.getCastState(), 'NO_DEVICES_AVAILABLE');
  puente.evento({ tipo: 'disponibilidad', estado: 'NOT_CONNECTED' });
  puente.evento({ tipo: 'disponibilidad', estado: 'NOT_CONNECTED' });
  puente.evento({ tipo: 'disponibilidad', estado: 'ROTO' });
  puente.evento({ tipo: 'disponibilidad', estado: 'CONNECTED' });
  assert.deepEqual(ev, ['NOT_CONNECTED', 'CONNECTED']);
  assert.equal(ctx.getCastState(), 'CONNECTED');
});

test('la app ya transmitía: la sesión y su Media existen apenas se instala (observarCast la va a informar como SESSION_RESUMED)', () => {
  const { puente, ctx } = armar({ estado: 'CONNECTED', sesion: { id: 'vieja', nombre: 'TV', silencio: true, volumen: 0.2, media: { msid: 12, contentId: SRC, contentUrl: SRC, duracion: 78, estado: 'PAUSED', motivo: null, t: 70.2, rate: 1 } } });
  const s = ctx.getCurrentSession();
  assert.ok(s);
  assert.equal(s.isMute(), true);
  assert.equal(s.getVolume(), 0.2);
  const m = s.getMediaSession();
  assert.deepEqual([m.mediaSessionId, m.playerState, m.currentTime, m.media.contentId], [12, 'PAUSED', 70.2, SRC]);
  assert.equal(puente.latidos.prendido, true, 'hay sesión: late');
});

test('el msid del latido: el del Media que tiene oyentes (el que maneja CastPlayer), o null', () => {
  const { puente, ctx, sdk } = armar();
  sesionIniciada(puente);
  assert.equal(puente.latidos.msid(), null);
  puente.evento(media({ msid: 3, estado: 'PLAYING', t: 1 }));
  assert.equal(puente.latidos.msid(), null, 'nadie la maneja todavía (una lección que no adoptó la sesión)');
  const m = ctx.getCurrentSession().getMediaSession();
  const fn = () => {};
  m.addUpdateListener(fn);
  assert.equal(puente.latidos.msid(), 3);
  assert.equal(sdk._msidActivo(), 3);
  puente.evento(media({ msid: 4, estado: 'BUFFERING', t: 1 }));
  assert.equal(puente.latidos.msid(), null, 'la nueva todavía no la tomó');
  m.removeUpdateListener(fn);
});

test('loadMedia → cargar con los campos del protocolo (tope 25 s); el rechazo lleva el código', async () => {
  const { puente, ctx, cc } = armar();
  sesionIniciada(puente);
  const s = ctx.getCurrentSession();
  const info = new cc.media.MediaInfo(SRC, 'application/x-mpegurl');
  info.contentUrl = SRC;
  info.streamType = cc.media.StreamType.BUFFERED;
  info.hlsSegmentFormat = cc.media.HlsSegmentFormat.TS;
  info.hlsVideoSegmentFormat = cc.media.HlsVideoSegmentFormat.MPEG2_TS;
  const md = new cc.media.GenericMediaMetadata();
  md.title = 'Lección';
  md.images = [new cc.Image('https://cdn.ejemplo.test/thumbnail.jpg')];
  info.metadata = md;
  info.customData = { ivplayer: 1 };
  const req = new cc.media.LoadRequest(info);
  req.currentTime = 18.2;
  req.autoplay = true;
  const p = s.loadMedia(req);
  const e = puente.ultimo('cargar');
  assert.equal(e.tope, 25000);
  assert.deepEqual(e.datos, {
    media: { contentId: SRC, contentUrl: SRC, contentType: 'application/x-mpegurl', streamType: 'BUFFERED', hlsSegmentFormat: 'ts', hlsVideoSegmentFormat: 'mpeg2_ts', titulo: 'Lección', imagen: 'https://cdn.ejemplo.test/thumbnail.jpg', customData: { ivplayer: 1 } },
    t: 18.2, autoplay: true, rate: 1,
  });
  e.resolver({ msid: 1 });
  assert.equal(await p, undefined);
  const p2 = s.loadMedia(new cc.media.LoadRequest(new cc.media.MediaInfo(SRC, 'video/mp4')));
  puente.ultimo('cargar').rechazar({ codigo: 'load_media_failed' });
  await assert.rejects(p2, (x) => x === 'load_media_failed');
});

test('silencio del equipo (silenciar + el evento volumen), velocidad por sendMessage, y terminar siempre deteniendo la TV', async () => {
  const { puente, ctx } = armar();
  sesionIniciada(puente);
  puente.evento(media({ msid: 5, estado: 'PLAYING', t: 1 }));
  const s = ctx.getCurrentSession();
  const p = s.setMute(true);
  assert.deepEqual(puente.ultimo('silenciar').datos, { silencio: true });
  puente.evento({ tipo: 'volumen', silencio: true, volumen: 0.4 });
  puente.ultimo('silenciar').resolver({});
  await p;
  assert.equal(s.isMute(), true);
  const v = s.sendMessage('urn:x-cast:com.google.cast.media', { type: 'SET_PLAYBACK_RATE', playbackRate: 1.5, mediaSessionId: 5, requestId: 1 });
  assert.deepEqual(puente.ultimo('velocidad').datos, { msid: 5, rate: 1.5 });
  puente.ultimo('velocidad').resolver({});
  await v;
  await assert.rejects(s.sendMessage('urn:x-cast:otra', { type: 'X' }), (x) => x === 'invalid_parameter');
  await assert.rejects(s.sendMessage('urn:x-cast:com.google.cast.media', { type: 'QUEUE_NEXT' }), (x) => x === 'invalid_parameter');
  ctx.endCurrentSession(false);
  assert.deepEqual(puente.ultimo('terminar').datos, { detenerTV: true }, 'con false la TV seguiría sola sin frenar en las preguntas');
});

test('sin "velocidad" ni "silencio" en las capacidades, esos comandos no salen (y CastPlayer sigue)', async () => {
  const puente = puenteFalso();
  const sdk = crearCastNativo({ ...holaOk(), capacidades: ['cast'] }, puente);
  const ctx = sdk.cast.framework.CastContext.getInstance();
  sesionIniciada(puente);
  puente.evento(media({ msid: 1, estado: 'PLAYING', t: 1 }));
  const s = ctx.getCurrentSession();
  await assert.rejects(s.sendMessage('urn:x-cast:com.google.cast.media', { type: 'SET_PLAYBACK_RATE', playbackRate: 1.5, mediaSessionId: 1 }), (x) => x === 'not_implemented');
  await assert.rejects(s.setMute(true), (x) => x === 'not_implemented');
  assert.deepEqual(puente.enviados.map((e) => e.tipo), [], 'no se mandó nada a la app');
});

test('eventos ajenos o rotos se ignoran sin romper', () => {
  const { puente, ctx } = armar();
  puente.evento(media({ msid: 1, estado: 'PLAYING', t: 1 }));   // sin sesión
  sesionIniciada(puente);
  puente.evento({ tipo: 'parada', t: 3 });
  puente.evento({ tipo: 'media', msid: 'uno', estado: 'PLAYING' });
  puente.evento({ tipo: 'sesion', estado: 'SESSION_STARTED', sesion: { nombre: 'sin id' } });
  assert.equal(ctx.getCurrentSession().getSessionId(), 's1');
  assert.equal(ctx.getCurrentSession().getMediaSession(), null);
});

test('instalarCastNativo cuelga cast.framework y chrome.cast (lo que mira sdk() en cast.js) sin pisar el resto de window.chrome', () => {
  const w = { chrome: { runtime: 1 } };
  const sdk = instalarCastNativo(holaOk(), puenteFalso(), w);
  assert.equal(w.cast.framework.VERSION, 'hub-app-ivcast-1');
  assert.equal(w.chrome.runtime, 1);
  assert.ok(w.chrome.cast.media.MediaInfo);
  assert.equal(w.cast.framework.CastContext.getInstance(), sdk.cast.framework.CastContext.getInstance());
  const w2 = {};
  instalarCastNativo(holaOk(), puenteFalso(), w2);
  assert.ok(w2.chrome.cast && w2.cast.framework);
});

// ─── CastPlayer de verdad a través del shim ─────────────────────────────────
let jugador = null;
afterEach(() => { jugador?.destroy(); jugador = null; delete window.cast; delete window.chrome; });

async function conShim(prueba, { estado = 'PAUSED', t = 40 } = {}) {
  // Relojes de mentira: los topes de los comandos de CastPlayer (8 s) no tienen que tener viva la prueba.
  prueba.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const puente = puenteFalso();
  instalarCastNativo(holaOk({ estado: 'CONNECTED', sesion: { id: 's', nombre: 'TV', media: { msid: 1, contentId: SRC, contentUrl: SRC, duracion: 78, estado, motivo: null, t, rate: 1 } } }), puente, window);
  const sesion = window.cast.framework.CastContext.getInstance().getCurrentSession();
  jugador = new CastPlayer(sesion, { src: SRC, adoptar: true, reproducir: estado === 'PLAYING', duracion: 78 });
  const eventos = [];
  for (const ev of ['timeupdate', 'seeked', 'play', 'pause']) jugador.on(ev, (d) => eventos.push({ ev, t: d && d.seconds }));
  await new Promise((r) => queueMicrotask(r));
  await tick();
  eventos.length = 0;
  return { puente, eventos };
}

test('CastPlayer por el shim: un salto del control remoto con la TV en pausa llega como timeupdate en el mismo aviso', async (t) => {
  const { puente, eventos } = await conShim(t, { estado: 'PAUSED', t: 40 });
  assert.equal(puente.latidos.msid(), 1, 'adoptó la media: el latido lleva su msid');
  puente.evento(media({ msid: 1, estado: 'PAUSED', t: 70 }));
  assert.deepEqual(eventos[0], { ev: 'timeupdate', t: 70 }, JSON.stringify(eventos));
  assert.ok(eventos.some((e) => e.ev === 'seeked' && e.t === 70), JSON.stringify(eventos));
  // El mismo estado otra vez: el shim lo descarta y CastPlayer no ve nada.
  eventos.length = 0;
  puente.evento(media({ msid: 1, estado: 'PAUSED', t: 70 }));
  assert.deepEqual(eventos, []);
});

test('CastPlayer por el shim: play y pausa salen como comandos del protocolo con el msid de la media adoptada', async (t) => {
  const { puente } = await conShim(t, { estado: 'PAUSED', t: 40 });
  await jugador.play();
  assert.deepEqual(puente.ultimo('play').datos, { msid: 1 });
  puente.ultimo('play').resolver({});
  await jugador.pause();
  assert.deepEqual(puente.ultimo('pausa').datos, { msid: 1 });
  jugador.pausarAlSalir();   // ya en pausa: no manda otra
  assert.equal(puente.enviados.filter((e) => e.tipo === 'pausa').length, 1);
  jugador.destroy();
  jugador = null;
  assert.equal(puente.latidos.msid(), null, 'sin CastPlayer, el latido dice null (la app vigila con eso)');
});

test('CastPlayer por el shim: la carga (renovación o conexión) es un cargar con autoplay y el segundo, y la media nueva se engancha por MEDIA_SESSION', async (t) => {
  // Relojes de mentira: el tope de 20 s del LOAD de CastPlayer no tiene que tener viva la prueba.
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const puente = puenteFalso();
  instalarCastNativo(holaOk({ estado: 'CONNECTED' }), puente, window);
  puente.evento({ tipo: 'sesion', estado: 'SESSION_STARTED', sesion: { id: 's', nombre: 'TV' } });
  const sesion = window.cast.framework.CastContext.getInstance().getCurrentSession();
  let listo = 0;
  jugador = new CastPlayer(sesion, { src: SRC, inicio: 18, reproducir: true, duracion: 78, onListo: () => listo++ });
  const c = puente.ultimo('cargar');
  assert.ok(c, 'mandó cargar');
  assert.deepEqual([c.datos.t, c.datos.autoplay, c.datos.media.customData, c.datos.media.hlsVideoSegmentFormat], [18, true, { ivplayer: 1 }, 'mpeg2_ts']);
  assert.equal(puente.latidos.msid(), null, 'cargando: nadie maneja una media todavía');
  // La app: media del msid nuevo ANTES del ok.
  puente.evento(media({ msid: 1, estado: 'BUFFERING', t: 18 }));
  puente.evento(media({ msid: 1, estado: 'PLAYING', t: 18.05 }));
  c.resolver({ msid: 1 });
  await tick();
  assert.equal(listo, 1);
  assert.equal(puente.latidos.msid(), 1);
});
