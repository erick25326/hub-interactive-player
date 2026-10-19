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

    paso(entorno, 'con el panel abierto: la fila de controles queda libre y un término nuevo se le anuncia al lector de pantalla', async () => {
      await p.abrir({ query: Q, progreso: { completed: [], currentTime: 0.5 }, esperarEn: 0.5 });
      await p.reproducir();
      // Abrirlo reproduciendo, antes del término de los 2 s (tocar un control lo cierra,
      // como el menú: por eso no se da play con el panel abierto).
      await p.clic('.iv-glosario-btn');
      await p.debe(`!!D.querySelector('.iv-glosario')`, 2000, 'no se abrió el glosario');
      const t0 = await p.a('A.comp()');
      assert.ok(t0 < 1.9, `abierto antes de que se nombre Data Link: ${t0}`);
      // Cada botón de la fila se puede tocar con el panel abierto (antes el lateral bajaba
      // hasta el borde y tapaba Glosario, Ajustes y Pantalla completa).
      const tapados = await p.a(`[...D.querySelectorAll('.iv-controls-row button')].filter((b) => b.offsetParent).filter((b) => {
        const r = b.getBoundingClientRect();
        const h = D.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(h && b.contains(h));
      }).map((b) => b.getAttribute('aria-label'))`);
      assert.deepEqual(tapados, [], 'botones tapados por el panel');
      const g = await p.a(`(() => { const a = D.querySelector('.iv-glosario').getBoundingClientRect(), b = D.querySelector('.iv-controls-row').getBoundingClientRect(); return { panelAbajo: a.bottom, filaArriba: b.top }; })()`);
      assert.ok(g.panelAbajo <= g.filaArriba + 1, `el panel termina arriba de la fila: ${JSON.stringify(g)}`);
      // El término de los 2 s, con el panel abierto: sin aviso visible, pero anunciado.
      await p.debe(`/Nuevo en el glosario: Data Link/.test(D.querySelector('.iv-glosario-anuncio')?.textContent || '')`, 6000, 'el término nuevo no se anunció con el panel abierto');
      assert.equal(await p.a(`D.querySelector('.iv-glosario-anuncio').getAttribute('aria-live')`), 'polite');
      assert.equal(await p.a(`!!D.querySelector('.iv-glosario-aviso')`), false, 'el aviso visible sigue sin mostrarse con el panel abierto');
      assert.equal((await terminos(p))[0].recien, true, 'en la lista, arriba y con "recién"');
      // Pausar con el panel abierto: el botón responde (y el panel se cierra, como al
      // tocar cualquier cosa afuera).
      await pausar(p);
      await p.debe(`A.video().paused`, 3000, 'no se pausó con el panel abierto');
      await p.debe(`!D.querySelector('.iv-glosario')`, 2000, 'tocar un control no cerró el panel');
      assert.equal(await p.a(`D.querySelector('.iv-glosario-anuncio').textContent`), '', 'con el panel cerrado, la región queda vacía');
    });

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

  // El panel que TAPA el video (decisión de Erick, 19-oct-2026): abrirlo pausa y
  // cerrarlo retoma, sólo si nada más lo frenó en el medio; en una pantalla ancha y
  // transmitiendo a la TV, no. El reproductor bajo es el iframe del campus con el
  // celular parado (375 × 211, en /marco.html como view.php). Lo puro (cuánto tapa y qué
  // decide), en las unitarias.
  describe('el panel que tapa el video: pausa al abrir y retoma al cerrar', () => {
    paso(entorno, 'reproductor bajo (375×211): abrir pausa, cerrar retoma, y los avisos y el candado siguen como con una pausa del alumno', async () => {
      await p.abrir({ pagina: 'marco.html', query: { ...Q, ancho: '375px' }, progreso: { completed: [], currentTime: 3 }, esperarEn: 3 });
      assert.deepEqual(await contenedor(p), [375, 211], 'el reproductor bajo del campus');
      await p.reproducir();
      // Entre el tic de los 4 y el de los 5 de la nota de los 7.
      await p.debe(`W.__sonidos.osc.filter((o) => o.que.startsWith('tic')).length === 1`, 6000, 'no sonó el primer tic de la nota');
      await p.clic('.iv-glosario-btn');
      await p.debe(`A.video().paused && A.estado().boton === 'Reproducir'`, 2000, 'abrir el glosario que tapa el video no lo pausó');
      const t0 = await p.a('A.comp()');
      assert.ok(t0 > 4 && t0 < 5, `pausó entre los tics de 4 y 5: ${t0}`);
      await dormir(400);   // la animación de entrada
      const cob = await tapa(p);
      assert.ok(cob > 0.7, `el panel tapa el video: ${cob}`);
      await dormir(1000);
      assert.ok(Math.abs((await p.a('A.comp()')) - t0) < 0.3, 'en pausa el tiempo no avanza');
      let S = await sonidos(p);
      assert.deepEqual([tics(S).length, de(S, 'plop').length, S.vib.length], [1, 0, 1], `la pausa no suena ni vibra: ${JSON.stringify(S)}`);
      await p.clic('.iv-glosario-cerrar');
      await p.debe(`!D.querySelector('.iv-glosario')`, 2000, 'la X no cerró el glosario');
      await p.debe(`!A.video().paused && A.comp() > ${t0 + 0.3}`, 3000, 'cerrar el glosario no retomó el video');
      // Sigue como si el alumno hubiera pausado y retomado: los tics de 5 y 6 (ni uno
      // repetido ni uno de más) y el freno en la nota de los 7, con su plop.
      await p.debe(`A.tarjeta()?.id === 'nota7'`, 8000, 'no frenó en la nota de los 7 después de retomar');
      await dormir(300);
      S = await sonidos(p);
      tresTics(tics(S), [4, 5, 6], 0.45);
      assert.equal(de(S, 'plop').length, 1);
      assert.deepEqual(patrones(S), ['40', '40', '40', FRENO]);
    }, { timeout: 60000 });

    paso(entorno, 'pantalla ancha (1280×720): el panel al costado deja ver el video y no pausa', async () => {
      await p.vista({ ancho: 1280, alto: 800 });
      try {
        await p.abrir({ pagina: 'marco.html', query: { ...Q, ancho: '1280px' }, progreso: { completed: [], currentTime: 0.5 }, esperarEn: 0.5 });
        assert.deepEqual(await contenedor(p), [1280, 720]);
        await p.reproducir();
        await p.debe(`A.comp() > 0.8`, 5000, 'no arrancó');
        await p.clic('.iv-glosario-btn');
        await p.debe(`!!D.querySelector('.iv-glosario')`, 2000, 'no se abrió el glosario');
        await dormir(600);
        const cob = await tapa(p);
        assert.ok(cob > 0.2 && cob < 0.4, `al costado tapa un cuarto: ${cob}`);
        assert.equal(await p.a('A.video().paused'), false, 'en una pantalla ancha abrir el glosario no pausa');
        await p.clic('.iv-glosario-cerrar');
        await dormir(400);
        assert.equal(await p.a('A.video().paused'), false, 'ni cerrarlo cambia nada');
      } finally {
        await p.vista();
      }
    });

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

    paso(entorno, 'si en el medio lo frena una pregunta, cerrar NO lo retoma', async () => {
      await p.abrir({ pagina: 'marco.html', query: { ...Q, ancho: '375px' }, progreso: { completed: ['nota7'], currentTime: 9 }, esperarEn: 9 });
      await p.reproducir();
      await p.debe(`A.comp() > 9.3`, 5000, 'no arrancó');
      await p.clic('.iv-glosario-btn');
      await p.debe(`A.video().paused`, 2000, 'abrir el glosario no lo pausó');
      await p.a(`(W.__plays = 0, A.video().addEventListener('play', () => { W.__plays++; }), true)`);
      // Un salto que no pidió el reproductor (los ±15 s de la pantalla de bloqueo) deja
      // atrás la pregunta de los 15: la guardia vuelve a ella y la muestra, y la
      // pregunta cierra el panel.
      await p.a(`(A.video().currentTime = 20, true)`);
      await p.debe(`A.tarjeta()?.id === 'mc15'`, 8000, 'la guardia no mostró la pregunta de los 15');
      assert.equal(await p.a(`!!D.querySelector('.iv-glosario')`), false, 'la pregunta cierra el panel');
      await dormir(1200);
      assert.deepEqual(await p.a('[A.video().paused, W.__plays]'), [true, 0], 'cerrado por la pregunta, no se retoma: ni un play');
    }, { timeout: 60000 });

    paso(entorno, 'si en el medio alguien le da play y lo vuelve a pausar (los auriculares, la pantalla de bloqueo), cerrar NO lo retoma', async () => {
      await p.abrir({ pagina: 'marco.html', query: { ...Q, ancho: '375px' }, progreso: { completed: ['nota7'], currentTime: 9 }, esperarEn: 9 });
      await p.reproducir();
      await p.debe(`A.comp() > 9.3`, 5000, 'no arrancó');
      await p.clic('.iv-glosario-btn');
      await p.debe(`A.video().paused`, 2000, 'abrir el glosario no lo pausó');
      await p.a(`(A.video().play(), true)`);
      await p.debe(`A.estado().boton === 'Pausar'`, 3000, 'el play de afuera no llegó');
      await p.a(`(A.video().pause(), true)`);
      await p.debe(`A.estado().boton === 'Reproducir'`, 3000, 'la pausa de afuera no llegó');
      await p.a(`(W.__plays = 0, A.video().addEventListener('play', () => { W.__plays++; }), true)`);
      await p.clic('.iv-glosario-cerrar');
      await dormir(1200);
      assert.deepEqual(await p.a('[A.video().paused, W.__plays]'), [true, 0], 'la pausa ya no es del glosario: cerrar no la retoma');
    }, { timeout: 60000 });

    paso(entorno, 'angosto pero no bajo (540×304): la hoja de abajo tapa 78 % y pausa; Reproducir con el panel abierto lo cierra y reproduce (no lo vuelve a pausar)', async () => {
      await p.abrir({ pagina: 'marco.html', query: { ...Q, ancho: '540px' }, progreso: { completed: [], currentTime: 0.5 }, esperarEn: 0.5 });
      await p.reproducir();
      await p.debe(`A.comp() > 0.8`, 5000, 'no arrancó');
      await p.clic('.iv-glosario-btn');
      await p.debe(`A.video().paused`, 2000, 'la hoja de abajo tapa más del 70 %: tenía que pausar');
      await dormir(400);
      const cob = await tapa(p);
      assert.ok(cob > 0.7 && cob < 0.85, `la hoja de abajo: ${cob}`);
      // Un toque de verdad (el dedo tarda en levantarse): el pointerdown cierra el panel
      // y el clic llega después. Si cerrar retomara el video, el clic lo encontraba
      // andando y lo pausaba.
      await clicLento(p, '.iv-controls-row button[aria-label="Reproducir"]', 200);
      await p.debe(`!D.querySelector('.iv-glosario')`, 2000, 'tocar Reproducir no cerró el panel');
      await dormir(1000);
      const e = await p.estado();
      assert.equal(e.pausado, false, `reproduce: ${JSON.stringify(e)}`);
      assert.equal(e.boton, 'Pausar');
    });
  });
}
