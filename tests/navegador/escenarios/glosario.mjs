// El GLOSARIO INTERACTIVO (modo "glosario" de las etiquetas, el de por defecto) con el
// reproductor de verdad: los términos se suman en el momento en que se nombran, con un
// "plop" suave y sin vibrar; lo último arriba con "recién"; el aviso "Nuevo en el
// glosario" abre el panel en ese término; un salto hacia adelante los suma callados;
// las notas vistas quedan; el modo "En pantalla" (respaldo por actividad) es el de
// antes; y el panel que TAPA el video lo pausa al abrir y lo retoma al cerrar. Lo puro
// (qué se suma y en qué orden, cuánto tapa el panel y qué decide) lo prueban las
// unitarias.
// Interacciones (?ias=glosario): etiquetas data-link (2), frecuencia (10), telemetria
// (18), ocusync (32); nota7, mc15, hs22, tf40. Sonido de mentira (?sonido=simulado).
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { cerca } from '../apoyo/pagina.mjs';
import { dormir } from '../apoyo/chrome.mjs';
import { Q, sonidos, tics, de, pausar, tresTics, patrones, FRENO } from './avisos.mjs';

const terminos = (p) => p.a(`[...D.querySelectorAll('[data-termino]')].map((li) => ({ id: li.dataset.termino, abierto: li.querySelector('button').getAttribute('aria-expanded'), def: !li.querySelector('.iv-glosario-def').hidden, recien: !!li.querySelector('.iv-glosario-recien') }))`);
const contador = (p) => p.a(`D.querySelector('.iv-glosario-marca')?.textContent`);
// Cuánto del contenedor (el área del video) tapa el panel, medido en la pantalla. Esperar
// la animación de entrada antes (se mueve 24 px en 0,2 s).
const tapa = (p) => p.a(`(() => {
  const g = D.querySelector('.iv-glosario'), c = D.querySelector('.iv-container');
  if (!g || !c) return null;
  const a = g.getBoundingClientRect(), b = c.getBoundingClientRect();
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return +(w * h / (b.width * b.height)).toFixed(3);
})()`);
const contenedor = (p) => p.a(`(() => { const r = D.querySelector('.iv-container').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()`);
// Clic REAL con el botón apretado `ms` milisegundos (un dedo de verdad): el pointerdown
// y el clic llegan separados, como en el celular. En el BORDE del botón, sobre el botón
// mismo y no sobre su ícono: si el ícono cambia en el medio (Reproducir pasa a Pausar),
// el navegador no da el clic, y la prueba no vería si el clic llegaba a deshacer algo.
async function clicLento(p, sel, ms) {
  const c = await p.apuntar(sel);
  assert.ok(c, `no se ve ${sel} · estado: ${JSON.stringify(await p.estado())}`);
  const lx = await p.a(`D.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().left + 3`);
  const enElBoton = await p.a(`D.elementFromPoint(${lx}, ${c.ly}) === D.querySelector(${JSON.stringify(sel)})`);
  assert.ok(enElBoton, `en el borde de ${sel} hay otra cosa`);
  const x = c.x - c.lx + lx, y = c.y;
  await p.cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await dormir(80);
  await p.cdp.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await dormir(ms);
  await p.cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function tecla(p, key, code, vk) {
  await p.cdp.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key === 'Enter' ? '\r' : undefined });
  await p.cdp.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
}

export function registrar(entorno) {
  const p = entorno.pagina;
  // 🔴 El glosario y los avisos son SÓLO transmitiendo a la TV (Erick, 19-oct-2026). Sin
  // transmitir, el reproductor es el de antes de la 1.4.0. Lo que hace el glosario
  // transmitiendo lo prueban ésta y avisos.mjs; lo puro, las unitarias de glosario.js.
  describe('glosario interactivo de las etiquetas (sólo transmitiendo a la TV)', () => {
    paso(entorno, 'sin transmitir, como antes: los pines sobre el video, sin glosario, sin tic-tac, cuenta, plop ni vibración, y sin sus ajustes (en los dos modos)', async () => {
      for (const etiquetas of ['glosario', 'pantalla']) {
        await p.abrir({ query: { ...Q, etiquetas } });
        assert.equal(await p.a(`!!D.querySelector('.iv-glosario-btn')`), false, `${etiquetas}: sin botón de glosario`);
        await p.reproducir();
        await p.debe(`[...D.querySelectorAll('.iv-label-pin .iv-label-btn')].some((b) => b.textContent === 'Data Link')`, 8000, `${etiquetas}: no apareció el pin de Data Link sobre el video`);
        assert.equal(await p.a(`!!D.querySelector('.iv-glosario-aviso')`), false, `${etiquetas}: sin aviso del glosario`);
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
        assert.equal(await p.a(`!!D.querySelector('.iv-glosario-btn')`), false, `${etiquetas}: la nota vista no arma un glosario`);
        await p.clic('.iv-ajustes-btn');
        assert.equal(await p.a(`[...D.querySelectorAll('.iv-ajustes-fila')].some((b) => /Sonidos de aviso|Vibración/.test(b.textContent))`), false, `${etiquetas}: sin los interruptores de los avisos en Ajustes`);
      }
    }, { timeout: 60000 });


    paso(entorno, 'transmitiendo a la TV, el panel tapa el cartel y no pausa: el video está en la TV', async () => {
      await p.abrir({ pagina: 'marco.html', query: { ...Q, cast: 'fake', lat: '120', ancho: '375px' }, progreso: { completed: ['nota7'], currentTime: 8 }, esperarEn: 8 });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      await p.reproducir();
      await p.clic('.iv-tv-btn');
      await p.debe(`(A.estado().capa || '').startsWith('Reproduciendo en') && A.estado().tv?.estado === 'PLAYING'`, 10000, 'no se conectó');
      await p.clic('.iv-glosario-btn');
      await p.debe(`!!D.querySelector('.iv-glosario')`, 2000, 'no se abrió el glosario');
      await dormir(800);
      assert.ok((await tapa(p)) > 0.7, 'el panel tapa todo (el cartel de la TV)');
      let e = await p.estado();
      assert.deepEqual([e.tv && e.tv.estado, e.boton], ['PLAYING', 'Pausar'], `la TV sigue reproduciendo: ${JSON.stringify(e)}`);
      await p.clic('.iv-glosario-cerrar');
      await dormir(600);
      e = await p.estado();
      assert.deepEqual([e.tv && e.tv.estado, e.boton], ['PLAYING', 'Pausar'], `y al cerrar, igual: ${JSON.stringify(e)}`);
    }, { timeout: 60000 });
  });
}
