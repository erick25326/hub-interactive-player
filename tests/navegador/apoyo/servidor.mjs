// Servidor HTTP local de las pruebas (puerto que elige el SO, sólo 127.0.0.1).
//   /player.html?…  el reproductor COMPILADO con window.PLAYER_CONFIG inyectado antes
//                   de </head>, igual que mod/ivplayer/player.php. Antes del bundle va el
//                   ayudante de la página y, si se pide, los receptores simulados.
//   /marco.html?…   el reproductor en un iframe del mismo sitio, como view.php: responde
//                   el pedido de pantalla completa simulada agrandando el iframe.
//   /vacio.html     página en blanco del mismo origen (para limpiar el localStorage).
//   /hls/<GUID>/…   el video de prueba: de una carpeta local (el que genera ffmpeg) o de
//                   un HLS remoto a través de un proxy con caché en memoria. El GUID es
//                   sintético: el reproductor saca de ahí la clave del avance, como con
//                   Bunny, y el receptor de Cast simulado reconoce "este video" por él.
// Query de /player.html: motor=hls|nativo|auto · progreso=<json del avance> ·
// subs=vtt · cast=fake (+ lat, hayTV… que lee el simulado) · airplay=1 · nofs=1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const GUID_PRUEBA = '11111111-2222-4333-8444-555555555555';
export const CLAVE_AVANCE = `iv_progress_${GUID_PRUEBA}`;

// Las mismas tres preguntas en todas las pruebas: nota en 8, V/F en 25 y en 60.
export const INTERACCIONES = [
  { id: 'n8', type: 'note', time: 8, data: { title: 'Nota de los 8 s', text: 'Texto de la nota.' } },
  { id: 'tf25', type: 'true-false', time: 25, data: { statement: 'Afirmación de los 25 s', correct: true, explanation: 'Explicación.' } },
  { id: 'tf60', type: 'true-false', time: 60, data: { statement: 'Afirmación de los 60 s', correct: false, explanation: 'Explicación.' } },
];
// Subtítulos sintéticos (los de los cursos son contenido pago y no van en el repo). El
// segundo cue cruza la nota de los 8 s: con la tarjeta abierta no se tiene que ver.
export const VTT_PRUEBA = [
  'WEBVTT', '',
  '00:00:01.000 --> 00:00:05.000', 'Primer subtítulo de prueba', '',
  '00:00:06.000 --> 00:00:10.500', 'Este cruza la nota de los 8 segundos', '',
].join('\n');
export const CUES_PRUEBA = [[1, 5, 'Primer subtítulo de prueba'], [6, 10.5, 'Este cruza la nota de los 8 segundos']];

const leerAqui = (...p) => fs.readFileSync(path.join(AQUI, ...p), 'utf8');
const AYUDANTE = leerAqui('ayudante-pagina.js');
const CAST = leerAqui('..', 'simulados', 'cast-simulado.js');
const AIRPLAY = leerAqui('..', 'simulados', 'airplay-simulado.js');

// Como JSON_HEX_TAG de player.php: un "</script>" dentro de un texto no corta el bloque.
const json = (x) => JSON.stringify(x).replace(/</g, '\\u003c');

const TIPOS = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.aac': 'audio/aac', '.vtt': 'text/vtt' };

