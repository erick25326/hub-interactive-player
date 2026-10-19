// La configuración del reproductor (src/configuracion.js): lo que trae por defecto y
// cuándo hay un video para reproducir. Lo que protege: que la config por defecto no
// vuelva a traer un video (hasta la 1.4.0 traía una clase real del campus, y viaja en
// player.html, el configurador y cada SCORM de un repo público), y que sin video el
// reproductor muestre el cartel en vez de crear un Vimeo que tira y deja todo en blanco.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CONFIG, getConfig, hayVideo } from '../../src/configuracion.js';

const leer = (rel) => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

describe('config por defecto', () => {
  test('no trae video ni interacciones de ejemplo', () => {
    assert.equal(DEFAULT_CONFIG.vimeoId, '');
    assert.equal(DEFAULT_CONFIG.vimeoHash, null);
    assert.equal(DEFAULT_CONFIG.videoUrl, null);
    assert.equal(DEFAULT_CONFIG.poster, null);
    assert.deepEqual(DEFAULT_CONFIG.interactions, []);
    assert.equal(hayVideo(DEFAULT_CONFIG), false);
  });
  test('transmitiendo, las etiquetas van al glosario en vivo salvo que la actividad pida "pantalla"; sin transmitir, en pantalla como antes (1.4.0)', () => {
    assert.equal(DEFAULT_CONFIG.etiquetas, 'glosario');
    // El componente decide con "!== 'pantalla'": cualquier otro valor (un SCORM o una
    // demo armados sin el campo, uno mal escrito) también es el glosario. Y sólo con la
    // TV conectada (Erick, 19-oct-2026): los avisos también.
    const c = leer('src/InteractiveVideoPlayer.jsx');
    assert.match(c, /const enTV = tv\?\.estado === 'conectado';/);
    assert.match(c, /const vivo = enTV && etiquetas !== 'pantalla';/);
    assert.match(c, /avisarRef\.current = \(que, alto\) => \{\s+if \(!enTVRef\.current\) return;/);
    assert.match(c, /if\(!enTVRef\.current\)\{ if\(c\)\{ setCuenta\(null\); setAvisoCuenta\(''\); \} return; \}/);
  });

  test('getConfig: sin PLAYER_CONFIG, la por defecto; con PLAYER_CONFIG, mezclada encima', () => {
    const antes = globalThis.window;
    try {
      delete globalThis.window;
      assert.equal(getConfig(), DEFAULT_CONFIG);
      globalThis.window = {};
      assert.equal(getConfig(), DEFAULT_CONFIG);
      globalThis.window = { PLAYER_CONFIG: { title: 'Lección', videoUrl: 'https://cdn.ejemplo/x/playlist.m3u8' } };
      const c = getConfig();
      assert.equal(c.title, 'Lección');
      assert.equal(c.videoUrl, 'https://cdn.ejemplo/x/playlist.m3u8');
      assert.equal(c.videoMotor, 'auto', 'lo que no viene sale de la por defecto');
      assert.equal(hayVideo(c), true);
    } finally {
      if (antes === undefined) delete globalThis.window; else globalThis.window = antes;
    }
  });

  // El componente tiene que usar ESTE módulo, no una copia propia: si no, la prueba de
  // arriba protegería una config que no se usa.
  test('el reproductor toma la config y hayVideo de configuracion.js, sin copias propias', () => {
    const jsx = leer('src/InteractiveVideoPlayer.jsx');
    assert.match(jsx, /import \{[^}]*\bgetConfig\b[^}]*\bhayVideo\b[^}]*\} from "\.\/configuracion\.js"/);
    assert.doesNotMatch(jsx, /DEFAULT_CONFIG|function getConfig\b|function hayVideo\b|const hayVideo\s*=/);
    assert.match(jsx, /hayVideo\(config\) \? <Reproductor\/> : <SinVideo /, 'sin video tiene que ir al cartel, sin montar el reproductor');
  });

  // config.example.js se copia tal cual para probar: si alguien le pega un video real,
  // queda publicado. Así como está, tiene que dar "sin video".
  test('config.example.js trae valores de mentira: tal cual, no hay video', () => {
    const w = {};
    new Function('window', leer('config.example.js'))(w);
    assert.ok(w.PLAYER_CONFIG && Array.isArray(w.PLAYER_CONFIG.interactions) && w.PLAYER_CONFIG.interactions.length > 0);
    assert.equal(hayVideo(w.PLAYER_CONFIG), false, `config.example.js trae un video: ${w.PLAYER_CONFIG.vimeoId} ${w.PLAYER_CONFIG.videoUrl || ''}`);
  });
});

describe('hayVideo', () => {
  const casos = [
    // [config, ¿hay video?, por qué]
    [{ videoUrl: 'https://vz-ejemplo.b-cdn.net/11111111-2222-4333-8444-555555555555/playlist.m3u8' }, true, 'HLS de Bunny'],
    [{ videoUrl: 'blob:http://localhost/abc', vimeoId: '' }, true, 'archivo de la compu (configurador)'],
    [{ vimeoId: '', videoUrl: 'https://cdn.ejemplo/v.mp4' }, true, 'player.php con Bunny: vimeoId vacío y videoUrl'],
    [{ vimeoId: 'https://cdn.ejemplo/v.m3u8' }, true, 'URL propia pegada en vimeoId'],
    [{ vimeoId: '123456' }, true, 'ID de Vimeo'],
    [{ vimeoId: 123456 }, true, 'ID de Vimeo como número'],
    [{ vimeoId: '123456', vimeoHash: 'abcdef1234' }, true, 'ID + hash'],
    [{ vimeoId: 'https://vimeo.com/123456/abcdef1234' }, true, 'URL de Vimeo con hash'],
    [{ vimeoId: 'https://player.vimeo.com/video/123456?h=abcdef1234' }, true, 'URL del reproductor de Vimeo'],
    [{}, false, 'nada'],
    [{ vimeoId: '', vimeoHash: null, videoUrl: null }, false, 'todo vacío'],
    [{ vimeoId: null }, false, 'null'],
    [{ vimeoId: '0' }, false, 'cero: el SDK de Vimeo lo toma como "sin id" y tira'],
    [{ vimeoId: 'ID_DEL_VIDEO', vimeoHash: 'HASH_DEL_VIDEO' }, false, 'texto que no es un ID (parseInt da NaN)'],
    [{ vimeoId: 'https://vimeo.com/' }, false, 'URL de Vimeo sin ID'],
    [{ vimeoId: 'https://vimeo.com/ID_DEL_VIDEO/HASH_DEL_VIDEO' }, false, 'URL de Vimeo con texto en vez de ID'],
  ];
  for (const [config, esperado, porque] of casos) {
    test(`${esperado ? 'hay' : 'no hay'} video: ${porque}`, () => assert.equal(hayVideo(config), esperado));
  }
  test('sin argumento no tira', () => assert.equal(hayVideo(), false));
});
