// ESPEJO en Node, línea por línea, de las funciones puras de Bunny de
// mod/ivplayer/lib.php (de ivplayer_bunny_normalizar_guid a ivplayer_bunny_expires, más
// ivplayer_reproductor_soporta_bunny).
//
// Por qué existe: en las máquinas de desarrollo no hay PHP. La prueba de verdad es
// tests/php/correr.php, que carga lib.php y corre en CI; esto da cobertura LOCAL de la
// misma lógica contra los mismos vectores (tests/php/vectores-bunny.json). Para que el
// espejo no se desvíe en silencio, bunny-espejo.test.mjs fija una huella del código de
// cada función de lib.php: si alguien la cambia, la prueba avisa que hay que re-traducir.
//
// Diferencias conocidas con PHP, ninguna alcanzable con entradas reales:
// - "\s" de JS incluye espacios Unicode (NBSP, etc.); el de PCRE sin /u, sólo ASCII.
// - toLowerCase() de JS baja también no-ASCII; strtolower() de PHP 8.2+, no. En los dos
//   casos el host termina rechazado por la expresión de nombre DNS.
import crypto from 'node:crypto';

// trim() de PHP: espacio, \t, \n, \r, \0 y \x0B (no los espacios Unicode).
const phpTrim = (s) => s.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
// strtolower() de PHP 8.2+: sólo ASCII.
const phpLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const phpLtrim0 = (s) => s.replace(/^0+/, '');

// La coding_exception de Moodle ("error de programación").
export class CodingException extends Error {}

const GUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

// ivplayer_bunny_normalizar_guid
export function normalizarGuid(entrada) {
  const a = analizar(entrada);
  return a === null ? null : a.guid;
}

// ivplayer_bunny_analizar: GUID + de dónde vino (host del CDN o número de biblioteca).
export function analizar(entrada) {
  entrada = phpTrim(String(entrada ?? ''));
  if (entrada === '') return { guid: '', host: null, biblioteca: null };
  const fin = '(?:[/?#]|$)';
  // Sin flag m, "$" de JS ya calza sólo al final (como el /D de PHP).
  let m = entrada.match(new RegExp('^' + GUID + '$', 'i'));
  if (m) return { guid: m[1].toLowerCase(), host: null, biblioteca: null };
  m = entrada.match(new RegExp(String.raw`^(?:https?://)?(?:(?:player|iframe)\.mediadelivery\.net|video\.bunnycdn\.com)/(?:play|embed)/(\d+)/` + GUID + fin, 'i'));
  if (m) return { guid: m[2].toLowerCase(), host: null, biblioteca: m[1] };
  m = entrada.match(new RegExp(String.raw`^(?:https?://)?([^/?#\s]+)/(?:bcdn_token=[^/?#\s]*/)?` + GUID + fin, 'i'));
  if (m) return { guid: m[2].toLowerCase(), host: phpLower(m[1]), biblioteca: null };
  return null;
}

// ivplayer_bunny_normalizar_host
export function normalizarHost(entrada) {
  let host = phpTrim(String(entrada ?? '')).toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.replace(/[/?#][\s\S]*$/, '');
  if (host === '') return '';
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) return null;
  return host;
}

// ivplayer_bunny_error_de_entrada
export function errorDeEntrada(bunny, vimeo, hostSitio, bibliotecaSitio) {
  bunny = phpTrim(String(bunny ?? ''));
  vimeo = phpTrim(String(vimeo ?? ''));
  if (bunny === '') return vimeo === '' ? { clave: 'errorsinvideo', a: null } : null;
  const a = analizar(bunny);
  if (a === null) return { clave: 'errorbunnyguid', a: null };
  if (a.host !== null && hostSitio !== '' && normalizarHost(a.host) !== hostSitio) {
    return { clave: 'errorbunnyotrohost', a: a.host };
  }
  if (a.biblioteca !== null && bibliotecaSitio !== '' && phpLtrim0(a.biblioteca) !== phpLtrim0(bibliotecaSitio)) {
    return { clave: 'errorbunnyotrabiblioteca', a: a.biblioteca };
  }
  if (hostSitio === '' && vimeo === '') return { clave: 'errorbunnysinhost', a: null };
  return null;
}

// ivplayer_bunny_validar
export function validar(host, guid) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(guid)) {
    throw new CodingException('GUID de Bunny inválido');
  }
  if (host === '' || normalizarHost(host) !== host) {
    throw new CodingException('Host de Bunny inválido');
  }
}

// ivplayer_bunny_token: HMAC-SHA256 con la clave como CLAVE del HMAC, digest binario a
// base64url.
export function token(clave, rutaFirmada, expires) {
  const mensaje = rutaFirmada + String(expires) + 'token_path=' + rutaFirmada;
  const digest = crypto.createHmac('sha256', clave).update(mensaje).digest();
  return 'HS256-' + digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// rawurlencode de PHP: igual a encodeURIComponent para hex, "-" y "/" (lo único que
// llega acá: "/<guid>/").
const rawurlencode = (s) => encodeURIComponent(s);

// ivplayer_bunny_firmar
export function firmar(host, guid, clave, expires) {
  validar(host, guid);
  if (clave === '') throw new CodingException('Falta la clave de token de Bunny');
  if (expires <= 0) throw new CodingException('Vencimiento de Bunny inválido');
  const ruta = '/' + guid + '/';
  const t = token(clave, ruta, expires);
  const params = 'token_path=' + rawurlencode(ruta) + '&expires=' + expires;
  return {
    playlist: 'https://' + host + '/bcdn_token=' + t + '&' + params + ruta + 'playlist.m3u8',
    poster: 'https://' + host + ruta + 'thumbnail.jpg?token=' + t + '&' + params,
    query: 'token=' + t + '&' + params,
    expires,
  };
}

// ivplayer_bunny_urls
export function urls(host, guid, clave, expires) {
  if (clave === '') {
    validar(host, guid);
    return {
      playlist: 'https://' + host + '/' + guid + '/playlist.m3u8',
      poster: 'https://' + host + '/' + guid + '/thumbnail.jpg',
      firmada: false,
      expires: null,
    };
  }
  const f = firmar(host, guid, clave, expires);
  return { playlist: f.playlist, poster: f.poster, firmada: true, expires: f.expires };
}

// ivplayer_bunny_expires
export function expiresDe(ahora, ttl) {
  return (Math.floor(ahora / 3600) + 1) * 3600 + ttl;
}

// ivplayer_reproductor_soporta_bunny
export const reproductorSoportaBunny = (html) => html.includes('loadSource');
