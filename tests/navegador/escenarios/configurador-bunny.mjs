// El configurador de interacciones con el video de BUNNY de la actividad: "Editar
// interacciones" (mod_form.php) le manda, aparte de la config, un enlace firmado de vida
// corta al playlist HLS (ivplayer_bunny_configurador), y el configurador lo reproduce
// con hls.js (adentro del configurador armado) para tomar tiempos, saltar, la vista
// previa y exportar, igual que con Vimeo o con un archivo de la compu.
// El "CDN" es otro servidor (otro origen, como b-cdn.net frente a GitHub Pages) que
// valida el token de verdad, con CORS (apoyo/cdn-bunny.mjs), y el HLS es sintético
// (ffmpeg). Lo que protege: que el enlace firmado no termine en el JSON exportado, en lo
// que vuelve a Moodle ni en ningún campo del formulario (pasado por el manejador REAL de
// mod_form.php, leído del archivo); que con Bunny no se cargue el Vimeo de la actividad
// ni se toque su campo; que vale sólo el primer mensaje; que un enlace vencido o
// rechazado avise sin quedar como el video abierto; y, del lado de mod_form.php, que el
// bloque firmado se saque de la página y no se mande si se cambió el campo de Bunny o
// venció (con el reloj del servidor).
// Sin ffmpeg se saltea diciendo por qué. Todo es sintético (el repo es público).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dormir } from '../apoyo/chrome.mjs';
import { herramientas, codigoModForm, generarMp4, VIMEO_DE_MOODLE } from '../apoyo/configurador.mjs';
import { crearCdnBunny } from '../apoyo/cdn-bunny.mjs';
import { hayFfmpeg } from '../../../scripts/generar-video-prueba.mjs';

const DURACION = 12;
const GUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTRO_GUID = '12345678-9abc-4def-8123-456789abcdef';
const BUNNY_DE_LA_SKILL = `https://vz-ejemplo.b-cdn.net/${GUID}/playlist.m3u8`;
const NOTA = (id, time) => ({ id, type: 'note', time, data: { title: `Nota de los ${time} s`, text: 'Texto.' } });

// Un HLS como el de Bunny, chiquito: master a mano con dos calidades (RESOLUTION) y
// segmentos .ts de 2 s con H.264 y el audio AAC adentro.
function generarHls(dir, segundos) {
  const variantes = [{ alto: 180, ancho: 320, kbps: 250 }, { alto: 270, ancho: 480, kbps: 450 }];
  for (const v of variantes) {
    const sub = path.join(dir, `${v.alto}p`);
    fs.mkdirSync(sub, { recursive: true });
    const r = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=${v.ancho}x${v.alto}:rate=10:duration=${segundos}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${segundos}`,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-level:v', '3.0', '-pix_fmt', 'yuv420p',
      '-b:v', `${v.kbps}k`, '-g', '20', '-keyint_min', '20', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '64k', '-ac', '2',
      '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_list_size', '0',
      '-hls_segment_filename', 'seg_%03d.ts', 'video.m3u8',
    ], { cwd: sub, encoding: 'utf8', windowsHide: true });
    if (r.error || r.status !== 0) throw new Error(`ffmpeg no pudo generar el HLS de prueba (${v.alto}p):\n${r.stderr || r.error}`);
  }
  const master = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const v of variantes) {
    master.push(`#EXT-X-STREAM-INF:BANDWIDTH=${(v.kbps + 64) * 1300},RESOLUTION=${v.ancho}x${v.alto},CODECS="avc1.4d401e,mp4a.40.2"`, `${v.alto}p/video.m3u8`);
  }
  fs.writeFileSync(path.join(dir, 'playlist.m3u8'), master.join('\n') + '\n');
}

