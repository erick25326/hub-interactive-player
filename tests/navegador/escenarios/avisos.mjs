// Los AVISOS de las interacciones que frenan (src/avisos.js + src/sonidos.js) con el
// reproductor de verdad: el tic-tac de los 3 segundos antes, la cuenta regresiva, el
// "plop" al frenar y la vibración. Web Audio y navigator.vibrate son de mentira
// (simulados/sonido-simulado.js, ?sonido=simulado): anotan cada sonido con el segundo
// del VIDEO en que salió, cada vibración y la cuenta que se vio. Lo puro (qué tic
// toca en cada paso) lo prueban las unitarias; acá, que el componente lo use bien con
// ticks reales: sólo reproduciendo, en tiempo de video, nunca al llegar saltando, que
// se repita al volver para atrás, que los ajustes del alumno lo apaguen y que siga en
// el celular transmitiendo a la TV.
// Interacciones (?ias=glosario): nota7 (tics en 4, 5, 6), mc15 (12, 13, 14), hs22
// (19, 20, 21), tf40; etiquetas en 2, 10, 18 y 32 (sin tic).
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { cerca } from '../apoyo/pagina.mjs';
import { dormir } from '../apoyo/chrome.mjs';
import { abrirConTV } from './tv.mjs';

export const Q = { motor: 'hls', ias: 'glosario', sonido: 'simulado' };
export const sonidos = (p) => p.a('W.__sonidos');
export const tics = (S) => S.osc.filter((o) => o.que === 'tic-alto' || o.que === 'tic-bajo');
export const de = (S, que) => S.osc.filter((o) => o.que === que);
const FRENO = JSON.stringify([60, 40, 60]);
const patrones = (S) => S.vib.map((v) => JSON.stringify(v.patron));

// Responder con clics reales lo que no responde Pagina.responder().
export async function responderMC(p) {
  await p.clic('.iv-option', { texto: 'B' });
  await p.clic('.iv-quiz-card .iv-btn-primary', { texto: 'Confirmar' });
  // Con la explicación la tarjeta no entra en 900×506 y se desplaza: el botón, a la vista.
  await p.debe(`(D.querySelector('.iv-quiz-card .iv-btn-primary')?.scrollIntoView({ block: 'nearest' }), /Continuar/.test(D.querySelector('.iv-quiz-card .iv-btn-primary')?.textContent || ''))`, 3000, 'no apareció Continuar');
  await p.clic('.iv-quiz-card .iv-btn-primary', { texto: 'Continuar' });
}
export async function responderPuntos(p) {
  await p.clic('.iv-hotspot-dot');
  await p.clic('.iv-hotspot-bar .iv-btn-primary', { texto: 'Continuar' });
}
export async function velocidad(p, texto) {
  await p.clic('.iv-ajustes-btn');
  await p.clic('.iv-ajustes-fila', { texto: 'Velocidad' });
  await p.clic('.iv-ajustes-opcion', { texto });
}
export const pausar = (p) => p.clic('.iv-controls-row button[aria-label="Pausar"]');

// Los tres tics de una pendiente: alto-bajo-alto, cada uno al cruzar su marca (entre la
// marca y un tick después: a 2× el tick es de ~0,5 s de video).
function tresTics(lista, marcas, tolerancia) {
  assert.deepEqual(lista.map((o) => o.que), ['tic-alto', 'tic-bajo', 'tic-alto'], `tic-tac: ${JSON.stringify(lista)}`);
  lista.forEach((o, i) => assert.ok(o.t != null && o.t >= marcas[i] - 0.05 && o.t <= marcas[i] + tolerancia,
    `el tic ${i + 1} tenía que sonar al cruzar ${marcas[i]} s de video: ${JSON.stringify(lista)}`));
}

