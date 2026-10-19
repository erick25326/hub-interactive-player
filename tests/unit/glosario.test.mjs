// El GLOSARIO EN VIVO (src/glosario.js): la lista de términos que se ve en la compu o el
// celular mientras el video está en la TV. Sale del TIEMPO (no se acumula), el más nuevo
// arriba; qué suena al cruzarlo; las marcas de la barra; y cuándo plegar un término
// retoma la TV. La pantalla y sus toques, en tests/navegador/escenarios/glosario.mjs.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nombreDe, esTermino, hayTerminos, terminosVisibles, terminosCruzados, marcadores, retomarAlCerrar, ANTICIPO_S } from '../../src/glosario.js';
import { SEEK_MIN } from '../../src/candado.js';

const E = (id, time, text, extra = {}) => ({ id, type: 'label', time, data: { text, definition: `Def de ${text}`, ...extra } });
const DL = E('dl', 2, 'Data Link');
const FR = E('fr', 10, '  Frecuencia ');
const TE = E('te', 18, 'Telemetría', { image: 'data:image/png;base64,AAAA' });
const MISMO = E('mismo', 18, 'OcuSync');
const NOTA = { id: 'n7', type: 'note', time: 7, data: { title: 'Nota', text: 'x' } };
const MC = { id: 'mc15', type: 'multiple-choice', time: 15, data: {} };
const VACIA = E('vacia', 5, '   ');
const IAS = [DL, NOTA, FR, MC, TE, MISMO, VACIA];
const ids = (xs) => xs.map((x) => x.id);

describe('qué es un término', () => {
  test('sólo etiquetas con texto; las notas ya no van en la lista', () => {
    assert.deepEqual(IAS.map(esTermino), [true, false, true, false, true, true, false]);
    assert.equal(nombreDe(FR), 'Frecuencia');
    assert.equal(hayTerminos([NOTA, MC, VACIA]), false);
    assert.equal(hayTerminos(IAS), true);
  });
});

describe('terminosVisibles: la lista sale del tiempo', () => {
  test('crece con el tiempo y el más nuevo va arriba', () => {
    assert.deepEqual(ids(terminosVisibles(IAS, 0)), []);
    assert.deepEqual(ids(terminosVisibles(IAS, 2)), ['dl']);
    assert.deepEqual(ids(terminosVisibles(IAS, 12)), ['fr', 'dl']);
  });
  test('volver para atrás la achica y volver a ver la rellena (nada se queda "nombrado")', () => {
    assert.deepEqual(ids(terminosVisibles(IAS, 30)), ['mismo', 'te', 'fr', 'dl']);
    assert.deepEqual(ids(terminosVisibles(IAS, 5)), ['dl']);
    assert.deepEqual(ids(terminosVisibles(IAS, 30)), ['mismo', 'te', 'fr', 'dl']);
  });
  test('dos en el mismo segundo son dos filas: arriba la que está después en la configuración', () => {
    assert.deepEqual(ids(terminosVisibles(IAS, 18)), ['mismo', 'te', 'fr', 'dl']);
  });
  test(`se ve ${ANTICIPO_S} s antes de su segundo (un salto a ese segundo aterriza un pelito antes)`, () => {
    assert.deepEqual(ids(terminosVisibles(IAS, 10 - ANTICIPO_S)), ['fr', 'dl']);
    assert.deepEqual(ids(terminosVisibles(IAS, 10 - ANTICIPO_S - 0.01)), ['dl']);
  });
  test('trae definición e imagen (data.image), o null si no hay', () => {
    const [te] = terminosVisibles([TE], 20);
    assert.deepEqual([te.nombre, te.texto, te.imagen, te.time], ['Telemetría', 'Def de Telemetría', 'data:image/png;base64,AAAA', 18]);
    assert.equal(terminosVisibles([DL], 20)[0].imagen, null);
    assert.equal(terminosVisibles([E('x', 1, 'X', { definition: 42 })], 2)[0].texto, '');
  });
});

describe('terminosCruzados: los que aparecen reproduciendo (suenan y entran animados)', () => {
  const cruza = (prev, t, reproduciendo = true, velocidad) => ids(terminosCruzados({ interactions: IAS, prev, t, reproduciendo, velocidad }));
  test('reproduciendo, al cruzar su segundo; los dos del mismo segundo juntos, en orden', () => {
    assert.deepEqual(cruza(9.6, 9.9), ['fr']);
    assert.deepEqual(cruza(17.6, 17.9), ['te', 'mismo']);
    assert.deepEqual(cruza(10, 10.3), [], 'ya estaba');
  });
  test('un salto, en pausa o hacia atrás: callados', () => {
    assert.deepEqual(cruza(5, 12), [], 'salto de 7 s');
    assert.deepEqual(cruza(9.6, 9.9, false), [], 'en pausa');
    assert.deepEqual(cruza(12, 9), [], 'hacia atrás');
  });
  test('volver a ver el video los vuelve a cruzar (suenan otra vez)', () => {
    assert.deepEqual(cruza(9.6, 9.9), ['fr']);
    assert.deepEqual(cruza(9.6, 9.9), ['fr']);
  });
  test('a 2×, un paso más largo sigue siendo reproducción', () => {
    assert.deepEqual(cruza(9.75 - 2 * SEEK_MIN + 0.1, 9.85, true, 2), ['fr']);
  });
});

test('marcadores: términos rayitas, lo que frena cuadraditos, vistos por tiempo', () => {
  const m = marcadores(IAS, 12, 100);
  assert.deepEqual(m.map((x) => [x.id, x.tipo, +x.left.toFixed(3), x.visto]), [
    ['dl', 'termino', 2, true], ['n7', 'frena', 7, true], ['fr', 'termino', 10, true],
    ['mc15', 'frena', 15, false], ['te', 'termino', 18, false], ['mismo', 'termino', 18, false],
  ]);
  assert.deepEqual(marcadores(IAS, 12, 0), [], 'sin duración, ninguna');
});

test('retomarAlCerrar: plegar retoma sólo la pausa que puso expandir', () => {
  assert.equal(retomarAlCerrar({ pausoElTermino: true }), true);
  assert.equal(retomarAlCerrar({ pausoElTermino: false }), false, 'la pausó el alumno o ya estaba en pausa');
  assert.equal(retomarAlCerrar({ pausoElTermino: true, pregunta: true }), false, 'la frenó una pregunta, nota o la tarjeta de fin');
  assert.equal(retomarAlCerrar({ pausoElTermino: true, error: true }), false);
});
