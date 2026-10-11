// Funciones puras de mod/ivplayer/lib.php que SÓLO prueba PHP de verdad
// (tests/php/correr.php, que corre en CI) y no tienen espejo en Node.
//
// Por qué existe: en las máquinas de desarrollo no hay PHP, así que un cambio en una
// de estas funciones pasaba toda la suite local sin que nada lo mirara (oct-2026: sacar
// la rama que quita el BOM de UTF-8 de los subtítulos pasaba `npm test` entero). Esto
// no prueba el resultado —eso lo hace correr.php—, sólo AVISA que el código cambió:
// quien lo cambie tiene que correr la prueba PHP (`npm run test:php`, o el workflow
// "Pruebas" en GitHub) y, si da bien, poner acá la huella nueva.
// Cambiar comentarios de línea entera o la sangría no la dispara (ver fuente-php.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerLib, funcionPhp, huella } from './apoyo/fuente-php.mjs';

test('la normalización de subtítulos de lib.php no cambió sin pasar por la prueba PHP', () => {
  const huellas = {
    // VTT/SRT del docente → UTF-8 sin BOM (BOM de UTF-8, UTF-16 con BOM, Windows-1252,
    // bytes rotos) o null. Un byte inválido deja al reproductor sin PLAYER_CONFIG.
    ivplayer_subtitulos_normalizar: '5e2d500184fcd715',
  };
  const src = leerLib();
  for (const [nombre, esperada] of Object.entries(huellas)) {
    const f = funcionPhp(src, nombre);
    assert.ok(f, `${nombre} ya no está en lib.php`);
    assert.equal(huella(f), esperada,
      `${nombre} cambió en lib.php: sólo la prueba de verdad tests/php/correr.php (corre en CI). `
      + `Corré npm run test:php (o el workflow "Pruebas") y, si da bien, poné la huella nueva (${huella(f)})`);
  }
});
