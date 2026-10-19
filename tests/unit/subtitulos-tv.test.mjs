// Subtítulos en la TV (1.4.0): lo que baja la TV de subtitulos.php tiene que ser LO MISMO
// que dibuja el celular. El VTT lo arma lib.php (ivplayer_subtitulos_a_vtt, en PHP) y el
// celular lo lee con parseVTT (src/subtitulos.js). Las dos puntas se prueban con los
// mismos vectores (tests/php/vectores-subtitulos.json): correr.php mira que PHP dé esos
// cues y ese WebVTT; acá, sin PHP, que parseVTT lea esos mismos cues de la entrada y
// del WebVTT que se sirve, y que ese WebVTT sea estricto. Además, la firma del enlace con
// el HMAC de Node: dos implementaciones independientes que tienen que dar lo mismo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { parseVTT } from '../../src/subtitulos.js';

const V = JSON.parse(fs.readFileSync(new URL('../php/vectores-subtitulos.json', import.meta.url), 'utf8'));
// Los cues de parseVTT (segundos con decimales) como los de PHP (milisegundos enteros).
const comoPhp = (cues) => cues.map((c) => [Math.round(c.start * 1000), Math.round(c.end * 1000), c.text]);
// En la TV un renglón que quedó vacío al sacar etiquetas no se manda (cortaría el cue).
const sinRenglonesVacios = (cues) => cues.map(([a, b, t]) => [a, b, t.split('\n').filter((l) => l.trim()).join('\n')]);

test('la firma del enlace (HMAC-SHA256 de "cmid|e", base64url) da lo mismo con el HMAC de Node', () => {
  assert.ok(V.firma.length >= 3);
  for (const f of V.firma) {
    const s = crypto.createHmac('sha256', f.secreto).update(`${f.cmid}|${f.e}`).digest('base64url');
    assert.equal(s, f.esperada, `cmid ${f.cmid}`);
    assert.match(s, /^[A-Za-z0-9_-]{43}$/, 'sin "=", "+" ni "/": viaja tal cual en la query');
  }
});

for (const c of V.casos) {
  test(`el celular lee los mismos cues que manda la TV: ${c.nombre}`, () => {
    assert.deepEqual(comoPhp(parseVTT(c.entrada)), c.cues, 'parseVTT de la entrada');
    if (c.vtt === null) {
      assert.deepEqual(c.cues, [], 'sin cues no hay WebVTT');
      return;
    }
    assert.deepEqual(comoPhp(parseVTT(c.vtt)), sinRenglonesVacios(c.cues), 'parseVTT del WebVTT que se sirve');
    // WebVTT estricto: cabecera, tiempos HH:MM:SS.mmm, sin renglones vacíos adentro de un
    // cue y sin "<" ni "-->" en el texto (van escapados).
    assert.ok(c.vtt.startsWith('WEBVTT\n\n') && c.vtt.endsWith('\n') && !c.vtt.endsWith('\n\n'));
    for (const bloque of c.vtt.slice(8, -1).split('\n\n')) {
      const [tiempo, ...texto] = bloque.split('\n');
      assert.match(tiempo, /^\d{2}:\d{2}:[0-5]\d\.\d{3} --> \d{2}:\d{2}:[0-5]\d\.\d{3}$/);
      assert.ok(texto.length && texto.every((l) => l.trim()), `renglón vacío en ${JSON.stringify(bloque)}`);
      assert.ok(!texto.join('\n').includes('<') && !texto.join('\n').includes('-->'), JSON.stringify(bloque));
    }
  });
}