export function crearServidor({ html, video }) {
  // `video`: { tipo: 'local', dir } o { tipo: 'remoto', url }.
  if ((html.match(/<\/head>/gi) || []).length !== 1) throw new Error('el bundle no tiene exactamente un </head>');
  const cache = new Map();
  const pedidosHls = [];

  async function traerRemoto(url) {
    if (!cache.has(url)) {
      const p = fetch(url, { signal: AbortSignal.timeout(20000) }).then(async (r) => ({
        estado: r.status, tipo: r.headers.get('content-type') || 'application/octet-stream', cuerpo: Buffer.from(await r.arrayBuffer()),
      }));
      cache.set(url, p);
      // Sólo quedan en caché las respuestas buenas: un error se vuelve a pedir.
      p.then((x) => { if (x.estado !== 200) cache.delete(url); }, () => cache.delete(url));
    }
    return cache.get(url);
  }

  function paginaReproductor(q, origen) {
    const config = {
      title: 'Prueba del reproductor',
      // URL absoluta: el HLS nativo arma las URL de las variantes con new URL(…, master).
      videoUrl: `${origen}/hls/${GUID_PRUEBA}/playlist.m3u8`,
      videoMotor: q.get('motor') || 'auto',
      interactions: INTERACCIONES,
    };
    if (q.get('subs') === 'vtt') config.subtitlesVtt = VTT_PRUEBA;
    let antes = `<script>${AYUDANTE}</script>\n`;
    if (q.get('cast') === 'fake') antes += `<script>${CAST}</script>\n`;
    if (q.get('airplay') === '1') antes += `<script>${AIRPLAY}</script>\n`;
    // Sin pantalla completa nativa (como el iPhone): fuerza la simulada de la madre.
    if (q.get('nofs') === '1') antes += '<script>delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen;</script>\n';
    if (q.get('progreso')) antes += `<script>try { localStorage.setItem(${json(CLAVE_AVANCE)}, ${json(q.get('progreso'))}); } catch (e) {}</script>\n`;
    // 🔴 Con función y no con texto de reemplazo: en un texto, "$'" (que aparece en el
    // ayudante: $('.iv-…')) significa "lo que sigue al hallazgo" y rompía la página.
    return html
      .replace(/<head>/i, () => `<head>\n${antes}`)
      .replace(/<\/head>/i, () => `<script>\nwindow.PLAYER_CONFIG = ${json(config)};\n</script>\n</head>`);
  }

  function paginaMarco(q) {
    const ancho = /^\d+px$/.test(q.get('ancho') || '') ? q.get('ancho') : '100vw';
    q.delete('ancho');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#222}iframe{border:0;width:${ancho};aspect-ratio:16/9;display:block}
iframe.css-fs{position:fixed;inset:0;width:100vw;height:100vh;aspect-ratio:auto;z-index:9}</style></head>
<body><iframe src="/player.html?${q.toString().replace(/"/g, '&quot;')}" title="Reproductor" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>
<script>
  // Lo que hace view.php con el pedido de pantalla completa simulada del reproductor.
  const f = document.querySelector('iframe');
  addEventListener('message', (e) => {
    if (e.source !== f.contentWindow || !e.data || e.data.type !== 'ivplayer-fullscreen') return;
    const en = e.data.action === 'enter';
    f.classList.toggle('css-fs', en);
    f.contentWindow.postMessage({ type: 'ivplayer-fullscreen-state', isFS: en }, '*');
  });
</script></body></html>`;
  }

  async function servirHls(resto, res) {
    pedidosHls.push(resto);
    if (video.tipo === 'local') {
      const archivo = path.resolve(video.dir, resto);
      // Nada fuera de la carpeta del video.
      if (!archivo.startsWith(path.resolve(video.dir) + path.sep)) { res.writeHead(403); return res.end(); }
      fs.readFile(archivo, (err, cuerpo) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(cuerpo);
      });
      return;
    }
    const master = new URL(video.url);
    const destino = resto === 'playlist.m3u8' ? master : new URL(resto, master);
    if (!destino.search && master.search) destino.search = master.search;
    const r = await traerRemoto(destino.href);
    res.writeHead(r.estado, { 'content-type': r.tipo, 'cache-control': 'no-store' });
    res.end(r.cuerpo);
  }

  const srv = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const origen = `http://${req.headers.host}`;
      const pagina = (cuerpo) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(cuerpo); };
      if (u.pathname === '/player.html') return pagina(paginaReproductor(u.searchParams, origen));
      if (u.pathname === '/marco.html') return pagina(paginaMarco(new URLSearchParams(u.searchParams)));
      if (u.pathname === '/vacio.html') return pagina('<!doctype html><title>vacío</title>');
      const pre = `/hls/${GUID_PRUEBA}/`;
      if (u.pathname.startsWith(pre)) return await servirHls(decodeURIComponent(u.pathname.slice(pre.length)), res);
      res.writeHead(404); res.end();
    } catch (e) {
      try { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(String(e && e.message)); } catch {}
    }
  });

  return new Promise((ok, mal) => {
    srv.once('error', mal);
    srv.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      ok({
        base, pedidosHls,
        cerrar: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
      });
    });
  });
}
