// Red de seguridad (plan de migración a Bunny, tramo 0.4): si el CDN de Bunny falla, la
// lección se recarga con Vimeo y retoma desde el avance guardado. Todo en /marco.html (como
// view.php: la recarga es sólo del iframe) contra el servidor de pruebas, que hace de CDN
// con fallas (404 del playlist, 503 de los segmentos, el CDN caído), de progress.php y de
// respaldo.php, y sirve el "Vimeo de mentira" en la recarga con ?origen=vimeo (el mismo
// video sin firma: lo que se prueba es la recarga y el retomar, no el SDK de Vimeo).
// Qué salta y qué no, sin navegador: tests/unit/respaldo.test.mjs. Lo de player.php y
// respaldo.php (la regla del ajuste y el ID de Vimeo, las causas aceptadas): correr.php.
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { dormir } from '../apoyo/chrome.mjs';

// La carga de respaldo ya lista para probar.
const LISTO_VIMEO = `W.__ivpOrigen === 'vimeo' && A.listo()`;

export function registrar(entorno) {
  const p = entorno.pagina;
  const srv = entorno.srv;
  const cdp = entorno.cdp;
  const R = () => srv.respaldo;
  const F = () => srv.firma;
  const AVANCE = { completed: ['n8'], currentTime: 12 };
  // Lo que cambió en el servidor desde `antes` (ver foto()).
  const foto = () => ({ pedidos: R().pedidos.length, progresos: R().progresos.length, vimeo: R().cargasVimeo, ...srv.cargas });
  const desde = (antes) => ({
    pedidos: R().pedidos.slice(antes.pedidos),
    progresos: R().progresos.slice(antes.progresos),
    vimeo: R().cargasVimeo - antes.vimeo,
    marco: srv.cargas.marco - antes.marco,
    reproductor: srv.cargas.reproductor - antes.reproductor,
  });
  // Bunny firmado (vida larga: que no se mezcle la renovación) con la red prendida.
  const query = (extra = {}) => ({ motor: 'hls', firma: 600, respaldo: '1', ...extra });
  const venceUltima = () => F().inicial.get(String(F().paginas)).expires;
  const esperarVencimiento = async (vence) => { while (Date.now() / 1000 <= vence + 0.5) await dormir(100); };

  // Como p.abrir, pero sin exigir que el reproductor quede listo ni sin cartel: para los
  // casos que terminan en el cartel. Devuelve el texto del cartel.
  async function abrirHastaElCartel(q, { progreso = AVANCE, tope = 45000 } = {}) {
    p.marco = true;
    await cdp.cmd('Page.navigate', { url: `${srv.base}/vacio.html` });
    for (let i = 0; i < 100 && !(await cdp.ev(`location.pathname === '/vacio.html' && document.readyState === 'complete'`).catch(() => false)); i++) await dormir(50);
    await cdp.cmd('Storage.clearDataForOrigin', { origin: srv.base, storageTypes: 'local_storage' });
    const u = new URLSearchParams(q);
    if (progreso) u.set('progreso', JSON.stringify({ updatedAt: Date.now(), ...progreso }));
    await cdp.cmd('Page.navigate', { url: `${srv.base}/marco.html?${u}` });
    return p.debe('A.estado().error', tope, 'no apareció el cartel');
  }

  // Lo que tiene que valer después de un salto: un solo aviso a respaldo.php con esa
  // causa, una sola carga de Vimeo, sólo el iframe recargado (con origen=vimeo), sin
  // cartel, y retomado en el avance que quedó guardado (que nunca fue para atrás).
  async function comprobarSalto(antes, { causa, codigo, detalle, desdeT }) {
    const d = desde(antes);
    assert.equal(d.pedidos.length, 1, `un aviso a respaldo.php: ${JSON.stringify(d.pedidos)}`);
    const [ped] = d.pedidos;
    assert.deepEqual({ causa: ped.causa, codigo: ped.codigo }, { causa, codigo }, `causa del salto: ${JSON.stringify(ped)}`);
    if (detalle) assert.equal(ped.detalle, detalle);
    assert.equal(ped.sesskey, 'sk-prueba');
    assert.equal(d.vimeo, 1, 'una carga con Vimeo');
    assert.equal(d.marco, 1, 'la página de arriba (la lección) no se recarga: sólo el iframe');
    assert.equal(d.reproductor, 2, 'el iframe: la carga de Bunny y la de Vimeo');
    assert.equal(await p.a(`new URL(W.location.href).searchParams.get('origen')`), 'vimeo', 'la recarga lleva origen=vimeo');
    assert.equal((await p.estado()).error, null, 'con el respaldo no aparece el cartel');
    // 🔴 Nunca se guardó un avance más atrás que donde estaba (el 404 llega antes de que
    // se restaure el avance: guardar ahí pisaba el del alumno con el 0).
    for (const g of d.progresos) {
      assert.ok(g.data && g.data.currentTime >= desdeT - 0.3, `se guardó un avance para atrás: ${JSON.stringify(g)}`);
      assert.ok(g.data.completed.includes('n8'), `se guardó un avance sin las respondidas: ${JSON.stringify(g)}`);
    }
    const guardado = R().avance;
    assert.ok(guardado && guardado.currentTime >= desdeT - 0.3, `avance guardado: ${JSON.stringify(guardado)}`);
    await p.debe(`Math.abs(A.comp() - ${guardado.currentTime}) < 0.6`, 10000, `la carga con Vimeo no retomó en ${guardado.currentTime}`);
    return { ped, guardado };
  }

  describe('red de seguridad: Vimeo si el CDN de Bunny falla', () => {
    paso(entorno, '404 del playlist: recarga con Vimeo y retoma donde iba (sin pisar el avance con el 0 del arranque)', async () => {
      const antes = foto();
      await p.abrir({ pagina: 'marco.html', query: query({ falla: 'playlist-404' }), progreso: AVANCE, listo: LISTO_VIMEO, esperarEn: 12 });
      await comprobarSalto(antes, { causa: 'http-404', codigo: 404, detalle: 'manifestLoadError', desdeT: 12 });
    }, { timeout: 90000 });

    // HLS nativo (el camino de iPhone y Safari; acá, el de Chrome): el <video> no da el
    // código HTTP, así que antes del error nativePlayer le pregunta al CDN por la misma
    // fuente (src/sondeo.js). Sin eso la causa era 'medio' sin código y un 403 saltaba.
    const skipNativo = entorno.sinNativo || false;
    paso(entorno, 'HLS nativo · 404 del playlist: le pregunta al CDN, salta con la misma causa que hls.js y retoma', async () => {
      const antes = foto();
      await p.abrir({ pagina: 'marco.html', query: query({ motor: 'nativo', falla: 'playlist-404' }), progreso: AVANCE, listo: LISTO_VIMEO, esperarEn: 12 });
      await comprobarSalto(antes, { causa: 'http-404', codigo: 404, detalle: 'nativo-playlist', desdeT: 12 });
    }, { skip: skipNativo, timeout: 90000 });

    paso(entorno, 'HLS nativo · 403 de los segmentos con la firma vigente: NO salta (como hls.js) y el cartel es el del acceso', async () => {
      const antes = foto();
      const r0 = F().rechazos.length;
      R().fallaSegmentos = 403;
      let error;
      try {
        error = await abrirHastaElCartel(query({ motor: 'nativo' }));
      } finally {
        R().fallaSegmentos = null;
      }
      assert.match(error, /El acceso al video venció/, `cartel: ${error}`);
      assert.ok(F().rechazos.slice(r0).some((r) => r.motivo === 'falla 403' && /\.ts$/i.test(r.resto)), 'la prueba tenía que pasar por un 403 de un segmento');
      await dormir(1000);
      const d = desde(antes);
      assert.deepEqual([d.pedidos.length, d.vimeo, d.reproductor], [0, 0, 1], `no tenía que saltar: ${JSON.stringify(d)}`);
    }, { skip: skipNativo, timeout: 90000 });

    paso(entorno, 'el CDN caído (no contesta): recarga con Vimeo después de los reintentos', async () => {
      const antes = foto();
      const t0 = Date.now();
      await p.abrir({ pagina: 'marco.html', query: query({ falla: 'red' }), progreso: AVANCE, listo: LISTO_VIMEO, esperarEn: 12, tope: 60000 });
      const { ped } = await comprobarSalto(antes, { causa: 'red', codigo: 0, desdeT: 12 });
      assert.match(ped.detalle, /^manifestLoad/, `detalle: ${ped.detalle}`);
      // Los reintentos de nativePlayer (2, 4 y 8 s) van antes del salto: no al primer fallo.
      assert.ok(Date.now() - t0 > 12000, `saltó sin reintentar (${Date.now() - t0} ms)`);
    }, { timeout: 120000 });

    // 🔴 Tarda ~140 s y es lo que tarda hoy el cartel (medido oct-2026, video de 2 s por
    // segmento y 3 calidades): hls.js reintenta el segmento 6 veces (1, 2, 4, 8, 8 y 8 s),
    // prueba las otras calidades, y nativePlayer repite eso 3 veces más (2, 4 y 8 s antes de
    // cada una). La red salta recién después de todo eso, como pide el plan.
    paso(entorno, '503 en los segmentos a mitad de la clase: recarga con Vimeo y sigue desde donde se trabó', async () => {
      const antes = foto();
      await p.abrir({ pagina: 'marco.html', query: query(), progreso: AVANCE, esperarEn: 12 });
      R().fallaSegmentos = 503;
      try {
        await p.reproducir();
        await p.debe(`A.comp() > 12.5`, 10000, 'no arrancó a reproducir');
        await p.debe(LISTO_VIMEO, 270000, 'no recargó con Vimeo');
      } finally {
        R().fallaSegmentos = null;
      }
      const { ped, guardado } = await comprobarSalto(antes, { causa: 'http-503', codigo: 503, desdeT: 12 });
      assert.ok(guardado.currentTime > 12.5, `el avance guardado es el de donde se trabó, no el del arranque: ${guardado.currentTime}`);
      assert.match(ped.detalle, /^(fragLoad|levelLoad)/, `detalle: ${ped.detalle}`);
      assert.ok(guardado.currentTime < 25, `el avance no pasa la pregunta de los 25: ${guardado.currentTime}`);
    }, { timeout: 330000 });

    paso(entorno, 'la sesión cerrada (firma.php contesta 401): NO salta y el cartel es el de la sesión', async () => {
      const antes = foto();
      await p.abrir({ pagina: 'marco.html', query: query({ firma: 6, renovar: 'falla' }), progreso: AVANCE, esperarEn: 12 });
      await esperarVencimiento(venceUltima());
      await p.reproducir();
      const error = await p.debe('A.estado().error', 30000, 'no apareció el cartel');
      assert.match(error, /sesión del campus/, `cartel: ${error}`);
      await dormir(1000);
      const d = desde(antes);
      assert.deepEqual([d.pedidos.length, d.vimeo, d.reproductor], [0, 0, 1], `no tenía que saltar: ${JSON.stringify(d)}`);
    }, { timeout: 90000 });

    paso(entorno, 'la firma vencida (403) que se renueva sola: sigue con Bunny, sin saltar ni cartel', async () => {
      const antes = foto();
      // firma.php sin red hasta que un pedido de video vuelva con 403: ahí renueva.
      await p.abrir({ pagina: 'marco.html', query: query({ firma: 6, renovar: 'falla-hasta-403', renovada: 600 }), progreso: AVANCE, esperarEn: 12 });
      await esperarVencimiento(venceUltima());
      await p.reproducir();
      await p.debe(`A.comp() > 15`, 30000, 'no siguió reproduciendo después de renovar la firma');
      const d = desde(antes);
      assert.ok(F().rechazos.some((r) => r.motivo === 'vencida'), 'la prueba tenía que pasar por un 403 de firma vencida');
      assert.deepEqual([d.pedidos.length, d.vimeo, d.reproductor], [0, 0, 1], `no tenía que saltar: ${JSON.stringify(d)}`);
      assert.equal((await p.estado()).error, null);
    }, { timeout: 90000 });

    paso(entorno, 'la firma vencida sin permiso para renovarla (403): NO salta', async () => {
      const antes = foto();
      await p.abrir({ pagina: 'marco.html', query: query({ firma: 6, renovar: 'permiso' }), progreso: AVANCE, esperarEn: 12 });
      await esperarVencimiento(venceUltima());
      await p.reproducir();
      const error = await p.debe('A.estado().error', 30000, 'no apareció el cartel');
      assert.match(error, /El acceso al video venció/, `cartel: ${error}`);
      await dormir(1000);
      const d = desde(antes);
      assert.deepEqual([d.pedidos.length, d.vimeo, d.reproductor], [0, 0, 1], `no tenía que saltar: ${JSON.stringify(d)}`);
    }, { timeout: 90000 });

    paso(entorno, 'con el ajuste apagado (sin respaldoUrl): NO salta, el cartel de siempre', async () => {
      const antes = foto();
      const { respaldo, ...sinRed } = query({ falla: 'playlist-404' });
      const error = await abrirHastaElCartel(sinRed);
      assert.match(error, /El video no está disponible/, `cartel: ${error}`);
      await dormir(1000);
      const d = desde(antes);
      assert.deepEqual([d.pedidos.length, d.vimeo, d.reproductor], [0, 0, 1], `no tenía que saltar: ${JSON.stringify(d)}`);
    });

    paso(entorno, 'la actividad sin ID de Vimeo (respaldo.php no lo deja): NO salta, el cartel de siempre', async () => {
      // player.php ni siquiera ofrece la red en ese caso (correr.php); esto es el reproductor
      // ante el "no" de respaldo.php: una página vieja, o le sacaron el Vimeo con la lección abierta.
      const antes = foto();
      const error = await abrirHastaElCartel(query({ falla: 'playlist-404', respaldoModo: 'sinvimeo' }));
      assert.match(error, /El video no está disponible/, `cartel: ${error}`);
      await dormir(1000);
      const d = desde(antes);
      assert.equal(d.pedidos.length, 1, 'le pregunta a respaldo.php');
      assert.deepEqual([d.vimeo, d.reproductor], [0, 1], `no tenía que recargar: ${JSON.stringify(d)}`);
    });

    paso(entorno, 'la sesión cerrada al momento de saltar (respaldo.php 401): NO salta y el cartel es el de la sesión', async () => {
      const antes = foto();
      const error = await abrirHastaElCartel(query({ falla: 'playlist-404', respaldoModo: 'sesion' }));
      assert.match(error, /sesión del campus/, `con la sesión cerrada, el cartel de la sesión ("Reintentar" recarga la página entera): ${error}`);
      await dormir(1000);
      const d = desde(antes);
      assert.equal(d.pedidos.length, 1);
      assert.deepEqual([d.vimeo, d.reproductor], [0, 1], `no tenía que recargar: ${JSON.stringify(d)}`);
    });

    paso(entorno, 'transmitiendo a la TV (AirPlay): NO salta', async () => {
      const antes = foto();
      await p.abrir({ pagina: 'marco.html', query: query({ airplay: '1' }), progreso: AVANCE, esperarEn: 12 });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 6000, 'no apareció el botón de AirPlay');
      await p.clic('.iv-tv-btn');
      await dormir(300);
      await p.a('(W.__airplay.conectar(), true)');
      await p.debe(`A.estado().capa === 'Reproduciendo en la TV'`, 3000, 'no se conectó AirPlay');
      R().fallaSegmentos = 404;
      try {
        await p.reproducir();
        const error = await p.debe('A.estado().error', 60000, 'no apareció el cartel');
        assert.match(error, /El video no está disponible/, `cartel: ${error}`);
      } finally {
        R().fallaSegmentos = null;
      }
      await dormir(1000);
      const d = desde(antes);
      assert.deepEqual([d.pedidos.length, d.vimeo, d.reproductor], [0, 0, 1], `transmitiendo no tenía que saltar: ${JSON.stringify(d)}`);
    }, { timeout: 90000 });
  });
}
