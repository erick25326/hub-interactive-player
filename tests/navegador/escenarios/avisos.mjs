// Los AVISOS de las interacciones que frenan (src/avisos.js + src/sonidos.js) con el
// reproductor de verdad: el tic-tac de los 3 segundos antes, la cuenta regresiva, el
// "plop" al frenar y la vibración. Web Audio y navigator.vibrate son de mentira
// (simulados/sonido-simulado.js, ?sonido=simulado): anotan cada sonido con el segundo
// del VIDEO en que salió, cada vibración y la cuenta que se vio. Lo puro (qué tic
// toca en cada paso) lo prueban las unitarias; acá, que el componente lo use bien con
// ticks reales: sólo reproduciendo, en tiempo de video, nunca al llegar saltando, que
// se repita al volver para atrás, que los ajustes del alumno lo apaguen, que el silencio
// del video calle los sonidos y no la vibración, y que siga en el celular transmitiendo
// a la TV.
// Interacciones (?ias=glosario): nota7 (tics en 4, 5, 6), mc15 (12, 13, 14), hs22
// (19, 20, 21), tf40; etiquetas en 2, 10, 18 y 32 (sin tic). Con ?ias=juntas: nota7 y
// tf9 (a menos de 3 s) y una etiqueta en 9, el mismo segundo que el V/F.
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
export const FRENO = JSON.stringify([60, 40, 60]);
export const patrones = (S) => S.vib.map((v) => JSON.stringify(v.patron));

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

// Clic REAL en la barra, en el segundo `seg` del video (la barra frena sola en una
// pendiente si la cruza). Primero el mouse encima, que muestra los controles.
export async function clicBarra(p, seg) {
  const r = await p.a(`(() => { const b = D.querySelector('.iv-progress-container').getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width, d: A.duracion() }; })()`);
  assert.ok(r && r.d > 0, `no hay barra con duración: ${JSON.stringify(r)}`);
  const x = r.x + r.w * (seg / r.d);
  await p.cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: r.y });
  await dormir(60);
  await p.cdp.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: r.y, button: 'left', clickCount: 1 });
  await p.cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: r.y, button: 'left', clickCount: 1 });
}

// Los tres tics de una pendiente: alto-bajo-alto, cada uno al cruzar su marca (entre la
// marca y un tick después: a 2× el tick es de ~0,5 s de video).
export function tresTics(lista, marcas, tolerancia) {
  assert.deepEqual(lista.map((o) => o.que), ['tic-alto', 'tic-bajo', 'tic-alto'], `tic-tac: ${JSON.stringify(lista)}`);
  lista.forEach((o, i) => assert.ok(o.t != null && o.t >= marcas[i] - 0.05 && o.t <= marcas[i] + tolerancia,
    `el tic ${i + 1} tenía que sonar al cruzar ${marcas[i]} s de video: ${JSON.stringify(lista)}`));
}

export function registrar(entorno) {
  const p = entorno.pagina;
  // 🔴 Sólo transmitiendo a la TV (Erick, 19-oct-2026). Que sin transmitir no haya
  // avisos lo prueba glosario.mjs ("sin transmitir, como antes"); lo puro (qué tic
  // toca en cada paso, el silencio, los ajustes) lo prueban las unitarias de avisos.js.
  describe('avisos de las interacciones que frenan, transmitiendo (tic-tac, cuenta, plop y vibración)', () => {
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

    paso(entorno, 'conectar la TV ANTES del primer play (la TV arranca sola): los avisos de la primera suenan y vibran igual', async () => {
      await abrirConTV(p, 'web', { query: { ...Q, lat: '120' }, progreso: { completed: ['nota7'], currentTime: 9.5 }, esperarEn: 9.5 });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      // Sin tocar play: el toque del botón de la TV es el único gesto.
      await p.clic('.iv-tv-btn');
      await p.debe(`/^Reproduciendo en/.test(A.estado().capa || '') && window.__tv.receptor.estado === 'PLAYING'`, 10000, 'no se conectó o la TV no arrancó sola');
      await p.debe(`A.tarjeta()?.id === 'mc15'`, 15000, 'no frenó en la pregunta de los 15 transmitiendo');
      await dormir(300);
      const S = await sonidos(p);
      assert.deepEqual(S.contextos.map((c) => c.enGesto), [true], `el toque de la TV crea el AudioContext: ${JSON.stringify(S.contextos)}`);
      tresTics(tics(S), [12, 13, 14], 0.7);
      assert.equal(de(S, 'plop').length, 1);
      assert.deepEqual(patrones(S), ['40', '40', '40', FRENO]);
    }, { timeout: 60000 });
  });
}
