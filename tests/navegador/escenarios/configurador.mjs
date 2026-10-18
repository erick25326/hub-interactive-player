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
// Todos los IDs, hashes y URLs son sintéticos (el repo es público).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dormir } from '../apoyo/chrome.mjs';
import { RAIZ } from '../apoyo/entorno.mjs';
import { GUID_PRUEBA } from '../apoyo/servidor.mjs';
import { hayFfmpeg } from '../../../scripts/generar-video-prueba.mjs';

const DURACION = 12;
const BLOQUEADAS_SIEMPRE = ['*://www.gstatic.com/cv/*'];   // las de entorno.mjs
const BLOQUEADAS_ACA = ['*://player.vimeo.com/*', '*://cdnjs.cloudflare.com/*', '*://fonts.googleapis.com/*', '*://fonts.gstatic.com/*'];
// El campo de Vimeo de la actividad, como lo muestra mod_form.php al editarla.
const VIMEO_DE_MOODLE = 'https://vimeo.com/123456789/abcdef1234';
// El videoUrl que pone la skill interacciones-video: el HLS de Bunny sin firmar.
const BUNNY_DE_LA_SKILL = `https://vz-ejemplo.b-cdn.net/${GUID_PRUEBA}/playlist.m3u8`;

// El <script> de mod_form.php tal como lo emite PHP: vive en un string de comillas
// simples, donde sólo \\ y \' son escapes. Y el origen que acepta (el del configurador
// publicado), sacado del mismo código.
function codigoModForm() {
  const php = fs.readFileSync(path.join(RAIZ, 'mod', 'ivplayer', 'mod_form.php'), 'utf8');
  const m = php.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no encontré el <script> de mod_form.php');
  const js = m[1].replace(/\\([\\'])/g, '$1');
  const u = js.match(/CONFIGURATOR_URL\s*=\s*"([^"]+)"/);
  if (!u) throw new Error('no encontré CONFIGURATOR_URL en mod_form.php');
  return { js, origen: new URL(u[1]).origin };
}

// 12 s de testsrc2 (el reloj en pantalla), 320×180 a 10 cuadros, un cuadro clave por
// segundo y sin audio: unos pocos KB. H.264 como lo que exporta un editor de video.
function generarMp4(destino) {
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=10:duration=${DURACION}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '10',
    '-movflags', '+faststart', '-an', destino,
  ], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg no pudo generar el MP4 de prueba:\n${r.stderr || r.error}`);
}

export function registrar(entorno, { avisar = () => {} } = {}) {
  const { cdp, pagina: p } = entorno;
  const exigir = process.env.IVP_EXIGIR_NAVEGADOR === '1';
  const faltaFfmpeg = hayFfmpeg() ? null : 'no hay ffmpeg en el PATH para generar el MP4 de prueba';
  // Como el resto de la suite: con IVP_EXIGIR_NAVEGADOR=1 (CI) no se saltea, falla.
  const sinFfmpeg = faltaFfmpeg && !exigir ? faltaFfmpeg : null;
  if (sinFfmpeg) avisar(`${sinFfmpeg}: se saltean las pruebas del configurador con un video de la compu`);

  describe('configurador · video de la compu (los de Bunny)', () => {
    let tmp = null, mp4 = null, mp4b = null;
    const excepciones = [];
    const dialogos = [];
    const pedidos = [];   // URLs que pidió la página (Network.requestWillBeSent)
    let soltarOyente = () => {};

    // Cierra las vistas previas abiertas y trae de vuelta adelante la pestaña del
    // configurador (con la vista previa encima, el botón no abre el diálogo de archivos).
    async function cerrarVentanas() {
      try { await cdp.ev(`(window.__ventanas || []).forEach((w) => { try { w.close(); } catch (e) {} }), true`); } catch {}
      try { await cdp.cmd('Page.bringToFront'); } catch {}
    }

    // Evalúa en la página del configurador; las expresiones ven sus globales
    // (reproductor, interactions, buildConfig…: let y function del script).
    const ev = (expr, tope) => cdp.ev(expr, tope);
    async function esperar(expr, tope = 10000, que = null) {
      const fin = Date.now() + tope;
      for (;;) {
        const v = await ev(`(() => { try { return (${expr}); } catch (e) { return null; } })()`);
        if (v) return v;
        if (Date.now() > fin) throw new Error(`${que || 'no se cumplió: ' + expr} (esperé ${tope} ms)`);
        await dormir(50);
      }
    }
    // Clic REAL con el mouse en el centro del elemento (lo trae a la vista antes y
    // confirma que en ese punto está él y no otra cosa).
    async function clic(sel) {
      const pos = await ev(`(() => {
        const e = document.querySelector(${JSON.stringify(sel)});
        if (!e) return null;
        e.scrollIntoView({ block: 'center' });
        const r = e.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const h = document.elementFromPoint(x, y);
        return { x, y, ok: !!h && (h === e || e.contains(h)) };
      })()`);
      if (!pos || !pos.ok) throw new Error(`no se pudo hacer clic en ${sel}: no está o está tapado (${JSON.stringify(pos)})`);
      await cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
      await cdp.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
      await cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    }
    // "Abrir video de tu computadora" con un clic de verdad: el diálogo de archivos
    // que abre se intercepta y se le pasa el archivo.
    async function abrirArchivo(ruta) {
      const abierto = new Promise((ok, mal) => {
        const t = setTimeout(() => { soltar(); mal(new Error('el botón no abrió el diálogo de archivos')); }, 5000);
        const soltar = cdp.on((m) => {
          if (m.method !== 'Page.fileChooserOpened') return;
          clearTimeout(t); soltar(); ok(m.params);
        });
      });
      await clic('#localVideoBtn');
      const d = await abierto;
      await cdp.cmd('DOM.setFileInputFiles', { files: [ruta], backendNodeId: d.backendNodeId });
    }
    // Un input de archivo que no abre diálogo (el de "Importar JSON"): directo.
    async function ponerArchivo(sel, ruta) {
      const { root } = await cdp.cmd('DOM.getDocument', { depth: 0 });
      const { nodeId } = await cdp.cmd('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      if (!nodeId) throw new Error(`no está ${sel}`);
      await cdp.cmd('DOM.setFileInputFiles', { files: [ruta], nodeId });
    }
    // "Exportar JSON" y lo que bajó (la descarga queda en la página, ver before()).
    async function exportar() {
      await ev('window.__descargas = [], exportJSON(), true');
      const desc = await ev('Promise.all(window.__descargas)');
      assert.equal(desc.length, 1, 'no se exportó un JSON');
      return { nombre: desc[0].nombre, json: JSON.parse(desc[0].texto) };
    }
    // Un JSON escrito en la carpeta temporal, importado con "Importar JSON".
    async function importar(nombre, config) {
      const ruta = path.join(tmp, nombre);
      fs.writeFileSync(ruta, JSON.stringify(config));
      await ponerArchivo('#jsonFileInput', ruta);
    }
    const videoLocal = () => ev(`(() => {
      const v = document.querySelector('#videoContainer video');
      return v ? { t: v.currentTime, paused: v.paused, d: v.duration, rs: v.readyState, src: v.currentSrc } : null;
    })()`);

    function paso(nombre, fn, opciones = {}) {
      test(nombre, { skip: sinFfmpeg || false, timeout: 60000, ...opciones }, async () => {
        // Lo de cada paso, no lo acumulado: si no, una falla arrastra a todas las siguientes.
        const exc0 = excepciones.length, dia0 = dialogos.length;
        try {
          await fn();
          const exc = excepciones.slice(exc0), dia = dialogos.slice(dia0);
          if (exc.length) throw new Error(`excepciones sin atrapar en el configurador: ${JSON.stringify(exc.slice(0, 5))}`);
          if (dia.length) throw new Error(`el configurador mostró avisos (alert/confirm): ${JSON.stringify(dia)}`);
        } catch (e) {
          const dia = dialogos.slice(dia0);
          if (dia.length) e.message += `\n(avisos que mostró el configurador: ${JSON.stringify(dia)})`;
          const cap = await p.capturar('configurador ' + nombre);
          if (cap) e.message += `\n(captura: ${cap})`;
          throw e;
        }
      });
    }

    before(async () => {
      if (sinFfmpeg) return;
      if (faltaFfmpeg) throw new Error(`${faltaFfmpeg} (IVP_EXIGIR_NAVEGADOR=1: no se saltea)`);
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivp-configurador-'));
      mp4 = path.join(tmp, 'clase-de-prueba.mp4');
      generarMp4(mp4);
      // Una copia con otro nombre, para probar el cambio de archivo.
      mp4b = path.join(tmp, 'otra-clase.mp4');
      fs.copyFileSync(mp4, mp4b);
      await p.vista();
      await cdp.cmd('Network.setBlockedURLs', { urls: [...BLOQUEADAS_SIEMPRE, ...BLOQUEADAS_ACA] });
      await cdp.cmd('Page.setInterceptFileChooserDialog', { enabled: true });
      soltarOyente = cdp.on((m) => {
        if (m.method === 'Runtime.exceptionThrown') {
          const d = m.params.exceptionDetails;
          excepciones.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
        } else if (m.method === 'Network.requestWillBeSent') {
          pedidos.push(m.params.request.url);
        } else if (m.method === 'Page.javascriptDialogOpening') {
          // Un alert() frena la página hasta que alguien lo cierre: se cierra solo y la
          // prueba falla diciendo qué decía, en vez de colgarse hasta el tope.
          dialogos.push(m.params.message);
          cdp.cmd('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
        }
      });
      await cdp.cmd('Page.navigate', { url: `${entorno.srv.base}/configurador.html` });
      await esperar(`location.pathname === '/configurador.html' && document.readyState === 'complete' && typeof window.previewWithPlayer === 'function'`, 15000, 'el configurador armado no cargó');
      // Las descargas no salen de la página (en headless podrían ir a la carpeta de
      // Descargas de la PC): se anotan acá con su contenido.
      await ev(`(() => {
        window.__blobs = new Map();
        window.__descargas = [];
        const crear = URL.createObjectURL;
        URL.createObjectURL = function(b) { const u = crear.call(URL, b); window.__blobs.set(u, b); return u; };
        const clicOriginal = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() {
          if (!this.download) return clicOriginal.call(this);
          const b = window.__blobs.get(this.href);
          window.__descargas.push(b ? b.text().then((texto) => ({ nombre: this.download, texto })) : Promise.resolve({ nombre: this.download, texto: null }));
        };
        window.__ventanas = [];
        const abrir = window.open;
        window.open = function() { const w = abrir.apply(this, arguments); window.__ventanas.push(w); return w; };
        return true;
      })()`);
    });

    after(async () => {
      if (sinFfmpeg) return;
      soltarOyente();
      await cerrarVentanas();
      try { await cdp.cmd('Page.setInterceptFileChooserDialog', { enabled: false }); } catch {}
      try { await cdp.cmd('Network.setBlockedURLs', { urls: BLOQUEADAS_SIEMPRE }); } catch {}
      try { await cdp.cmd('Page.navigate', { url: `${entorno.srv.base}/vacio.html` }); } catch {}
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
        w.dispatchEvent(new w.MessageEvent('message', { origin: ${JSON.stringify(origen)}, data: { type: 'ivplayer-save-config', config: ${JSON.stringify(config)} } }));
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
  });
}
