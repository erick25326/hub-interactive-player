// Firma de Bunny y validación de lo que pega el docente, probadas LOCALMENTE sobre el
// espejo en Node de lib.php (apoyo/bunny-espejo.mjs), con los mismos vectores que usa
// la prueba PHP de verdad (tests/php/correr.php, que corre en CI contra lib.php).
// Lo que protege: que el CDN acepte el token (un error acá es 403 para todos los
// alumnos) y que nunca se firme algo que no sea exactamente /<guid>/ de un host válido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as B from './apoyo/bunny-espejo.mjs';
import { leerLib, funcionPhp, huella } from './apoyo/fuente-php.mjs';

const V = JSON.parse(fs.readFileSync(new URL('../php/vectores-bunny.json', import.meta.url), 'utf8'));

// La misma expresión con la que el reproductor saca el GUID de videoUrl para la clave
// del avance en localStorage. Se lee del JSX para no copiarla a mano.
const jsx = fs.readFileSync(new URL('../../src/InteractiveVideoPlayer.jsx', import.meta.url), 'utf8');
const literal = jsx.match(/nativeSrc\.match\((\/.+?\/[a-z]*)\)/);
const reGuidDelReproductor = literal && new Function('return ' + literal[1])();

// Generador con semilla: las pruebas al azar son reproducibles.
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('el token coincide con los vectores oficiales de Bunny (clave como clave del HMAC, digest binario en base64url)', () => {
  for (const v of V.token) assert.equal(B.token(v.clave, v.ruta, v.expires), v.esperado, v.fuente);
});

test('firmar da el mismo playlist, miniatura y query que el SDK oficial de Bunny', () => {
  for (const v of V.firmar) {
    assert.deepEqual(B.firmar(v.host, v.guid, v.clave, v.expires),
      { playlist: v.playlist, poster: v.poster, query: v.query, expires: v.expires }, v.nombre);
    assert.deepEqual(B.urls(v.host, v.guid, v.clave, v.expires),
      { playlist: v.playlist, poster: v.poster, firmada: true, expires: v.expires }, 'urls ' + v.nombre);
  }
});

test('sin clave, las URLs van planas (y igual se valida host y GUID)', () => {
  const u = V.urlsSinClave;
  assert.deepEqual(B.urls(u.host, u.guid, '', 0), u.esperado);
});

test('el reproductor encuentra el GUID en la URL firmada: la clave del avance no cambia al renovar el token', () => {
  assert.ok(reGuidDelReproductor, 'no encontré nativeSrc.match(/…/) en InteractiveVideoPlayer.jsx');
  for (const v of V.firmar) assert.equal(v.playlist.match(reGuidDelReproductor)?.[1], v.guid, v.nombre);
  assert.equal(V.urlsSinClave.esperado.playlist.match(reGuidDelReproductor)?.[1], V.urlsSinClave.guid);
});

test('las variantes y los .ts relativos del playlist heredan el token de la ruta (en la query se perdería)', () => {
  const v = V.firmar[0];
  const f = B.firmar(v.host, v.guid, v.clave, v.expires);
  const prefijo = f.playlist.slice(0, f.playlist.indexOf('/' + v.guid + '/'));
  const variante = new URL('360p/video.m3u8', f.playlist).href;
  assert.equal(variante, prefijo + '/' + v.guid + '/360p/video.m3u8');
  assert.equal(new URL('video0.ts', variante).href, prefijo + '/' + v.guid + '/360p/video0.ts');
  // Con el token en la query (formato de la miniatura) la variante lo pierde: por eso
  // el playlist va firmado en la ruta.
  assert.equal(new URL('360p/video.m3u8', f.poster.replace('thumbnail.jpg', 'playlist.m3u8')).href.includes('token='), false);
});

test('normalizar el GUID acepta el GUID, el enlace del reproductor de Bunny y el del CDN; rechaza lo demás', () => {
  for (const [entrada, esperado] of V.normalizarGuid) assert.equal(B.normalizarGuid(entrada), esperado, JSON.stringify(entrada));
});

test('normalizar el host deja sólo un nombre DNS válido (sin puerto, usuario ni espacios)', () => {
  for (const [entrada, esperado] of V.normalizarHost) assert.equal(B.normalizarHost(entrada), esperado, JSON.stringify(entrada));
});

