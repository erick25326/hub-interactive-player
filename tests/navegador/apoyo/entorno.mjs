// Arma el entorno del nivel navegador una sola vez para toda la suite: busca Chrome,
// elige el video de prueba, compila el reproductor a una carpeta TEMPORAL (dist/ no se
// toca), levanta el servidor y lanza Chrome headless. Si falta Chrome o no hay video
// (sin ffmpeg y sin red) devuelve { omitir: motivo } y la suite se saltea con ese
// mensaje (o falla, con IVP_EXIGIR_NAVEGADOR=1, como en CI).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buscarChrome, lanzarChrome, borrarConReintentos, dormir } from './chrome.mjs';
import { crearServidor } from './servidor.mjs';
import { Pagina } from './pagina.mjs';
import { revisarHls } from './hls.mjs';
import { generarVideo, videoValido, hayFfmpeg, DIR_VIDEO } from '../../../scripts/generar-video-prueba.mjs';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DIR_SALIDA = path.join(RAIZ, 'tests', 'navegador', '.salida');
// Stream público de prueba (el de los ejemplos de hls.js): Big Buck Bunny, 634 s,
// cinco calidades con RESOLUTION, segmentos .ts con el audio adentro (como Bunny) y
// CORS abierto. Verificado con curl en oct-2026. El "sample" público de Bunny dio
// 403 y los de Apple traen el audio aparte o no nombran RESOLUTION. Se cambia con
// IVP_VIDEO_URL.
export const VIDEO_PUBLICO = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

class ErrorHttp extends Error {}

async function videoRemoto(url, origen) {
  const leer = async (rel) => {
    const u = rel ? new URL(rel, url) : new URL(url);
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new ErrorHttp(`HTTP ${r.status} en ${u.href}`);
    return r.text();
  };
  try {
    return { tipo: 'remoto', url, origen, ...(await revisarHls(leer)) };
  } catch (e) {
    // Sin red (o la red no llega): se saltea. Si responde pero no sirve, es un error
    // de configuración y se dice fuerte, no se esconde la suite entera.
    if (!(e instanceof ErrorHttp) && (e.name === 'TypeError' || e.name === 'TimeoutError' || e.name === 'AbortError')) {
      return { omitir: `sin red: no se pudo bajar el video de prueba ${origen} (${url}): ${e.cause?.code || e.message}. Con ffmpeg instalado se genera uno local (scripts/generar-video-prueba.mjs).` };
    }
    throw new Error(`El video de prueba ${origen} (${url}) no sirve: ${e.message}. Cambialo con IVP_VIDEO_URL o generá uno local con ffmpeg (node scripts/generar-video-prueba.mjs).`);
  }
}

// Orden: IVP_VIDEO_URL si está; si no, el local de ffmpeg (ya generado, o se genera si
// hay ffmpeg); si no, el público por defecto.
async function elegirVideo(avisar) {
  if (process.env.IVP_VIDEO_URL) return videoRemoto(process.env.IVP_VIDEO_URL, 'de IVP_VIDEO_URL');
  if (await videoValido()) return { tipo: 'local', dir: DIR_VIDEO, ...(await revisarLocal()) };
  if (hayFfmpeg()) {
    avisar('[navegador] generando el video de prueba con ffmpeg…');
    await generarVideo({ avisar: (m) => avisar('[navegador] ' + m) });
    return { tipo: 'local', dir: DIR_VIDEO, ...(await revisarLocal()) };
  }
  return videoRemoto(VIDEO_PUBLICO, 'público por defecto');
}
const revisarLocal = () => revisarHls(async (rel) => fs.readFileSync(path.join(DIR_VIDEO, rel || 'playlist.m3u8'), 'utf8'));

// Compila el reproductor como en producción (vite build, un solo index.html) a una
// carpeta temporal. Lo mismo que copia build-plugin.js a mod/ivplayer/player.html.
function compilar(destino) {
  const vite = path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) throw new Error('Falta vite en node_modules: corré npm ci');
  const r = spawnSync(process.execPath, [vite, 'build', '--outDir', destino, '--emptyOutDir', '--logLevel', 'error'], { cwd: RAIZ, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`vite build falló:\n${r.stdout}\n${r.stderr}`);
  return fs.readFileSync(path.join(destino, 'index.html'), 'utf8');
}

