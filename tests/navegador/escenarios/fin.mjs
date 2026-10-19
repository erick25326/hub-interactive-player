// La TARJETA DE FIN del video (pedido de Erick, 19-oct-2026): al terminar, adentro del
// reproductor y encima del video, "Lección completada" (o "Terminaste el video"), la
// próxima lección, "Siguiente lección" y "Volver a ver"; en la última lección, "Volver al
// curso". El destino sale de la barra del tema del campus en la página de ARRIBA: acá la
// arma /marco.html?lnav=… con el mismo marcado que theme_hubeducation (ver servidor.mjs).
// Lo puro (qué destino se acepta, qué dice) está en tests/unit/fin-video.test.mjs; acá, el
// componente de verdad: cuándo aparece (después de una pregunta del final, nunca encima),
// el foco, Escape, que el video quede en el final y no vuelva a empezar solo (tampoco con
// "Repetir video"), que complete.php salga igual que antes, navegar la página de arriba
// (también desde la pantalla completa y como en hub-app) y transmitiendo a la TV.
// Interacciones: nota en 8, V/F en 25 y en 60; con ias=final, otra en el fin (tfFin).
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { cerca } from '../apoyo/pagina.mjs';
import { dormir } from '../apoyo/chrome.mjs';
import { LECCION_SIGUIENTE, CURSO, CMID_PRUEBA, SESSKEY_PRUEBA } from '../apoyo/servidor.mjs';
import { abrirConTV, comprobarModoApp } from './tv.mjs';

const TODAS = ['n8', 'tf25', 'tf60'];
// La tarjeta como la ve el alumno: textos, botones, dónde está el foco y si se completó.
const LEER = `(() => {
  const c = D.querySelector('.iv-fin');
  if (!c) return null;
  const tx = (s) => { const e = c.querySelector(s); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; };
  return {
    titulo: tx('.iv-fin-titulo'), siguiente: tx('.iv-fin-siguiente'), completada: c.classList.contains('completada'),
    botones: [...c.querySelectorAll('.iv-fin-botones button')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()),
    foco: D.activeElement && c.contains(D.activeElement) ? D.activeElement.textContent.replace(/\\s+/g, ' ').trim() : null,
    rol: c.getAttribute('role'), modal: c.getAttribute('aria-modal'),
    etiquetadaPor: (D.getElementById(c.getAttribute('aria-labelledby') || '') || {}).textContent || null,
    controlesInert: D.querySelector('.iv-controls').hasAttribute('inert'),
  };
})()`;
async function tecla(p, key, code, vk) {
  await p.cdp.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
  await p.cdp.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
}