export function registrar(entorno, { avisar = () => {} } = {}) {
  const exigir = process.env.IVP_EXIGIR_NAVEGADOR === '1';
  const faltaFfmpeg = hayFfmpeg() ? null : 'no hay ffmpeg en el PATH para generar el HLS de prueba';
  const sinFfmpeg = faltaFfmpeg && !exigir ? faltaFfmpeg : null;
  if (sinFfmpeg) avisar(`${sinFfmpeg}: se saltean las pruebas del configurador con el video de Bunny`);

  describe('configurador · video de Bunny que manda Moodle (HLS firmado)', () => {
    let tmp = null, mp4 = null, cdn = null;
    let enlace = null;   // el `bunny` del primer mensaje de Moodle
    const h = herramientas(entorno, { skip: sinFfmpeg });
    const { ev, esperar, clic, abrirArchivo, exportar, paso, mensajeDeMoodle } = h;
    const importar = (nombre, config) => h.importar(tmp, nombre, config);
    const ahora = () => Math.floor(Date.now() / 1000);
    // Lo que manda mod_form.php en `bunny`: el playlist firmado y los segundos que le quedan.
    const bunny = (ttl = 7200) => ({ playlist: cdn.firmar(ahora() + ttl), restan: ttl });
    // 🔴 El enlace firmado (o el CDN) no puede aparecer en lo que sale del configurador.
    function sinEnlace(texto, que) {
      assert.ok(!/bcdn_token|token_path/i.test(texto), `${que} lleva la firma de Bunny`);
      assert.ok(!texto.includes(cdn.base), `${que} lleva la dirección del CDN`);
    }
    const videoAbierto = () => ev(`(() => {
      const v = document.querySelector('#videoContainer video');
      return v ? { t: v.currentTime, paused: v.paused, d: v.duration, seeking: v.seeking, n: document.querySelectorAll('#videoContainer video').length } : null;
    })()`);
    const textoRecuadro = () => ev(`document.getElementById('videoContainer').textContent`);

    before(async () => {
      if (sinFfmpeg) return;
      if (faltaFfmpeg) throw new Error(`${faltaFfmpeg} (IVP_EXIGIR_NAVEGADOR=1: no se saltea)`);
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivp-configurador-bunny-'));
      const dirHls = path.join(tmp, 'hls');
      generarHls(dirHls, DURACION);
      mp4 = path.join(tmp, 'clase-de-prueba.mp4');
      generarMp4(mp4, DURACION);
      cdn = await crearCdnBunny({ dir: dirHls, guid: GUID });
      await h.preparar();
      await h.abrirConfigurador();
    });

    after(async () => {
      if (sinFfmpeg) return;
      await h.desarmar();
      if (cdn) await cdn.cerrar();
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    });

    paso('Moodle manda el video de Bunny: lo reproduce con hls.js desde el CDN (otro origen) y no carga el Vimeo de la actividad', async () => {
      await h.ponerOpener();
      enlace = bunny();
      const p0 = cdn.pedidos.length;
      await mensajeDeMoodle({ config: { vimeoId: VIMEO_DE_MOODLE, interactions: [NOTA('n2', 2)] }, bunny: enlace });
      await esperar(`reproductor && reproductor.tipo === 'hls' && videoDuration > 0`, 15000, 'el video de Bunny no quedó listo');
      assert.equal(await ev('typeof Hls'), 'function', 'hls.js tenía que venir adentro del configurador armado');
      assert.equal(await ev('reproductor.motor'), 'hls');
      assert.ok(Math.abs((await ev('videoDuration')) - DURACION) < 0.6, `duración: ${await ev('videoDuration')}`);
      assert.equal(await ev('reproductor.url'), enlace.playlist);
      // La duración llega con la playlist (antes que el primer segmento): se espera la metadata.
      await esperar(`reproductor.video.readyState >= 1`, 10000, 'no llegó la metadata del video de Bunny');
      const servidos = cdn.pedidos.slice(p0);
      assert.ok(servidos.some((x) => x.estado === 200 && x.ruta.endsWith(`/${GUID}/playlist.m3u8`)), 'no se pidió el playlist firmado');
      assert.ok(servidos.some((x) => x.estado === 200 && x.ruta.endsWith('.ts')), 'no se bajó ningún segmento');
      assert.deepEqual(cdn.rechazos, [], 'el CDN rechazó pedidos');
      // Si hay Bunny, es Bunny: el Vimeo de la actividad queda en el campo, sin cargarse.
      assert.equal(await ev(`document.getElementById('vimeoInput').value`), VIMEO_DE_MOODLE);
      assert.equal(await ev(`!!document.querySelector('#videoContainer iframe')`), false, 'se creó el reproductor de Vimeo');
      assert.doesNotMatch(await textoRecuadro(), /Error al cargar el video/);
      assert.equal(await ev(`interactions.map((i) => i.id).join()`), 'n2');
      assert.ok(await ev(`!!document.getElementById('moodleSaveBtn')`), 'no apareció "Guardar en Moodle"');
      // Se dice de dónde sale y hasta cuándo, sin la URL.
      const fuente = await ev(`document.getElementById('fuenteLocal').textContent`);
      assert.match(fuente, /video de Bunny de la actividad/);
      assert.match(fuente, /vence a las \d{1,2}:\d{2}/);
      // La página (sin el texto de los scripts, que nombran bcdn_token para descartarlo).
      sinEnlace(await ev(`(() => { const c = document.body.cloneNode(true); c.querySelectorAll('script').forEach((s) => s.remove()); return c.outerHTML; })()`), 'la página del configurador');
      assert.equal(await ev(`document.getElementById('volverBunnyBtn').style.display`), 'none', 'el botón de volver a Bunny con Bunny abierto');
      // La repetición del mensaje (otro enlace, otro Vimeo, otras interacciones) no pisa nada.
      await mensajeDeMoodle({ config: { vimeoId: '555555555', interactions: [NOTA('nz', 1)] }, bunny: bunny(3600) });
      await dormir(300);
      assert.equal(await ev('reproductor && reproductor.url'), enlace.playlist, 'la repetición cambió el video');
      assert.equal(await ev(`interactions.map((i) => i.id).join()`), 'n2', 'la repetición pisó las interacciones');
      assert.equal(await ev(`document.getElementById('vimeoInput').value`), VIMEO_DE_MOODLE, 'la repetición pisó el campo de Vimeo');
    });

    paso('"Usar tiempo actual", "Ir a este tiempo" y la línea de tiempo con el video de Bunny', async () => {
      await ev(`reproductor.play().then(() => true, () => true)`);
      await esperar(`(() => { const v = document.querySelector('#videoContainer video'); return !v.paused && v.currentTime > 0.5; })()`, 10000, 'no avanzó al darle play');
      await ev(`reproductor.pause().then(() => true)`);
      await ev(`selectInteraction('n2'), true`);
      await esperar(`!!document.getElementById('usarTiempoBtn')`, 3000, 'no se abrió el editor de la nota');
      await ev(`reproductor.setCurrentTime(6.4).then(() => true)`);
      await esperar(`document.getElementById('tiempoActual').textContent === '(0:06)'`, 5000, 'el botón no muestra el tiempo del video');
      await clic('#usarTiempoBtn');
      await esperar(`document.getElementById('edit-time').value === '0:06'`, 3000, 'no tomó el tiempo del video');
      assert.equal(await ev('interactions[0].time'), 6);
      await ev(`(() => { const e = document.getElementById('edit-time'); e.value = '0:09'; e.dispatchEvent(new Event('change')); return true; })()`);
      await esperar(`interactions[0].time === 9 && !!document.getElementById('irTiempoBtn')`, 3000, 'no se guardó el tiempo escrito');
      await ev(`reproductor.play().then(() => true, () => true)`);
      await clic('#irTiempoBtn');
      await esperar(`(() => { const v = document.querySelector('#videoContainer video'); return v.paused && !v.seeking && Math.abs(v.currentTime - 9) < 0.3; })()`, 8000, 'no saltó a 0:09 en pausa');
      assert.ok(Math.abs((await ev('reproductor.getCurrentTime()')) - 9) < 0.3, 'getCurrentTime() no da el tiempo del salto');
      await esperar(`document.getElementById('previewTimelineWrap').style.display === 'block'`, 3000, 'no apareció la línea de tiempo');
      const izq = await ev(`parseFloat(document.querySelector('.preview-timeline-marker').style.left)`);
      assert.ok(Math.abs(izq - (9 / DURACION) * 100) < 2, `la marca quedó en ${izq} %`);
    });

    paso('exportar, importar y "Guardar en Moodle": sin el enlace firmado y sin tocar el campo de Vimeo (manejador real de mod_form.php)', async () => {
      let { json, texto } = await exportar();
      assert.equal(json.vimeoId, '');
      assert.equal(json.vimeoHash, null);
      assert.ok(!('videoUrl' in json), 'el JSON exportado lleva un videoUrl');
      sinEnlace(texto, 'el JSON exportado');
      sinEnlace(await ev('JSON.stringify(window.generateConfig())'), 'lo que se manda a Moodle');

      // Un JSON con un Vimeo de verdad no carga Vimeo ni saca el de Bunny, y no viaja.
      await importar('con-vimeo.json', { title: 'Lección', vimeoId: '222222222', interactions: [NOTA('nb', 3)] });
      await esperar(`interactions.length === 1 && interactions[0].id === 'nb'`, 3000, 'no se importó el JSON');
      await dormir(300);
      assert.equal(await ev('reproductor && reproductor.tipo === "hls" && reproductor.url'), enlace.playlist, 'importar cambió el video de Bunny');
      assert.equal(await ev(`!!document.querySelector('#videoContainer iframe')`), false, 'importar cargó Vimeo');
      assert.equal(await ev('window.generateConfig().vimeoId'), '', 'con Bunny, un vimeoId importado viajaría a Moodle');

      // El JSON de la skill (videoUrl sin firmar): con Bunny abierto el aviso sobra, y al
      // exportar sale ese videoUrl, nunca el firmado.
      await importar('skill.json', { title: 'Video 1.1', videoUrl: BUNNY_DE_LA_SKILL, interactions: [NOTA('na', 2)] });
      await esperar(`interactions.length === 1 && interactions[0].id === 'na'`, 3000, 'no se importó el JSON de la skill');
      assert.equal(await ev(`document.getElementById('avisoVideoUrl').style.display`), 'none', 'el aviso de "no se reproduce acá" con Bunny abierto');
      ({ json, texto } = await exportar());
      assert.equal(json.videoUrl, BUNNY_DE_LA_SKILL);
      sinEnlace(texto, 'el JSON exportado con el videoUrl de la skill');
      // Un videoUrl firmado que llegue en un JSON no se conserva (vence y abre el video).
      await importar('firmado.json', { title: 'Video 1.1', videoUrl: enlace.playlist, interactions: [NOTA('na', 2)] });
      await dormir(200);
      ({ json, texto } = await exportar());
      assert.ok(!('videoUrl' in json), 'se conservó un videoUrl firmado');
      sinEnlace(texto, 'el JSON reexportado');
      assert.equal(await ev('reproductor && reproductor.url'), enlace.playlist, 'importar cambió el video de Bunny');

      await clic('#moodleSaveBtn');
      await esperar('window.__guardados.length === 1', 3000, '"Guardar en Moodle" no le mandó nada a Moodle');
      const { data, origen: destino } = (await ev('window.__guardados'))[0];
      assert.equal(destino, entorno.srv.base, 'no le contestó al origen que lo abrió');
      assert.equal(data.type, 'ivplayer-save-config');
      assert.equal(data.config.vimeoId, '');
      assert.deepEqual(data.config.interactions.map((i) => i.id), ['na']);
      sinEnlace(JSON.stringify(data), 'lo que volvió a Moodle');

      // El formulario de la actividad (sólo Bunny y con Vimeo de respaldo) con el script
      // REAL de mod_form.php: cambian las interacciones y nada más.
      const { js, origen } = codigoModForm();
      for (const vimeoAntes of [VIMEO_DE_MOODLE, '']) {
        const formulario = '<!doctype html><textarea id="id_interactions_json">[]</textarea>'
          + `<input id="id_videourl" value="${GUID}"><input id="id_vimeoid" value="${vimeoAntes}">`
          + '<div id="ivplayer-interactions-preview"></div><button type="button" id="ivplayer-edit-btn"></button>'
          + `<span id="ivplayer-edit-status"></span><script>${js}</script>`;
        await ev(`new Promise((ok) => {
          const f = document.createElement('iframe');
          f.id = 'modFormDePrueba';
          f.style.display = 'none';
          f.onload = () => ok(true);
          f.srcdoc = ${JSON.stringify(formulario)};
          document.body.appendChild(f);
        })`);
        try {
          const r = await ev(`(() => {
            const w = document.getElementById('modFormDePrueba').contentWindow, d = w.document;
            // Como "Editar interacciones": la ventana que abre es esta página (la del
            // configurador), y sólo de ella acepta lo que vuelve.
            w.open = () => window;
            d.getElementById('ivplayer-edit-btn').click();
            w.dispatchEvent(new w.MessageEvent('message', { origin: ${JSON.stringify(origen)}, data: ${JSON.stringify(data)}, source: window }));
            return { vimeo: d.getElementById('id_vimeoid').value, bunny: d.getElementById('id_videourl').value, json: d.getElementById('id_interactions_json').value };
          })()`);
          assert.equal(r.vimeo, vimeoAntes, 'Moodle cambió el campo de Vimeo');
          assert.equal(r.bunny, GUID, 'Moodle cambió el campo de Bunny');
          assert.deepEqual(JSON.parse(r.json).map((i) => i.id), ['na'], 'Moodle no recibió las interacciones');
          sinEnlace(JSON.stringify(r), 'los campos del formulario');
        } finally {
          await ev(`(document.getElementById('modFormDePrueba') || { remove() {} }).remove(), true`);
        }
      }
    });

    paso('la vista previa abre el reproductor de verdad con el enlace firmado y las interacciones andan', async () => {
      await clic('button[onclick="preview()"]');
      try {
        await esperar(`window.__ventanas.length === 1 && !!window.__ventanas[0].document.querySelector('video')`, 10000, 'no se abrió la vista previa con un <video>');
        const W = 'window.__ventanas[0]';
        const cfg = await ev(`(() => { const c = ${W}.PLAYER_CONFIG; return { vimeoId: c.vimeoId, videoUrl: c.videoUrl, n: c.interactions.length, t: c.interactions[0].time }; })()`);
        assert.deepEqual(cfg, { vimeoId: '', videoUrl: enlace.playlist, n: 1, t: 2 });
        await esperar(`(() => { const v = ${W}.document.querySelector('video'); return v.dataset.motor === 'hls' && v.readyState >= 1 && Math.abs(v.duration - ${DURACION}) < 0.6; })()`, 15000, 'el reproductor de la vista previa no cargó el video de Bunny');
        await ev(`${W}.document.querySelector('video').play().then(() => true, () => true)`);
        await esperar(`!!${W}.document.querySelector('.iv-note-card')`, 15000, 'la nota de los 2 s no apareció en la vista previa');
      } finally {
        await h.cerrarVentanas();
      }
    });

    paso('un archivo de la compu se abre a mano encima de Bunny, y "Video de la actividad (Bunny)" vuelve al de la actividad', async () => {
      await abrirArchivo(mp4);
      await esperar(`reproductor && reproductor.tipo === 'local' && videoDuration > 0`, 10000, 'el video de la compu no quedó listo');
      assert.equal((await videoAbierto()).n, 1, 'quedó más de un <video>');
      assert.match(await ev(`document.getElementById('fuenteLocal').textContent`), /clase-de-prueba\.mp4/);
      assert.equal(await ev('window.generateConfig().vimeoId'), '');
      assert.equal(await ev(`document.getElementById('volverBunnyBtn').style.display`), '', 'no está el botón para volver a Bunny');
      const blob = await ev('reproductor.url');
      const p0 = cdn.pedidos.length;
      await clic('#volverBunnyBtn');
      await esperar(`reproductor && reproductor.tipo === 'hls' && videoDuration > 0`, 15000, 'no volvió al video de Bunny');
      assert.equal(await ev('reproductor.url'), enlace.playlist);
      assert.ok(cdn.pedidos.slice(p0).some((x) => x.estado === 200 && x.ruta.endsWith('/playlist.m3u8')), 'no volvió a pedir el playlist');
      assert.equal(await ev(`fetch(${JSON.stringify(blob)}).then(() => 'viva', () => 'liberada')`), 'liberada', 'la URL del archivo sigue viva');
      assert.equal((await videoAbierto()).n, 1, 'quedó más de un <video>');
      assert.equal(await ev(`document.getElementById('volverBunnyBtn').style.display`), 'none');
    });

    paso('un enlace que el CDN rechaza (vencido): cartel, no queda como el video abierto, no carga Vimeo y deja abrir el archivo', async () => {
      await h.abrirConfigurador();
      await h.ponerOpener();
      const r0 = cdn.rechazos.length;
      // Vencido para el CDN y vigente para el configurador (como con el reloj corrido).
      await mensajeDeMoodle({ config: { vimeoId: VIMEO_DE_MOODLE, interactions: [NOTA('n2', 2)] }, bunny: { playlist: cdn.firmar(ahora() - 60), restan: 3600 } });
      await esperar(`/rechazó el enlace/.test(document.getElementById('videoContainer').textContent)`, 10000, 'no apareció el cartel del enlace rechazado');
      assert.equal(await ev('reproductor === null'), true, 'el video que no cargó quedó como el video abierto');
      assert.ok(cdn.rechazos.slice(r0).some((r) => r.motivo === 'vencida'), `el CDN no lo rechazó por vencido: ${JSON.stringify(cdn.rechazos.slice(r0))}`);
      assert.equal(await ev(`document.querySelectorAll('#videoContainer video, #videoContainer iframe').length`), 0);
      assert.equal(await ev(`document.getElementById('vimeoInput').value`), VIMEO_DE_MOODLE);
      assert.equal(await ev('window.generateConfig().vimeoId'), '', 'con Bunny caído, el Vimeo del campo viajaría a Moodle');
      assert.equal(await ev(`document.getElementById('fuenteLocal').style.display`), 'none');
      assert.equal(await ev(`document.getElementById('volverBunnyBtn').style.display`), '', 'no quedó cómo volver a intentar');
      await abrirArchivo(mp4);
      await esperar(`reproductor && reproductor.tipo === 'local' && videoDuration > 0`, 10000, 'después del cartel no se pudo abrir el archivo');
    });

    paso('Moodle avisa que el enlace venció (el formulario estuvo abierto de más): cartel, sin pedirle nada al CDN ni cargar Vimeo', async () => {
      await h.abrirConfigurador();
      await h.ponerOpener();
      const p0 = cdn.pedidos.length;
      await mensajeDeMoodle({ config: { vimeoId: VIMEO_DE_MOODLE, interactions: [] }, bunny: { vencido: true } });
      await esperar(`/venció/.test(document.getElementById('videoContainer').textContent)`, 5000, 'no apareció el cartel del enlace vencido');
      await dormir(300);
      assert.equal(cdn.pedidos.length, p0, 'se le pidió algo al CDN con el enlace vencido');
      assert.equal(await ev('reproductor === null'), true);
      assert.equal(await ev(`!!document.querySelector('#videoContainer iframe')`), false, 'se cargó Vimeo');
      assert.equal(await ev('window.generateConfig().vimeoId'), '');
      assert.equal(await ev(`document.getElementById('volverBunnyBtn').style.display`), 'none', 'el botón no sirve sin enlace');
    });

    paso('sin hls.js (configurador sin armar): el HLS nativo del navegador', async () => {
      await h.abrirConfigurador();
      await ev('window.Hls = undefined, true');
      await mensajeDeMoodle({ config: { vimeoId: '', interactions: [] }, bunny: bunny() });
      await esperar(`reproductor && reproductor.tipo === 'hls' && reproductor.motor === 'nativo' && videoDuration > 0`, 15000, 'el HLS nativo no cargó el video de Bunny');
      assert.ok(Math.abs((await ev('videoDuration')) - DURACION) < 0.6);
      await ev(`reproductor.setCurrentTime(5).then(() => true)`);
      assert.ok(Math.abs((await ev('reproductor.getCurrentTime()')) - 5) < 0.6, 'no saltó con el nativo');
    }, { skip: sinFfmpeg || entorno.sinNativo || false });

    paso('mod_form.php: el enlace sale de la página al cargar, viaja sólo en el mensaje y no va si se cambió el campo de Bunny o venció', async () => {
      const { js, origen } = codigoModForm();
      // El bloque como lo arma ivplayer_configurador_fuente_html (JSON con "<" escapado).
      const bloque = (fuente) => `<script type="application/json" id="ivplayer-video-firmado">${JSON.stringify(fuente).replace(/</g, '\\u003C').replace(/>/g, '\\u003E').replace(/&/g, '\\u0026')}</script>`;
      const formulario = (fuente) => '<!doctype html><textarea id="id_interactions_json">[]</textarea>'
        + `<input id="id_videourl" value="${GUID}"><input id="id_vimeoid" value="${VIMEO_DE_MOODLE}">`
        + '<div id="ivplayer-interactions-preview"></div>'
        + (fuente ? bloque(fuente) : '')
        + '<button type="button" id="ivplayer-edit-btn"></button><span id="ivplayer-edit-status" style="color:#84F4BE"></span>'
        + `<script>${js}</script>`;
      const abrir = (fuente) => ev(`new Promise((ok) => {
        const f = document.createElement('iframe');
        f.id = 'modFormBunny';
        f.style.display = 'none';
        f.onload = () => ok(true);
        f.srcdoc = ${JSON.stringify(formulario(fuente))};
        document.body.appendChild(f);
      })`);
      const cerrar = () => ev(`(document.getElementById('modFormBunny') || { remove() {} }).remove(), true`);
      // "Editar interacciones" con un window.open de mentira: la ventana anota lo que
      // recibe y se da por cerrada después del primero (corta la repetición).
      const editar = (bunnyCampo = null) => ev(`new Promise((ok) => {
        const w = document.getElementById('modFormBunny').contentWindow, d = w.document;
        if (${JSON.stringify(bunnyCampo)} !== null) d.getElementById('id_videourl').value = ${JSON.stringify(bunnyCampo)};
        const recibidos = [];
        const falsa = { closed: false, postMessage(data, origen) { recibidos.push({ data: JSON.parse(JSON.stringify(data)), origen }); falsa.closed = true; } };
        w.open = () => falsa;
        d.getElementById('ivplayer-edit-btn').click();
        setTimeout(() => ok({ recibidos, status: d.getElementById('ivplayer-edit-status').textContent }), 900);
      })`);
      const t = ahora();
      try {
        // Vigente, con el reloj de esta compu una hora ADELANTADO respecto del servidor:
        // lo que le queda se mide con el del servidor (ahora + desfase).
        const ahoraServidor = t - 3600;
        const vigente = { playlist: cdn.firmar(ahoraServidor + 7200), expires: ahoraServidor + 7200, ahora: ahoraServidor, guid: GUID };
        await abrir(vigente);
        const estado = await ev(`(() => {
          const d = document.getElementById('modFormBunny').contentWindow.document;
          return { bloque: !!d.getElementById('ivplayer-video-firmado'), html: d.documentElement.outerHTML,
            campos: [...d.querySelectorAll('input, textarea')].map((e) => e.value).join(' ') };
        })()`);
        assert.equal(estado.bloque, false, 'el bloque firmado sigue en la página');
        sinEnlace(estado.html, 'la página del formulario después de cargar');
        sinEnlace(estado.campos, 'los campos del formulario');
        let r = await editar();
        assert.equal(r.recibidos.length, 1, 'no le mandó nada al configurador');
        const { data, origen: destino } = r.recibidos[0];
        assert.equal(destino, origen, 'el mensaje tiene que ir con el origen del configurador, no "*"');
        assert.equal(data.type, 'ivplayer-load-config');
        assert.equal(data.config.vimeoId, VIMEO_DE_MOODLE);
        assert.equal(data.bunny.playlist, vigente.playlist);
        assert.ok(data.bunny.restan > 7100 && data.bunny.restan <= 7200, `restan ${data.bunny.restan}: no se midió con el reloj del servidor`);
        sinEnlace(JSON.stringify(data.config), 'la config del mensaje (lo que vuelve a Moodle)');
        assert.equal(r.status, '');
        // El GUID guardado en otra forma (un enlace del reproductor de Bunny, en mayúsculas): va.
        r = await editar(`https://player.mediadelivery.net/play/123/${GUID.toUpperCase()}`);
        assert.equal(r.recibidos[0].data.bunny.playlist, vigente.playlist);
        // Cambiado o vaciado sin guardar: ya no es el video de la actividad.
        r = await editar(OTRO_GUID);
        assert.ok(!('bunny' in r.recibidos[0].data), 'mandó el video firmado con otro GUID en el campo');
        r = await editar('');
        assert.ok(!('bunny' in r.recibidos[0].data), 'mandó el video firmado con el campo de Bunny vacío');
        await cerrar();

        // Con menos de 5 minutos: no se manda el enlace, se avisa (acá y al configurador).
        await abrir({ playlist: cdn.firmar(t + 120), expires: t + 120, ahora: t, guid: GUID });
        r = await editar();
        assert.deepEqual(r.recibidos[0].data.bunny, { vencido: true });
        assert.match(r.status, /venció/);
        await cerrar();

        // Sin firmar (el sitio sin clave): va sin vencimiento.
        const plana = `${cdn.base}/${GUID}/playlist.m3u8`;
        await abrir({ playlist: plana, expires: null, ahora: t, guid: GUID });
        r = await editar();
        assert.deepEqual(r.recibidos[0].data.bunny, { playlist: plana, restan: null });
        await cerrar();

        // Sin bloque (una actividad sólo con Vimeo, o quien no puede editarla): como siempre.
        await abrir(null);
        r = await editar();
        assert.ok(!('bunny' in r.recibidos[0].data));
        assert.equal(r.recibidos[0].data.config.vimeoId, VIMEO_DE_MOODLE);
      } finally {
        await cerrar();
      }
    });

    // Lo que encontró la revisión de seguridad de la 1.4.0 (venía de antes): el tipo de una
    // interacción iba crudo al innerHTML de la vista previa, y el manejador aceptaba las
    // interacciones de CUALQUIER página del origen del configurador (el de todas las
    // páginas de GitHub Pages de la cuenta), sin mirar quién las mandaba.
    paso('mod_form.php: la vista previa no ejecuta un tipo armado, y lo que vuelve se acepta sólo de la ventana que abrió', async () => {
      const { js, origen } = codigoModForm();
      // Si el <img> se ejecutara, marca la ventana del formulario.
      const TIPO = '<img src=x onerror=window.__xssModForm=(window.__xssModForm||0)+1>';
      const guardado = [{ id: 'x1', type: TIPO, time: 3, data: {} }];
      const html = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const formulario = '<!doctype html><textarea id="id_interactions_json">' + html(JSON.stringify(guardado)) + '</textarea>'
        + `<input id="id_videourl" value=""><input id="id_vimeoid" value="${VIMEO_DE_MOODLE}">`
        + '<div id="ivplayer-interactions-preview"></div><button type="button" id="ivplayer-edit-btn"></button>'
        + `<span id="ivplayer-edit-status"></span><script>${js}</script>`;
      await ev(`new Promise((ok) => {
        const f = document.createElement('iframe');
        f.id = 'modFormSeguro';
        f.style.display = 'none';
        f.onload = () => ok(true);
        f.srcdoc = ${JSON.stringify(formulario)};
        document.body.appendChild(f);
      })`);
      const W = `document.getElementById('modFormSeguro').contentWindow`;
      // Lo que ve el formulario: los ids del campo, si se ejecutó algo y qué hay en la vista previa.
      const estado = () => ev(`(() => {
        const w = ${W}, d = w.document, p = d.getElementById('ivplayer-interactions-preview');
        let ids = null; try { ids = JSON.parse(d.getElementById('id_interactions_json').value).map((i) => i.id); } catch (e) {}
        return { ids, xss: w.__xssModForm || 0, imgs: p.querySelectorAll('img').length, texto: p.textContent };
      })()`);
      // Un "Guardar en Moodle" con estas interacciones desde `fuente` (una expresión que da
      // una ventana, o 'null': sin fuente, como un evento armado).
      const devolver = (interacciones, fuente) => ev(`(() => {
        const w = ${W};
        w.dispatchEvent(new w.MessageEvent('message', { origin: ${JSON.stringify(origen)}, source: ${fuente},
          data: { type: 'ivplayer-save-config', config: { vimeoId: '', interactions: ${JSON.stringify(interacciones)} } } }));
        return true;
      })()`);
      try {
        await dormir(300);   // el error del <img> es asincrónico
        let e = await estado();
        assert.equal(e.xss, 0, 'el tipo guardado se ejecutó al cargar el formulario');
        assert.equal(e.imgs, 0, 'el tipo guardado armó un elemento en la vista previa');
        assert.ok(e.texto.includes('<img src=x'), `la vista previa tenía que mostrar el tipo como texto: ${e.texto}`);

        // Con el origen correcto pero de una ventana que el formulario no abrió: no.
        await devolver([NOTA('ajena', 5)], 'window');
        await devolver([NOTA('sin-fuente', 5)], 'null');
        await ev(`(() => { const f = document.createElement('iframe'); f.id = 'otraPagina'; f.style.display = 'none'; document.body.appendChild(f); return true; })()`);
        await devolver([NOTA('otra-pagina', 5)], `document.getElementById('otraPagina').contentWindow`);
        e = await estado();
        assert.deepEqual(e.ids, ['x1'], 'aceptó interacciones de una ventana que no abrió');

        // La ventana que abrió esta página antes de recargarse (su opener es ésta): sí.
        const pop = await entorno.cdp.cmd('Runtime.evaluate', {
          expression: `(() => { window.__popModForm = ${W}.open('about:blank', '_blank'); return !!window.__popModForm; })()`,
          returnByValue: true, userGesture: true,
        });
        assert.equal(pop.result && pop.result.value, true, 'no se pudo abrir la ventana de prueba');
        try {
          await devolver([NOTA('de-antes', 5)], 'window.__popModForm');
          e = await estado();
          assert.deepEqual(e.ids, ['de-antes'], 'no aceptó lo que volvió de una ventana que abrió esta página');
        } finally {
          await ev(`(window.__popModForm && window.__popModForm.close(), true)`);
        }

        // "Editar interacciones" (la ventana que abre es esta página): lo que vuelve de ella
        // se acepta, y un tipo armado que venga ahí tampoco se ejecuta.
        await ev(`(() => { const w = ${W}; w.open = () => window; w.document.getElementById('ivplayer-edit-btn').click(); return true; })()`);
        await devolver([{ id: 'x2', type: TIPO, time: 4, data: {} }], 'window');
        await dormir(300);
        e = await estado();
        assert.deepEqual(e.ids, ['x2'], 'no aceptó lo que volvió del configurador que abrió');
        assert.equal(e.xss, 0, 'el tipo que vino del configurador se ejecutó en la vista previa');
        assert.equal(e.imgs, 0);
      } finally {
        await ev(`['modFormSeguro', 'otraPagina'].forEach((id) => { const f = document.getElementById(id); if (f) f.remove(); }), true`);
      }
    });
  });
}
