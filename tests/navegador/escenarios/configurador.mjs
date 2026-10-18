// El configurador de interacciones con un video de la COMPU: los videos que van
// directo a Bunny no tienen Vimeo de donde tomar los tiempos. Se prueba el
// configurador ARMADO como el de GitHub Pages (con este reproductor adentro), con un
// MP4 sintético que genera ffmpeg y que se abre por el botón de verdad: el clic abre
// el diálogo de archivos, la prueba lo intercepta y le pasa el archivo
// (Page.setInterceptFileChooserDialog + DOM.setFileInputFiles), que es lo mismo que
// elegirlo a mano. Sin ffmpeg se saltea diciendo por qué.
// El SDK de Vimeo, JSZip y las fuentes se bloquean: el modo local no puede depender
// de nada de afuera (y así la prueba no depende de la red).
// También el ida y vuelta con Moodle: el mensaje con que mod_form.php abre el
// configurador (lo repite cada medio segundo) y lo que devuelve "Guardar en Moodle",
// pasado por el manejador REAL de mod_form.php (leído del archivo): con un video de la
// compu, el campo de Vimeo de la actividad no se toca.
// Las herramientas (clics, descargas, el script de mod_form) están en
// apoyo/configurador.mjs; el video de Bunny que manda Moodle, en configurador-bunny.mjs.
// Todos los IDs, hashes y URLs son sintéticos (el repo es público).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dormir } from '../apoyo/chrome.mjs';
import { GUID_PRUEBA } from '../apoyo/servidor.mjs';
import { herramientas, codigoModForm, generarMp4, VIMEO_DE_MOODLE } from '../apoyo/configurador.mjs';
import { hayFfmpeg } from '../../../scripts/generar-video-prueba.mjs';

const DURACION = 12;
// El videoUrl que pone la skill interacciones-video: el HLS de Bunny sin firmar.
const BUNNY_DE_LA_SKILL = `https://vz-ejemplo.b-cdn.net/${GUID_PRUEBA}/playlist.m3u8`;

// Un WebM "en vivo" (sin Duration ni Cues en la cabecera), como los que graba
// MediaRecorder: el navegador da duration = Infinity hasta haberlo leído entero.
function generarWebmSinDuracion(destino, segundos) {
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=10:duration=${segundos}`,
    '-c:v', 'libvpx', '-b:v', '200k', '-deadline', 'realtime', '-cpu-used', '8', '-g', '10',
    '-an', '-f', 'webm', '-live', '1', destino,
  ], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg no pudo generar el WebM sin duración:\n${r.stderr || r.error}`);
}

