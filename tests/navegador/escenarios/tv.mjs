// Transmitir a la TV con receptores SIMULADOS (tests/navegador/simulados): no hay una
// TV de verdad en la prueba, pero sí todo el código del reproductor que le habla.
//  - Chromecast: src/cast.js reemplaza playerRef por un CastPlayer y el candado sigue
//    funcionando con los avisos de la TV (latencia de 120 ms por vía). Se prueba el
//    recorrido completo, en orden: conectar, frenar en la pregunta EN LA TV, el control
//    remoto que adelanta y la vuelta a la pendiente, y cortar la sesión y retomar en el
//    celular en el mismo segundo.
//  - AirPlay: el <video> sigue siendo el dueño; se prueba que aparezca el botón con una
//    TV a la vista y que el selector se abra dentro del toque.
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { cerca } from '../apoyo/pagina.mjs';
import { dormir } from '../apoyo/chrome.mjs';

export function registrar(entorno) {
  const p = entorno.pagina;

  describe('transmitir a la TV · Chromecast simulado (recorrido en orden)', () => {
    // Cada paso arranca donde dejó el anterior: si uno falla, los que siguen se
    // saltean diciendo por qué, en vez de fallar en cadena por la misma causa.
    let vivo = true;
    const pasoTV = (nombre, fn) => paso(entorno, nombre, async (t) => {
      if (!vivo) return t.skip('falló un paso anterior del recorrido');
      try { await fn(t); } catch (e) { vivo = false; throw e; }
    });
    const tv = () => p.a('window.__tv.receptor.foto()');
    const log = () => p.a('window.__tv.log');

    pasoTV('conectar: la TV arranca donde estaba el celular y el <video> queda en pausa', async () => {
      await p.abrir({ query: { motor: 'hls', cast: 'fake', lat: '120' }, progreso: { completed: ['n8'], currentTime: 18 }, esperarEn: 18 });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      await p.reproducir();
      await p.debe(`A.comp() > 18.8`, 10000, 'no arrancó a reproducir');
      await p.clic('.iv-tv-btn');
      await p.debe(`A.estado().capa === 'Reproduciendo en Living & Comedor' && window.__tv.receptor.estado === 'PLAYING'`, 10000, 'no se conectó');
      await dormir(1200);
      const e = await p.estado();
      const L = await log();
      const pedido = L.find((x) => x.ev === 'requestSession');
      const carga = L.find((x) => x.ev === 'CMD LOAD');
      assert.ok(pedido && pedido.activo, `requestSession tiene que salir dentro del toque (activación de usuario): ${JSON.stringify(pedido)}`);
      assert.ok(carga && /playlist\.m3u8$/.test(carga.contentId) && carga.hlsv === 'mpeg2_ts' && carga.autoplay === true, `LOAD: ${JSON.stringify(carga)}`);
      assert.ok(cerca(carga.t, e.vt, 0.3), `la TV tenía que arrancar donde quedó el <video> (${e.vt}): ${carga.t}`);
      assert.equal(e.pausado, true, 'el <video> del celular queda en pausa');
      assert.equal(e.botonTV, 'Dejar de transmitir');
      assert.equal(e.botonFS, null, 'transmitiendo no hay pantalla completa');
      assert.ok(cerca(e.comp, e.tv.t, 0.6), `el componente sigue a la TV: ${JSON.stringify({ comp: e.comp, tv: e.tv })}`);
    });

    pasoTV('la pregunta de los 25 frena la TV en su segundo, no antes', async () => {
      await p.debe(`A.tarjeta()?.id === 'tf25'`, 20000, 'no apareció la pregunta de los 25');
      await dormir(1200);
      const e = await p.estado();
      assert.equal(e.tv.estado, 'PAUSED', `la TV tenía que quedar en pausa: ${JSON.stringify(e.tv)}`);
      assert.ok(e.tv.t >= 24.98 && e.tv.t <= 25.35, `la TV tenía que frenar en 25 (nunca antes): ${JSON.stringify(e.tv)}`);
      assert.ok(e.comp >= 24.98 && e.comp <= 25.35, `el componente en 25: ${e.comp}`);
      const guardados = await p.a('A.guardados');
      assert.ok(guardados.every((g) => g.currentTime <= 25.001), `se guardó un avance más allá de la pregunta: ${JSON.stringify(guardados.slice(-3))}`);
    });

    pasoTV('el control remoto adelanta 40 s cruzando la de 60: la TV vuelve a 60 y la muestra', async () => {
      await p.responder();
      await p.debe(`A.comp() > 27.5 && window.__tv.receptor.estado === 'PLAYING'`, 10000, 'la TV no siguió después de responder');
      await p.a('(window.__tv.remoto.adelantar(40), true)');
      await p.debe(`A.tarjeta()?.id === 'tf60'`, 10000, 'después del salto remoto no apareció la de los 60');
      await dormir(1500);
      const e = await p.estado();
      assert.equal(e.tv.estado, 'PAUSED', JSON.stringify(e.tv));
      assert.ok(cerca(e.tv.t, 60, 0.35), `la TV tenía que volver a 60: ${JSON.stringify(e.tv)}`);
      assert.ok(cerca(e.comp, 60, 0.1), `el componente en 60: ${e.comp}`);
    });

    pasoTV('cortar la sesión desde afuera: el celular retoma en el mismo segundo y sigue', async () => {
      await p.responder();
      await p.debe(`A.comp() > 61.5 && window.__tv.receptor.estado === 'PLAYING'`, 10000, 'la TV no siguió después de responder');
      await dormir(800);
      // El segundo de la TV y el reloj, en el mismo instante en que se corta.
      const corte = await p.a(`(() => { const t = window.__tv.receptor.tiempo(); const ms = A.ms(); window.__tv.remoto.cortarSesion(); return { t, ms }; })()`);
      await p.debe(`!A.estado().capa`, 5000, 'el cartel de la TV no se fue');
      const vuelta = await p.estado();
      // Al volver, el componente salta (propio) al segundo de la TV, que siguió
      // corriendo mientras se cortaba (~100 ms + la latencia).
      const esperado = corte.t + (vuelta.ms - corte.ms) / 1000;
      assert.ok(vuelta.comp >= corte.t - 0.3 && vuelta.comp <= esperado + 0.5, `retomó en ${vuelta.comp}; la TV estaba en ${corte.t.toFixed(2)}: ${JSON.stringify(vuelta)}`);
      await p.debe(`!A.video().paused && A.comp() > ${corte.t + 0.8}`, 8000, 'el <video> no siguió reproduciendo');
      const e = await p.estado();
      assert.ok(e.tarjeta == null && e.botonFS === 'Pantalla completa' && e.boton === 'Pausar', JSON.stringify(e));
      assert.match(e.aviso || '', /Se dejó de transmitir/);
      const serie = (await p.a('A.serie')).filter((m) => m.ms >= vuelta.ms && m.comp != null);
      assert.ok(Math.min(...serie.map((m) => m.comp)) >= corte.t - 0.3, 'al volver al celular el tiempo fue para atrás');
    });
  });

  describe('transmitir a la TV · AirPlay simulado', () => {
    // El camino de Safari es el HLS nativo; si este Chrome no lo tiene, hls.js (en
    // Chrome no apaga AirPlay: no usa ManagedMediaSource).
    const motor = entorno.sinNativo ? 'hls' : 'nativo';
    paso(entorno, 'con una TV a la vista aparece el botón y el selector se abre dentro del toque', async () => {
      await p.abrir({ query: { motor, airplay: '1' } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 6000, 'no apareció el botón de AirPlay');
      assert.ok(!(await p.ev('!!window.cast')), 'sin Presentation API (Safari) no se carga el SDK de Cast');
      await p.clic('.iv-tv-btn');
      await dormir(300);
      const pedidos = await p.a('window.__airplay.prompts');
      assert.ok(pedidos.length === 1 && pedidos[0].activo, `prompt() tiene que salir dentro del toque: ${JSON.stringify(pedidos)}`);
      await p.a('(window.__airplay.conectar(), true)');
      await p.debe(`A.estado().capa === 'Reproduciendo en la TV'`, 3000, 'no mostró el cartel de AirPlay');
      assert.equal((await p.estado()).botonTV, 'Dejar de transmitir o elegir otra TV');
      await p.a('(window.__airplay.desconectar(), true)');
      await p.debe(`!A.estado().capa && /Se dejó de transmitir/.test(A.estado().aviso || '')`, 3000, 'no volvió al celular');
      // El botón queda SIEMPRE con video propio (pedido de Erick, oct-2026): sin TV a la
      // vista sigue ahí y el selector del sistema dice que no hay ninguna.
      await p.a('(window.__airplay.disp(false), true)');
      await dormir(800);
      assert.equal((await p.estado()).botonTV, 'Transmitir a la TV', 'sin TV a la vista el botón tiene que seguir');
    });
  });

  describe('transmitir a la TV · botón siempre visible y avisos (prueba con TV real, oct-2026)', () => {
    paso(entorno, 'primera conexión: si el pedido de carga falla pero la TV carga igual, la compu se engancha y no sigue sola', async () => {
      await p.abrir({ query: { motor: 'hls', cast: 'fake', lat: '120', cargaTarde: '1' } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      await p.reproducir();
      await p.debe(`A.comp() > 1`, 10000, 'no arrancó a reproducir');
      await p.clic('.iv-tv-btn');
      await p.debe(`/^Reproduciendo en/.test(A.estado().capa || '') && window.__tv.receptor.estado === 'PLAYING'`, 15000, 'la compu no se enganchó a la TV');
      await dormir(1500);
      const e = await p.estado();
      assert.equal(e.pausado, true, 'el video de la compu tiene que quedar en pausa');
      assert.ok(!/no pudo|No se pudo/.test(e.aviso || ''), `aviso falso: ${e.aviso}`);
      assert.ok(cerca(e.comp, e.tv.t, 0.8), `la compu tiene que seguir a la TV: ${JSON.stringify({ comp: e.comp, tv: e.tv })}`);
    });

    paso(entorno, 'sin ninguna TV en la red el botón está y, al tocarlo, avisa que no encontró ninguna', async () => {
      await p.abrir({ query: { motor: 'hls', cast: 'fake', lat: '120', hayTV: '0' } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'sin TV el botón tenía que estar igual');
      await p.clic('.iv-tv-btn');
      await p.debe(`/No encontramos una TV con Chromecast/.test(A.estado().aviso || '')`, 8000, 'no avisó que no hay TV');
      assert.equal((await p.estado()).capa, null, 'no tiene que quedar el cartel de la TV');
    });

    paso(entorno, 'con el video en pausa, un solo toque conecta y la TV arranca reproduciendo', async () => {
      await p.abrir({ query: { motor: 'hls', cast: 'fake', lat: '120' } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      assert.equal((await p.estado()).pausado, true, 'el video tenía que estar en pausa antes de transmitir');
      await p.clic('.iv-tv-btn');
      await p.debe(`window.__tv.receptor.estado === 'PLAYING'`, 10000, 'la TV no arrancó sola: había que volver a tocar');
      const carga = (await p.a('window.__tv.log')).find((x) => x.ev === 'CMD LOAD');
      assert.equal(carga && carga.autoplay, true, `LOAD tenía que ir con autoplay: ${JSON.stringify(carga)}`);
    });

    paso(entorno, 'si Chrome rechaza el pedido pero la TV igual conecta, no aparece "No se pudo conectar"', async () => {
      await p.abrir({ query: { motor: 'hls', cast: 'fake', lat: '120' } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      // Como un Android real: requestSession rechaza con session_error mientras la sesión
      // sigue arrancando y termina bien.
      await p.a(`(() => { const C = window.cast.framework.CastContext.getInstance(); const o = C.requestSession.bind(C);
        C.requestSession = function () { o().catch(() => {}); return new Promise((_, no) => setTimeout(() => no('session_error'), 300)); }; return true; })()`);
      await p.clic('.iv-tv-btn');
      await p.debe(`/^Reproduciendo en/.test(A.estado().capa || '')`, 10000, 'no conectó');
      const avisos = [];
      for (let i = 0; i < 25; i++) { const a = (await p.estado()).aviso; if (a) avisos.push(a); await dormir(200); }
      assert.ok(!avisos.some((a) => /No se pudo conectar|No encontramos/.test(a)), `aviso falso: ${JSON.stringify(avisos)}`);
    });
  });
}
