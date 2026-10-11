// Leer funciones de mod/ivplayer/lib.php desde Node, sin PHP: sirve para fijar la
// "huella" del código que el espejo de bunny-espejo.mjs tradujo.
import crypto from 'node:crypto';
import fs from 'node:fs';

export const RUTA_LIB = new URL('../../../mod/ivplayer/lib.php', import.meta.url);

export function leerLib() {
  // En Windows git la deja con CRLF; en CI, con LF. Se compara siempre en LF.
  return fs.readFileSync(RUTA_LIB, 'utf8').split('\r\n').join('\n');
}

// Texto de una función de primer nivel: desde "function nombre(" hasta la primera "}"
// en la columna 0 (así cierra toda función de lib.php). null si no está.
export function funcionPhp(src, nombre) {
  const a = src.search(new RegExp('^function ' + nombre + '\\(', 'm'));
  if (a < 0) return null;
  const b = src.indexOf('\n}', a);
  return b < 0 ? null : src.slice(a, b + 2);
}

// Huella del CÓDIGO de una función: sin los comentarios de línea entera y con el
// espacio colapsado, así reescribir un comentario o reindentar no la cambia, pero
// tocar una expresión sí.
export function huella(texto) {
  const codigo = texto.split('\n').filter((l) => !/^\s*\/\//.test(l)).join(' ').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(codigo).digest('hex').slice(0, 16);
}