export function registrar(entorno, { avisar = () => {} } = {}) {
  const { pagina: p } = entorno;
  const exigir = process.env.IVP_EXIGIR_NAVEGADOR === '1';
  const faltaFfmpeg = hayFfmpeg() ? null : 'no hay ffmpeg en el PATH para generar el MP4 de prueba';
  // Como el resto de la suite: con IVP_EXIGIR_NAVEGADOR=1 (CI) no se saltea, falla.
  const sinFfmpeg = faltaFfmpeg && !exigir ? faltaFfmpeg : null;
  if (sinFfmpeg) avisar(`${sinFfmpeg}: se saltean las pruebas del configurador con un video de la compu`);

  describe('configurador · video de la compu (los de Bunny)', () => {
    let tmp = null, mp4 = null, mp4b = null, roto = null, texto = null, webm = null;
    const h = herramientas(entorno, { skip: sinFfmpeg });
    const { ev, esperar, clic, abrirArchivo, exportar, paso, dialogos, pedidos } = h;
    const importar = (nombre, config) => h.importar(tmp, nombre, config);
    const cerrarVentanas = () => h.cerrarVentanas();
    const videoLocal = () => ev(`(() => {
      const v = document.querySelector('#videoContainer video');
      return v ? { t: v.currentTime, paused: v.paused, d: v.duration, rs: v.readyState, src: v.currentSrc } : null;
    })()`);

    before(async () => {
      if (sinFfmpeg) return;
      if (faltaFfmpeg) throw new Error(`${faltaFfmpeg} (IVP_EXIGIR_NAVEGADOR=1: no se saltea)`);
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivp-configurador-'));
      mp4 = path.join(tmp, 'clase-de-prueba.mp4');
      generarMp4(mp4, DURACION);
      // Una copia con otro nombre, para probar el cambio de archivo.
      mp4b = path.join(tmp, 'otra-clase.mp4');
      fs.copyFileSync(mp4, mp4b);
      // Un .mp4 que no es un video (el navegador le pone video/mp4 por la extensión y
      // recién al leerlo falla) y un archivo que no es video ni por el tipo.
      roto = path.join(tmp, 'clase-rota.mp4');
      fs.writeFileSync(roto, 'esto no es un video '.repeat(200));
      texto = path.join(tmp, 'notas.txt');
      fs.writeFileSync(texto, 'notas de la clase');
      webm = path.join(tmp, 'grabacion-sin-duracion.webm');
      generarWebmSinDuracion(webm, 6);
      await h.preparar();
      await h.abrirConfigurador();
    });

    after(async () => {
      if (sinFfmpeg) return;
      await h.desarmar();
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    });

    paso('"Abrir video de tu computadora" lo reproduce acá, sin Vimeo, con su duración y sin subir nada', async () => {
      assert.equal(await ev(`typeof Vimeo`), 'undefined', 'el SDK de Vimeo tenía que estar bloqueado');
      await abrirArchivo(mp4);
      await esperar(`reproductor && reproductor.tipo === 'local' && videoDuration > 0`, 10000, 'el video local no quedó listo');
      const v = await videoLocal();
      assert.ok(v.src.startsWith('blob:'), `el <video> no lee el archivo por una URL blob: (${v.src})`);
      assert.ok(Math.abs(v.d - DURACION) < 0.5, `duración del <video>: ${v.d}`);
      assert.ok(Math.abs((await ev('videoDuration')) - DURACION) < 0.5, 'la duración del configurador no es la del video');
      assert.ok(Math.abs((await ev('reproductor.getDuration()')) - DURACION) < 0.5, 'getDuration() no da la duración');
      assert.match(await ev(`document.getElementById('fuenteLocal').textContent`), /clase-de-prueba\.mp4/);
      // Ningún pedido de red con el video: el blob se lee del disco.
      assert.equal(entorno.srv.pedidosHls.filter((r) => /clase-de-prueba/.test(r)).length, 0);
    });

    paso('play y pausa por la misma interfaz que Vimeo', async () => {
      await ev(`reproductor.play().then(() => true)`);
      await esperar(`(() => { const v = document.querySelector('#videoContainer video'); return !v.paused && v.currentTime > 0.5; })()`, 8000, 'no avanzó al darle play');
      await ev(`reproductor.pause().then(() => true)`);
      const a = await videoLocal();
      assert.ok(a.paused, 'no quedó en pausa');
      await dormir(400);
      const b = await videoLocal();
      assert.ok(Math.abs(b.t - a.t) < 0.05, `en pausa siguió avanzando: ${a.t} → ${b.t}`);
    });

    paso('"Usar tiempo actual" toma el tiempo del video local', async () => {
      await clic('.add-dropdown-wrap .btn-primary');
      await esperar(`document.getElementById('addDropdown').classList.contains('open')`, 3000, 'no se abrió el menú de agregar');
      await clic(`#addDropdown button[onclick="addInteraction('note')"]`);
      await esperar(`interactions.length === 1 && !!document.getElementById('usarTiempoBtn')`, 3000, 'no se agregó la nota');
      // Como si lo hubiera llevado con la barra del <video>.
      await ev(`reproductor.setCurrentTime(4.6).then(() => true)`);
      await esperar(`document.getElementById('tiempoActual').textContent === '(0:04)'`, 3000, 'el botón no muestra el tiempo del video');
      await clic('#usarTiempoBtn');
      await esperar(`document.getElementById('edit-time').value === '0:04'`, 3000, 'no tomó el tiempo del video');
      assert.equal(await ev('interactions[0].time'), 4);
      // La línea de tiempo usa la duración del archivo.
      await esperar(`document.getElementById('previewTimelineWrap').style.display === 'block'`, 3000, 'no apareció la línea de tiempo');
      const izq = await ev(`parseFloat(document.querySelector('.preview-timeline-marker').style.left)`);
      assert.ok(Math.abs(izq - (4 / DURACION) * 100) < 1, `la marca quedó en ${izq} %`);
    });

    paso('"Ir a este tiempo" lleva el video local al tiempo de la interacción y lo deja en pausa', async () => {
      await ev(`reproductor.play().then(() => true)`);
      await ev(`(() => { const e = document.getElementById('edit-time'); e.value = '0:09'; e.dispatchEvent(new Event('change')); return true; })()`);
      await esperar(`interactions[0].time === 9 && !!document.getElementById('irTiempoBtn')`, 3000, 'no se guardó el tiempo escrito');
      await clic('#irTiempoBtn');
      await esperar(`(() => { const v = document.querySelector('#videoContainer video'); return v.paused && Math.abs(v.currentTime - 9) < 0.15 && !v.seeking; })()`, 5000, 'no saltó a 0:09 en pausa');
      assert.ok(Math.abs((await ev('reproductor.getCurrentTime()')) - 9) < 0.15, 'getCurrentTime() no da el tiempo del salto');
    });

    paso('el JSON exportado sale con vimeoId vacío y reimportarlo no cambia el video ni la URL de Vimeo', async () => {
      await ev(`(() => { document.getElementById('courseTitle').value = 'Clase de prueba'; document.getElementById('vimeoInput').value = 'https://vimeo.com/123456789'; return true; })()`);
      const { nombre, json } = await exportar();
      assert.equal(nombre, 'Clase_de_prueba.json');
      assert.equal(json.vimeoId, '');
      assert.equal(json.vimeoHash, null);
      assert.ok(!('videoUrl' in json), 'la URL blob: no puede ir al JSON');
      assert.deepEqual(json.interactions.map((i) => [i.type, i.time]), [['note', 9]]);
      // "Guardar en Moodle" manda lo mismo (buildConfig).
      assert.equal(await ev('window.generateConfig().vimeoId'), '');

      const url = await ev('reproductor.url');
      await importar('exportado.json', { ...json, interactions: [{ ...json.interactions[0], time: 3 }] });
      await esperar(`interactions.length === 1 && interactions[0].time === 3`, 3000, 'no se importó el JSON');
      assert.equal(await ev('reproductor && reproductor.url'), url, 'importar cambió el video abierto');
      assert.equal(await ev(`document.getElementById('vimeoInput').value`), 'https://vimeo.com/123456789', 'un vimeoId vacío borró la URL de Vimeo');

      // Los JSON viejos de la skill traían vimeoId "PENDIENTE" en los videos sin Vimeo:
      // no se intenta cargar en Vimeo ni queda en el campo para volver a Moodle.
      await importar('skill-vieja.json', { title: 'Video 1.1', vimeoId: 'PENDIENTE', vimeoHash: 'PENDIENTE', interactions: [{ id: 'note-a', type: 'note', time: 2, data: { title: 'A', text: 'B' } }] });
      await esperar(`interactions.length === 1 && interactions[0].id === 'note-a'`, 3000, 'no se importó el JSON de la skill');
      assert.equal(await ev('reproductor && reproductor.tipo === "local" && reproductor.url'), url, 'el JSON con vimeoId cambió el video local');
      assert.ok(await ev(`!!document.querySelector('#videoContainer video')`), 'se fue el <video>');
      assert.equal(await ev(`document.getElementById('vimeoInput').value`), 'https://vimeo.com/123456789', 'el "PENDIENTE" quedó en el campo de Vimeo');
      assert.equal(await ev('window.generateConfig().vimeoId'), '');
    });

    paso('Moodle abre el configurador con su Vimeo: no saca el video de la compu y vale sólo el primer mensaje (mod_form.php lo repite)', async () => {
      // El opener de mentira (Moodle) se queda con lo que mande "Guardar en Moodle", y
      // el cierre de la ventana que viene después no hace nada.
      await ev(`(() => {
        window.__guardados = [];
        window.opener = { postMessage: (data, origen) => { window.__guardados.push({ data: JSON.parse(JSON.stringify(data)), origen }); } };
        window.close = () => { window.__cerro = true; };
        return true;
      })()`);
      assert.equal(await ev(`typeof (window.opener && window.opener.postMessage)`), 'function', 'no se pudo poner el opener de mentira');
      const url = await ev('reproductor.url');
      // Lo que manda mod_form.php: el campo de Vimeo tal cual y las interacciones.
      const moodle = (config) => ev(`window.postMessage(${JSON.stringify({ type: 'ivplayer-load-config', config })}, '*'), true`);
      await moodle({ vimeoId: VIMEO_DE_MOODLE, interactions: [{ id: 'tf-1', type: 'true-false', time: 6, data: { statement: 'S', correct: true, explanation: 'E' } }] });
      await esperar(`interactions.length === 1 && interactions[0].id === 'tf-1' && !!document.getElementById('moodleSaveBtn')`, 3000, 'no llegó la config de Moodle');
      assert.equal(await ev(`document.getElementById('vimeoInput').value`), VIMEO_DE_MOODLE, 'el Vimeo de la actividad no quedó a mano para volver a él');
      assert.equal(await ev('reproductor && reproductor.tipo === "local" && reproductor.url'), url, 'la config de Moodle sacó el video de la compu');
      // La repetición (otra config, para que se note si se la toma) no pisa nada.
      await moodle({ vimeoId: '555555555', interactions: [{ id: 'note-z', type: 'note', time: 1, data: { title: 'Z', text: 'Z' } }] });
      await dormir(300);
      assert.equal(await ev('interactions.map((i) => i.id).join()'), 'tf-1', 'la repetición del mensaje de Moodle pisó las interacciones');
      assert.equal(await ev(`document.getElementById('vimeoInput').value`), VIMEO_DE_MOODLE, 'la repetición del mensaje de Moodle pisó el campo de Vimeo');
    });

    paso('un JSON de la skill con videoUrl (Bunny) se acepta sin usarlo de fuente, sin pisar lo de Moodle, y se conserva al exportar', async () => {
      const url = await ev('reproductor.url');
      const pedidos0 = pedidos.length;
      await importar('skill.json', { title: 'Video 1.1', videoUrl: BUNNY_DE_LA_SKILL, interactions: [{ id: 'note-a', type: 'note', time: 2, data: { title: 'A', text: 'B' } }] });
      await esperar(`interactions.length === 1 && interactions[0].id === 'note-a'`, 3000, 'no se importó el JSON de la skill');
      await dormir(300);
      assert.equal(await ev('reproductor && reproductor.tipo === "local" && reproductor.url'), url, 'el videoUrl cambió el video abierto');
      assert.equal(await ev(`document.querySelector('#videoContainer video').currentSrc`), url, 'el <video> no sigue con el archivo');
      assert.equal(await ev(`document.getElementById('vimeoInput').value`), VIMEO_DE_MOODLE, 'el JSON pisó el Vimeo que mandó Moodle');
      assert.deepEqual(pedidos.slice(pedidos0).filter((u) => u.includes('vz-ejemplo')), [], 'se pidió el video de Bunny');
      // Con el archivo abierto, el aviso de "no se reproduce acá" sobra.
      assert.equal(await ev(`document.getElementById('avisoVideoUrl').style.display`), 'none');
      // Ni Moodle ni la vista previa lo reciben: la vista previa usa el archivo.
      assert.equal(await ev(`'videoUrl' in window.generateConfig()`), false, 'el videoUrl llegó a lo que se manda a Moodle / al SCORM');
      assert.equal(await ev('window.generatePreviewConfig().videoUrl'), url, 'la vista previa no usa el archivo');
      // Exportado, vuelve a salir (sin vimeoId: así lo acepta la skill).
      const { json } = await exportar();
      assert.equal(json.videoUrl, BUNNY_DE_LA_SKILL);
      assert.equal(json.vimeoId, '');
      assert.equal(json.vimeoHash, null);
    });

    paso('"Guardar en Moodle" con el video de la compu no toca el campo de Vimeo de la actividad (manejador de mod_form.php)', async () => {
      await clic('#moodleSaveBtn');
      await esperar('window.__guardados.length === 1', 3000, '"Guardar en Moodle" no le mandó nada a Moodle');
      const { data, origen: destino } = (await ev('window.__guardados'))[0];
      assert.equal(destino, entorno.srv.base, 'no le contestó al origen que lo abrió');
      assert.equal(data.type, 'ivplayer-save-config');
      assert.equal(data.config.vimeoId, '');
      assert.ok(!('videoUrl' in data.config), 'el videoUrl viajó a Moodle');
      assert.deepEqual(data.config.interactions.map((i) => i.id), ['note-a']);

      // El formulario de la actividad con el <script> de mod_form.php, en un iframe.
      const { js, origen } = codigoModForm();
      const formulario = '<!doctype html><textarea id="id_interactions_json">[]</textarea>'
        + '<div id="ivplayer-interactions-preview"></div><button type="button" id="ivplayer-edit-btn"></button>'
        + `<span id="ivplayer-edit-status"></span><input id="id_vimeoid" value="${VIMEO_DE_MOODLE}">`
        + `<script>${js}</script>`;
      await ev(`new Promise((ok) => {
        const f = document.createElement('iframe');
        f.id = 'modFormDePrueba';
        f.style.display = 'none';
        f.onload = () => ok(true);
        f.srcdoc = ${JSON.stringify(formulario)};
        document.body.appendChild(f);
      })`);
      const guardar = (config, vimeoAntes) => ev(`(() => {
        const w = document.getElementById('modFormDePrueba').contentWindow, d = w.document;
        if (${JSON.stringify(vimeoAntes)} !== null) d.getElementById('id_vimeoid').value = ${JSON.stringify(vimeoAntes)};
        // Como "Editar interacciones" (una vez): la ventana que abre es esta página (la del
        // configurador), y sólo de ella acepta lo que vuelve.
        if (!w.__abrioConfigurador) { w.open = () => window; d.getElementById('ivplayer-edit-btn').click(); w.__abrioConfigurador = true; }
        w.dispatchEvent(new w.MessageEvent('message', { origin: ${JSON.stringify(origen)}, source: window, data: { type: 'ivplayer-save-config', config: ${JSON.stringify(config)} } }));
        return { vimeo: d.getElementById('id_vimeoid').value, json: d.getElementById('id_interactions_json').value };
      })()`);
      try {
        // Actividad con Vimeo (la vuelta atrás mientras dura la migración): queda igual.
        let r = await guardar(data.config, null);
        assert.equal(r.vimeo, VIMEO_DE_MOODLE, 'Moodle cambió el campo de Vimeo');
        assert.deepEqual(JSON.parse(r.json).map((i) => i.id), ['note-a'], 'Moodle no recibió las interacciones');
        // Actividad sólo con Bunny (campo de Vimeo vacío): no se le escribe ningún relleno.
        r = await guardar(data.config, '');
        assert.equal(r.vimeo, '', 'Moodle escribió algo en el campo de Vimeo vacío');
        // El arnés no es vacuo: con un vimeoId de verdad, Moodle sí lo escribe.
        r = await guardar({ vimeoId: '987654321', vimeoHash: null, interactions: [] }, null);
        assert.equal(r.vimeo, '987654321', 'el manejador de mod_form.php no corrió');
      } finally {
        await ev(`(document.getElementById('modFormDePrueba') || { remove() {} }).remove(), true`);
      }
    });

    paso('la vista previa abre el reproductor de verdad con el archivo y las interacciones andan', async () => {
      const url = await ev('reproductor.url');
      const pedidos0 = pedidos.length;
      await clic('button[onclick="preview()"]');
      try {
        await esperar(`window.__ventanas.length === 1 && !!window.__ventanas[0].document.querySelector('video')`, 10000, 'no se abrió la vista previa con un <video>');
        const W = 'window.__ventanas[0]';
        // El videoUrl de Bunny que trajo el JSON de la skill no es la fuente: es el archivo.
        const cfg = await ev(`(() => { const c = ${W}.PLAYER_CONFIG; return { vimeoId: c.vimeoId, videoUrl: c.videoUrl, n: c.interactions.length, t: c.interactions[0].time }; })()`);
        assert.deepEqual(cfg, { vimeoId: '', videoUrl: url, n: 1, t: 2 });
        await esperar(`(() => { const v = ${W}.document.querySelector('video'); return v.dataset.motor === 'mp4' && v.readyState >= 1 && Math.abs(v.duration - ${DURACION}) < 0.5; })()`, 10000, 'el reproductor de la vista previa no cargó el archivo');
        // La nota de los 2 s aparece reproduciendo, igual que con Vimeo.
        await ev(`${W}.document.querySelector('video').play().then(() => true, () => true)`);
        await esperar(`!!${W}.document.querySelector('.iv-note-card')`, 10000, 'la nota de los 2 s no apareció en la vista previa');
        assert.deepEqual(pedidos.slice(pedidos0).filter((u) => u.includes('vz-ejemplo')), [], 'la vista previa pidió el video de Bunny');
      } finally {
        await cerrarVentanas();
      }
    });

    paso('cambiar de archivo libera la URL del anterior', async () => {
      const vieja = await ev('reproductor.url');
      await abrirArchivo(mp4b);
      await esperar(`reproductor && reproductor.tipo === 'local' && reproductor.url !== ${JSON.stringify(vieja)} && videoDuration > 0`, 10000, 'no se cargó el otro archivo');
      assert.equal(await ev(`fetch(${JSON.stringify(vieja)}).then(() => 'viva', () => 'liberada')`), 'liberada', 'la URL del archivo anterior sigue viva');
      assert.equal(await ev(`document.querySelectorAll('#videoContainer video').length`), 1, 'quedó más de un <video>');
      assert.match(await ev(`document.getElementById('fuenteLocal').textContent`), /otra-clase\.mp4/);
      // Las interacciones no se tocan al cambiar de video.
      assert.equal(await ev('interactions.length'), 1);
    });

    paso('"Cargar video" de Vimeo reemplaza al archivo, lo libera y el JSON vuelve a llevar el vimeoId', async () => {
      const vieja = await ev('reproductor.url');
      await ev(`(() => { document.getElementById('vimeoInput').value = 'https://vimeo.com/123456789'; return true; })()`);
      await clic(`button[onclick="loadVideo()"]`);
      // Con el SDK bloqueado no hay reproductor de Vimeo: el cartel de error de siempre.
      await esperar(`/Error al cargar el video/.test(document.getElementById('videoContainer').textContent)`, 3000, 'no apareció el cartel de error de Vimeo');
      assert.equal(await ev(`fetch(${JSON.stringify(vieja)}).then(() => 'viva', () => 'liberada')`), 'liberada', 'la URL del archivo sigue viva');
      assert.equal(await ev(`document.getElementById('fuenteLocal').style.display`), 'none');
      assert.equal(await ev('window.generateConfig().vimeoId'), '123456789');
      // Sin el archivo, el aviso del videoUrl importado vuelve a verse; y exportado con
      // Vimeo no lo lleva (una sola fuente por archivo).
      assert.equal(await ev(`document.getElementById('avisoVideoUrl').style.display`), 'block');
      const { json } = await exportar();
      assert.equal(json.vimeoId, '123456789');
      assert.ok(!('videoUrl' in json), 'el JSON con Vimeo lleva también el videoUrl de Bunny');

      // Con Vimeo, un JSON viejo de la skill con vimeoId "PENDIENTE" tampoco cambia el
      // campo (ni lo intenta cargar), y lo que no es un ID de Vimeo no viaja a Moodle.
      await importar('skill-vieja-2.json', { title: 'Video 1.2', vimeoId: 'PENDIENTE', interactions: [{ id: 'note-b', type: 'note', time: 4, data: { title: 'A', text: 'B' } }] });
      await esperar(`interactions.length === 1 && interactions[0].id === 'note-b'`, 3000, 'no se importó el JSON de la skill');
      assert.equal(await ev(`document.getElementById('vimeoInput').value`), 'https://vimeo.com/123456789', 'el "PENDIENTE" pisó el campo de Vimeo');
      assert.equal(await ev('window.generateConfig().vimeoId'), '123456789');
      assert.equal(await ev(`document.getElementById('avisoVideoUrl').style.display`), 'none', 'el aviso quedó de un JSON anterior');
      await ev(`document.getElementById('vimeoInput').value = 'PENDIENTE', true`);
      assert.equal(await ev('window.generateConfig().vimeoId'), '', 'un relleno escrito a mano viajaría a Moodle como vimeoId');
    });

    paso('un archivo que no es video avisa sin tocar nada, y uno que el navegador no puede leer no queda como el video abierto', async () => {
      await ev(`document.getElementById('vimeoInput').value = ${JSON.stringify(VIMEO_DE_MOODLE)}, true`);
      await abrirArchivo(mp4);
      await esperar(`reproductor && reproductor.tipo === 'local' && videoDuration > 0`, 10000, 'el video local no quedó listo');
      const buena = await ev('reproductor.url');

      // Un .txt (text/plain): avisa y el video abierto sigue.
      const avisos0 = dialogos.length;
      await abrirArchivo(texto);
      for (const fin = Date.now() + 3000; dialogos.length === avisos0 && Date.now() < fin;) await dormir(50);
      // Se sacan de la lista: este aviso es el esperado (paso() falla con cualquier otro).
      const avisos = dialogos.splice(avisos0);
      assert.equal(avisos.length, 1, `avisos: ${JSON.stringify(avisos)}`);
      assert.match(avisos[0], /tiene que ser un video/);
      assert.equal(await ev('reproductor && reproductor.url'), buena, 'un archivo que no es video sacó el video abierto');
      assert.match(await ev(`document.getElementById('fuenteLocal').textContent`), /clase-de-prueba\.mp4/);

      // Un .mp4 que no es un video: pasa el filtro por el tipo y falla al leerlo.
      await abrirArchivo(roto);
      await esperar(`/No se pudo reproducir el archivo/.test(document.getElementById('videoContainer').textContent)`, 10000, 'no apareció el cartel de que el archivo no se puede reproducir');
      assert.equal(await ev('reproductor === null'), true, 'el archivo que no se puede leer quedó como el video abierto');
      const rota = await ev('[...window.__blobs.keys()].pop()');
      assert.ok(rota && rota !== buena && rota.startsWith('blob:'), `no encontré la URL del archivo roto (${rota})`);
      assert.equal(await ev(`fetch(${JSON.stringify(rota)}).then(() => 'viva', () => 'liberada')`), 'liberada', 'la URL del archivo roto sigue viva');
      assert.equal(await ev(`fetch(${JSON.stringify(buena)}).then(() => 'viva', () => 'liberada')`), 'liberada', 'la URL del archivo anterior sigue viva');
      assert.equal(await ev(`document.getElementById('fuenteLocal').style.display`), 'none', 'sigue diciendo "Reproduciendo…" un archivo que no se reproduce');
      assert.equal(await ev(`document.querySelectorAll('#videoContainer video').length`), 0);
      // Sin video abierto, como antes de abrir el archivo: lo que haya en el campo de Vimeo.
      assert.equal(await ev('window.generateConfig().vimeoId'), '123456789');
      assert.equal(await ev(`'videoUrl' in window.generatePreviewConfig()`), false, 'la vista previa llevaría la URL del archivo roto');
    });

    paso('un video sin duración conocida (WebM sin la duración en la cabecera): sin línea de tiempo hasta saberla, y se marca igual', async () => {
      await abrirArchivo(webm);
      await esperar(`reproductor && reproductor.tipo === 'local' && document.querySelector('#videoContainer video').readyState >= 1`, 10000, 'el WebM no cargó');
      await ev('reproductor.ready().then(() => true)');
      assert.equal(await ev(`String(document.querySelector('#videoContainer video').duration)`), 'Infinity',
        'el WebM de prueba trae la duración: esta prueba no probaría nada');
      await dormir(200);
      assert.equal(await ev('videoDuration'), 0, 'una duración Infinity llegó al configurador');
      assert.equal(await ev('reproductor.getDuration()'), 0);
      assert.equal(await ev(`document.getElementById('previewTimelineWrap').style.display`), 'none', 'línea de tiempo sin duración');
      // Saltar y tomar el tiempo andan igual.
      await ev(`reproductor.setCurrentTime(3.4).then(() => true)`);
      assert.ok(Math.abs((await ev('reproductor.getCurrentTime()')) - 3.4) < 0.25, 'no saltó en el video sin duración');
      await ev(`selectInteraction(interactions[0].id), true`);
      await esperar(`!!document.getElementById('usarTiempoBtn')`, 3000, 'no se abrió el editor de la interacción');
      await clic('#usarTiempoBtn');
      await esperar(`document.getElementById('edit-time').value === '0:03'`, 3000, 'no tomó el tiempo del video sin duración');
      // Cuando el navegador la averigua (acá, al leerlo hasta el final), llega por
      // 'durationchange' y aparece la línea de tiempo.
      await ev(`reproductor.setCurrentTime(1e6).then(() => true)`);
      await esperar(`videoDuration > 5 && videoDuration < 7 && document.getElementById('previewTimelineWrap').style.display === 'block'`, 10000,
        'no llegó la duración cuando el navegador la supo');
    });

    // Revisión de seguridad de la 1.4.0 (venía de antes): el tipo de una interacción
    // externa (un JSON importado, lo que manda Moodle) iba crudo al HTML de la barra
    // lateral, y el id de una opción, x/y y la duración, al del editor. Esta página es la
    // que tiene el enlace firmado de Bunny y la que le escribe a Moodle.
    paso('un JSON con un tipo o campos armados no ejecuta nada: entran sólo los cinco tipos y los números como números', async () => {
      const marca = (n) => `<img src=x onerror=window.__xssConfigurador=(window.__xssConfigurador||0)+${n}>`;
      await ev('window.__xssConfigurador = 0, true');
      await importar('armado.json', { title: 'Armado', interactions: [
        { id: 'malo', type: marca(1), time: 1, data: {} },
        null,
        { id: 'mc-1', type: 'multiple-choice', time: '5', data: { question: 'P', options: [{ id: `a"><b>${marca(10)}`, text: 'x' }, { id: 'b', text: 'y' }], correctId: 'b' } },
        { id: 'label-1', type: 'label', time: 7, duration: `3">${marca(100)}`, data: { text: 'T', definition: 'D', x: `1">${marca(1000)}`, y: 20 } },
        { id: 'hotspot-1', type: 'hotspot', time: 9, data: { spots: [{ x: `2">${marca(10000)}`, y: 30, label: 'L', info: 'I' }] } },
      ] });
      await esperar(`interactions.length === 3`, 3000, 'no se importó el JSON (o entró el tipo armado)');
      assert.deepEqual(await ev('interactions.map((i) => i.type)'), ['multiple-choice', 'label', 'hotspot'], 'entró un tipo que no es de los cinco');
      assert.equal(await ev('interactions[0].time'), 5, 'el tiempo tenía que entrar como número');
      assert.equal(await ev('interactions[1].duration'), 5, 'una duración que no es un número: la de siempre');
      // Abrir cada una en el editor (ahí van el id de la opción, x/y y la duración).
      for (const id of ['mc-1', 'label-1', 'hotspot-1']) {
        await ev(`selectInteraction(${JSON.stringify(id)}), true`);
        await esperar(`!!document.getElementById('edit-time')`, 3000, `no se abrió el editor de ${id}`);
      }
      await dormir(300);   // el error de un <img> es asincrónico
      assert.equal(await ev('window.__xssConfigurador'), 0, 'se ejecutó algo de lo importado');
      assert.equal(await ev(`document.querySelectorAll('#sidebarList img, #editorPanel img').length`), 0, 'lo importado armó elementos');
    });
  });
}