test('analizar dice de dónde vino el enlace (host del CDN o número de biblioteca)', () => {
  for (const [entrada, esperado] of V.analizar) {
    assert.deepEqual(B.analizar(entrada), esperado, JSON.stringify(entrada));
    assert.equal(B.normalizarGuid(entrada), esperado?.guid ?? null, 'normalizarGuid = analizar().guid ' + JSON.stringify(entrada));
  }
});

test('el formulario frena enlaces de otro host, de otra biblioteca y Bunny sin host en el sitio', () => {
  for (const [bunny, vimeo, host, biblio, esperado] of V.errorDeEntrada) {
    assert.deepEqual(B.errorDeEntrada(bunny, vimeo, host, biblio), esperado, JSON.stringify([bunny, vimeo, host, biblio]));
  }
});

test('el vencimiento va a la hora en punto siguiente más el TTL (misma URL en toda la hora)', () => {
  for (const [ahora, ttl, esperado] of V.expires) assert.equal(B.expiresDe(ahora, ttl), esperado);
  const azar = mulberry32(3600);
  for (let i = 0; i < 2000; i++) {
    const ahora = 1 + Math.floor(azar() * 2 ** 32), ttl = 3600 + Math.floor(azar() * (604800 - 3600 + 1));
    const e = B.expiresDe(ahora, ttl);
    assert.ok(e - ahora >= ttl && e - ahora <= ttl + 3600 && e % 3600 === ttl % 3600, `ahora=${ahora} ttl=${ttl} -> ${e}`);
  }
});

test('nunca se firma algo que no sea exactamente /<guid>/ de un host válido, ni sin clave o vencimiento', () => {
  const fn = { firmar: B.firmar, urls: B.urls };
  for (const r of V.rechazos) assert.throws(() => fn[r.funcion](...r.args), B.CodingException, r.nombre);
});

test('el video de una actividad: la misma regla de "¿usa Bunny?" para player.php y firma.php, y la clave nunca sale', () => {
  for (const v of V.video) {
    const r = B.video(v.guardado, v.host, v.clave, v.ttl, v.ahora, v.reproductor);
    assert.deepEqual(r, v.esperado, v.nombre);
    if (v.clave) assert.ok(!JSON.stringify(r).includes(v.clave), 'la clave salió en ' + v.nombre);
  }
});

test('la detección del reproductor que sabe Bunny busca la marca loadSource', () => {
  for (const [html, esperado] of V.soportaBunny) assert.equal(B.reproductorSoportaBunny(html), esperado, html);
});

// 🔴 El espejo es una TRADUCCIÓN: si el código de una de estas funciones de lib.php
// cambia, esta prueba falla para que se re-traduzca apoyo/bunny-espejo.mjs (y se
// actualice su huella acá). Cambiar comentarios o sangría no la dispara.
test('el espejo en Node sigue siendo la traducción del código actual de lib.php', () => {
  const huellas = {
    ivplayer_bunny_normalizar_guid: '9bd6588245df8a8c',
    ivplayer_bunny_analizar: '51dcee68f35cfc38',
    ivplayer_bunny_normalizar_host: '141839c8d558b39f',
    ivplayer_bunny_error_de_entrada: '6a78b7885b65ebce',
    ivplayer_bunny_validar: 'f067db66cab57a15',
    ivplayer_bunny_token: '6fc0d4bd62e0b6b7',
    ivplayer_bunny_firmar: '9616d3a6c58758fa',
    ivplayer_bunny_urls: 'b8b96d801a5fd860',
    ivplayer_bunny_expires: '47d8cdf0e7a5bfae',
    ivplayer_bunny_video: '892a41b08061f6fc',
    ivplayer_reproductor_soporta_bunny: 'dc7bcfc7d403f57f',
  };
  const src = leerLib();
  for (const [nombre, esperada] of Object.entries(huellas)) {
    const f = funcionPhp(src, nombre);
    assert.ok(f, `${nombre} ya no está en lib.php`);
    assert.equal(huella(f), esperada,
      `${nombre} cambió en lib.php: re-traducí tests/unit/apoyo/bunny-espejo.mjs y poné la huella nueva (${huella(f)})`);
  }
});
