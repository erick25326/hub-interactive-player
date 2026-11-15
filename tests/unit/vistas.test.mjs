// Los TRAMOS VISTOS (src/vistas.js): qué suma y qué no mientras se mira un video, y lo que
// viaja a progress.php. Cómo los suma el servidor por día, tests/php/correr.php
// (ivplayer_vistas_combinar).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAMO_S, TOPE, cantidadDeTramos, tramoDe, diaDe, crearVistas, registrarTick, entradasParaEnviar, juntarEntradas, MAX_ENTRADAS,
} from '../../src/vistas.js';

const DIA = 20261115;

/**
 * Reproduce de `desde` a `hasta` con ticks de 250 ms de reloj a la velocidad dada, como el
 * timeupdate. Devuelve el reloj al terminar (para seguir desde ahí).
 */
function reproducir(v, desde, hasta, { reloj = 0, velocidad = 1, duracion = 60, cuenta = true, dia = DIA, cadaMs = 250 } = {}) {
  let t = desde;
  registrarTick(v, { t, reloj, cuenta, duracion, velocidad, dia });
  while (t < hasta - 1e-9) {
    reloj += cadaMs;
    t = Math.min(hasta, t + (cadaMs / 1000) * velocidad);
    registrarTick(v, { t, reloj, cuenta, duracion, velocidad, dia });
  }
  return reloj;
}
const cifras = (v, dia = DIA) => (entradasParaEnviar(v).find((e) => e.dia === dia) || { tramos: '' }).tramos;

describe('tramos: tamaño y borde', () => {
  test('de 5 s; el fin exacto cae en el último tramo', () => {
    assert.equal(TRAMO_S, 5);
    assert.equal(cantidadDeTramos(60), 12);
    assert.equal(cantidadDeTramos(61), 13);
    assert.equal(cantidadDeTramos(0), 0);
    assert.equal(tramoDe(60, 12), 11);
    assert.equal(tramoDe(4.99, 12), 0);
    assert.equal(tramoDe(5, 12), 1);
    assert.equal(tramoDe(-1, 12), 0);
  });

  test('el día es el local del alumno, AAAAMMDD', () => {
    assert.equal(diaDe(new Date(2026, 10, 15, 23, 59)), 20261115);
    assert.equal(diaDe(new Date(2026, 0, 3, 0, 0)), 20260103);
  });
});

describe('qué suma', () => {
  test('mirar de corrido todo el video: cada tramo una vez', () => {
    const v = crearVistas('s1');
    reproducir(v, 0, 60);
    assert.equal(cifras(v), '111111111111');
    assert.equal(entradasParaEnviar(v)[0].segundos, 60);
  });

  test('retroceder y volver a mirar suma otra vez esos tramos (y no el del salto)', () => {
    const v = crearVistas('s1');
    let r = reproducir(v, 0, 32);            // tramos 0 a 6
    r = reproducir(v, 12, 32, { reloj: r + 250 }); // −20 s: vuelve al tramo 2
    assert.equal(cifras(v), '112222200000');
  });

  test('pausa y retomar en el mismo tramo no lo cuenta dos veces', () => {
    const v = crearVistas('s1');
    let r = reproducir(v, 0, 12);
    registrarTick(v, { t: 12, reloj: r + 250, cuenta: false, duracion: 60, dia: DIA }); // pausa
    reproducir(v, 12, 18, { reloj: r + 90_000 });  // un minuto y medio después, sigue
    assert.equal(cifras(v), '111100000000');
  });

  test('en pausa no suma, ni aunque lleguen ticks (un salto con el video quieto)', () => {
    const v = crearVistas('s1');
    reproducir(v, 0, 40, { cuenta: false });
    assert.deepEqual(entradasParaEnviar(v), []);
  });

  test('un salto adelante no suma los tramos salteados; el de aterrizaje, si se sigue', () => {
    const v = crearVistas('s1');
    let r = reproducir(v, 0, 6);              // tramos 0 y 1
    registrarTick(v, { t: 41, reloj: r + 250, cuenta: true, duracion: 60, dia: DIA }); // +35 s
    reproducir(v, 41, 47, { reloj: r + 500 });
    assert.equal(cifras(v), '110000001100');
  });

  test('un salto que aterriza y no sigue (pausa ahí) no cuenta ese tramo', () => {
    const v = crearVistas('s1');
    let r = reproducir(v, 0, 3);
    registrarTick(v, { t: 41, reloj: r + 250, cuenta: true, duracion: 60, dia: DIA });
    registrarTick(v, { t: 41, reloj: r + 500, cuenta: false, duracion: 60, dia: DIA });
    assert.equal(cifras(v), '100000000000');
  });

  test('un salto PEDIDO en vuelo (cuenta=false) corta aunque sea corto', () => {
    const v = crearVistas('s1');
    let r = reproducir(v, 0, 9);              // 0 y 1
    registrarTick(v, { t: 11, reloj: r + 250, cuenta: false, duracion: 60, dia: DIA }); // ±10 que frena antes
    reproducir(v, 11, 14, { reloj: r + 500 });
    // tramo 2 (10-15 s) cuenta una vez: se aterrizó ahí y se siguió
    assert.equal(cifras(v), '111000000000');
  });

  test('tope de 9 por tramo', () => {
    const v = crearVistas('s1');
    let r = 0;
    for (let i = 0; i < 12; i++) r = reproducir(v, 0, 9.9, { reloj: r + 250 }); // 12 vueltas a los dos primeros tramos
    assert.equal(cifras(v).slice(0, 2), String(TOPE).repeat(2));
  });

  test('a 2× cuenta igual (los ticks avanzan medio segundo)', () => {
    const v = crearVistas('s1');
    reproducir(v, 0, 60, { velocidad: 2 });
    assert.equal(cifras(v), '111111111111');
  });

  test('con el hilo trabado (un tick cada 2 s de reloj) sigue siendo de corrido', () => {
    const v = crearVistas('s1');
    reproducir(v, 0, 29.9, { cadaMs: 2000 });
    assert.equal(cifras(v), '111111000000');
  });

  test('transmitiendo con el celular bloqueado: un tick por minuto, la TV reproduciendo, cuenta todo', () => {
    const v = crearVistas('s1');
    reproducir(v, 0, 60, { cadaMs: 30_000 });
    assert.equal(cifras(v), '111111111111');
  });

  test('ruido de la TV: el estimador retrocede unas décimas en el borde de un tramo y no lo cuenta otra vez', () => {
    const v = crearVistas('s1');
    let r = reproducir(v, 0, 10.1);           // entra al tramo 2 a los 10
    registrarTick(v, { t: 9.8, reloj: r + 200, cuenta: true, duracion: 60, dia: DIA }); // corrección
    reproducir(v, 9.9, 14, { reloj: r + 400 });
    assert.equal(cifras(v), '111000000000');
  });

  test('el fin: el último tramo cuenta con el último segundo', () => {
    const v = crearVistas('s1');
    reproducir(v, 52, 58.72, { duracion: 58.72 });
    assert.equal(cifras(v), '000000000011');
  });
});