export async function prepararEntorno({ avisar = (m) => console.log(m) } = {}) {
  const chrome = buscarChrome();
  if (!chrome) return { omitir: 'no se encontró Chrome. Definí CHROME_PATH con la ruta del ejecutable.' };
  const video = await elegirVideo(avisar);
  if (video.omitir) return video;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivp-navegador-'));
  const cierres = [];
  const cerrar = async () => {
    for (const c of cierres.reverse()) { try { await c(); } catch {} }
    cierres.length = 0;
    await borrarConReintentos(tmp);
  };
  try {
    const t0 = Date.now();
    // IVP_HTML: probar un bundle YA compilado en vez de compilar src/ (p. ej. el
    // mod/ivplayer/player.html que va en el ZIP del plugin, que puede haber quedado viejo).
    const html = process.env.IVP_HTML
      ? fs.readFileSync(path.resolve(RAIZ, process.env.IVP_HTML), 'utf8')
      : compilar(path.join(tmp, 'dist'));
    const tCompilar = Date.now() - t0;
    const srv = await crearServidor({ html, video });
    cierres.push(() => srv.cerrar());
    const ch = await lanzarChrome({ ejecutable: chrome, perfil: path.join(tmp, 'perfil') });
    cierres.push(() => ch.cerrar());
    const { cdp } = ch;
    await cdp.cmd('Page.enable');
    await cdp.cmd('Runtime.enable');
    // El SDK de Cast de Google no se baja nunca en las pruebas: o lo reemplaza el
    // simulado, o no hace falta (sin TV no hay botón). Así no depende de gstatic.
    await cdp.cmd('Network.enable');
    await cdp.cmd('Network.setBlockedURLs', { urls: ['*://www.gstatic.com/cv/*'] });
    await cdp.cmd('Page.navigate', { url: `${srv.base}/vacio.html` });
    for (let i = 0; i < 100 && !(await cdp.ev(`location.pathname === '/vacio.html'`).catch(() => false)); i++) await dormir(50);
    const agente = await cdp.ev('navigator.userAgent');
    // HLS nativo de Chrome (142+): el camino de Safari/iPhone, que en Chrome se puede
    // probar. Si este Chrome no lo tiene, esas pruebas se saltean diciendo por qué.
    const hlsNativo = await cdp.ev(`document.createElement('video').canPlayType('application/vnd.apple.mpegurl')`);
    const version = (agente.match(/Chrome\/([\d.]+)/) || [])[1] || '?';
    avisar(`[navegador] Chrome ${version} (${chrome}) · video ${video.tipo === 'local' ? 'local de ffmpeg' : video.origen + ' ' + video.url} · ${video.duracion.toFixed(0)} s, ${video.variantes.map((v) => v.alto + 'p').join('/')} · HLS nativo: ${hlsNativo || 'no'} · ${process.env.IVP_HTML ? 'bundle de IVP_HTML: ' + process.env.IVP_HTML : `compilado en ${tCompilar} ms`}`);
    return {
      pagina: new Pagina(cdp, srv.base, DIR_SALIDA),
      html, video, srv, cdp, chrome, version,
      sinNativo: hlsNativo ? null : `este Chrome (${version}) no reproduce HLS nativo: canPlayType('application/vnd.apple.mpegurl') vino vacío`,
      cerrar,
    };
  } catch (e) {
    await cerrar();
    throw e;
  }
}

// Una prueba del nivel navegador: con tope de tiempo, captura de pantalla si falla y,
// al final, sin excepciones sin atrapar en la página (una prueba que pasa con el
// reproductor tirando errores no prueba nada).
export function paso(entorno, nombre, fn, { skip = false, timeout = 120000 } = {}) {
  test(nombre, { skip, timeout }, async (t) => {
    const p = entorno.pagina;
    try {
      await fn(t);
      const errores = await p.a('A.errores');
      if (errores && errores.length) throw new Error(`excepciones sin atrapar en la página: ${JSON.stringify(errores.slice(0, 5))}`);
    } catch (e) {
      const cap = await p.capturar(nombre);
      if (cap) e.message += `\n(captura: ${path.relative(RAIZ, cap)})`;
      throw e;
    }
  });
}
