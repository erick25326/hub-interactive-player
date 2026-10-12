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
//   /bcdn_token=…&token_path=…&expires=E/hls/<GUID>/…
//                   el mismo video FIRMADO, como el CDN de Bunny con la autenticación por
//                   token prendida: valida el token (que lo haya emitido este servidor,
//                   para ESTE directorio y con ESTE vencimiento) y el vencimiento, con 403
//                   (y CORS abierto, como Bunny) si no vale. Ver ?firma=.
//   /firma          el firma.php de mentira: POST cmid + sesskey → una firma nueva.
// Query de /player.html: motor=hls|nativo|auto · progreso=<json del avance> ·
// subs=vtt · cast=fake (+ lat, hayTV… que lee el simulado) · airplay=1 · nofs=1 ·
// firma=<segundos> (el video va firmado y vence a los <segundos>; MOODLE_CONTEXT trae
// firmaUrl para renovarlo) · renovar=falla (el /firma de esa página contesta "se cerró
// la sesión", como firma.php sin sesión) · renovar=falla-hasta-403 (contesta 503, como
// sin red, hasta que un pedido de video de esa página vuelva con 403: ahí anda, y así se
// prueba el reintento después del 403) · renovar=red-tras-403 (igual, y además los DOS
// primeros pedidos después del 403 también contestan 503: la red que tarda en volver al
// desbloquear el celular) · renovar=lenta (el primer pedido de esa página
// contesta recién 2 s —o demora=<s>— DESPUÉS de que venció su firma, con una firma hecha
// al contestar: un pedido de video que sale en ese rato tiene que esperarla) ·
// rota=alta (la playlist de la calidad MÁS ALTA da 403 siempre, con cualquier firma y
// vigente: una variante rota o una regla del CDN, NO el vencimiento) · renovada=<s> (lo
// que duran las firmas que da /firma; por defecto, lo mismo que la de la página).
// 🔴 renovada: las pruebas de lo que pasa AL vencer la primera firma. Con firmas de 6 s
// también después, el HLS nativo cambia de fuente cada ~3 s reproduciendo y cada cambio
// cuesta un salto (2-4 s con el 1080p de Mux, 8 MB por segmento): no avanza y la prueba
// falla por algo que con firmas de 1 h o más no existe (un cambio por hora).
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

// La firma de prueba: el directorio firmado (como token_path=/<guid>/ en Bunny) y lo que
// manda la página para pedir otra (lo que pondría player.php en MOODLE_CONTEXT).
export const DIR_FIRMADO = `/hls/${GUID_PRUEBA}/`;
export const CMID_PRUEBA = 7;
export const SESSKEY_PRUEBA = 'sk-prueba';

const TIPOS = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.aac': 'audio/aac', '.vtt': 'text/vtt' };