describe('lo que viaja', () => {
  test('sin duración conocida no se manda nada; después, una cifra por tramo', () => {
    const v = crearVistas('s1');
    reproducir(v, 0, 8, { duracion: 0 });
    assert.deepEqual(entradasParaEnviar(v), []);
    registrarTick(v, { t: 8.25, reloj: 100_000, cuenta: false, duracion: 22, dia: DIA });
    assert.deepEqual(entradasParaEnviar(v), [{ sesion: 's1', dia: DIA, tramos: '11000', segundos: 8, duracion: 22 }]);
  });

  test('la medianoche: lo de cada día va en su entrada, y el tramo que se estaba mirando no se cuenta dos veces', () => {
    const v = crearVistas('s1');
    let r = reproducir(v, 0, 12, { dia: 20261115 });
    reproducir(v, 12, 22, { reloj: r, dia: 20261116 });
    const e = entradasParaEnviar(v);
    assert.deepEqual(e.map((x) => [x.dia, x.tramos]), [[20261115, '111000000000'], [20261116, '000110000000']]);
  });

  test('absoluto por sesión: el envío siguiente trae todo lo de antes más lo nuevo', () => {
    const v = crearVistas('s1');
    let r = reproducir(v, 0, 12);
    const primero = entradasParaEnviar(v)[0].tramos;
    reproducir(v, 12, 22, { reloj: r });
    assert.equal(primero, '111000000000');
    assert.equal(cifras(v), '111110000000');
  });

  test('juntarEntradas: lo de otra carga que no llegó viaja con el envío nuevo; de la misma, gana la nueva', () => {
    const a = { sesion: 'A', dia: DIA, tramos: '11', segundos: 9, duracion: 10 };
    const b1 = { sesion: 'B', dia: DIA, tramos: '10', segundos: 3, duracion: 10 };
    const b2 = { sesion: 'B', dia: DIA, tramos: '11', segundos: 8, duracion: 10 };
    assert.deepEqual(juntarEntradas([a, b1], [b2]), [a, b2]);
    assert.deepEqual(juntarEntradas(undefined, [b2]), [b2]);
    assert.deepEqual(juntarEntradas([a], []), [a]);
    const muchas = Array.from({ length: 6 }, (_, i) => ({ sesion: 'S' + i, dia: DIA, tramos: '1', segundos: 1, duracion: 5 }));
    assert.equal(juntarEntradas(muchas, [b2]).length, MAX_ENTRADAS);
    assert.deepEqual(juntarEntradas(muchas, [b2]).at(-1), b2);
  });
});
