// Subtítulos en la TV (1.4.0), con los receptores SIMULADOS (tests/navegador/simulados).
// La TV simulada guarda las pistas del LOAD, informa las prendidas en cada estado, acepta
// EDIT_TRACKS_INFO (rechaza un id que su media no tiene) y BAJA el VTT de la pista
// prendida, como el receptor: así se ve que el enlace que llega a la TV anda. Lo sirve el
// subtitulos.php de mentira del servidor de pruebas (sólo enlaces emitidos y vigentes).
// Todo corre DOS veces: con el emisor de Chrome y por el puente ivcast de hub-app.
//  - Transmitiendo con los subtítulos prendidos: el LOAD lleva la pista y activeTrackIds,
//    la TV baja el VTT, el celular NO los dibuja encima del cartel, el botón los apaga y
//    los prende EN LA TV, y al volver el celular los dibuja de nuevo.
//  - Una sesión adoptada con los subtítulos prendidos en la TV: el botón dice eso.
//  - Sin pista en la TV (sin subtitlesUrlTv, o una app sin 'subtitulos'): como antes, los
//    dibuja el celular y el botón no le manda nada a la TV.
// La renovación de la firma con la pista (la recarga lleva el enlace nuevo) está en
// firma.mjs, en la prueba de la TV.
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { CUES_PRUEBA } from '../apoyo/servidor.mjs';
import { dormir } from '../apoyo/chrome.mjs';
import { abrirConTV, comprobarModoApp } from './tv.mjs';

const CUE2 = CUES_PRUEBA[1][2], CUE3 = CUES_PRUEBA[2][2];
const RE_ENLACE = /\/subtitulos\?id=7&e=(\d+)&s=(sub-prueba-\d+)$/;

