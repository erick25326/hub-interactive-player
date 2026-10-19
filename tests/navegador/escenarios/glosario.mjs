// El GLOSARIO INTERACTIVO (modo "glosario" de las etiquetas, el de por defecto) con el
// reproductor de verdad: los términos se suman en el momento en que se nombran, con un
// "plop" suave y sin vibrar; lo último arriba con "recién"; el aviso "Nuevo en el
// glosario" abre el panel en ese término; un salto hacia adelante los suma callados;
// las notas vistas quedan; y el modo "En pantalla" (respaldo por actividad) es el de
// antes. Lo puro (qué se suma y en qué orden) lo prueban las unitarias.
// Interacciones (?ias=glosario): etiquetas data-link (2), frecuencia (10), telemetria
// (18), ocusync (32); nota7, mc15, hs22, tf40. Sonido de mentira (?sonido=simulado).
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { cerca } from '../apoyo/pagina.mjs';
import { dormir } from '../apoyo/chrome.mjs';
import { Q, sonidos, tics, de, pausar } from './avisos.mjs';

const terminos = (p) => p.a(`[...D.querySelectorAll('[data-termino]')].map((li) => ({ id: li.dataset.termino, abierto: li.querySelector('button').getAttribute('aria-expanded'), def: !li.querySelector('.iv-glosario-def').hidden, recien: !!li.querySelector('.iv-glosario-recien') }))`);
const contador = (p) => p.a(`D.querySelector('.iv-glosario-marca')?.textContent`);
async function tecla(p, key, code, vk) {
  await p.cdp.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key === 'Enter' ? '\r' : undefined });
  await p.cdp.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
}