export function registrar(entorno) {
  const p = entorno.pagina;
  const srv = entorno.srv;
  const dur = entorno.video.duracion;
  const tarjeta = () => p.a(LEER);
  // Abre a 4 s del final, con las tres respondidas, y reproduce hasta la tarjeta.
  const hastaElFin = async ({ pagina = 'player.html', query = {}, completed = TODAS, antes = 4 } = {}) => {
    await p.abrir({ pagina, query: { motor: 'hls', ...query }, progreso: { completed, currentTime: dur - antes }, esperarEn: dur - antes });
    await p.reproducir();
  };
  const esperarTarjeta = (tope = 15000) => p.debe(`!!D.querySelector('.iv-fin')`, tope, 'no apareció la tarjeta de fin');
  // A dónde fue la página de arriba (la cuenta el servidor y se ve en la pestaña).
  const esperarDestino = async (ruta, tope = 10000) => {
    const fin = Date.now() + tope;
    for (;;) {
      const llego = srv.fin.navegacion.some((n) => n.ruta === ruta);
      const ahi = await p.cdp.ev(`location.pathname + location.search`).catch(() => null);
      if (llego && ahi === ruta) return true;
      if (Date.now() > fin) throw new Error(`la página de arriba no llegó a ${ruta}: está en ${ahi} · navegación ${JSON.stringify(srv.fin.navegacion.slice(-3))}`);
      await dormir(100);
    }
  };
  // Lo que se recibió en el complete.php de mentira desde `n`.
  const completadosDesde = (n) => srv.fin.completados.slice(n);

  describe('tarjeta de fin del video', () => {
    for (const modo of ['navegador', 'app']) {
      paso(entorno, `${modo === 'app' ? 'en hub-app (WebView, con el dedo): ' : ''}con la barra del tema, "Lección completada", la próxima lección y el foco en "Siguiente lección"; el botón navega la página de arriba`, async () => {
        const n0 = srv.fin.completados.length, a0 = srv.respaldo.progresos.length;
        const app = modo === 'app';
        const query = { motor: 'hls', lnav: 'siguiente', completar: '1', ...(app ? { app: 'fake', webview: '1' } : {}) };
        // En la app, con el dedo (pantalla táctil emulada).
        if (app) await p.vista({ tactil: true });
        try {
          await p.abrir({ pagina: 'marco.html', query, progreso: { completed: TODAS, currentTime: dur - 4 }, esperarEn: dur - 4 });
          if (app) await p.toque('.iv-big-play'); else await p.reproducir();
          await esperarTarjeta();
          const f = await tarjeta();
          assert.equal(f.titulo, 'Lección completada');
          assert.equal(f.completada, true);
          assert.equal(f.siguiente, `Siguiente: ${LECCION_SIGUIENTE.nombre}`);
          assert.deepEqual(f.botones, ['Siguiente lección →', 'Volver a ver']);
          if (!app) assert.equal(f.foco, 'Siguiente lección →', 'el foco va al botón principal');
          assert.equal(f.rol, 'dialog');
          assert.equal(f.modal, 'true');
          assert.equal(f.etiquetadaPor, 'Lección completada');
          assert.equal(f.controlesInert, true, 'detrás de la tarjeta los controles no se alcanzan con Tab');
          // El video queda EN EL FINAL, en pausa (ya no vuelve a 0).
          const e = await p.estado();
          assert.ok(cerca(e.comp, dur, 0.4) && e.pausado === true, `el video tenía que quedar en el final y en pausa: ${JSON.stringify(e)}`);
          if (app) await comprobarModoApp(p);
          // complete.php sale como siempre: una vez, al terminar con todo respondido.
          for (let i = 0; i < 50 && completadosDesde(n0).length < 1; i++) await dormir(100);
          await dormir(300);
          const c = completadosDesde(n0);
          assert.equal(c.length, 1, `complete.php tenía que salir una vez: ${JSON.stringify(c)}`);
          assert.deepEqual([c[0].cmid, c[0].sesskey], [String(CMID_PRUEBA), SESSKEY_PRUEBA]);
          if (app) await p.toque('.iv-fin-ir'); else await p.clic('.iv-fin-ir');
          await esperarDestino(LECCION_SIGUIENTE.ruta);
          // Al irse, el avance que queda guardado es 0, como cuando el video volvía a 0 al
          // terminar: la próxima vez la lección arranca desde el principio.
          for (let i = 0; i < 30 && !srv.respaldo.progresos.slice(a0).some((x) => x.data && x.data.currentTime === 0); i++) await dormir(100);
          const ultimo = srv.respaldo.progresos.slice(a0).filter((x) => x.data).pop();
          assert.ok(ultimo && ultimo.data.currentTime === 0 && TODAS.every((id) => ultimo.data.completed.includes(id)), `el avance al irse: ${JSON.stringify(ultimo)}`);
        } finally {
          if (app) await p.vista();
        }
      }, { timeout: 60000 });
    }

    paso(entorno, 'la última lección del curso: "Volver al curso", sin "Siguiente: …"', async () => {
      await hastaElFin({ pagina: 'marco.html', query: { lnav: 'ultima', completar: '1' } });
      await esperarTarjeta();
      const f = await tarjeta();
      assert.equal(f.titulo, 'Lección completada');
      assert.equal(f.siguiente, null);
      assert.deepEqual(f.botones, ['Volver al curso', 'Volver a ver']);
      assert.equal(f.foco, 'Volver al curso');
      await p.clic('.iv-fin-ir');
      await esperarDestino(CURSO);
    }, { timeout: 60000 });

    paso(entorno, '"Marcar completada y continuar" (togglecompletion.php) se usa tal cual: marca y sigue a la próxima', async () => {
      await hastaElFin({ pagina: 'marco.html', query: { lnav: 'marcar', completar: '1' } });
      await esperarTarjeta();
      const f = await tarjeta();
      assert.equal(f.siguiente, `Siguiente: ${LECCION_SIGUIENTE.nombre}`);
      assert.deepEqual(f.botones, ['Siguiente lección →', 'Volver a ver']);
      const n0 = srv.fin.navegacion.length;
      await p.clic('.iv-fin-ir');
      await esperarDestino(LECCION_SIGUIENTE.ruta);
      const marcar = srv.fin.navegacion.slice(n0).find((x) => x.ruta.startsWith('/course/togglecompletion.php'));
      assert.ok(marcar, `no pasó por togglecompletion.php: ${JSON.stringify(srv.fin.navegacion.slice(n0))}`);
      assert.deepEqual([marcar.id, marcar.completionstate, marcar.sesskey], [String(CMID_PRUEBA), '1', SESSKEY_PRUEBA]);
    }, { timeout: 60000 });

    paso(entorno, 'sin la barra del tema (el reproductor solo, la demo): "Terminaste el video" y sólo "Volver a ver", que arranca desde 0; con movimiento reducido, sin animación', async () => {
      await p.cdp.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      try {
        await hastaElFin();
        await esperarTarjeta();
        const f = await tarjeta();
        assert.equal(f.titulo, 'Terminaste el video', 'sin Moodle ni SCORM no se puede saber si se completó');
        assert.equal(f.completada, false);
        assert.equal(f.siguiente, null);
        assert.deepEqual(f.botones, ['Volver a ver']);
        assert.equal(f.foco, 'Volver a ver', 'el único botón es el principal');
        const anim = await p.a(`[getComputedStyle(D.querySelector('.iv-fin')).animationName, getComputedStyle(D.querySelector('.iv-fin-fondo')).animationName]`);
        assert.deepEqual(anim, ['none', 'none'], 'con movimiento reducido la tarjeta aparece sin animación');
      } finally {
        await p.cdp.cmd('Emulation.setEmulatedMedia', { features: [] });
      }
      await p.clic('.iv-fin-ver');
      await p.debe(`!D.querySelector('.iv-fin') && A.comp() < 3 && !A.video().paused`, 8000, '"Volver a ver" no arrancó desde el principio');
      await p.debe(`A.comp() > 1.2`, 8000, 'no siguió reproduciendo');
      const e = await p.estado();
      assert.equal(e.boton, 'Pausar');
      assert.equal(await p.a(`D.activeElement === D.querySelector('.iv-controls-row .iv-ctrl-btn')`), true, 'el foco, que estaba en la tarjeta, pasa al botón de reproducir');
    }, { timeout: 60000 });

    paso(entorno, 'Escape la cierra: el video queda en el final, en pausa, y el play vuelve a empezar desde 0', async () => {
      await hastaElFin();
      await esperarTarjeta();
      await tecla(p, 'Escape', 'Escape', 27);
      await p.debe(`!D.querySelector('.iv-fin')`, 3000, 'Escape no cerró la tarjeta');
      await dormir(1500);
      let e = await p.estado();
      assert.ok(cerca(e.comp, dur, 0.4) && e.pausado === true && cerca(e.vt, dur, 0.5), `el video tenía que quedar en el final: ${JSON.stringify(e)}`);
      assert.equal(e.boton, 'Reproducir');
      assert.equal(await p.a(`D.activeElement === D.querySelector('.iv-controls-row .iv-ctrl-btn')`), true, 'al cerrar, el foco va al botón de reproducir');
      assert.equal(await p.a(`!!D.querySelector('.iv-big-play') && !D.querySelector('.iv-controls').hasAttribute('inert')`), true, 'cerrada, el botón grande y los controles a mano');
      await p.reproducir();
      await p.debe(`A.comp() < 3 && !A.video().paused`, 8000, 'el play con el video terminado no volvió a empezar');
      await p.debe(`A.comp() > 1.2`, 8000, 'no siguió reproduciendo');
      e = await p.estado();
      assert.equal(e.tarjeta, null);
    }, { timeout: 60000 });

    paso(entorno, 'con "Repetir video" (loop) se frena en la tarjeta y no vuelve a empezar solo; "Volver a ver" sí', async () => {
      await hastaElFin({ query: { loop: '1' } });
      await esperarTarjeta();
      await dormir(2500);
      const e = await p.estado();
      assert.ok(await p.a(`!!D.querySelector('.iv-fin')`), 'la tarjeta se fue sola');
      assert.ok(cerca(e.comp, dur, 0.4) && e.pausado === true && cerca(e.vt, dur, 0.5), `con loop no tiene que volver a empezar solo: ${JSON.stringify(e)}`);
      await p.clic('.iv-fin-ver');
      await p.debe(`!D.querySelector('.iv-fin') && A.comp() < 3 && !A.video().paused`, 8000, '"Volver a ver" no arrancó desde el principio');
    }, { timeout: 60000 });

    paso(entorno, 'un play de afuera (auriculares, la pantalla de bloqueo) con la tarjeta abierta: se va y el video sigue desde 0', async () => {
      await hastaElFin();
      await esperarTarjeta();
      // Como el botón de un auricular: play directo al <video>, sin pasar por el reproductor.
      await p.a(`(A.video().play().catch(() => {}), true)`);
      await p.debe(`!D.querySelector('.iv-fin') && !A.video().paused && A.comp() < 3`, 8000, 'la tarjeta quedó encima del video que arrancó de nuevo');
      assert.equal((await p.estado()).boton, 'Pausar');
      // Y anda de verdad: con hls.js detenido desde 'ended', el <video> se quedaba esperando
      // datos en el 0 (nativePlayer retoma la carga con ese play).
      await p.debe(`A.comp() > 1.5 && A.video().currentTime > 1.5`, 10000, 'el video arrancó pero no avanza (sin datos)');
    }, { timeout: 60000 });

    paso(entorno, 'una pregunta del final: primero la pregunta (sin la tarjeta encima), y la tarjeta al responderla', async () => {
      const n0 = srv.fin.completados.length;
      await p.abrir({ pagina: 'marco.html', query: { motor: 'hls', lnav: 'siguiente', completar: '1', ias: 'final' }, progreso: { completed: TODAS, currentTime: dur - 4 }, esperarEn: dur - 4 });
      // Un vigía en el documento del reproductor: si alguna vez están la pregunta y la
      // tarjeta de fin a la vez (aunque sea un render), queda anotado.
      await p.a(`(() => { W.__finConPregunta = false; new W.MutationObserver(() => { if (D.querySelector('.iv-fin') && D.querySelector('.iv-tf-card')) W.__finConPregunta = true; }).observe(D.body, { subtree: true, childList: true }); return true; })()`);
      await p.reproducir();
      await p.debe(`A.tarjeta()?.id === 'tfFin'`, 15000, 'no frenó en la pregunta del final');
      await dormir(1500);
      assert.equal(await p.a(`!!D.querySelector('.iv-fin')`), false, 'la tarjeta de fin tapó la pregunta del final');
      assert.equal(completadosDesde(n0).length, 0, 'con una pendiente no se manda complete.php');
      await p.responder();
      await esperarTarjeta(8000);
      const f = await tarjeta();
      assert.equal(f.titulo, 'Lección completada');
      assert.deepEqual(f.botones, ['Siguiente lección →', 'Volver a ver']);
      assert.equal(f.foco, 'Siguiente lección →');
      assert.equal(await p.a('W.__finConPregunta'), false, 'la tarjeta de fin y la pregunta estuvieron juntas');
      for (let i = 0; i < 50 && completadosDesde(n0).length < 1; i++) await dormir(100);
      assert.ok(completadosDesde(n0).length >= 1, 'al responder la última, complete.php');
      const e = await p.estado();
      assert.ok(cerca(e.comp, dur, 0.5), `la barra en el final: ${JSON.stringify(e)}`);
    }, { timeout: 60000 });

    // Pantalla completa: la NATIVA (el reproductor la pide sobre su wrapper, adentro del
    // iframe) y la SIMULADA del iPhone (nofs=1: se la pide a la madre, que agranda el
    // iframe). "Siguiente lección" sale de la pantalla completa antes de navegar: se anota
    // (en el localStorage del sitio, que sobrevive a la navegación) cada exitFullscreen de
    // los dos documentos y cada pedido de salida que le llega a la madre.
    for (const [cual, query] of [['nativa', {}], ['simulada (iPhone)', { nofs: '1' }]]) {
      paso(entorno, `en pantalla completa ${cual}: la tarjeta se ve adentro; "Siguiente lección" sale de la pantalla completa y navega`, async () => {
        await p.abrir({ pagina: 'marco.html', query: { motor: 'hls', lnav: 'siguiente', completar: '1', ...query }, progreso: { completed: TODAS, currentTime: dur - 4 }, esperarEn: dur - 4 });
        await p.clic('.iv-fs-btn');
        await p.debe(`A.estado().botonFS === 'Salir de pantalla completa'`, 5000, 'no entró a la pantalla completa');
        if (cual === 'nativa') assert.ok(await p.a('!!D.fullscreenElement'), 'la nativa: el documento del reproductor en pantalla completa');
        else assert.ok(await p.esperarArriba(`document.querySelector('iframe').classList.contains('css-fs')`, 3000), 'la madre no agrandó el iframe');
        await dormir(400);
        await p.reproducir();
        await esperarTarjeta();
        const m = await p.a(`(() => {
          const r = D.querySelector('.iv-fin').getBoundingClientRect(), ir = D.querySelector('.iv-fin-ir').getBoundingClientRect();
          const h = D.elementFromPoint(ir.left + ir.width / 2, ir.top + ir.height / 2);
          return { dentro: r.top >= 0 && r.left >= 0 && r.bottom <= W.innerHeight && r.right <= W.innerWidth, tocable: !!h && !!h.closest('.iv-fin-ir'), alto: W.innerHeight };
        })()`);
        assert.ok(m.dentro && m.tocable, `la tarjeta tiene que verse entera y tocarse en la pantalla completa: ${JSON.stringify(m)}`);
        assert.equal((await tarjeta()).foco, 'Siguiente lección →');
        // Espías: se anota en el localStorage del sitio (lo lee la página de destino).
        await p.ev(`(() => {
          localStorage.removeItem('ivp-fs'); const anotar = (que) => localStorage.setItem('ivp-fs', (localStorage.getItem('ivp-fs') || '') + que + ';');
          const W = document.querySelector('iframe').contentWindow;
          for (const [d, quien] of [[document, 'arriba'], [W.document, 'marco']]) {
            const orig = d.exitFullscreen && d.exitFullscreen.bind(d);
            d.exitFullscreen = () => { anotar('exit-' + quien); return orig ? orig() : Promise.resolve(); };
          }
          addEventListener('message', (e) => { if (e.data && e.data.type === 'ivplayer-fullscreen' && e.data.action === 'exit') anotar('msg-exit'); });
          return true;
        })()`);
        await p.clic('.iv-fin-ir');
        await esperarDestino(LECCION_SIGUIENTE.ruta);
        const salidas = await p.cdp.ev(`localStorage.getItem('ivp-fs')`);
        if (cual === 'nativa') assert.match(salidas || '', /exit-(arriba|marco)/, `antes de navegar tenía que salir de la pantalla completa: ${salidas}`);
        else assert.match(salidas || '', /msg-exit/, `antes de navegar tenía que pedirle a la madre que salga de la pantalla completa: ${salidas}`);
      }, { timeout: 60000 });
    }

    paso(entorno, 'en pantalla completa, "Volver a ver" sigue en pantalla completa y arranca desde 0', async () => {
      await p.abrir({ pagina: 'marco.html', query: { motor: 'hls', lnav: 'siguiente', nofs: '1' }, progreso: { completed: TODAS, currentTime: dur - 4 }, esperarEn: dur - 4 });
      await p.clic('.iv-fs-btn');
      await p.debe(`A.estado().botonFS === 'Salir de pantalla completa'`, 5000, 'no entró a la pantalla completa');
      await dormir(400);
      await p.reproducir();
      await esperarTarjeta();
      await p.clic('.iv-fin-ver');
      await p.debe(`!D.querySelector('.iv-fin') && A.comp() < 3 && !A.video().paused`, 8000, '"Volver a ver" no arrancó desde el principio');
      assert.equal((await p.estado()).botonFS, 'Salir de pantalla completa');
      assert.ok(await p.esperarArriba(`document.querySelector('iframe').classList.contains('css-fs')`, 1000), 'se salió de la pantalla completa');
    }, { timeout: 60000 });

    // El reproductor bajo: el iframe del campus con el celular parado (375 × 211, y 320 ×
    // 180 en los chicos). La tarjeta entra entera, sin scroll, con los botones tocables.
    for (const ancho of [320, 375]) {
      paso(entorno, `a ${ancho} px de ancho (el campus en un celular parado) la tarjeta entra entera y se toca`, async () => {
        await p.vista({ ancho: 420, alto: 740, movil: true, escala: 2, tactil: true });
        try {
          await p.abrir({ pagina: 'marco.html', query: { motor: 'hls', lnav: 'siguiente', completar: '1', ancho: `${ancho}px` }, progreso: { completed: TODAS, currentTime: dur - 3 }, esperarEn: dur - 3 });
          await p.toque('.iv-big-play');
          await esperarTarjeta();
          await p.a('D.fonts.ready.then(() => true)');
          await dormir(400);
          const m = await p.a(`(() => {
            const c = D.querySelector('.iv-container').getBoundingClientRect(), t = D.querySelector('.iv-fin'), r = t.getBoundingClientRect();
            const bs = [...t.querySelectorAll('button')].map((b) => { const x = b.getBoundingClientRect(); const h = D.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return { txt: b.textContent.trim() || b.getAttribute('aria-label'), alto: Math.round(x.height), dentro: x.top >= r.top - 0.5 && x.bottom <= r.bottom + 0.5 && x.left >= r.left - 0.5 && x.right <= r.right + 0.5, tocable: !!h && b.contains(h) }; });
            return { contenedor: [Math.round(c.width), Math.round(c.height)], tarjeta: [r.top - c.top, c.bottom - r.bottom], scroll: t.scrollHeight - t.clientHeight, bs };
          })()`);
          assert.ok(m.tarjeta[0] >= 0 && m.tarjeta[1] >= 0, `la tarjeta se sale del reproductor: ${JSON.stringify(m)}`);
          assert.ok(m.scroll <= 1, `la tarjeta necesita scroll: ${JSON.stringify(m)}`);
          for (const b of m.bs) {
            assert.ok(b.dentro && b.tocable, `el botón "${b.txt}" no entra o no se puede tocar: ${JSON.stringify(m)}`);
            if (b.txt !== 'Cerrar') assert.ok(b.alto >= 32, `el botón "${b.txt}" es muy bajo para el dedo: ${JSON.stringify(m)}`);
          }
          await p.toque('.iv-fin-ir');
          await esperarDestino(LECCION_SIGUIENTE.ruta);
        } finally {
          await p.vista();
        }
      }, { timeout: 60000 });
    }

    // Transmitiendo: el video está en la TV, pero el final se ve en el celular. Con el
    // emisor de Chrome (sin barra: el reproductor solo) y como en hub-app (con la barra).
    for (const modo of ['web', 'app']) {
      paso(entorno, `transmitiendo (${modo === 'web' ? 'Chromecast simulado' : 'hub-app por el puente'}): cuando la TV termina, la tarjeta aparece en el celular y "Volver a ver" arranca la TV desde 0`, async () => {
        const query = { motor: 'hls', lat: '120', ...(modo === 'app' ? { lnav: 'siguiente', completar: '1' } : {}) };
        await abrirConTV(p, modo, { query, progreso: { completed: TODAS, currentTime: dur - 7 }, esperarEn: dur - 7 });
        await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
        await p.clic('.iv-tv-btn');
        await p.debe(`/^Reproduciendo en/.test(A.estado().capa || '') && window.__tv.receptor.estado === 'PLAYING'`, 10000, 'no se conectó');
        await p.debe(`window.__tv.receptor.idleReason === 'FINISHED'`, 15000, 'la TV no llegó al final');
        await esperarTarjeta(5000);
        const f = await tarjeta();
        if (modo === 'app') {
          assert.equal(f.titulo, 'Lección completada');
          assert.deepEqual(f.botones, ['Siguiente lección →', 'Volver a ver']);
        } else {
          assert.equal(f.titulo, 'Terminaste el video');
          assert.deepEqual(f.botones, ['Volver a ver']);
        }
        let e = await p.estado();
        assert.equal(e.botonTV, 'Dejar de transmitir', 'sigue transmitiendo');
        assert.ok(cerca(e.comp, dur, 0.6), `la barra en el final: ${JSON.stringify(e)}`);
        // Sin recargar sola: la TV queda terminada hasta que el alumno elige.
        await dormir(1500);
        const cargas = (await p.a('window.__tv.log')).filter((x) => x.ev === 'CMD LOAD').length;
        assert.equal(cargas, 1, 'la TV volvió a cargar el video sola');
        await p.clic('.iv-fin-ver');
        await p.debe(`!D.querySelector('.iv-fin') && window.__tv.receptor.estado === 'PLAYING' && window.__tv.receptor.tiempo() < 4`, 10000, '"Volver a ver" no arrancó la TV desde el principio');
        const carga = (await p.a('window.__tv.log')).filter((x) => x.ev === 'CMD LOAD').pop();
        assert.ok(carga && carga.t < 0.5 && carga.autoplay === true, `la recarga de la TV: ${JSON.stringify(carga)}`);
        await p.debe(`A.comp() < 5 && A.comp() > 0.3`, 8000, 'el reloj del celular no siguió a la TV');
        e = await p.estado();
        assert.equal(e.tarjeta, null);
        assert.equal(e.boton, 'Pausar');
      }, { timeout: 60000 });
    }
  });
}
