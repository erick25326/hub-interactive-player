// El configurador de interacciones con el video de Bunny que manda Moodle, sin
// navegador: lo que el configurador acepta del mensaje de mod_form.php
// (fuenteBunnyDeMoodle), con qué motor reproduce el HLS (motorHls), que el enlace
// firmado no llegue a lo que se exporta o vuelve a Moodle, y el armado que mete hls.js
// en el configurador publicado (scripts/armar-configurador.mjs).
// Las funciones del configurador se leen de configurator/index.html (no se copian),
// como hace correr.php con lib.php. El recorrido entero (hls.js de verdad, el CDN con
// token, el script real de mod_form.php) lo prueba el nivel navegador
// (escenarios/configurador-bunny.mjs). Datos sintéticos (repo público).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { armarConfigurador, scriptHls, leerHlsJs } from '../../scripts/armar-configurador.mjs';

const CONFIGURADOR = fs.readFileSync(new URL('../../configurator/index.html', import.meta.url), 'utf8').split('\r\n').join('\n');

// Texto de una función de primer nivel del script del configurador: desde "function
// nombre(" hasta la primera "}" en la columna 0 (así cierran todas).
function funcionDelConfigurador(nombre) {
  const a = CONFIGURADOR.search(new RegExp('^function ' + nombre + '\\(', 'm'));
  assert.ok(a >= 0, `${nombre} ya no está en configurator/index.html`);
  const b = CONFIGURADOR.indexOf('\n}', a);
  return CONFIGURADOR.slice(a, b + 2);
}
const cargar = (nombre) => new Function(`${funcionDelConfigurador(nombre)}\nreturn ${nombre};`)();

const GUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FIRMADA = `https://vz-ejemplo.b-cdn.net/bcdn_token=HS256-abc_-123&token_path=%2F${GUID}%2F&expires=1800000000/${GUID}/playlist.m3u8`;
const AHORA = 1_700_000_000_000;

describe('fuenteBunnyDeMoodle: lo que acepta del mensaje de mod_form.php', () => {
  const fuente = cargar('fuenteBunnyDeMoodle');
  const casos = [
    // [bunny del mensaje, resultado, por qué]
    [{ playlist: FIRMADA, restan: 7200 }, { playlist: FIRMADA, vence: AHORA + 7200 * 1000 }, 'firmado: vence con lo que le queda, en el reloj de esta compu'],
    [{ playlist: FIRMADA, restan: '7200' }, { playlist: FIRMADA, vence: AHORA + 7200 * 1000 }, 'restan como texto'],
    [{ playlist: `https://vz-ejemplo.b-cdn.net/${GUID}/playlist.m3u8`, restan: null }, { playlist: `https://vz-ejemplo.b-cdn.net/${GUID}/playlist.m3u8`, vence: null }, 'sin firmar (sitio sin clave): sin vencimiento'],
    [{ playlist: `  ${FIRMADA}  `, restan: 60 }, { playlist: FIRMADA, vence: AHORA + 60000 }, 'con espacios alrededor'],
    [{ playlist: `http://127.0.0.1:4321/bcdn_token=x/${GUID}/playlist.m3u8`, restan: 10 }, { playlist: `http://127.0.0.1:4321/bcdn_token=x/${GUID}/playlist.m3u8`, vence: AHORA + 10000 }, 'http en esta compu (desarrollo y pruebas)'],
    [{ vencido: true }, { vencido: true }, 'mod_form avisa que venció'],
    [{ playlist: FIRMADA, restan: 0 }, { vencido: true }, 'sin tiempo: vencido'],
    [{ playlist: FIRMADA, restan: -5 }, { vencido: true }, 'vencido'],
    [{ playlist: FIRMADA, restan: 'mucho' }, null, 'restan que no es un número'],
    [{ playlist: `http://vz-ejemplo.b-cdn.net/${GUID}/playlist.m3u8`, restan: 60 }, null, 'http fuera de esta compu'],
    [{ playlist: `javascript:alert(1)//.m3u8`, restan: 60 }, null, 'otro esquema'],
    [{ playlist: `https://vz-ejemplo.b-cdn.net/${GUID}/play"list.m3u8`, restan: 60 }, null, 'con comillas (va a un src)'],
    [{ playlist: `https://vz-ejemplo.b-cdn.net/${GUID}/video.mp4`, restan: 60 }, null, 'no es un HLS'],
    [{ playlist: `https://vz-ejemplo.b-cdn.net/${'a'.repeat(5000)}/playlist.m3u8`, restan: 60 }, null, 'larguísimo'],
    [{ playlist: 12345, restan: 60 }, null, 'playlist que no es texto'],
    [{}, null, 'vacío'],
    [null, null, 'null (mod_form viejo o actividad sin Bunny)'],
    [undefined, null, 'sin bunny'],
    ['texto', null, 'texto suelto'],
  ];
  for (const [dato, esperado, porque] of casos) {
    test(porque, () => assert.deepEqual(fuente(dato, AHORA), esperado));
  }
});

