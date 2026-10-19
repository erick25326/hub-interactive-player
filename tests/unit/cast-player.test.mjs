// El ADAPTADOR de Chromecast (CastPlayer de src/cast.js) contra una TV falsa mínima,
// sin navegador ni SDK de Google. Lo que se prueba es su CONTRATO con el componente:
// lo que pasa en la TV le llega como 'timeupdate', y el candado (la guardia de saltos,
// el efecto que deshace un salto de la TV con la pregunta abierta) sólo mira eso: el
// 'seeked' el componente lo usa para apagar la ruedita y nada más.
//
// Por qué acá y no sólo en el navegador: el receptor simulado de las pruebas de
// navegador avisa un salto en DOS estados (BUFFERING y después PAUSED o PLAYING), y el
// latido de 200 ms informa el segundo nuevo mientras la TV reproduce. Las dos cosas
// tapaban un 'timeupdate' que faltara (oct-2026: una mutación que lo sacaba pasaba toda
// la suite). Un Chromecast de verdad puede avisar el salto en un solo estado: con la
// TV en pausa, el componente recién se enteraba con el pedido de estado de los 5 s.
//
// La TV falsa: una "media" con playerState/currentTime y su listener de cambios. Sin
// window.cast/chrome.cast, CastPlayer no manda comandos (sdk() da null): sólo se mira
// cómo interpreta los avisos de la TV.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// CastPlayer mira window.cast / window.chrome sólo adentro de sus métodos. Un window
// vacío alcanza para que sdk() diga "no hay SDK" en vez de tirar ReferenceError.
globalThis.window ??= {};
const { CastPlayer } = await import('../../src/cast.js');

// La TV: una media del SDK reducida a lo que lee CastPlayer.
function crearTV({ estado = 'PAUSED', t = 0, duracion = 78 } = {}) {
  const oyentes = new Set();
  const media = {
    playerState: estado, currentTime: t, playbackRate: 1, idleReason: null,
    media: { duration: duracion, contentId: 'https://cdn.ejemplo/11111111-2222-4333-8444-555555555555/playlist.m3u8' },
    addUpdateListener: (f) => oyentes.add(f),
    removeUpdateListener: (f) => oyentes.delete(f),
  };
  const session = {
    isMute: () => false,
    getMediaSession: () => media,
    addEventListener() {}, removeEventListener() {},
  };
  // La TV avisa un cambio: UN solo estado, como puede hacerlo un Chromecast real.
  const avisar = (cambios) => { Object.assign(media, cambios); for (const f of [...oyentes]) f(true); };
  return { media, session, avisar };
}

let jugador = null;
afterEach(() => { jugador?.destroy(); jugador = null; });

// Engancha una sesión ya en curso (adoptar: no carga nada) y junta lo que emite.
async function conectar(tv, { reproducir = false } = {}) {
  jugador = new CastPlayer(tv.session, { src: tv.media.media.contentId, adoptar: true, reproducir, duracion: 78 });
  const eventos = [];
  for (const ev of ['timeupdate', 'seeked', 'play', 'pause']) jugador.on(ev, (d) => eventos.push({ ev, t: d && d.seconds }));
  await new Promise((r) => queueMicrotask(r));   // el estado inicial sale en una microtarea
  await new Promise((r) => setImmediate(r));
  eventos.length = 0;
  return eventos;
}

test('un salto del control remoto con la TV EN PAUSA le llega al componente como timeupdate en el mismo aviso, antes del seeked', async () => {
  const tv = crearTV({ estado: 'PAUSED', t: 40 });
  const eventos = await conectar(tv);
  // El control remoto lleva la TV de 40 a 70 (cruzando la pregunta de los 60).
  tv.avisar({ currentTime: 70 });
  // Sincrónico: sin esperar ningún timer (el latido no informa con la TV en pausa y el
  // pedido de estado sale recién a los 5 s).
  assert.deepEqual(eventos[0], { ev: 'timeupdate', t: 70 }, `lo primero tiene que ser el segundo nuevo: ${JSON.stringify(eventos)}`);
  assert.ok(eventos.some((e) => e.ev === 'seeked' && e.t === 70), `y además el seeked: ${JSON.stringify(eventos)}`);
  assert.equal(await jugador.getCurrentTime(), 70);
});

test('un salto del control remoto con la TV reproduciendo también llega en el mismo aviso, sin esperar al latido', async () => {
  const tv = crearTV({ estado: 'PLAYING', t: 30 });
  const eventos = await conectar(tv, { reproducir: true });
  tv.avisar({ currentTime: 50 });
  assert.deepEqual(eventos[0], { ev: 'timeupdate', t: 50 }, JSON.stringify(eventos));
});