export function crearServidor({ html, video }) {
  // `video`: { tipo: 'local', dir } o { tipo: 'remoto', url }.
  if ((html.match(/<\/head>/gi) || []).length !== 1) throw new Error('el bundle no tiene exactamente un </head>');
  const cache = new Map();
  const pedidosHls = [];
  // Firmas emitidas (token → expires) y lo que pasó con ellas, para que las pruebas vean
  // si el video siguió con la firma nueva o se topó con una vencida.
  //   pedidos: cada pedido a /firma · servidos: cada pedido de video firmado que se sirvió
  //   · rechazos: cada 403 (con el motivo).
  //   paginaDe: token → página que lo pidió · rotas: páginas con rota=alta.
  const firma = { emitidas: new Map(), pedidos: [], servidos: [], rechazos: [], n: 0, paginas: 0, inicial: new Map(), lentas: new Set(), paginaDe: new Map(), rotas: new Set() };
  const segundos = () => Date.now() / 1000;
  function emitirFirma(ttl, origen, pag) {
    const token = `HS256-prueba${++firma.n}`;
    const expires = Math.floor(segundos()) + ttl;
    firma.emitidas.set(token, expires);
    if (pag != null) firma.paginaDe.set(token, pag);
    const tramo = `bcdn_token=${token}&token_path=${encodeURIComponent(DIR_FIRMADO)}&expires=${expires}`;
    return {
      token, expires,
      playlist: `${origen}/${tramo}${DIR_FIRMADO}playlist.m3u8`,
      // La miniatura, como la de Bunny: misma firma, en la query (acá no hay imagen: 404).
      poster: `${origen}${DIR_FIRMADO}thumbnail.jpg?token=${token}&token_path=${encodeURIComponent(DIR_FIRMADO)}&expires=${expires}`,
    };
  }

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

  // La playlist de la calidad más alta (mayor alto y, a igual alto, mayor bitrate: la que
  // elige nativePlayer para ese alto), relativa al master, para rota=alta.
  let varianteAlta = null;
  function laVarianteAlta() {
    if (!varianteAlta) {
      const texto = video.tipo === 'local'
        ? Promise.resolve(fs.readFileSync(path.join(video.dir, 'playlist.m3u8'), 'utf8'))
        : traerRemoto(video.url).then((r) => r.cuerpo.toString('utf8'));
      varianteAlta = texto.then((txt) => {
        const lineas = txt.split(/\r?\n/).map((l) => l.trim());
        let mejor = null;
        lineas.forEach((l, i) => {
          if (!/^#EXT-X-STREAM-INF:/i.test(l)) return;
          const uri = lineas.slice(i + 1).find((x) => x && !x.startsWith('#'));
          const alto = Number((/RESOLUTION=\d+x(\d+)/i.exec(l) || [])[1]) || 0;
          const bps = Number((/[:,]BANDWIDTH=(\d+)/i.exec(l) || [])[1]) || 0;
          if (uri && (!mejor || alto > mejor.alto || (alto === mejor.alto && bps > mejor.bps))) mejor = { uri, alto, bps };
        });
        return mejor ? mejor.uri : null;
      });
    }
    return varianteAlta;
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
    let contexto = null;
    const ttl = Number(q.get('firma'));
    if (ttl > 0) {
      // Lo que hace player.php con la clave de Bunny cargada: la URL firmada y, en
      // MOODLE_CONTEXT, a dónde pedir otra y la hora del servidor al firmar.
      const pag = String(++firma.paginas);
      const f0 = emitirFirma(ttl, origen, pag);
      config.videoUrl = f0.playlist;
      firma.inicial.set(pag, f0);
      if (q.get('rota') === 'alta') firma.rotas.add(pag);
      const modo = ['falla', 'falla-hasta-403', 'red-tras-403', 'lenta'].includes(q.get('renovar')) ? q.get('renovar') : 'ok';
      const f = new URLSearchParams({ ttl: String(Number(q.get('renovada')) > 0 ? Number(q.get('renovada')) : ttl), modo, pag });
      if (Number(q.get('demora')) > 0) f.set('demora', q.get('demora'));
      contexto = { cmid: CMID_PRUEBA, sesskey: SESSKEY_PRUEBA, firmaUrl: `${origen}/firma?${f}`, firmaAhora: segundos() };
    }
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
      .replace(/<\/head>/i, () => `<script>\nwindow.PLAYER_CONFIG = ${json(config)};${contexto ? `\nwindow.MOODLE_CONTEXT = ${json(contexto)};` : ''}\n</script>\n</head>`);
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

  // El CDN con la autenticación por token: el tramo /bcdn_token=…/ tiene que ser una
  // firma emitida acá, de este directorio y sin vencer. Si no, 403 (con CORS, como Bunny).
  async function servirFirmado(pathname, res) {
    const m = /^\/bcdn_token=([^/]*)(\/.*)$/.exec(pathname);
    const p = new URLSearchParams('bcdn_token=' + (m ? m[1] : ''));
    const token = p.get('bcdn_token'), expires = Number(p.get('expires'));
    const resto = m ? m[2] : '';
    let motivo = null;
    if (!m || !resto.startsWith(DIR_FIRMADO)) motivo = 'ruta';
    else if (p.get('token_path') !== DIR_FIRMADO) motivo = 'token_path';
    else if (firma.emitidas.get(token) !== expires) motivo = 'token desconocido';
    else if (segundos() > expires) motivo = 'vencida';
    // Con la firma en regla: la calidad rota de esa página (rota=alta) da 403 igual.
    else if (firma.rotas.has(firma.paginaDe.get(token)) && decodeURIComponent(resto.slice(DIR_FIRMADO.length)) === await laVarianteAlta()) motivo = 'rota';
    if (motivo) {
      firma.rechazos.push({ ms: Date.now(), token, motivo, resto });
      res.writeHead(403, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      return res.end('403');
    }
    firma.servidos.push({ ms: Date.now(), token, expires, resto });
    return servirHls(decodeURIComponent(resto.slice(DIR_FIRMADO.length)), res);
  }

  // firma.php de mentira. Los modos (ver renovar= arriba) imitan lo que puede pasar en el
  // campo: la sesión cerrada, sin red un rato, una respuesta que tarda.
  function responderFirma(req, u, origen, res) {
    const responder = (estado, cuerpo) => { res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(cuerpo)); };
    let cuerpo = '';
    req.on('data', (d) => { cuerpo += d; });
    req.on('end', () => {
      const b = new URLSearchParams(cuerpo);
      firma.pedidos.push({ ms: Date.now(), metodo: req.method, cmid: b.get('cmid'), sesskey: b.get('sesskey'), modo: u.searchParams.get('modo'), pag: u.searchParams.get('pag') });
      if (req.method !== 'POST') return responder(405, { ok: false, motivo: 'metodo' });
      const modo = u.searchParams.get('modo'), inicial = firma.inicial.get(u.searchParams.get('pag'));
      if (modo === 'falla-hasta-403' || modo === 'red-tras-403') {
        const r403 = inicial && firma.rechazos.find((r) => r.token === inicial.token);
        if (!r403) return responder(503, { ok: false, motivo: 'error' });
        // red-tras-403: los DOS primeros pedidos de después del 403, también 503.
        const tras403 = firma.pedidos.filter((x) => x.pag === u.searchParams.get('pag') && x.ms >= r403.ms).length;
        if (modo === 'red-tras-403' && tras403 <= 2) return responder(503, { ok: false, motivo: 'error' });
      }
      if (modo === 'lenta' && inicial && !firma.lentas.has(inicial.token)) {
        firma.lentas.add(inicial.token);
        // La firma se hace al contestar (como firma.php cuando por fin atiende): hecha al
        // pedir, con una demora mayor que la mitad del TTL llegaba vencida.
        return setTimeout(() => {
          const f = emitirFirma(Number(u.searchParams.get('ttl')) || 60, origen, u.searchParams.get('pag'));
          responder(200, { ok: true, playlist: f.playlist, poster: f.poster, expires: f.expires, ahora: segundos() });
        }, Math.max(0, (inicial.expires + (Number(u.searchParams.get('demora')) || 2)) * 1000 - Date.now()));
      }
      if (modo === 'falla' || b.get('cmid') !== String(CMID_PRUEBA) || b.get('sesskey') !== SESSKEY_PRUEBA) return responder(401, { ok: false, motivo: 'sesion' });
      const f = emitirFirma(Number(u.searchParams.get('ttl')) || 60, origen, u.searchParams.get('pag'));
      responder(200, { ok: true, playlist: f.playlist, poster: f.poster, expires: f.expires, ahora: segundos() });
    });
  }

  const srv = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const origen = `http://${req.headers.host}`;
      const pagina = (cuerpo) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(cuerpo); };
      if (u.pathname === '/player.html') return pagina(paginaReproductor(u.searchParams, origen));
      if (u.pathname === '/marco.html') return pagina(paginaMarco(new URLSearchParams(u.searchParams)));
      if (u.pathname === '/vacio.html') return pagina('<!doctype html><title>vacío</title>');
      if (u.pathname === '/firma') return responderFirma(req, u, origen, res);
      if (u.pathname.startsWith('/bcdn_token=')) return await servirFirmado(u.pathname, res);
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
        base, pedidosHls, firma,
        cerrar: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
      });
    });
  });
}