describe('motorHls: hls.js primero, el nativo si no hay', () => {
  const motor = cargar('motorHls');
  const video = (nativo) => ({ canPlayType: (t) => (nativo && t === 'application/vnd.apple.mpegurl' ? 'maybe' : '') });
  test('con hls.js y MSE: hls.js, aunque el navegador diga "maybe" al nativo (Chrome 142+)', () => {
    assert.equal(motor({ isSupported: () => true }, video(true)), 'hls');
  });
  test('hls.js sin MSE (iPhone viejo): el nativo', () => assert.equal(motor({ isSupported: () => false }, video(true)), 'nativo'));
  test('sin hls.js (configurador sin armar): el nativo si lo hay', () => assert.equal(motor(undefined, video(true)), 'nativo'));
  test('sin ninguno: null (el cartel de "este navegador no reproduce")', () => assert.equal(motor(undefined, video(false)), null));
});

describe('el enlace firmado no sale del configurador', () => {
  // 🔴 Lo que se exporta, vuelve a Moodle o va al SCORM sale de buildConfig (y
  // exportJSON le suma sólo el videoUrl importado, que se descarta si viene firmado).
  // Ninguno mira la fuente de Bunny ni la URL del video abierto.
  for (const nombre of ['buildConfig', 'exportJSON']) {
    test(`${nombre} no lee fuenteBunny ni reproductor.url`, () => {
      const f = funcionDelConfigurador(nombre);
      assert.doesNotMatch(f, /fuenteBunny|reproductor\.url|\.playlist/);
    });
  }
  test('"Guardar en Moodle" manda buildConfig y nada más', () => {
    const f = funcionDelConfigurador('showMoodleSaveBtn');
    assert.match(f, /var config = buildConfig\(\);/);
    assert.match(f, /postMessage\(\{ type: 'ivplayer-save-config', config: config \}/);
  });
  test('un videoUrl firmado en un JSON importado no se guarda para reexportarlo', () => {
    assert.match(funcionDelConfigurador('loadConfig'), /!\/bcdn_token=\|\[\?&\]token=\/i\.test\(vu\)/);
  });
  test('mostrarFuente no pone la URL en pantalla (sólo la mira para el botón de volver)', () => {
    const f = funcionDelConfigurador('mostrarFuente').split('\n').filter((l) => !/volver/.test(l)).join('\n');
    assert.doesNotMatch(f, /\.playlist|reproductor\.url/);
  });
});

describe('armado del configurador con hls.js', () => {
  const hls = leerHlsJs();
  const configurator = '<!DOCTYPE html><html><head><title>c</title></head><body><script>let interactions = [];\nconst t = `</head>`;</script></body></html>';
  const armado = armarConfigurador({ playerHtml: '<html><head></head><body></body></html>', manifest: '<title>t</title>', configurator });

  test('hls.js completo (no light) y de la versión instalada', () => {
    assert.match(hls.version, /^\d+\.\d+\.\d+/);
    assert.ok(hls.codigo.includes('loadSource'), 'no es hls.js');
    const real = JSON.parse(fs.readFileSync(new URL('../../node_modules/hls.js/package.json', import.meta.url), 'utf8')).version;
    assert.equal(hls.version, real);
  });
  test('va adentro del <head>, antes del script del configurador, una sola vez', () => {
    const i = armado.indexOf(`/* hls.js ${hls.version}`);
    assert.ok(i > 0, 'no está hls.js');
    assert.ok(i < armado.indexOf('</head>'), 'hls.js tiene que ir antes del </head> del documento');
    assert.ok(i < armado.indexOf('let interactions = []'), 'hls.js tiene que estar antes del script del configurador');
    assert.equal(armado.split(`/* hls.js ${hls.version}`).length, 2, 'hls.js entró más de una vez');
    // El "</head>" de adentro del JS del configurador no se toca.
    assert.ok(armado.includes('const t = `</head>`;'));
  });
  test('sin el comentario del source map', () => {
    assert.doesNotMatch(scriptHls(hls), /sourceMappingURL/);
  });
  test('un "</script" o "<!--" adentro de la biblioteca no cierra el bloque', () => {
    const s = scriptHls({ codigo: 'var a = "</script><script>alert(1)</SCRIPT>"; var b = "<!--";\n//# sourceMappingURL=x.map\n', version: '0.0.0' });
    const cuerpo = s.slice(s.indexOf('>') + 1, s.lastIndexOf('</script>'));
    assert.doesNotMatch(cuerpo, /<\/script|<!--/i);
    assert.equal(new Function(cuerpo.replace(/^\/\*.*?\*\//, '') + '; return [a, b];')().join('|'), '</script><script>alert(1)</SCRIPT>|<!--',
      'el escape cambió lo que dice el código');
  });
  test('el configurador de verdad queda con tres scripts que compilan', () => {
    const real = armarConfigurador({
      playerHtml: '<html><head></head><body></body></html>',
      manifest: '<title>t</title>',
      configurator: CONFIGURADOR,
    });
    const scripts = [...real.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(scripts.length, 3, 'hls.js, el del configurador y el del armado');
    for (const s of scripts) assert.doesNotThrow(() => new Function(s));
  });
});
