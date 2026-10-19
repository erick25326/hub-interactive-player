// El GLOSARIO INTERACTIVO (src/glosario.js): qué términos se suman en cada paso del
// tiempo, cuáles con sonido, y qué se lista y en qué orden. Contenido de ejemplo: los
// textos de la lección 3.1 de Introducción a los Drones (no son secretos; el video no
// va). Lo que hace el componente con esto, tests/navegador/escenarios/glosario.mjs.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nombreDe, esTermino, esNota, hayGlosario, totalPosible, terminosNuevos, entradas, cobertura, pausarAlAbrir, reanudarAlCerrar, RECIEN_MS, AVISO_MS, TAPA_MIN } from '../../src/glosario.js';

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

test('constantes: "recién" 6 s, el aviso con el panel cerrado 4,5 s y el panel pausa si tapa más del 70 %', () => {
  assert.deepEqual({ RECIEN_MS, AVISO_MS, TAPA_MIN }, { RECIEN_MS: 6000, AVISO_MS: 4500, TAPA_MIN: 0.7 });
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

  test('a más de 1×, un paso más largo sigue siendo reproducción (umbral por velocidad)', () => {
    // 2,6 s de video entre dos renders: a 2× es un tick de 1,3 s de reloj (el latido de
    // la TV en segundo plano); a 1× es un salto.
    const a2 = terminosNuevos({ interactions: LECCION, nombrados: new Set(['data-link', 'ondas']), prev: 7, t: 9.6, reproduciendo: true, velocidad: 2 });
    assert.deepEqual(a2.map((x) => [x.id, x.sonido]), [['frecuencia', true]]);
    const a1 = terminosNuevos({ interactions: LECCION, nombrados: new Set(['data-link', 'ondas']), prev: 7, t: 9.6, reproduciendo: true, velocidad: 1 });
    assert.deepEqual(a1.map((x) => [x.id, x.sonido]), [['frecuencia', false]]);
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

// El panel que TAPA el video (decisión de Erick, 19-oct-2026). Los rectángulos son los
// que da styles.css en cada caso (las coordenadas del contenedor, como las mide el
// componente); que el panel de verdad mida eso lo prueba el nivel navegador
// (escenarios/glosario.mjs, "el panel que tapa el video").
const R = (x, y, ancho, alto) => ({ x, y, ancho, alto });
describe('cobertura: cuánto del video tapa el panel', () => {
  test('reproductor bajo (el iframe del campus o la pantalla completa con el celular parado, 375×211): todo', () => {
    assert.equal(cobertura(R(0, 0, 375, 211), R(0, 0, 375, 211)), 1);
  });
  test('ancho: el lateral derecho deja ver el video (1280×720: 26 %; 900×506, el de las pruebas: 36 %)', () => {
    assert.ok(Math.abs(cobertura(R(920, 0, 360, 664), R(0, 0, 1280, 720)) - 0.2594) < 0.001);
    assert.ok(Math.abs(cobertura(R(540, 0, 360, 450), R(0, 0, 900, 506)) - 0.3557) < 0.001);
  });
  test('angosto pero no bajo (540×304): la hoja de abajo, 78 % de alto, tapa 78 %', () => {
    assert.ok(Math.abs(cobertura(R(0, 304 - 56 - 237.12, 540, 237.12), R(0, 0, 540, 304)) - 0.78) < 1e-9);
  });
  test('sólo cuenta lo que cae adentro del video; sin cruce, 0; nunca más de 1', () => {
    assert.equal(cobertura(R(-100, 0, 200, 100), R(0, 0, 200, 100)), 0.5);
    assert.equal(cobertura(R(300, 0, 50, 50), R(0, 0, 200, 100)), 0);
    assert.equal(cobertura(R(-10, -10, 999, 999), R(0, 0, 200, 100)), 1);
    assert.equal(cobertura(R(200, 0, 50, 100), R(0, 0, 200, 100)), 0, 'pegado al borde no tapa nada');
  });
  test('datos rotos (sin panel, video sin tamaño, valores que no son números) dan 0 y no tiran', () => {
    assert.equal(cobertura(null, R(0, 0, 10, 10)), 0);
    assert.equal(cobertura(R(0, 0, 10, 10), undefined), 0);
    assert.equal(cobertura(R(0, 0, 10, 10), R(0, 0, 0, 10)), 0);
    assert.equal(cobertura({ x: 'a', y: NaN, ancho: 10, alto: 10 }, R(0, 0, 10, 10)), 1);
  });
});

describe('pausarAlAbrir y reanudarAlCerrar: el glosario que tapa el video lo pausa y lo retoma', () => {
  const abrir = (o) => pausarAlAbrir({ reproduciendo: true, transmitiendo: false, cobertura: 1, ...o });
  const cerrar = (o) => reanudarAlCerrar({ pausoElGlosario: true, pregunta: false, error: false, transmitiendo: false, ...o });
  test('reproduciendo y tapado (más del 70 %): pausa', () => {
    assert.equal(abrir(), true);
    assert.equal(abrir({ cobertura: 0.78 }), true);
    assert.equal(abrir({ cobertura: 0.7001 }), true);
  });
  test('en una pantalla ancha (el video a la vista) no pausa, como hasta ahora; el 70 % justo, tampoco', () => {
    assert.equal(abrir({ cobertura: 0.26 }), false);
    assert.equal(abrir({ cobertura: TAPA_MIN }), false);
    assert.equal(abrir({ cobertura: undefined }), false);
  });
  test('en pausa no hay nada que pausar (y cerrar no lo va a arrancar)', () => {
    assert.equal(abrir({ reproduciendo: false }), false);
  });
  test('transmitiendo a la TV, nunca: el video está en la TV y el celular es el control', () => {
    assert.equal(abrir({ transmitiendo: true }), false);
  });
  test('cerrar retoma lo que pausó el glosario', () => {
    assert.equal(cerrar(), true);
  });
  test('si no lo pausó el glosario (no tapaba, estaba en pausa, o alguien le dio play en el medio), cerrar no lo toca', () => {
    assert.equal(cerrar({ pausoElGlosario: false }), false);
  });
  test('si en el medio lo frenó una pregunta (la que cerró el panel), un error o la TV, no se retoma', () => {
    assert.equal(cerrar({ pregunta: true }), false);
    assert.equal(cerrar({ error: true }), false);
    assert.equal(cerrar({ transmitiendo: true }), false);
  });
});