export function registrar(entorno) {
  const p = entorno.pagina;
  describe('avisos de las interacciones que frenan (tic-tac, cuenta, plop y vibración)', () => {
    paso(entorno, 'nota, pregunta y punto para tocar: tres tics 3 s antes (también a 2×, en tiempo de video), la cuenta y un plop al frenar, con vibración', async () => {
      await p.abrir({ query: Q });
      let S = await sonidos(p);
      assert.deepEqual([S.contextos.length, S.osc.length, S.vib.length], [0, 0, 0], `antes del play no se crea el sonido ni suena nada: ${JSON.stringify(S)}`);
      await p.reproducir();
      await p.debe(`A.tarjeta()?.id === 'nota7'`, 15000, 'no frenó en la nota de los 7');
      await dormir(300);
      S = await sonidos(p);
      assert.equal(S.contextos.length, 1, 'un solo AudioContext');
      assert.equal(S.contextos[0].enGesto, true, 'el AudioContext se crea dentro del toque de play');
      tresTics(tics(S), [4, 5, 6], 0.45);
      const plop = de(S, 'plop');
      assert.equal(plop.length, 1, `un plop al frenar: ${JSON.stringify(S.osc)}`);
      assert.ok(cerca(plop[0].t, 7, 0.4) && plop[0].ms > tics(S)[2].ms, `el plop sale al frenar en 7: ${JSON.stringify(plop)}`);
      assert.deepEqual(patrones(S), ['40', '40', '40', FRENO], 'vibra corto en cada tic y más largo al frenar');
      for (const o of S.osc) assert.ok(o.vol > 0 && o.vol <= 0.3, `volumen moderado: ${JSON.stringify(o)}`);
      // La cuenta que se vio: 3, 2, 1 con su texto, y nada al aparecer la nota.
      const vistas = S.cuentas.map((c) => c.txt);
      assert.deepEqual(vistas.filter(Boolean), ['3 Se viene una nota', '2 Se viene una nota', '1 Se viene una nota'], `cuenta: ${JSON.stringify(S.cuentas)}`);
      assert.equal(vistas[vistas.length - 1], null, 'con la nota abierta la cuenta ya no está');
      await p.responder();

      // A 2×: los tics siguen siendo 3 s de VIDEO antes, o sea cada ~0,5 s de reloj.
      await velocidad(p, '2x');
      await p.debe(`A.tarjeta()?.id === 'mc15'`, 15000, 'no frenó en la pregunta de los 15');
      await dormir(300);
      S = await sonidos(p);
      const deLaPregunta = tics(S).slice(3);
      tresTics(deLaPregunta, [12, 13, 14], 0.8);
      const reloj = [deLaPregunta[1].ms - deLaPregunta[0].ms, deLaPregunta[2].ms - deLaPregunta[1].ms];
      assert.ok(reloj.every((d) => d > 250 && d < 900), `a 2× suenan cada ~500 ms de reloj: ${reloj}`);
      assert.ok(S.cuentas.some((c) => c.txt === '3 Se viene una pregunta'), `la cuenta dice "pregunta": ${JSON.stringify(S.cuentas.slice(-4))}`);
      await responderMC(p);

      await p.debe(`A.tarjeta()?.tipo === 'hotspot'`, 15000, 'no frenó en los puntos de los 22');
      await dormir(300);
      S = await sonidos(p);
      tresTics(tics(S).slice(6), [19, 20, 21], 0.8);
      assert.equal(de(S, 'plop').length, 3, 'un plop por cada vez que frenó');
      assert.ok(S.cuentas.some((c) => c.txt === '3 Se viene una actividad'), 'la cuenta de los puntos dice "actividad"');
      // Nueve tics en total (tres por cada una que frena): la etiqueta de los 18 no
      // hizo tic-tac ni vibró (suena su plop suave, que es del glosario).
      assert.equal(tics(S).length, 9);
      assert.deepEqual(patrones(S), ['40', '40', '40', FRENO, '40', '40', '40', FRENO, '40', '40', '40', FRENO]);
      assert.ok(de(S, 'suave').some((o) => cerca(o.t, 18, 0.8)), 'la etiqueta de los 18 sumó su término con el plop suave');
      await responderPuntos(p);
    }, { timeout: 90000 });

    paso(entorno, 'llegar SALTANDO a una pregunta no hace tic-tac (el plop al frenar sí)', async () => {
      await p.abrir({ query: Q, progreso: { completed: ['nota7'], currentTime: 9 }, esperarEn: 9 });
      await p.reproducir();
      await p.debe(`A.comp() > 9.3`, 5000, 'no arrancó');
      await pausar(p);
      await p.debe(`A.video().paused`, 3000, 'no se pausó');
      const antes = await sonidos(p);
      // +10 desde ~9,4: el salto frena EXACTO en la pendiente de los 15 y la muestra.
      await p.clic('.iv-controls-row button[aria-label="Adelantar 10 segundos"]');
      await p.debe(`A.tarjeta()?.id === 'mc15'`, 8000, 'el salto no frenó en la pregunta de los 15');
      await dormir(400);
      const S = await sonidos(p);
      assert.equal(tics(S).length, tics(antes).length, `ningún tic al llegar saltando: ${JSON.stringify(tics(S))}`);
      assert.equal(S.cuentas.filter((c) => c.txt).length, 0, 'ni cuenta regresiva');
      assert.equal(de(S, 'plop').length, 1, 'el plop al frenar sí');
      assert.deepEqual(patrones(S), [FRENO]);
    });

    paso(entorno, 'volver para atrás antes de la pregunta: el aviso se repite al cruzarlo de nuevo', async () => {
      await p.abrir({ query: Q, progreso: { completed: ['nota7'], currentTime: 10.5 }, esperarEn: 10.5 });
      await p.reproducir();
      await p.debe(`W.__sonidos.osc.filter((o) => o.que.startsWith('tic')).length >= 2`, 8000, 'no sonaron los dos primeros tics');
      await pausar(p);
      await p.debe(`A.video().paused`, 3000, 'no se pausó');
      let e = await p.estado();
      assert.ok(e.comp < 14.9 && !e.tarjeta, `pausó antes de la pregunta: ${JSON.stringify(e)}`);
      await p.clic('.iv-controls-row button[aria-label="Retroceder 10 segundos"]');
      await p.debe(`A.comp() < 5`, 5000, 'no retrocedió');
      await velocidad(p, '2x');
      await p.reproducir();
      await p.debe(`A.tarjeta()?.id === 'mc15'`, 15000, 'no frenó en la pregunta de los 15');
      await dormir(300);
      const S = await sonidos(p);
      const todos = tics(S);
      assert.equal(todos.length, 5, `dos de la primera pasada y los tres de nuevo: ${JSON.stringify(todos)}`);
      tresTics(todos.slice(2), [12, 13, 14], 0.8);
    });

    paso(entorno, 'Ajustes: el alumno apaga los sonidos y la vibración, queda recordado, y la cuenta se sigue viendo', async () => {
      await p.abrir({ query: Q });
      await p.clic('.iv-ajustes-btn');
      await p.debe(`!!D.querySelector('.iv-ajustes-principal')`, 3000, 'Ajustes tiene que abrir en la vista principal (ahí están los avisos)');
      const fila = (texto) => `[...D.querySelectorAll('.iv-ajustes-fila[role="switch"]')].find((b) => b.textContent.startsWith(${JSON.stringify(texto)}))`;
      assert.equal(await p.a(`${fila('Sonidos de aviso')}?.getAttribute('aria-checked')`), 'true', 'por defecto, con sonido');
      assert.equal(await p.a(`${fila('Vibración')}?.getAttribute('aria-checked')`), 'true', 'por defecto, con vibración (equipo táctil)');
      await p.clic('.iv-ajustes-fila', { texto: 'Sonidos de aviso' });
      await p.clic('.iv-ajustes-fila', { texto: 'Vibración' });
      assert.deepEqual(await p.a(`[${fila('Sonidos de aviso')}.getAttribute('aria-checked'), ${fila('Vibración')}.getAttribute('aria-checked'), ${fila('Sonidos de aviso')}.textContent]`), ['false', 'false', 'Sonidos de avisoNo']);
      assert.deepEqual(await p.a(`[localStorage.getItem('iv_avisos_sonido'), localStorage.getItem('iv_avisos_vibracion')]`), ['0', '0']);
      await p.clic('.iv-ajustes-cerrar');
      await p.reproducir();
      await p.debe(`A.tarjeta()?.id === 'nota7'`, 15000, 'no frenó en la nota de los 7');
      await dormir(300);
      let S = await sonidos(p);
      assert.deepEqual([S.osc.length, S.vib.length], [0, 0], `apagados: ni sonido ni vibración: ${JSON.stringify(S)}`);
      assert.equal(S.contextos.length, 0, 'con los sonidos apagados no se crea el AudioContext (ni la sesión de audio)');
      assert.deepEqual(S.cuentas.filter((c) => c.txt).map((c) => c.txt[0]), ['3', '2', '1'], 'la cuenta regresiva se ve igual');
      // Recargar (sin borrar el localStorage, a diferencia de abrir()): siguen apagados.
      await p.cdp.cmd('Page.reload');
      await p.debe('A.listo()', 30000, 'no volvió a cargar');
      await p.clic('.iv-ajustes-btn');
      assert.deepEqual(await p.a(`[${fila('Sonidos de aviso')}.getAttribute('aria-checked'), ${fila('Vibración')}.getAttribute('aria-checked')]`), ['false', 'false'], 'quedaron recordados');
      // Prenderlo de nuevo da una muestra (dentro del toque, que además desbloquea el sonido).
      await p.clic('.iv-ajustes-fila', { texto: 'Sonidos de aviso' });
      await p.clic('.iv-ajustes-fila', { texto: 'Vibración' });
      S = await sonidos(p);
      assert.deepEqual([de(S, 'suave').length, patrones(S)], [1, ['40']], `al prenderlos, una muestra de cada uno: ${JSON.stringify(S)}`);
      assert.deepEqual(S.contextos.map((c) => c.enGesto), [true], 'el toque que los prende crea el AudioContext');
      assert.equal(await p.a(`localStorage.getItem('iv_avisos_sonido')`), '1');
    });

    paso(entorno, 'transmitiendo a la TV: los tics, el plop y la vibración salen en el celular, y el glosario se abre sobre el cartel de la TV', async () => {
      await abrirConTV(p, 'web', { query: { ...Q, lat: '120' }, progreso: { completed: [], currentTime: 0.3 }, esperarEn: 0.3 });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      await p.reproducir();
      await p.clic('.iv-tv-btn');
      await p.debe(`/^Reproduciendo en/.test(A.estado().capa || '') && window.__tv.receptor.estado === 'PLAYING'`, 10000, 'no se conectó');
      // El término de los 2 s: plop suave en el celular y el aviso, encima del cartel.
      await p.debe(`/Data Link/.test(D.querySelector('.iv-glosario-aviso')?.textContent || '')`, 8000, 'no apareció el aviso del glosario transmitiendo');
      await p.clic('.iv-glosario-aviso');
      await p.debe(`!!D.querySelector('.iv-glosario')`, 3000, 'el aviso no abrió el glosario');
      const encima = await p.a(`(() => {
        const g = D.querySelector('.iv-glosario').getBoundingClientRect();
        const h = D.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2);
        return { capa: !!D.querySelector('.iv-tv-capa'), enPanel: !!(h && h.closest('.iv-glosario')), abierto: D.querySelector('[data-termino="data-link"] button')?.getAttribute('aria-expanded') };
      })()`);
      assert.deepEqual(encima, { capa: true, enPanel: true, abierto: 'true' }, 'el panel queda encima del cartel de la TV, en el término del aviso');
      // La nota de los 7: el freno es en la TV, los avisos en el celular (el panel se cierra).
      await p.debe(`A.tarjeta()?.id === 'nota7'`, 15000, 'no frenó en la nota de los 7 transmitiendo');
      await dormir(300);
      const S = await sonidos(p);
      tresTics(tics(S), [4, 5, 6], 0.7);
      assert.equal(de(S, 'plop').length, 1);
      assert.equal(de(S, 'suave').length, 1, 'el plop suave del término');
      assert.deepEqual(patrones(S), ['40', '40', '40', FRENO]);
      assert.equal(await p.a(`!!D.querySelector('.iv-glosario')`), false, 'la nota cierra el panel');
      const e = await p.estado();
      assert.equal(e.tv && e.tv.estado, 'PAUSED', `la TV quedó frenada en la nota: ${JSON.stringify(e.tv)}`);
    }, { timeout: 90000 });
  });
}
