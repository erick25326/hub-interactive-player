// "Reintentar" cuando no se pudo renovar la firma de Bunny (plan de migración a Bunny,
// 0.3). Con la sesión del campus cerrada recarga la página de ARRIBA (la lección,
// view.php): así el ingreso de Moodle aparece en la página entera, donde hub-app hace su
// ingreso automático, y no adentro del cuadro del video. Con cualquier otro motivo, o si
// la de arriba es de otro origen (una demo, un SCORM), sólo el iframe, como siempre.
// Qué se recargó se ve de dos lados: el servidor cuenta cuántas veces sirvió cada página,
// y antes de tocar el botón se deja una marca en cada documento (la que se recarga, la
// pierde). La decisión en sí (sin navegador) está en tests/unit/firma.test.mjs.
import { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { dormir } from '../apoyo/chrome.mjs';
import { crearMarcoAjeno } from '../apoyo/servidor.mjs';

export function registrar(entorno) {
  const p = entorno.pagina;
  const srv = entorno.srv;
  const cdp = entorno.cdp;
  const F = () => srv.firma;
  // El vencimiento de la firma con que arrancó la última página del reproductor.
  const venceUltima = () => F().inicial.get(String(F().paginas)).expires;
  const esperarVencimiento = async (vence) => { while (Date.now() / 1000 <= vence + 0.5) await dormir(100); };
  const AVANCE = { completed: ['n8'], currentTime: 12 };
  // Firmas de 6 s: la renovación programada (a los 3 s) falla según `renovar`, la firma
  // vence en pausa y, al reproducir, el primer pedido de video da 403 y sale el cartel.
  const query = (renovar) => ({ motor: 'hls', firma: 6, renovar });

  describe('"Reintentar" cuando no se pudo renovar la firma', () => {
    // En /marco.html (como view.php: la de arriba es del mismo origen).
    const hastaElCartel = async (renovar) => {
      await p.abrir({ pagina: 'marco.html', query: query(renovar), progreso: AVANCE, esperarEn: 12 });
      await esperarVencimiento(venceUltima());
      await p.reproducir();
      return p.debe(`A.estado().error`, 30000, 'no apareció el cartel después de que venció la firma');
    };
    const marcar = async () => {
      await p.ev('(window.__marcaArriba = 1, true)');
      assert.ok(await p.a('(W.__marcaMarco = 1, true)'), 'no se pudo marcar el iframe');
      return { ...srv.cargas };
    };

    paso(entorno, 'sesión cerrada: recarga la página de ARRIBA (la lección), no sólo el iframe', async () => {
      const error = await hastaElCartel('falla');
      assert.match(error, /sesión del campus/, `el cartel tenía que decir que se cerró la sesión: ${error}`);
      const antes = await marcar();
      await p.clic('.iv-error button', { texto: 'Reintentar' });
      assert.ok(await p.esperarArriba(`window.__marcaArriba === undefined && document.readyState === 'complete'`, 15000),
        'la página de arriba no se recargó (con la sesión cerrada, recargar sólo el iframe muestra el ingreso de Moodle adentro del video)');
      await p.debe('A.listo()', 30000, 'el reproductor no volvió a cargar después de recargar la página');
      assert.equal(srv.cargas.marco - antes.marco, 1, 'la página de arriba se tenía que pedir otra vez, una');
      assert.equal(srv.cargas.reproductor - antes.reproductor, 1, 'el iframe vuelve con la página de arriba, una vez');
      assert.equal((await p.estado()).error, null, 'volvió con el cartel');
    }, { timeout: 90000 });

    paso(entorno, 'otro motivo (sin permiso): recarga sólo el iframe, como siempre', async () => {
      const error = await hastaElCartel('permiso');
      assert.match(error, /El acceso al video venció/, `cartel: ${error}`);
      const antes = await marcar();
      await p.clic('.iv-error button', { texto: 'Reintentar' });
      await p.debe(`!W.__marcaMarco && A.listo()`, 30000, 'el iframe no se recargó');
      await dormir(500);
      assert.equal(await p.ev('window.__marcaArriba'), 1, 'se recargó la página de arriba');
      assert.equal(srv.cargas.marco - antes.marco, 0, 'se pidió otra vez la página de arriba');
      assert.equal(srv.cargas.reproductor - antes.reproductor, 1, 'el iframe se tenía que pedir otra vez, una');
    }, { timeout: 90000 });

    // La de arriba de OTRO origen (otro puerto). Desde la pestaña tampoco se puede entrar
    // al iframe con el ayudante (W.__ivp): se lo lee por CDP, en un mundo aislado del
    // iframe (comparte el DOM, no las variables), y se le hace clic por coordenadas.
    describe('con la página de arriba de otro origen', () => {
      let ajeno = null;
      let mundo = null;
      before(async () => { ajeno = await crearMarcoAjeno({ baseReproductor: srv.base }); });
      after(async () => { if (ajeno) await ajeno.cerrar(); });

      const crearMundo = async () => {
        const { frameTree } = await cdp.cmd('Page.getFrameTree');
        const hijo = frameTree.childFrames && frameTree.childFrames[0];
        if (!hijo) return null;
        return (await cdp.cmd('Page.createIsolatedWorld', { frameId: hijo.frame.id, worldName: 'pruebas-reintentar' })).executionContextId;
      };
      // Evalúa en el iframe. Si se recargó, su mundo aislado ya no existe: se arma otro.
      const enIframe = async (expr) => {
        for (let i = 0; i < 2; i++) {
          try {
            if (mundo == null) mundo = await crearMundo();
            if (mundo == null) return null;
            const r = await cdp.cmd('Runtime.evaluate', { expression: `(() => { try { return (${expr}); } catch (e) { return null; } })()`, contextId: mundo, returnByValue: true }, 5000);
            return r.result ? (r.result.value ?? null) : null;
          } catch (e) { mundo = null; }
        }
        return null;
      };
      const debeEnIframe = async (expr, tope, que) => {
        const fin = Date.now() + tope;
        for (;;) {
          const v = await enIframe(expr);
          if (v) return v;
          if (Date.now() > fin) throw new Error(`${que} (esperé ${tope} ms)`);
          await dormir(100);
        }
      };
      const clicEnIframe = async (sel) => {
        const marco = await cdp.ev(`(() => { const b = document.querySelector('iframe').getBoundingClientRect(); return { x: b.left, y: b.top }; })()`);
        const c = await debeEnIframe(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; })()`, 10000, `no apareció ${sel} en el iframe`);
        const x = marco.x + c.x, y = marco.y + c.y;
        await cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await dormir(120);
        await cdp.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      };
      const listoEnIframe = `(() => { const v = document.querySelector('.iv-vimeo-wrap video'); return !!(document.querySelector('.iv-controls-row') && !document.querySelector('.iv-loading') && v && v.readyState >= 1); })()`;

      paso(entorno, 'sesión cerrada: recarga el iframe, como siempre (la de arriba no se puede tocar)', async () => {
        // Como abrir(), pero la de arriba es la página ajena.
        p.marco = false;
        await cdp.cmd('Page.navigate', { url: `${srv.base}/vacio.html` });
        for (let i = 0; i < 100 && !(await cdp.ev(`location.pathname === '/vacio.html' && document.readyState === 'complete'`).catch(() => false)); i++) await dormir(50);
        await cdp.cmd('Storage.clearDataForOrigin', { origin: srv.base, storageTypes: 'local_storage' });
        const q = new URLSearchParams({ ...query('falla'), progreso: JSON.stringify({ updatedAt: Date.now(), ...AVANCE }) });
        mundo = null;
        await cdp.cmd('Page.navigate', { url: `${ajeno.base}/marco-ajeno.html?${q}` });
        await debeEnIframe(`${listoEnIframe} && (() => { const v = document.querySelector('.iv-vimeo-wrap video'); return Math.abs(v.currentTime - 12) < 1 && !v.seeking && v.readyState >= 2; })()`,
          30000, 'el reproductor no quedó listo en el 12 adentro de la página ajena');
        assert.equal(await cdp.ev(`(() => { try { void document.querySelector('iframe').contentWindow.document; return false; } catch (e) { return true; } })()`), true,
          'la página de arriba tenía que ser de otro origen');
        await esperarVencimiento(venceUltima());
        await clicEnIframe('.iv-big-play');
        const error = await debeEnIframe(`document.querySelector('.iv-error')?.textContent`, 30000, 'no apareció el cartel después de que venció la firma');
        assert.match(error, /sesión del campus/, `cartel: ${error}`);

        await cdp.ev('(window.__marcaArriba = 1, true)');
        assert.ok(await enIframe(`(document.documentElement.dataset.marca = '1', true)`), 'no se pudo marcar el iframe');
        const antes = { ...srv.cargas }, antesAjeno = ajeno.cargas.marco;
        await clicEnIframe('.iv-error button');
        await debeEnIframe(`!document.documentElement.dataset.marca && ${listoEnIframe}`, 30000, 'el iframe no se recargó');
        await dormir(500);
        assert.equal(await cdp.ev('window.__marcaArriba'), 1, 'se recargó la página de arriba');
        assert.equal(ajeno.cargas.marco - antesAjeno, 0, 'se pidió otra vez la página de arriba');
        assert.equal(srv.cargas.reproductor - antes.reproductor, 1, 'el iframe se tenía que pedir otra vez, una');
        assert.equal(await enIframe(`!!document.querySelector('.iv-error')`), false, 'volvió con el cartel');
      }, { timeout: 90000 });
    });
  });
}
