// El CDN de Bunny de mentira para el configurador: OTRO servidor (otro puerto, o sea otro
// origen, como b-cdn.net frente a GitHub Pages) que sirve un HLS de una carpeta local
// sólo con el token en la ruta, como Bunny con la autenticación por token prendida:
//   /bcdn_token=HS256-…&token_path=%2F<guid>%2F&expires=E/<guid>/…
// El token se valida de verdad (HMAC con una clave de prueba, con el espejo en Node de la
// firma de lib.php): las URLs que arma `firmar` tienen la forma exacta de las de
// ivplayer_bunny_configurador, con el host cambiado por el de este servidor.
// Todo con CORS abierto (también el 403), como Bunny: hls.js baja el playlist y los .ts
// con XHR desde el origen del configurador.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as B from '../../unit/apoyo/bunny-espejo.mjs';

// Sintéticos (el repo es público): ni el host, ni la clave, ni el GUID son de verdad.
export const HOST_BUNNY_FALSO = 'vz-prueba.b-cdn.net';
export const CLAVE_PRUEBA = 'clave-de-prueba-del-configurador';

const TIPOS = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t' };

export function crearCdnBunny({ dir, guid }) {
  const dirFirmado = `/${guid}/`;
  const pedidos = [];     // cada pedido: { ruta, estado }
  const rechazos = [];    // cada 403: { ruta, motivo }
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    const rechazar = (motivo) => {
      rechazos.push({ ruta: u.pathname, motivo });
      pedidos.push({ ruta: u.pathname, estado: 403 });
      res.writeHead(403, { ...cors, 'content-type': 'text/plain' });
      res.end('403');
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'access-control-allow-headers': '*' }); return res.end(); }
    const m = /^\/bcdn_token=([^/]*)(\/.*)$/.exec(u.pathname);
    if (!m) return rechazar('sin token en la ruta');
    const p = new URLSearchParams('bcdn_token=' + m[1]);
    const token = p.get('bcdn_token'), expires = Number(p.get('expires')), resto = m[2];
    if (p.get('token_path') !== dirFirmado || !resto.startsWith(dirFirmado)) return rechazar('ruta');
    if (!Number.isInteger(expires) || B.token(CLAVE_PRUEBA, dirFirmado, expires) !== token) return rechazar('token');
    if (Date.now() / 1000 > expires) return rechazar('vencida');
    const archivo = path.resolve(dir, decodeURIComponent(resto.slice(dirFirmado.length)));
    if (!archivo.startsWith(path.resolve(dir) + path.sep)) return rechazar('fuera de la carpeta');
    fs.readFile(archivo, (err, cuerpo) => {
      pedidos.push({ ruta: u.pathname, estado: err ? 404 : 200 });
      if (err) { res.writeHead(404, cors); return res.end(); }
      res.writeHead(200, { ...cors, 'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
      res.end(cuerpo);
    });
  });
  return new Promise((ok, mal) => {
    srv.once('error', mal);
    srv.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      // El playlist firmado como lo arma lib.php (vía el espejo), servido por acá.
      const firmar = (expires) => B.firmar(HOST_BUNNY_FALSO, guid, CLAVE_PRUEBA, expires).playlist
        .replace(`https://${HOST_BUNNY_FALSO}`, base);
      ok({
        base, pedidos, rechazos, firmar,
        cerrar: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
      });
    });
  });
}