export function registrar(entorno) {
  const p = entorno.pagina;
  describe('glosario interactivo de las etiquetas', () => {
    paso(entorno, 'progresivo y ordenado: cada término al nombrarse, con plop suave sin vibrar; el aviso abre el panel en ese término', async () => {
      await p.abrir({ query: Q });
      // Antes de empezar: el botón con 0 y el panel que explica, sin la lista completa.
      assert.equal(await contador(p), '0');
      assert.equal(await p.a(`D.querySelector('.iv-glosario-btn').getAttribute('aria-label')`), 'Glosario: 0 entradas');
      await p.clic('.iv-glosario-btn');
      await p.debe(`!!D.querySelector('.iv-glosario-vacio')`, 3000, 'el panel vacío tiene que explicar qué va a aparecer');
      assert.equal(await p.a(`D.querySelector('.iv-glosario-cuenta').textContent`), '0 de 5');
      assert.equal(await p.a(`D.querySelector('.iv-glosario-btn').getAttribute('aria-expanded')`), 'true');
      await p.clic('.iv-glosario-cerrar');
      await p.debe(`!D.querySelector('.iv-glosario')`, 3000, 'la X no cerró el panel');
      assert.equal(await p.a(`D.activeElement === D.querySelector('.iv-glosario-btn')`), true, 'al cerrar, el foco vuelve al botón');

      await p.reproducir();
      await p.debe(`/Data Link/.test(D.querySelector('.iv-glosario-aviso')?.textContent || '')`, 8000, 'no apareció "Nuevo en el glosario: Data Link"');
      let S = await sonidos(p);
      const suave = de(S, 'suave');
      assert.equal(suave.length, 1, `un plop suave: ${JSON.stringify(S.osc)}`);
      assert.ok(cerca(suave[0].t, 2.2, 0.35), `en el segundo en que se nombra (2): ${JSON.stringify(suave)}`);
      assert.equal(S.vib.length, 0, 'el término nuevo no vibra');
      assert.equal(tics(S).length, 0, 'ni hace tic-tac');
      assert.equal(await contador(p), '1');
      assert.equal(await p.a(`D.querySelector('.iv-glosario-marca').classList.contains('late')`), true, 'el contador late');
      assert.equal(await p.a(`D.querySelector('.iv-glosario-aviso-zona').getAttribute('aria-live')`), 'polite');
      // Nada infinito en lo nuevo (la cuenta, el aviso, el contador, el panel).
      const infinitas = await p.a(`D.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity && a.effect.target && a.effect.target.closest && a.effect.target.closest('.iv-cuenta, .iv-glosario-aviso-zona, .iv-glosario-btn, .iv-glosario-capa')).length`);
      assert.equal(infinitas, 0, 'ninguna animación infinita');

      await p.debe(`A.tarjeta()?.id === 'nota7'`, 10000, 'no frenó en la nota de los 7');
      await p.responder();
      // La nota vista queda en el glosario (sin sonido ni aviso: se acaba de leer).
      await p.debe(`D.querySelector('.iv-glosario-marca')?.textContent === '2'`, 3000, 'la nota no quedó en el glosario');

      // El de los 10: el aviso, y tocarlo abre el panel en ese término.
      await p.debe(`/Frecuencia/.test(D.querySelector('.iv-glosario-aviso')?.textContent || '')`, 8000, 'no apareció "Nuevo en el glosario: Frecuencia"');
      await p.clic('.iv-glosario-aviso');
      await p.debe(`!!D.querySelector('.iv-glosario-lista')`, 3000, 'el aviso no abrió el glosario');
      let ts = await terminos(p);
      assert.deepEqual(ts.map((x) => x.id), ['frecuencia', 'nota7', 'data-link'], 'lo último arriba, y sólo lo ya nombrado');
      assert.deepEqual(ts[0], { id: 'frecuencia', abierto: 'true', def: true, recien: true }, 'el del aviso, abierto y con "recién"');
      assert.deepEqual(ts.slice(1).map((x) => [x.abierto, x.def]), [['false', false], ['false', false]], 'los demás, plegados');
      assert.equal(await p.a(`D.activeElement?.closest('[data-termino]')?.dataset.termino`), 'frecuencia', 'el foco va al término del aviso');
      assert.match(await p.a(`D.querySelector('[data-termino="frecuencia"] .iv-glosario-def').textContent`), /ciclos por segundo/);
      assert.equal(await p.a(`D.querySelector('.iv-glosario-cuenta').textContent`), '3 de 5');
      assert.equal(await p.a('A.video().paused'), false, 'abrir el glosario no pausa el video');
      // Con teclado: Enter despliega otro término; Escape cierra y devuelve el foco al botón.
      await p.a(`(D.querySelector('[data-termino="data-link"] button').focus(), true)`);
      await tecla(p, 'Enter', 'Enter', 13);
      await p.debe(`D.querySelector('[data-termino="data-link"] button').getAttribute('aria-expanded') === 'true'`, 2000, 'Enter no desplegó el término');
      await tecla(p, 'Escape', 'Escape', 27);
      await p.debe(`!D.querySelector('.iv-glosario')`, 2000, 'Escape no cerró el glosario');
      assert.equal(await p.a(`D.activeElement === D.querySelector('.iv-glosario-btn')`), true, 'al cerrar con Escape, el foco vuelve al botón');
      // Tocar afuera (el video) lo cierra SIN pausar.
      await p.clic('.iv-glosario-btn');
      await p.debe(`!!D.querySelector('.iv-glosario')`, 2000, 'el botón no abrió el glosario');
      ts = await terminos(p);
      assert.deepEqual(ts.filter((x) => x.abierto === 'true').map((x) => x.id), ['frecuencia', 'data-link'], 'recuerda lo desplegado');
      await p.clic('.iv-click-layer');
      await p.debe(`!D.querySelector('.iv-glosario')`, 2000, 'tocar el video no cerró el glosario');
      await dormir(300);
      assert.equal(await p.a('A.video().paused'), false, 'tocar el video con el glosario abierto sólo lo cierra');
      // Con el panel abierto, la cuenta regresiva de la pregunta va adentro del panel (la
      // de afuera quedaría tapada) y la pregunta de los 15 lo cierra.
      await p.clic('.iv-glosario-btn');
      await p.debe(`/Se viene una pregunta/.test(D.querySelector('.iv-glosario .iv-glosario-se-viene')?.textContent || '')`, 8000, 'la cuenta regresiva no apareció en el panel');
      assert.equal(await p.a(`!!D.querySelector('.iv-cuenta')`), false, 'con el panel abierto, la cuenta de afuera no se muestra');
      await p.debe(`A.tarjeta()?.id === 'mc15'`, 10000, 'no frenó en la pregunta de los 15');
      assert.equal(await p.a(`!!D.querySelector('.iv-glosario')`), false, 'la pregunta cierra el glosario');
    }, { timeout: 90000 });

    paso(entorno, 'un salto hacia adelante suma callado lo que quedó atrás; volver para atrás no saca nada', async () => {
      await p.abrir({ query: Q, progreso: { completed: ['nota7'], currentTime: 0.5 }, esperarEn: 0.5 });
      assert.equal(await contador(p), '1', 'la nota vista en otra sesión ya está en el glosario');
      await p.reproducir();
      await p.debe(`A.comp() > 0.7`, 5000, 'no arrancó');
      await pausar(p);
      await p.debe(`A.video().paused`, 3000, 'no se pausó');
      const e0 = await p.estado();
      assert.ok(e0.comp < 1.9, `pausó antes del primer término: ${JSON.stringify(e0)}`);
      await p.clic('.iv-controls-row button[aria-label="Adelantar 10 segundos"]');
      await p.debe(`D.querySelector('.iv-glosario-marca')?.textContent === '3'`, 5000, 'el salto no sumó los términos que quedaron atrás');
      await dormir(500);
      const S = await sonidos(p);
      assert.deepEqual([de(S, 'suave').length, tics(S).length, S.vib.length], [0, 0, 0], `callados: ${JSON.stringify(S.osc)}`);
      assert.equal(await p.a(`!!D.querySelector('.iv-glosario-aviso')`), false, 'sin aviso');
      await p.clic('.iv-glosario-btn');
      const ts = await terminos(p);
      assert.deepEqual(ts.map((x) => [x.id, x.recien]), [['frecuencia', false], ['nota7', false], ['data-link', false]], 'sin "recién": no se escucharon nombrar');
      await p.clic('.iv-glosario-cerrar');
      await p.clic('.iv-controls-row button[aria-label="Retroceder 10 segundos"]');
      await p.debe(`A.comp() < 2`, 5000, 'no retrocedió');
      assert.equal(await contador(p), '3', 'volver para atrás no saca nada');
    });

    paso(entorno, 'modo "En pantalla" (respaldo por actividad): los pines de siempre, sin glosario, y los avisos de las que frenan igual', async () => {
      await p.abrir({ query: { ...Q, etiquetas: 'pantalla' } });
      assert.equal(await p.a(`!!D.querySelector('.iv-glosario-btn')`), false, 'sin botón de glosario');
      await p.reproducir();
      await p.debe(`[...D.querySelectorAll('.iv-label-pin .iv-label-btn')].some((b) => b.textContent === 'Data Link')`, 8000, 'no apareció el pin de Data Link sobre el video');
      assert.equal(await p.a(`!!D.querySelector('.iv-glosario-aviso')`), false, 'sin aviso del glosario');
      await p.debe(`A.tarjeta()?.id === 'nota7'`, 10000, 'no frenó en la nota de los 7');
      await dormir(300);
      const S = await sonidos(p);
      assert.equal(de(S, 'suave').length, 0, 'las etiquetas en pantalla no suenan (como antes)');
      assert.deepEqual(tics(S).map((o) => o.que), ['tic-alto', 'tic-bajo', 'tic-alto'], 'el tic-tac de la nota sigue');
      assert.equal(de(S, 'plop').length, 1, 'y el plop al frenar');
      await p.responder();
      assert.equal(await p.a(`!!D.querySelector('.iv-glosario-btn')`), false, 'la nota vista no arma un glosario en este modo');
    });

    paso(entorno, 'con movimiento reducido: sin latido del contador ni animación del panel', async () => {
      await p.cdp.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      try {
        await p.abrir({ query: Q, progreso: { completed: [], currentTime: 1.2 }, esperarEn: 1.2 });
        await p.reproducir();
        await p.debe(`D.querySelector('.iv-glosario-marca')?.classList.contains('late')`, 6000, 'no se sumó el término de los 2');
        await pausar(p);
        await p.clic('.iv-glosario-btn');
        await p.debe(`!!D.querySelector('.iv-glosario')`, 2000, 'no se abrió el glosario');
        const anim = await p.a(`[getComputedStyle(D.querySelector('.iv-glosario-marca')).animationName, getComputedStyle(D.querySelector('.iv-glosario')).animationName]`);
        assert.deepEqual(anim, ['none', 'none']);
      } finally {
        await p.cdp.cmd('Emulation.setEmulatedMedia', { features: [] });
      }
    });
  });
}