test('una corrección chica de la TV (deriva) no se toma como salto de afuera', async () => {
  const tv = crearTV({ estado: 'PAUSED', t: 40 });
  const eventos = await conectar(tv);
  tv.avisar({ currentTime: 40.4 });
  assert.ok(!eventos.some((e) => e.ev === 'seeked'), `0,4 s no es un salto: ${JSON.stringify(eventos)}`);
  // En pausa igual se informa dónde quedó, para que el componente muestre el cuadro real.
  assert.deepEqual(eventos, [{ ev: 'timeupdate', t: 40.4 }]);
});

// ─── Subtítulos en la TV (1.4.0): lo puro ───────────────────────────────────
// La pista, el estilo y la lectura de lo que dice una media de la TV. El recorrido entero
// (LOAD, EDIT_TRACKS_INFO, adoptar, recargar con la pista) está en cast-nativo.test.mjs
// (CastPlayer por el shim) y en escenarios/tv-subtitulos.mjs (navegador).
const { pistaSubtitulos, estiloSubtitulos, idsSubtitulos, pistasDe, pistasPosibles, PISTA_SUBTITULOS } = await import('../../src/cast.js');

// Un chrome.cast mínimo con las clases del Web SDK y SIN los enumerados del estilo.
const ccMinimo = () => {
  class Track { constructor(id, tipo) { this.trackId = id; this.type = tipo; } }
  class TextTrackStyle {}
  class EditTracksInfoRequest { constructor(ids) { this.activeTrackIds = ids; } }
  return { media: { Track, TextTrackStyle, EditTracksInfoRequest, TrackType: { TEXT: 'TEXT' }, TextTrackType: { SUBTITLES: 'SUBTITLES' } } };
};

test('la pista de subtítulos para el LOAD: TEXT, SUBTITLES, el VTT firmado, en español, siempre con el id 1', () => {
  const cc = ccMinimo();
  const p = pistaSubtitulos(cc, 'https://campus.ejemplo.test/mod/ivplayer/subtitulos.php?id=7&e=1&s=x');
  assert.ok(p instanceof cc.media.Track);
  assert.deepEqual({ ...p }, { trackId: PISTA_SUBTITULOS, type: 'TEXT', trackContentId: 'https://campus.ejemplo.test/mod/ivplayer/subtitulos.php?id=7&e=1&s=x', trackContentType: 'text/vtt', subtype: 'SUBTITLES', name: 'Español', language: 'es' });
  assert.deepEqual([idsSubtitulos(true), idsSubtitulos(false)], [[1], []]);
});

test('el estilo en la TV: letra más grande, blanca sobre negro semitransparente (también sin los enumerados del SDK)', () => {
  const e = estiloSubtitulos(ccMinimo());
  assert.ok(e.fontScale > 1);
  assert.deepEqual([e.foregroundColor, e.backgroundColor, e.edgeType, e.fontGenericFamily, e.windowType], ['#FFFFFFFF', '#000000B3', 'NONE', 'SANS_SERIF', 'NONE']);
});

test('¿el SDK sabe de pistas? Sin Track, EditTracksInfoRequest o TextTrackStyle, no (los subtítulos quedan en el celular)', () => {
  assert.equal(pistasPosibles(ccMinimo()), true);
  for (const falta of ['Track', 'EditTracksInfoRequest', 'TextTrackStyle']) {
    const cc = ccMinimo();
    delete cc.media[falta];
    assert.equal(pistasPosibles(cc), false, falta);
  }
  assert.equal(pistasPosibles(null), false);
});

test('lo que dice una media de la TV de nuestra pista: si la tiene y si está prendida', () => {
  const conPista = { media: { tracks: [{ trackId: 1, type: 'TEXT' }] } };
  assert.deepEqual(pistasDe({ ...conPista, activeTrackIds: [1] }), { tiene: true, prendida: true });
  assert.deepEqual(pistasDe({ ...conPista, activeTrackIds: [] }), { tiene: true, prendida: false });
  assert.deepEqual(pistasDe({ media: { tracks: [{ trackId: 2 }] }, activeTrackIds: [2] }), { tiene: false, prendida: false }, 'otra pista no es la nuestra');
  assert.deepEqual(pistasDe({ media: { tracks: null }, activeTrackIds: [] }), { tiene: null, prendida: false }, 'sin pistas informadas (la app): no se sabe');
  assert.deepEqual(pistasDe({ media: {}, activeTrackIds: [1] }), { tiene: true, prendida: true }, 'prendida es que la tiene');
  assert.deepEqual(pistasDe({ media: {} }), { tiene: null, prendida: null });
  assert.deepEqual(pistasDe(null), { tiene: null, prendida: null });
});
