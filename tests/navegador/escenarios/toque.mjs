// El TOQUE DE FIN DE LECCIÓN y la DUDA (1.5.0, mockup aprobado por Erick el 15-nov-2026):
// en la tarjeta de fin, arriba de "Siguiente lección", "¿Cómo te resultó esta lección?" con
// cinco opciones en dos grupos (hasta una de cada uno) y "Dejar una duda o comentario", un
// campo en la misma tarjeta. Sólo en el campus: pulso=1 hace que la página de mentira mande
// pulsoUrl y comentarioUrl en MOODLE_CONTEXT, como player.php. Lo puro (los textos, qué
// cambia al tocar) está en tests/unit/fin-video.test.mjs; el servidor, en correr.php. Acá, el
// componente de verdad: lo que llega a pulso.php y comentario.php de mentira, el foco,
// Escape, y que en el celular parado la página agranda el reproductor (opción A).
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { dormir } from '../apoyo/chrome.mjs';

const TODAS = ['n8', 'tf25', 'tf60'];
const OPCIONES = ['La seguí bien', 'Me costó un poco', 'Me perdí', 'Sentí que no me aportó mucho', 'Sentí que no me aportó nada'];
const LEER = `(() => {
  const c = D.querySelector('.iv-fin');
  if (!c) return null;
  const tx = (e) => e ? e.textContent.replace(/\\s+/g, ' ').trim() : null;
  const pulso = c.querySelector('.iv-fin-pulso'), botones = c.querySelector('.iv-fin-botones');
  return {
    pregunta: tx(c.querySelector('.iv-fin-pregunta')),
    opciones: [...c.querySelectorAll('.iv-fin-op')].map((b) => [tx(b), b.getAttribute('aria-checked')]),
    antesDeLosBotones: !!(pulso && botones && (pulso.compareDocumentPosition(botones) & Node.DOCUMENT_POSITION_FOLLOWING)),
    enlace: tx(c.querySelector('.iv-fin-comentar')), enviado: tx(c.querySelector('.iv-fin-enviado')),
    gracias: tx(c.querySelector('.iv-fin-gracias')), escribiendo: !!c.querySelector('.iv-fin-comentario textarea'),
    texto: (c.querySelector('.iv-fin-comentario textarea') || {}).value ?? null,
    foco: D.activeElement && c.contains(D.activeElement) ? (D.activeElement.tagName === 'TEXTAREA' ? 'campo' : tx(D.activeElement)) : null,
    botones: [...c.querySelectorAll('.iv-fin-botones button')].map(tx),
  };
})()`;
const marcadas = (t) => t.opciones.filter(([, m]) => m === 'true').map(([x]) => x);

