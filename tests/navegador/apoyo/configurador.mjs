// Lo que comparten las pruebas del configurador de interacciones (escenarios/
// configurador.mjs, con un video de la compu, y configurador-bunny.mjs, con el de Bunny
// que manda Moodle): el configurador ARMADO como el de GitHub Pages en
// /configurador.html, manejado con clics reales, con las descargas y las ventanas que
// abre anotadas en la página, y el <script> REAL de mod_form.php leído del archivo.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dormir } from './chrome.mjs';
import { RAIZ } from './entorno.mjs';

export const BLOQUEADAS_SIEMPRE = ['*://www.gstatic.com/cv/*'];   // las de entorno.mjs
// El SDK de Vimeo, JSZip y las fuentes: el configurador con un video propio no puede
// depender de nada de afuera (y así la prueba no depende de la red).
export const BLOQUEADAS_CONFIGURADOR = ['*://player.vimeo.com/*', '*://cdnjs.cloudflare.com/*', '*://fonts.googleapis.com/*', '*://fonts.gstatic.com/*'];
// El campo de Vimeo de la actividad, como lo muestra mod_form.php al editarla.
export const VIMEO_DE_MOODLE = 'https://vimeo.com/123456789/abcdef1234';

// El <script> de mod_form.php tal como lo emite PHP: vive en un string de comillas
// simples, donde sólo \\ y \' son escapes. Y el origen que acepta (el del configurador
// publicado), sacado del mismo código.
export function codigoModForm() {
  const php = fs.readFileSync(path.join(RAIZ, 'mod', 'ivplayer', 'mod_form.php'), 'utf8');
  const m = php.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no encontré el <script> de mod_form.php');
  const js = m[1].replace(/\\([\\'])/g, '$1');
  const u = js.match(/CONFIGURATOR_URL\s*=\s*"([^"]+)"/);
  if (!u) throw new Error('no encontré CONFIGURATOR_URL en mod_form.php');
  return { js, origen: new URL(u[1]).origin };
}

// Un MP4 de testsrc2 (el reloj en pantalla), 320×180 a 10 cuadros, un cuadro clave por
// segundo y sin audio: unos pocos KB. H.264 como lo que exporta un editor de video.
export function generarMp4(destino, segundos) {
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=10:duration=${segundos}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '10',
    '-movflags', '+faststart', '-an', destino,
  ], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg no pudo generar el MP4 de prueba:\n${r.stderr || r.error}`);
}

// Las herramientas para manejar el configurador desde una prueba. `skip`: el motivo para
// saltear cada paso (sin ffmpeg), o null.
export function herramientas(entorno, { skip = null } = {}) {
  const { cdp, pagina: p } = entorno;
  const excepciones = [];
  const dialogos = [];
  const pedidos = [];   // URLs que pidió la página (Network.requestWillBeSent)
  let soltarOyente = () => {};

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
  // Cierra las vistas previas abiertas y trae de vuelta adelante la pestaña del
  // configurador (con la vista previa encima, el botón no abre el diálogo de archivos).
  async function cerrarVentanas() {
    try { await cdp.ev(`(window.__ventanas || []).forEach((w) => { try { w.close(); } catch (e) {} }), true`); } catch {}
    try { await cdp.cmd('Page.bringToFront'); } catch {}
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
  // "Exportar JSON" y lo que bajó (la descarga queda en la página, ver abrirConfigurador).
  // `texto`: el archivo tal cual, para buscar lo que no tiene que estar en ningún campo.
  async function exportar() {
    await ev('window.__descargas = [], exportJSON(), true');
    const desc = await ev('Promise.all(window.__descargas)');
    assert.equal(desc.length, 1, 'no se exportó un JSON');
    return { nombre: desc[0].nombre, texto: desc[0].texto, json: JSON.parse(desc[0].texto) };
  }
  // Un JSON escrito en la carpeta `dir`, importado con "Importar JSON".
  async function importar(dir, nombre, config) {
    const ruta = path.join(dir, nombre);
    fs.writeFileSync(ruta, JSON.stringify(config));
    await ponerArchivo('#jsonFileInput', ruta);
  }

  function paso(nombre, fn, opciones = {}) {
    test(nombre, { skip: skip || false, timeout: 60000, ...opciones }, async () => {
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

  // Lo de antes de la primera prueba: sin red de afuera, el diálogo de archivos
  // interceptado y los oyentes de excepciones, pedidos y avisos.
  async function preparar() {
    await p.vista();
    await cdp.cmd('Network.setBlockedURLs', { urls: [...BLOQUEADAS_SIEMPRE, ...BLOQUEADAS_CONFIGURADOR] });
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
  }

  // Abre (o vuelve a abrir, de cero) el configurador armado y deja anotadas en la página
  // las descargas y las ventanas que abre.
  async function abrirConfigurador() {
    await cerrarVentanas();
    await cdp.cmd('Page.navigate', { url: `${entorno.srv.base}/vacio.html` });
    await esperar(`location.pathname === '/vacio.html'`, 10000, 'no volvió a la página en blanco');
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
  }

  // El opener de mentira (Moodle) que se queda con lo que mande "Guardar en Moodle"; el
  // cierre de la ventana que viene después no hace nada.
  async function ponerOpener() {
    await ev(`(() => {
      window.__guardados = [];
      window.opener = { postMessage: (data, origen) => { window.__guardados.push({ data: JSON.parse(JSON.stringify(data)), origen }); } };
      window.close = () => { window.__cerro = true; };
      return true;
    })()`);
    assert.equal(await ev(`typeof (window.opener && window.opener.postMessage)`), 'function', 'no se pudo poner el opener de mentira');
  }

  // Lo que manda mod_form.php al configurador (lo repite cada medio segundo).
  const mensajeDeMoodle = (mensaje) => ev(`window.postMessage(${JSON.stringify({ type: 'ivplayer-load-config', ...mensaje })}, '*'), true`);

  async function desarmar() {
    soltarOyente();
    await cerrarVentanas();
    try { await cdp.cmd('Page.setInterceptFileChooserDialog', { enabled: false }); } catch {}
    try { await cdp.cmd('Network.setBlockedURLs', { urls: BLOQUEADAS_SIEMPRE }); } catch {}
    try { await cdp.cmd('Page.navigate', { url: `${entorno.srv.base}/vacio.html` }); } catch {}
  }

  return {
    ev, esperar, clic, abrirArchivo, ponerArchivo, exportar, importar, cerrarVentanas, paso,
    preparar, abrirConfigurador, ponerOpener, mensajeDeMoodle, desarmar,
    excepciones, dialogos, pedidos,
  };
}
