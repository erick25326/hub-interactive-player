// El GLOSARIO EN VIVO con el reproductor de verdad: sin transmitir no existe (el
// reproductor de antes, con los pines sobre el video); transmitiendo reemplaza al cartel
// de la TV, y expandir un término pausa la TV y plegarlo la retoma. Lo puro (la lista
// que sale del tiempo, qué suena, las marcas, cuándo retomar), en las unitarias.
// Interacciones (?ias=glosario): etiquetas data-link (2), frecuencia (10), telemetria
// (18), ocusync (32); nota7, mc15, hs22, tf40. Sonido de mentira (?sonido=simulado).
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { dormir } from '../apoyo/chrome.mjs';
import { Q, sonidos } from './avisos.mjs';

export function registrar(entorno) {
  const p = entorno.pagina;
  // 🔴 El glosario y los avisos son SÓLO transmitiendo a la TV (Erick, 19-oct-2026). Sin
  // transmitir, el reproductor es el de antes de la 1.4.0.
  describe('glosario en vivo de las etiquetas (sólo transmitiendo a la TV)', () => {
    paso(entorno, 'sin transmitir, como antes: los pines sobre el video, sin glosario, sin tic-tac, cuenta, plop ni vibración, y sin sus ajustes (en los dos modos)', async () => {
      for (const etiquetas of ['glosario', 'pantalla']) {
        await p.abrir({ query: { ...Q, etiquetas } });
        assert.equal(await p.a(`!!D.querySelector('.iv-gv')`), false, `${etiquetas}: sin glosario en vivo`);
        await p.reproducir();
        await p.debe(`[...D.querySelectorAll('.iv-label-pin .iv-label-btn')].some((b) => b.textContent === 'Data Link')`, 8000, `${etiquetas}: no apareció el pin de Data Link sobre el video`);
        assert.equal(await p.a(`!!D.querySelector('.iv-gv')`), false, `${etiquetas}: tampoco reproduciendo`);
        let cuenta = false;
        const hasta = Date.now() + 10000;
        while (Date.now() < hasta && (await p.a(`A.tarjeta()?.id || null`)) !== 'nota7') {
          if (await p.a(`!!D.querySelector('.iv-cuenta')`)) cuenta = true;
          await dormir(150);
        }
        assert.equal(await p.a(`A.tarjeta()?.id`), 'nota7', `${etiquetas}: no frenó en la nota de los 7`);
        assert.equal(cuenta, false, `${etiquetas}: sin cuenta regresiva`);
        await dormir(300);
        const S = (await sonidos(p)) || {};
        const osc = S.osc || [], vib = S.vib || [];
        assert.deepEqual([osc.length, vib.length], [0, 0], `${etiquetas}: sin sonidos ni vibración: ${JSON.stringify(S)}`);
        await p.responder();
        assert.equal(await p.a(`!!D.querySelector('.iv-gv')`), false, `${etiquetas}: la nota vista no arma un glosario`);
        await p.clic('.iv-ajustes-btn');
        assert.equal(await p.a(`[...D.querySelectorAll('.iv-ajustes-fila')].some((b) => /Sonidos de aviso|Vibración/.test(b.textContent))`), false, `${etiquetas}: sin los interruptores de los avisos en Ajustes`);
      }
    }, { timeout: 60000 });


    paso(entorno, 'transmitiendo a la TV, el glosario en vivo reemplaza al cartel; expandir un término pausa la TV y plegarlo la retoma', async () => {
      await p.abrir({ pagina: 'marco.html', query: { ...Q, cast: 'fake', lat: '120', ancho: '375px' }, progreso: { completed: ['nota7'], currentTime: 8 }, esperarEn: 8 });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      await p.reproducir();
      await p.clic('.iv-tv-btn');
      await p.debe(`(A.estado().capa || '').startsWith('Reproduciendo en') && A.estado().tv?.estado === 'PLAYING'`, 10000, 'no se conectó');
      await p.debe(`!!D.querySelector('.iv-gv [data-termino="data-link"]') && !D.querySelector('.iv-tv-capa')`, 3000, 'no apareció el glosario en vivo con Data Link');
      const fila = '.iv-gv [data-termino="data-link"] .iv-gv-cab';
      await p.clic(fila);
      await p.debe(`A.estado().tv?.estado === 'PAUSED' && A.estado().boton === 'Reproducir'`, 4000, 'expandir no pausó la TV');
      assert.equal(await p.a(`D.querySelector(${JSON.stringify(fila)}).getAttribute('aria-expanded')`), 'true');
      // 375×211 (el iframe con el celular parado): nada se sale de la pantalla.
      const caja = await p.a(`(() => { const g = D.querySelector('.iv-gv'), c = D.querySelector('.iv-controls').getBoundingClientRect(), f = D.querySelector('[data-termino="data-link"] .iv-gv-cab').getBoundingClientRect(); return { sobra: g.clientWidth - g.scrollWidth, filaArribaDeControles: f.top < c.top }; })()`);
      assert.deepEqual(caja, { sobra: 0, filaArribaDeControles: true }, JSON.stringify(caja));
      // "Ver en el video": la TV vuelve a los 2 s (para atrás: la nota de los 7, ya vista,
      // no se repite), sigue en pausa y aparece el aviso.
      // En 211 px de alto el botón queda abajo en la lista: a la vista, como lo haría el dedo.
      await p.a(`(D.querySelector('.iv-gv [data-termino="data-link"] .iv-gv-ver').scrollIntoView({ block: 'nearest' }), true)`);
      await p.clic('.iv-gv [data-termino="data-link"] .iv-gv-ver');
      await p.debe(`/Volviendo a 0:02 en la TV/.test(D.querySelector('.iv-gv-toast')?.textContent || '') && Math.abs(A.estado().tv?.t - 2) < 0.6 && A.estado().tv?.estado === 'PAUSED'`, 4000, '"Ver en el video" no llevó la TV a 0:02');
      await p.a(`(D.querySelector(${JSON.stringify(fila)}).scrollIntoView({ block: 'nearest' }), true)`);
      await p.clic(fila);
      await p.debe(`A.estado().tv?.estado === 'PLAYING' && A.estado().boton === 'Pausar'`, 4000, 'plegar no retomó la TV');
    }, { timeout: 60000 });
  });
}
