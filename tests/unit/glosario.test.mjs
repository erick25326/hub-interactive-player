// El GLOSARIO INTERACTIVO (src/glosario.js): qué términos se suman en cada paso del
// tiempo, cuáles con sonido, y qué se lista y en qué orden. Contenido de ejemplo: los
// textos de la lección 3.1 de Introducción a los Drones (no son secretos; el video no
// va). Lo que hace el componente con esto, tests/navegador/escenarios/glosario.mjs.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nombreDe, esTermino, esNota, hayGlosario, totalPosible, terminosNuevos, entradas, RECIEN_MS, AVISO_MS } from '../../src/glosario.js';

const L = (id, time, text, definition = `Definición de ${text}.`) => ({ id, type: 'label', time, duration: 8, data: { text, definition, x: 5, y: 15 } });
const LECCION = [
  L('data-link', 2, 'Data Link', 'Sistema de comunicación inalámbrica que conecta el control remoto con la aeronave.'),
  L('ondas', 4, 'Ondas de radio'),
  L('frecuencia', 9, 'Frecuencia'),
  L('banda-24', 15, 'Banda de 2.4 GHz'),
  L('banda-58', 17, 'Banda de 5.8 GHz'),
  L('telemetria', 39, 'Telemetría'),
  { id: 'mc-downlink', type: 'multiple-choice', time: 48, data: { question: '¿Por qué enlace viajan la telemetría y el video en tiempo real?', options: [], correctId: 'b' } },
  L('ocusync', 71, 'Ocusync'),
  { id: 'nota-wifi', type: 'note', time: 89, data: { title: 'Dato curioso: Wi-Fi en drones DJI', text: 'En algunos DJI, el enlace depende de **cómo se vuela**.' } },
  L('gestion', 93, 'Gestión inteligente'),
  L('entorno', 97, 'Entorno radioeléctrico'),
];
const ids = (xs) => xs.map((x) => x.id);

test('constantes: "recién" 6 s y el aviso con el panel cerrado 4,5 s', () => {
  assert.deepEqual({ RECIEN_MS, AVISO_MS }, { RECIEN_MS: 6000, AVISO_MS: 4500 });
});

describe('qué va al glosario', () => {
  test('etiquetas con nombre y notas; preguntas y puntos para tocar no', () => {
    assert.equal(esTermino(LECCION[0]), true);
    assert.equal(esNota(LECCION[8]), true);
    assert.equal(esTermino(LECCION[6]) || esNota(LECCION[6]), false);
    assert.equal(esTermino({ id: 'x', type: 'label', time: 3, data: { text: '   ' } }), false, 'sin nombre no se lista');
    assert.equal(esTermino({ id: 'x', type: 'label', time: 3 }), false, 'sin data no rompe');
    assert.equal(hayGlosario(LECCION), true);
    assert.equal(hayGlosario([LECCION[6]]), false, 'sólo una pregunta: sin glosario (sin botón)');
    assert.equal(hayGlosario(undefined), false);
    assert.equal(totalPosible(LECCION), 10);
  });
  test('el nombre: el término, el título de la nota o el principio de su texto sin markdown', () => {
    assert.equal(nombreDe(LECCION[0]), 'Data Link');
    assert.equal(nombreDe(LECCION[8]), 'Dato curioso: Wi-Fi en drones DJI');
    assert.equal(nombreDe({ type: 'note', data: { text: 'Una nota **sin** título' } }), 'Una nota sin título');
    const larga = nombreDe({ type: 'note', data: { text: 'x'.repeat(200) } });
    assert.ok(larga.length <= 58 && larga.endsWith('…'), larga);
  });
});