export function registrar(entorno) {
  const p = entorno.pagina;
  const srv = entorno.srv;
  const dur = entorno.video.duracion;
  const tarjeta = () => p.a(LEER);
  // Abre la lección en la página de mentira (con la barra del tema), a 4 s del final y con
  // todo respondido, y la reproduce hasta la tarjeta.
  async function hastaLaTarjeta(query = {}) {
    await p.abrir({ pagina: 'marco.html', query: { motor: 'hls', lnav: 'siguiente', completar: '1', pulso: '1', ...query }, progreso: { completed: TODAS, currentTime: dur - 4 }, esperarEn: dur - 4 });
    await p.reproducir();
    await p.debe(`!!D.querySelector('.iv-fin')`, 15000, 'no apareció la tarjeta de fin');
    return tarjeta();
  }
  const ultimo = (lista) => lista[lista.length - 1] || null;
  async function esperarPulso(n0, dificultad, utilidad) {
    for (let i = 0; i < 60; i++) {
      const u = srv.fin.pulsos.length > n0 ? ultimo(srv.fin.pulsos) : null;
      if (u && u.dificultad === dificultad && u.utilidad === utilidad) return u;
      await dormir(100);
    }
    throw new Error(`pulso.php no recibió ${dificultad || '—'} / ${utilidad || '—'}: ${JSON.stringify(srv.fin.pulsos.slice(n0))}`);
  }
  const iframeAlto = () => p.esperarArriba(`Math.round(document.querySelector('iframe').getBoundingClientRect().height)`);

  describe('el toque de fin de lección y la duda (1.5.0)', () => {
    paso(entorno, 'la pregunta va arriba de "Siguiente lección", con las cinco opciones; el foco sigue en "Siguiente lección"', async () => {
      const t = await hastaLaTarjeta();
      assert.equal(t.pregunta, '¿Cómo te resultó esta lección?');
      assert.deepEqual(t.opciones.map(([x]) => x), OPCIONES, 'los textos y el orden de Erick');
      assert.deepEqual(marcadas(t), [], 'nada marcado de entrada');
      assert.ok(t.antesDeLosBotones, 'la pregunta va antes de los botones');
      assert.equal(t.enlace, 'Dejar una duda o comentario');
      assert.deepEqual(t.botones, ['Siguiente lección →', 'Volver a ver']);
      await p.debe(`D.activeElement && /Siguiente lección/.test(D.activeElement.textContent)`, 3000, 'el foco tiene que seguir en "Siguiente lección"');
    });

    paso(entorno, 'hasta una de cada grupo: se guarda al tocar, tocar otra la cambia y tocar la marcada la saca', async () => {
      const n0 = srv.fin.pulsos.length;
      await hastaLaTarjeta();
      await p.clic('.iv-fin-op', { texto: 'Me costó un poco' });
      await esperarPulso(n0, 'costo', '');
      assert.equal((await tarjeta()).gracias, 'Gracias');
      await p.clic('.iv-fin-op', { texto: 'Sentí que no me aportó mucho' });
      await esperarPulso(n0, 'costo', 'poco');
      await p.clic('.iv-fin-op', { texto: 'Me perdí' });
      const u = await esperarPulso(n0, 'perdi', 'poco');
      assert.equal(u.sesskey, (await p.a('W.MOODLE_CONTEXT.sesskey')), 'con el sesskey de la sesión');
      assert.deepEqual(marcadas(await tarjeta()), ['Me perdí', 'Sentí que no me aportó mucho']);
      await p.clic('.iv-fin-op', { texto: 'Sentí que no me aportó mucho' });
      await esperarPulso(n0, 'perdi', '');
      assert.deepEqual(marcadas(await tarjeta()), ['Me perdí']);
    });

    paso(entorno, 'lo que ya había marcado aparece marcado', async () => {
      const t = await hastaLaTarjeta({ pulsoGuardado: JSON.stringify({ dificultad: 'bien', utilidad: 'nada' }) });
      assert.deepEqual(marcadas(t), ['La seguí bien', 'Sentí que no me aportó nada']);
    });

    paso(entorno, 'la duda: se escribe en la misma tarjeta, Escape vuelve sin mandar y Enviar la manda', async () => {
      const n0 = srv.fin.comentarios.length;
      await hastaLaTarjeta();
      await p.clic('.iv-fin-comentar');
      await p.debe(`!!D.querySelector('.iv-fin-comentario textarea') && D.activeElement === D.querySelector('.iv-fin-comentario textarea')`, 3000, 'no se abrió el campo con el foco');
      // Vacío no se manda.
      await p.clic('.iv-fin-comentario .iv-fin-ir', { texto: 'Enviar' });
      await dormir(400);
      assert.equal(srv.fin.comentarios.length, n0, 'un campo vacío no se manda');
      await p.cdp.cmd('Input.insertText', { text: '¿El control llega igual si se corta el video?' });
      await p.cdp.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await p.cdp.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await p.debe(`!D.querySelector('.iv-fin-comentario') && !!D.querySelector('.iv-fin')`, 3000, 'Escape tenía que volver a la tarjeta, sin cerrarla');
      await p.debe(`D.activeElement && D.activeElement.classList.contains('iv-fin-comentar')`, 3000, 'el foco vuelve al enlace');
      assert.equal(srv.fin.comentarios.length, n0, 'Escape no manda nada');
      await p.clic('.iv-fin-comentar');
      await p.debe(`(D.querySelector('.iv-fin-comentario textarea') || {}).value === '¿El control llega igual si se corta el video?'`, 3000, 'lo escrito se perdió');
      await p.clic('.iv-fin-comentario .iv-fin-ir', { texto: 'Enviar' });
      for (let i = 0; i < 50 && srv.fin.comentarios.length === n0; i++) await dormir(100);
      const c = ultimo(srv.fin.comentarios);
      assert.equal(c && c.texto, '¿El control llega igual si se corta el video?');
      const t = await tarjeta();
      assert.equal(t.enviado, 'Recibimos tu mensaje. Te respondemos por mail.');
      assert.equal(t.escribiendo, false);
      await p.debe(`D.activeElement && /Siguiente lección/.test(D.activeElement.textContent)`, 3000, 'después de enviar, el foco va a "Siguiente lección"');
    });

    paso(entorno, 'fuera del campus (sin pulsoUrl) la tarjeta es la de siempre', async () => {
      await p.abrir({ pagina: 'marco.html', query: { motor: 'hls', lnav: 'siguiente', completar: '1' }, progreso: { completed: TODAS, currentTime: dur - 4 }, esperarEn: dur - 4 });
      await p.reproducir();
      await p.debe(`!!D.querySelector('.iv-fin')`, 15000, 'no apareció la tarjeta de fin');
      const t = await tarjeta();
      assert.equal(t.pregunta, null);
      assert.equal(t.enlace, null);
      assert.ok(!(await p.esperarArriba(`document.querySelector('iframe').classList.contains('fin')`, 1500)), 'sin el toque no se pide más alto');
    });

    paso(entorno, 'celular parado: la página agranda el reproductor mientras está la tarjeta, que entra entera, y al volver a ver vuelve al 16:9', async () => {
      try {
        await p.vista({ ancho: 375, alto: 740, movil: true, escala: 2, tactil: true });
        await p.abrir({ pagina: 'marco.html', query: { motor: 'hls', lnav: 'siguiente', completar: '1', pulso: '1', ancho: '375px' }, progreso: { completed: TODAS, currentTime: dur - 4 }, esperarEn: dur - 4 });
        assert.ok((await iframeAlto()) < 230, 'antes de la tarjeta, el 16:9 de siempre');
        await p.reproducir();
        await p.debe(`!!D.querySelector('.iv-fin')`, 15000, 'no apareció la tarjeta de fin');
        assert.ok(await p.esperarArriba(`document.querySelector('iframe').getBoundingClientRect().height > 450`), 'la página no agrandó el reproductor');
        await dormir(600);   // la animación de entrada y el cambio de alto del iframe
        const m = await p.a(`(() => { const c = D.querySelector('.iv-fin'), k = D.querySelector('.iv-fin-capa'); if (!c || !k) return null;
          const r = c.getBoundingClientRect(), q = k.getBoundingClientRect(), ops = [...D.querySelectorAll('.iv-fin-op')].map((o) => Math.round(o.getBoundingClientRect().top));
          return { filas: new Set(ops).size, tarjeta: [Math.round(r.top), Math.round(r.bottom)], capa: [Math.round(q.top), Math.round(q.bottom)], scroll: c.scrollHeight - c.clientHeight }; })()`);
        assert.ok(m && m.tarjeta[0] >= m.capa[0] - 1 && m.tarjeta[1] <= m.capa[1] + 1 && m.scroll <= 1, `la tarjeta no entra entera: ${JSON.stringify(m)}`);
        assert.equal(m.filas, 5, 'una opción por renglón');
        await p.toque('.iv-fin-op', { texto: 'Me perdí' });
        await p.debe(`D.querySelector('.iv-fin-op.on') && /Me perdí/.test(D.querySelector('.iv-fin-op.on').textContent)`, 3000, 'el toque no marcó la opción');

        await p.toque('.iv-fin-ver', { texto: 'Volver a ver' });
        assert.ok(await p.esperarArriba(`document.querySelector('iframe').getBoundingClientRect().height < 230`), 'al volver a ver, el reproductor no volvió al 16:9');
      } finally {
        await p.vista();
      }
    }, { timeout: 60000 });
  });
}
