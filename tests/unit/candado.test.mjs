// El CANDADO de preguntas, función por función (src/candado.js). Es lo que no se puede
// romper: si una de estas falla, un alumno puede pasar una pregunta sin verla, verla
// antes de que termine la frase, o volver a la lección pasado una pendiente.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  debeFrenar, tiempoAGuardar, esTickPropio, pendienteARetomar,
  SEEK_MIN, ANTES_SEEK, DESPUES, SALTO_CRUCE, PROPIO_TOLERANCIA,
} from '../../src/candado.js';
import { MC, NOTA, VF, HS, ETIQUETA, mulberry32 } from './apoyo/simulador.mjs';

// Los números del candado son decisiones medidas (ver los comentarios de candado.js):
// si alguien los cambia, que sea a propósito.
test('las constantes del candado son las acordadas', () => {
  assert.deepEqual({ SEEK_MIN, ANTES_SEEK, DESPUES, SALTO_CRUCE, PROPIO_TOLERANCIA },
    { SEEK_MIN: 2, ANTES_SEEK: 0.25, DESPUES: 0.8, SALTO_CRUCE: 6, PROPIO_TOLERANCIA: 3 });
});

// El componente tiene que usar ESTAS funciones, no copias propias: si no, las pruebas
// protegerían un módulo muerto.
test('el reproductor usa el candado y el parser de los módulos puros, sin copias propias', () => {
  const jsx = fs.readFileSync(new URL('../../src/InteractiveVideoPlayer.jsx', import.meta.url), 'utf8');
  assert.match(jsx, /import \{[^}]*\bdebeFrenar\b[^}]*\} from "\.\/candado\.js"/);
  assert.match(jsx, /import \{[^}]*\bparseVTT\b[^}]*\} from "\.\/subtitulos\.js"/);
  for (const f of ['debeFrenar', 'tiempoAGuardar', 'esTickPropio', 'pendienteARetomar', 'parseVTT', 'textoDeCue']) {
    assert.doesNotMatch(jsx, new RegExp(`function ${f}\\b|const ${f}\\s*=`), `${f} está definida otra vez en el JSX`);
  }
  assert.match(jsx, /pendienteARetomar\(\{/, 'el efecto de disparo no llama a pendienteARetomar');
  assert.match(jsx, /esTickPropio\(/, 'el efecto de disparo no llama a esTickPropio');
});

describe('debeFrenar', () => {
  test('reproduciendo, nunca frena antes de llegar al tiempo de la pregunta', () => {
    for (let i = 0; i <= 300; i++) {
      const prev = 5 + i * 0.01;
      for (const d of [0.05, 0.25, 0.5, 1, 2]) {
        const t = prev + d;
        if (t < 8) assert.equal(debeFrenar(8, prev, t), false, `prev=${prev} t=${t}`);
      }
    }
    // El caso viejo: un tick a 7,3 s frenaba la pregunta de los 8 y cortaba la frase.
    assert.equal(debeFrenar(8, 7.05, 7.3), false);
  });

  test('reproduciendo, frena con el primer tick que llega o pasa el tiempo', () => {
    assert.equal(debeFrenar(8, 7.9, 8), true);
    assert.equal(debeFrenar(8, 7.75, 8.25), true);
    assert.equal(debeFrenar(8, 7.6, 8.1), true);   // 2×: ticks de medio segundo
  });

  test('el tick que ya había dejado la pregunta más de 0,8 s atrás no la vuelve a frenar', () => {
    assert.equal(debeFrenar(8, 8.79, 9.04), true);
    assert.equal(debeFrenar(8, 8.8, 9.05), false);
  });

  test('una interacción en el segundo 0 frena con el primer tick', () => {
    assert.equal(debeFrenar(0, 0, 0), true);
    assert.equal(debeFrenar(0, 0, 0.25), true);
  });

  test('en un seek acepta caer hasta 0,25 s antes: el skip aterriza justo delante', () => {
    assert.equal(debeFrenar(8, 2, 7.9), true);
    assert.equal(debeFrenar(8, 2, 7.75), true);
    assert.equal(debeFrenar(8, 2, 7.74), false);
    assert.equal(debeFrenar(8, 2, 8.79), true);
    assert.equal(debeFrenar(8, 30, 7.9), true);   // seek hacia atrás que aterriza en ella
    assert.equal(debeFrenar(8, 30, 9), false);
  });

  test('un salto que cruza el tiempo por ticks trabados (hasta 6 s) frena igual', () => {
    assert.equal(debeFrenar(8, 5, 10.5), true);
    assert.equal(debeFrenar(8, 3, 9), true);      // justo 6 s
    assert.equal(debeFrenar(8, 2.9, 9), false);   // 6,1 s y lejos: lo resuelve la guardia
  });

  test('un salto largo que cruza frena si el render anterior estaba a menos de 0,8 s del tiempo', () => {
    assert.equal(debeFrenar(8, 7.3, 20), true);
    assert.equal(debeFrenar(8, 7.1, 20), false);
  });

  test('una pregunta puesta en el fin o después se frena con el último tick (fin real del medio)', () => {
    // El configurador guarda 79 s para un video de 78,72.
    assert.equal(debeFrenar(79, 78.5, 78.72, 78.72), true);
    assert.equal(debeFrenar(79, 78.5, 78.72), false);   // sin el fin real no llegaría nunca
    assert.equal(debeFrenar(30, 29.8, 29.96, 30), true);
  });

  test('a 0,5×–2× y con cualquier fase de los ticks, frena en el primer tick que pasa el tiempo y en ninguno anterior', () => {
    for (const rate of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      const paso = 0.25 * rate;   // un timeupdate cada 250 ms de reloj
      for (let i = 0; i < 100; i++) {
        const fase = (i / 100) * paso;
        let prev = 5 + fase, frenadas = 0;
        for (let t = prev + paso; t < 10; prev = t, t += paso) {
          const frena = debeFrenar(8, prev, t);
          if (t < 8) assert.equal(frena, false, `rate=${rate} prev=${prev} t=${t}`);
          if (frena) {
            frenadas++;
            assert.ok(t - 8 < paso + 1e-9, `frenó tarde: rate=${rate} t=${t}`);
            break;   // el componente la marca como mostrada: no vuelve a preguntar
          }
        }
        assert.equal(frenadas, 1, `rate=${rate} fase=${fase}`);
      }
    }
  });
});

describe('esTickPropio (marcarSaltoPropio: reloj + destino)', () => {
  test('un tick cerca del destino, dentro de la ventana, es del salto propio', () => {
    assert.equal(esTickPropio(21, 21, 1000, 500), true);
    assert.equal(esTickPropio(24, 21, 1000, 500), true);   // destino + 3 (2× con tick atrasado)
    assert.equal(esTickPropio(20, 21, 1000, 500), true);   // destino − 1
    assert.equal(esTickPropio(21, 21, 1000, 1000), true);  // último milisegundo de la ventana
  });

  test('lejos del destino es un salto externo aunque llegue dentro de la ventana', () => {
    assert.equal(esTickPropio(60.2, 21, 1000, 500), false);   // pantalla de bloqueo después de un skip
    assert.equal(esTickPropio(24.01, 21, 1000, 500), false);
    assert.equal(esTickPropio(19.99, 21, 1000, 500), false);
  });

  test('vencida la ventana, ni el destino exacto cuenta como propio', () => {
    assert.equal(esTickPropio(21, 21, 1000, 1001), false);
  });

  test('sin destino marcado no hay salto propio', () => {
    assert.equal(esTickPropio(0, null, 1000, 500), false);
    assert.equal(esTickPropio(0, undefined, 1000, 500), false);
  });
});

describe('pendienteARetomar (la decisión de la guardia de saltos externos)', () => {
  const guardia = (interactions, prev, t, extra = {}) => pendienteARetomar({
    interactions, completed: new Set(), triggered: new Set(), prev, t, currentTime: t, ...extra,
  });
  const id = (r) => r && { id: r.ia.id, vuelta: r.vuelta };

  test('la reproducción normal (ticks de menos de 0,8 s) nunca activa la guardia', () => {
    assert.equal(guardia([MC('q8', 8)], 7.5, 8.2), null);
    assert.equal(guardia([MC('q8', 8)], 7.9, 8.1), null);
  });

  test('un salto externo en pausa de 0 a 40 vuelve a la nota de los 8 y la retoma ahí', () => {
    assert.deepEqual(id(guardia([NOTA('n8', 8), VF('tf25', 25)], 0, 40)), { id: 'n8', vuelta: 8 });
  });

  test('la guardia vuelve a la primera pendiente cuando un salto cruza dos', () => {
    assert.deepEqual(id(guardia([VF('tf25', 25), MC('q40', 40)], 10, 60.2)), { id: 'tf25', vuelta: 25 });
  });

  test('un salto que cae en la ventana de otra pendiente vuelve a la anterior (el bucle habría frenado la de adelante)', () => {
    const ias = [MC('q20', 20), MC('q30', 30)];
    // Por qué importa que la guardia vaya ANTES del bucle: el bucle solo frenaba la
    // de los 30 y la de los 20 quedaba salteada para siempre.
    assert.equal(debeFrenar(30, 15, 30.3), true);
    assert.equal(debeFrenar(20, 15, 30.3), false);
    assert.deepEqual(id(guardia(ias, 15, 30.3)), { id: 'q20', vuelta: 20 });
    // Aterrizando apenas antes de la de los 30 (cruzó sólo la de los 20) también.
    assert.deepEqual(id(guardia(ias, 15, 29.9)), { id: 'q20', vuelta: 20 });
  });

  test('un salto que cae dentro de los 8 s de un hotspot vuelve a la pregunta anterior', () => {
    assert.deepEqual(id(guardia([MC('q20', 20), HS('h25', 25)], 15, 28)), { id: 'q20', vuelta: 20 });
  });

  test('si sólo cruzó un hotspot y cae dentro de su ventana, no hay seek de más: lo muestra el bucle', () => {
    assert.equal(guardia([HS('h25', 25)], 15, 28), null);
    assert.equal(guardia([HS('h25', 25)], 15, 33), null);                              // borde de los 8 s
    assert.deepEqual(id(guardia([HS('h25', 25)], 15, 33.5)), { id: 'h25', vuelta: 25 }); // pasó la ventana
    assert.deepEqual(id(guardia([HS('h25', 25, 3)], 15, 29)), { id: 'h25', vuelta: 25 }); // duración propia
  });

  test('un salto corto que cruza dos pendientes también vuelve a la primera', () => {
    assert.equal(debeFrenar(10.5, 10, 11.5), true);   // el bucle la frenaría, pero salteada la segunda
    assert.deepEqual(id(guardia([MC('a', 10.5), MC('b', 11)], 10, 11.5)), { id: 'a', vuelta: 10.5 });
  });

  test('si cruzó una sola y el bucle igual la frena, se deja como está (sin seek de más)', () => {
    assert.equal(guardia([MC('a', 10.5)], 10, 11.2), null);   // tick lento
    assert.equal(guardia([MC('q8', 8)], 5, 10.5), null);       // hilo trabado corto (cruce ≤ 6 s)
  });

  test('un salto largo que cruza una sola pendiente la retoma', () => {
    assert.deepEqual(id(guardia([MC('q8', 8)], 1, 20)), { id: 'q8', vuelta: 8 });
  });

  test('las completadas, las ya mostradas y las etiquetas no cuentan como saltadas', () => {
    const ias = [ETIQUETA('l20', 20), MC('q25', 25), MC('q30', 30), MC('q40', 40)];
    const r = pendienteARetomar({ interactions: ias, completed: new Set(['q25']), triggered: new Set(['q30']), prev: 10, t: 60, currentTime: 60 });
    assert.deepEqual(id(r), { id: 'q40', vuelta: 40 });
    const nada = pendienteARetomar({ interactions: ias, completed: new Set(['q25', 'q40']), triggered: new Set(['q30']), prev: 10, t: 60, currentTime: 60 });
    assert.equal(nada, null);
  });

  test('el orden del arreglo no importa: vuelve a la más temprana por tiempo', () => {
    assert.deepEqual(id(guardia([MC('q40', 40), VF('tf25', 25)], 10, 60)), { id: 'tf25', vuelta: 25 });
  });

  test('una pendiente justo en el destino del salto no cuenta como cruzada: la frena el bucle', () => {
    assert.equal(guardia([MC('q30', 30)], 10, 30), null);
    assert.equal(debeFrenar(30, 10, 30), true);
  });

  test('un salto hacia atrás no activa la guardia', () => {
    assert.equal(guardia([MC('q30', 30)], 60, 10), null);
  });

  test('con el video rebobinado tras el fin, la ventana del hotspot se mira en currentTime y la vuelta se acota al fin', () => {
    // alTerminar evalúa contra el fin (t = 78,72) con el estado ya en 0: el hotspot del
    // final no está "a la vista" y hay que volver a él, al último cuadro mostrable.
    const r = pendienteARetomar({ interactions: [HS('h', 78.7)], completed: new Set(), triggered: new Set(), prev: 70, t: 78.72, currentTime: 0, fin: 78.72 });
    assert.deepEqual(id(r), { id: 'h', vuelta: 78.72 - 0.05 });
  });
});

describe('tiempoAGuardar', () => {
  test('con una pregunta abierta guarda SU tiempo, no dónde quedó el video (pausa lenta a 2×)', () => {
    assert.equal(tiempoAGuardar(8.9, MC('q8', 8)), 8);
  });

  test('una pregunta del final abierta con el video rebobinado a 0 guarda su tiempo, acotado al fin real', () => {
    assert.equal(tiempoAGuardar(0, MC('q79', 79), 78.72), 78.72 - 0.05);
  });

  test('nunca guarda más allá de una pendiente que quedó atrás', () => {
    assert.equal(tiempoAGuardar(40, null, Infinity, [VF('tf25', 25)], new Set()), 25);
    assert.equal(tiempoAGuardar(40, null, Infinity, [MC('q30', 30), VF('tf25', 25)], new Set()), 25);   // la más temprana
  });

  test('si la de atrás está completada o es una etiqueta, guarda el tiempo real', () => {
    assert.equal(tiempoAGuardar(40, null, Infinity, [VF('tf25', 25)], new Set(['tf25'])), 40);
    assert.equal(tiempoAGuardar(40, null, Infinity, [ETIQUETA('l20', 20)], new Set()), 40);
  });

  test('una pendiente justo en el tiempo o más adelante no cambia nada', () => {
    assert.equal(tiempoAGuardar(40, null, Infinity, [MC('q40', 40), MC('q50', 50)], new Set()), 40);
  });

  test('un avance viejo guardado más allá de una pendiente se retoma en ella (la misma función que usa la restauración)', () => {
    const ias = [NOTA('n8', 8), VF('tf25', 25), MC('q50', 50)];
    assert.equal(tiempoAGuardar(40, null, Infinity, ias, new Set(['n8'])), 25);
    assert.equal(tiempoAGuardar(15, null, Infinity, ias, new Set(['n8'])), 15);
  });

  test('sin interacciones (valores por defecto) devuelve el tiempo tal cual', () => {
    assert.equal(tiempoAGuardar(12.3), 12.3);
    assert.equal(tiempoAGuardar(0), 0);
  });

  test('propiedad: el tiempo guardado nunca pasa una pendiente ni el tiempo real, y nunca es negativo', () => {
    const azar = mulberry32(25);
    for (let i = 0; i < 3000; i++) {
      const n = Math.floor(azar() * 6);
      const ias = Array.from({ length: n }, (_, k) => (azar() < 0.2 ? ETIQUETA : MC)('i' + k, Math.round(azar() * 1000) / 10));
      const completed = new Set(ias.filter(() => azar() < 0.4).map((ia) => ia.id));
      const t = Math.round(azar() * 1000) / 10;
      const fin = azar() < 0.5 ? Infinity : 50 + azar() * 60;
      const g = tiempoAGuardar(t, null, fin, ias, completed);
      const pendientesAtras = ias.filter((ia) => ia.type !== 'label' && !completed.has(ia.id) && ia.time < t);
      assert.ok(g >= 0 && g <= t, `g=${g} t=${t}`);
      for (const ia of pendientesAtras) assert.ok(g <= ia.time, `guardó ${g} pasada la pendiente de ${ia.time}`);
      if (!pendientesAtras.length) assert.equal(g, t);
    }
  });
});