describe('terminosNuevos: cuándo se suma cada término', () => {
  // Recorre como el componente: ticks de `paso` s, sumando lo nuevo a `nombrados`.
  function recorrer({ desde = 0, hasta, paso = 0.25, nombrados = new Set(), reproduciendo = true }) {
    const sumados = [];
    let prev = desde;
    for (let t = desde + paso; t <= hasta + 1e-9; t += paso) {
      for (const n of terminosNuevos({ interactions: LECCION, nombrados, prev, t, reproduciendo })) { nombrados.add(n.id); sumados.push({ t: +t.toFixed(2), ...n }); }
      prev = t;
    }
    return { sumados, nombrados };
  }

  test('reproduciendo: cada uno en su segundo, con sonido, de a uno', () => {
    const { sumados } = recorrer({ hasta: 20 });
    assert.deepEqual(sumados.map((s) => [s.id, s.t, s.sonido]), [
      ['data-link', 2, true], ['ondas', 4, true], ['frecuencia', 9, true], ['banda-24', 15, true], ['banda-58', 17, true],
    ]);
  });

  test('nunca la lista completa de golpe: a los 10 s están los tres nombrados y nada más', () => {
    const { nombrados } = recorrer({ hasta: 10 });
    assert.deepEqual([...nombrados], ['data-link', 'ondas', 'frecuencia']);
  });

  test('un salto hacia adelante suma lo que quedó atrás SIN sonido', () => {
    const nombrados = new Set(['data-link']);
    const xs = terminosNuevos({ interactions: LECCION, nombrados, prev: 3, t: 16, reproduciendo: true });
    assert.deepEqual(xs.map((x) => [x.id, x.sonido]), [['ondas', false], ['frecuencia', false], ['banda-24', false]]);
  });

  test('restaurar el avance (en pausa) o un paso en pausa también es callado', () => {
    const xs = terminosNuevos({ interactions: LECCION, nombrados: new Set(), prev: 0, t: 1.9 + 0.2, reproduciendo: false });
    assert.deepEqual(xs.map((x) => [x.id, x.sonido]), [['data-link', false]]);
  });

  test('un término en el segundo 0 se suma al cargar, callado (nadie lo escuchó nombrar)', () => {
    const cero = [L('cero', 0, 'Desde el principio')];
    assert.deepEqual(terminosNuevos({ interactions: cero, nombrados: new Set(), prev: 0, t: 0, reproduciendo: false }).map((x) => [x.id, x.sonido]), [['cero', false]]);
  });

  test('volver para atrás no saca nada ni vuelve a sonar al pasar de nuevo', () => {
    const { nombrados } = recorrer({ hasta: 20 });
    assert.deepEqual(terminosNuevos({ interactions: LECCION, nombrados, prev: 20, t: 3, reproduciendo: true }), []);
    const { sumados } = recorrer({ desde: 3, hasta: 20, nombrados });
    assert.deepEqual(sumados, []);
  });

  test('dos términos en el mismo paso (un tick largo) salen en orden de tiempo, los dos con sonido', () => {
    const xs = terminosNuevos({ interactions: LECCION, nombrados: new Set(['data-link']), prev: 3.5, t: 4.2, reproduciendo: true });
    assert.deepEqual(xs.map((x) => [x.id, x.nombre, x.sonido]), [['ondas', 'Ondas de radio', true]]);
  });
});

describe('entradas: lo que muestra, lo último arriba', () => {
  test('sólo lo nombrado y las notas ya vistas, del más nuevo al más viejo', () => {
    const nombrados = new Set(['data-link', 'ondas', 'frecuencia', 'banda-24', 'banda-58', 'telemetria', 'ocusync', 'gestion']);
    const lista = entradas({ interactions: LECCION, nombrados, completed: new Set(['mc-downlink', 'nota-wifi']) });
    assert.deepEqual(ids(lista), ['gestion', 'nota-wifi', 'ocusync', 'telemetria', 'banda-58', 'banda-24', 'frecuencia', 'ondas', 'data-link']);
    const nota = lista.find((e) => e.id === 'nota-wifi');
    assert.deepEqual([nota.tipo, nota.nombre, nota.texto], ['nota', 'Dato curioso: Wi-Fi en drones DJI', 'En algunos DJI, el enlace depende de **cómo se vuela**.']);
    const dl = lista.find((e) => e.id === 'data-link');
    assert.deepEqual([dl.tipo, dl.nombre, dl.texto, dl.time], ['termino', 'Data Link', 'Sistema de comunicación inalámbrica que conecta el control remoto con la aeronave.', 2]);
  });

  test('una nota que todavía no se vio (o que se está viendo) no está', () => {
    const lista = entradas({ interactions: LECCION, nombrados: new Set(['ocusync']), completed: new Set() });
    assert.deepEqual(ids(lista), ['ocusync']);
  });

  test('vacío al empezar', () => {
    assert.deepEqual(entradas({ interactions: LECCION, nombrados: new Set(), completed: new Set() }), []);
  });

  test('a igual tiempo, el que está después en la configuración va arriba', () => {
    const dos = [L('a', 5, 'Primero'), L('b', 5, 'Segundo')];
    assert.deepEqual(ids(entradas({ interactions: dos, nombrados: new Set(['a', 'b']), completed: new Set() })), ['b', 'a']);
  });

  test('una definición que no es texto no rompe (llega vacía)', () => {
    const raro = [{ id: 'r', type: 'label', time: 1, data: { text: 'Raro', definition: { html: '<b>x</b>' } } }];
    assert.equal(entradas({ interactions: raro, nombrados: new Set(['r']), completed: new Set() })[0].texto, '');
  });
});