export function registrar(entorno) {
  const p = entorno.pagina;
  const log = () => p.a('window.__tv.log');
  const bajadas = () => p.a('window.__tv.bajadas');
  const pistas = async () => (await log()).filter((x) => x.ev === 'CMD pistas').map((x) => x.ids);

  for (const [modo, titulo, extra] of [
    ['web', 'subtítulos en la TV · Chromecast simulado', {}],
    ['app', 'subtítulos en la TV · hub-app simulada por el puente ivcast', { latPuente: '80' }],
  ]) describe(titulo, () => {
    paso(entorno, 'con los subtítulos prendidos, la TV recibe la pista y los dibuja ella; el botón los apaga y prende EN LA TV; al volver, el celular', async () => {
      await abrirConTV(p, modo, { query: { motor: 'hls', lat: '120', subs: 'vtt', ...extra }, progreso: { completed: ['n8'], currentTime: 0 } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      await p.clic('button[aria-label="Subtítulos"]');
      await p.debe(`A.estado().subsBtn === 'true'`, 3000, 'el botón de subtítulos no se prendió');
      await p.reproducir();
      await p.debe(`A.comp() > 0.5`, 10000, 'no arrancó a reproducir');
      await p.clic('.iv-tv-btn');
      await p.debe(`/^Reproduciendo en/.test(A.estado().capa || '') && window.__tv.receptor.estado === 'PLAYING'`, 10000, 'no se conectó');
      const desde = await p.a('A.ms()');

      // El LOAD: la pista de texto con el enlace firmado de subtitulos.php, prendida, y el
      // estilo para leer de lejos.
      const carga = (await log()).find((x) => x.ev === 'CMD LOAD');
      const pista = carga && carga.tracks && carga.tracks[0];
      assert.ok(pista && carga.tracks.length === 1, `el LOAD tiene que llevar UNA pista: ${JSON.stringify(carga)}`);
      assert.deepEqual([pista.trackId, pista.type, pista.subtype, pista.trackContentType, pista.language, pista.name], [1, 'TEXT', 'SUBTITLES', 'text/vtt', 'es', 'Español']);
      const enlace = RE_ENLACE.exec(pista.trackContentId || '');
      assert.ok(enlace && entorno.srv.subs.emitidas.get(enlace[2]) === Number(enlace[1]), `el enlace tiene que ser el que emitió el servidor: ${pista.trackContentId}`);
      assert.deepEqual(carga.activeTrackIds, [1], 'prendidos en el celular: prendidos en la TV');
      assert.ok(carga.estilo && carga.estilo.fontScale > 1 && carga.estilo.backgroundColor === '#000000B3' && carga.estilo.foregroundColor === '#FFFFFFFF', `estilo: ${JSON.stringify(carga.estilo)}`);
      if (modo === 'app') {
        await comprobarModoApp(p);
        const cargar = (await p.ev('window.__puente.recibidos')).find((r) => r.tipo === 'cargar');
        assert.deepEqual(cargar.m.activeTrackIds, [1], `el cargar del protocolo lleva activeTrackIds: ${JSON.stringify(cargar.m)}`);
        assert.equal(cargar.m.media.tracks[0].trackContentId, pista.trackContentId);
        assert.equal(cargar.m.media.textTrackStyle.fontScale, carga.estilo.fontScale);
      }
      // La TV bajó el VTT con ese enlace, sin sesión, con CORS abierto y como text/vtt.
      await p.debe(`window.__tv.bajadas.some((b) => b.estado === 200)`, 5000, 'la TV no bajó el VTT');
      const b = (await bajadas()).find((x) => x.estado === 200);
      assert.equal(b.url, pista.trackContentId);
      assert.match(b.tipo || '', /^text\/vtt/);
      assert.equal(b.cors, '*');
      assert.ok(/^WEBVTT/.test(b.texto) && b.texto.includes(CUE2), 'el VTT de la lección');

      // En el cue de 6 a 10,5: la TV los tiene, el celular NO los dibuja encima del cartel.
      await p.debe(`A.comp() > 6.4`, 12000, 'la TV no llegó al segundo cue');
      let e = await p.estado();
      assert.deepEqual(e.tv.pistas, [1], `la TV con la pista prendida: ${JSON.stringify(e.tv)}`);
      assert.ok(/^Reproduciendo en/.test(e.capa || ''), 'sigue transmitiendo');
      const dibujados = (await p.a('A.muestras')).filter((m) => m.ms >= desde && m.subtitulo);
      assert.deepEqual(dibujados.slice(0, 3), [], 'transmitiendo con la pista en la TV, el celular no los dibuja');

      // El botón: apagados en la TV y prendidos de nuevo, sin recargar (sin otro LOAD).
      await p.clic('button[aria-label="Subtítulos"]');
      await p.debe(`window.__tv.receptor.activeTrackIds.length === 0`, 5000, 'apagarlos no llegó a la TV');
      assert.equal((await p.estado()).subsBtn, 'false');
      await p.clic('button[aria-label="Subtítulos"]');
      await p.debe(`window.__tv.receptor.activeTrackIds.join() === '1'`, 5000, 'prenderlos no llegó a la TV');
      assert.deepEqual(await pistas(), [[], [1]], 'un EDIT_TRACKS_INFO por toque');
      assert.equal((await log()).filter((x) => x.ev === 'CMD LOAD').length, 1, 'prender o apagar no recarga el video en la TV');
      if (modo === 'app') {
        const recibidos = (await p.ev('window.__puente.recibidos')).filter((r) => r.tipo === 'pistas');
        assert.deepEqual(recibidos.map((r) => [r.m.ids, typeof r.m.msid]), [[[], 'number'], [[1], 'number']], 'el comando pistas con el msid de la media');
      }

      // Dejar de transmitir en el cue de 12 a 22: el celular los vuelve a dibujar.
      await p.debe(`A.comp() > 12.6`, 12000, 'la TV no llegó al tercer cue');
      await p.clic('.iv-tv-btn');
      await p.debe(`!A.estado().capa`, 5000, 'no volvió al celular');
      await p.debe(`A.estado().subtitulo === ${JSON.stringify(CUE3)}`, 3000, 'de vuelta en el celular, los subtítulos tenían que verse ahí');
    }, { timeout: 90000 });

    paso(entorno, 'una sesión adoptada con los subtítulos prendidos en la TV: el botón queda prendido, el celular no los dibuja, y el botón le habla a la TV', async () => {
      // La nota de los 8 ya vista: si no, la guardia de saltos lleva la TV de vuelta a ella.
      await abrirConTV(p, modo, { query: { motor: 'hls', lat: '120', subs: 'vtt', reanudar: '14', reanudarSubs: '1', ...extra }, progreso: { completed: ['n8'], currentTime: 0 } });
      await p.debe(`/^Reproduciendo en/.test(A.estado().capa || '')`, 10000, 'no adoptó la sesión con este video');
      await p.debe(`A.estado().subsBtn === 'true'`, 3000, 'el botón tenía que decir lo que tiene la TV (prendidos)');
      await p.debe(`A.comp() > 14.5`, 5000, 'no siguió a la TV');
      const e = await p.estado();
      assert.equal(e.subtitulo, null, `con la pista en la TV el celular no los dibuja: ${JSON.stringify(e)}`);
      assert.equal((await log()).filter((x) => x.ev === 'CMD LOAD').length, 0, 'adoptar no recarga');
      await p.clic('button[aria-label="Subtítulos"]');
      await p.debe(`window.__tv.receptor.activeTrackIds.length === 0`, 5000, 'apagarlos no llegó a la TV');
      await p.clic('button[aria-label="Subtítulos"]');
      await p.debe(`window.__tv.receptor.activeTrackIds.join() === '1'`, 5000, 'prenderlos no llegó a la TV');
      assert.deepEqual(await pistas(), [[], [1]]);
      if (modo === 'app') await comprobarModoApp(p);
    }, { timeout: 60000 });

    // Sin pista en la TV: sin el enlace (SCORM, demo, sitio sin el secreto) o, en la app,
    // una app que no declara 'subtitulos'. Los subtítulos no pueden quedar en ningún lado.
    const sinPista = modo === 'app' ? { sinSubtitulos: '1' } : { subsTv: '0' };
    paso(entorno, `sin pista en la TV (${modo === 'app' ? "app sin 'subtitulos'" : 'sin subtitlesUrlTv'}): el LOAD va sin pista, el celular los sigue dibujando y el botón no le manda nada a la TV`, async () => {
      await abrirConTV(p, modo, { query: { motor: 'hls', lat: '120', subs: 'vtt', ...sinPista, ...extra }, progreso: { completed: ['n8'], currentTime: 5.5 }, esperarEn: 5.5 });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      await p.clic('button[aria-label="Subtítulos"]');
      await p.reproducir();
      await p.clic('.iv-tv-btn');
      await p.debe(`/^Reproduciendo en/.test(A.estado().capa || '') && window.__tv.receptor.estado === 'PLAYING'`, 10000, 'no se conectó');
      const carga = (await log()).find((x) => x.ev === 'CMD LOAD');
      assert.equal(carga.tracks, null, `sin pista: ${JSON.stringify(carga)}`);
      if (modo === 'app') {
        const cargar = (await p.ev('window.__puente.recibidos')).find((r) => r.tipo === 'cargar');
        assert.ok(!('tracks' in cargar.m.media) && !('activeTrackIds' in cargar.m), `el cargar de siempre, sin campos nuevos: ${JSON.stringify(cargar.m)}`);
      }
      await p.debe(`A.estado().subtitulo === ${JSON.stringify(CUE2)}`, 8000, 'transmitiendo sin pista en la TV, el celular los tiene que seguir dibujando');
      await p.clic('button[aria-label="Subtítulos"]');
      await p.debe(`A.estado().subtitulo === null && A.estado().subsBtn === 'false'`, 3000, 'apagarlos en el celular');
      await dormir(500);
      assert.deepEqual(await pistas(), [], 'sin pista en la TV no se le manda nada');
      assert.deepEqual(await bajadas(), []);
    }, { timeout: 60000 });
  });
}
