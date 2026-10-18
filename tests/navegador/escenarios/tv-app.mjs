// Transmitir a la TV ADENTRO de hub-app (reproductor 1.4.0, puente ivcast v1), con la app
// simulada (simulados/puente-app-simulado.js) arriba, en marco.html (que hace de view.php),
// y el reproductor en el iframe como en un WebView (webview=1: sin Cast Web SDK, sin
// Presentation API, UA MoodleMobile). El recorrido completo (conectar, frenar, control
// remoto, cortar) y la renovación de la firma corren en tv.mjs y firma.mjs en los dos
// modos; acá va lo que sólo existe en la app:
//  - salir y volver: la TV queda en pausa y la lección nueva adopta la sesión;
//  - el saludo que nadie contesta (la app vieja que igual tiene el puente, un H5P…): no se
//    instala nada y el reproductor sigue como siempre;
//  - la app sin Chromecast (sin Google Play Services) y el saludo lento;
//  - iPhone: AirPlay sólo si la app lo declara, directo a Chromecast si no hay TV de
//    AirPlay, y el selector si hay de las dos;
//  - la regresión clave: el WebView SIN puente (la app de hoy) dice lo de siempre, y
//    "actualizala" sólo con la casilla del plugin prendida.
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { cerca } from '../apoyo/pagina.mjs';
import { dormir } from '../apoyo/chrome.mjs';
import { abrirConTV, comprobarModoApp } from './tv.mjs';

export function registrar(entorno) {
  const p = entorno.pagina;
  const log = () => p.ev('window.__tv.log');
  const holas = () => p.ev(`window.__puente.recibidos.filter((m) => m.tipo === 'hola').length`);
  // Nada del modo app instalado en el iframe del reproductor.
  const sinNada = () => p.a(`({ cast: !!W.cast, chromeCast: !!(W.chrome && W.chrome.cast), gstatic: !!D.querySelector('script[src*="gstatic"]') })`);
  const conectado = `/^Reproduciendo en Living & Comedor/.test(A.estado().capa || '') && window.__tv.receptor.estado === 'PLAYING'`;

  describe('transmitir a la TV · hub-app simulada: lo propio de la app', () => {
    paso(entorno, 'salir y volver: al irse la TV queda en pausa en ese segundo, y la lección que vuelve adopta la sesión sin volver a cargar', async () => {
      await abrirConTV(p, 'app', { query: { motor: 'hls', lat: '120' }, progreso: { completed: ['n8', 'tf25'], currentTime: 30 }, esperarEn: 30 });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      await p.reproducir();
      await p.debe(`A.comp() > 30.5`, 10000, 'no arrancó a reproducir');
      await p.clic('.iv-tv-btn');
      await p.debe(conectado, 10000, 'no se conectó');
      await dormir(1500);
      const cargas0 = (await log()).filter((x) => x.ev === 'CMD LOAD').length;
      const holas0 = await holas();
      assert.equal(cargas0, 1);
      // Se va de la lección: el iframe se recarga (la app y la TV, arriba, siguen; como
      // cuando el WebView navega y vuelve a view.php).
      await p.a('(W.__viejo = true, true)');
      const antes = (await log()).length;
      await p.ev(`(document.querySelector('iframe').contentWindow.location.reload(), true)`);
      assert.ok(await p.esperarArriba(`window.__tv.receptor.estado === 'PAUSED'`, 5000), 'al irse, la TV tenía que quedar en pausa (pagehide → pausa por el puente)');
      const quieta = await p.ev('window.__tv.receptor.foto()');
      const alIrse = (await log()).slice(antes);
      assert.ok(alIrse.some((x) => x.ev === 'CMD pause'), `la pausa la manda el reproductor por el puente: ${JSON.stringify(alIrse.map((x) => x.ev))}`);
      assert.ok((await p.ev('window.__puente.adioses')) >= 1, 'al irse manda adios');
      // Vuelve: la lección nueva saluda, la app contesta con la sesión y se adopta.
      await p.debe(`!W.__viejo && A.listo()`, 30000, 'la lección no volvió a cargar');
      await p.debe(`/^Reproduciendo en Living & Comedor/.test(A.estado().capa || '')`, 15000, 'no adoptó la sesión que seguía abierta');
      await dormir(800);
      let e = await p.estado();
      assert.equal(e.boton, 'Reproducir', `la TV está en pausa: el botón tiene que ofrecer reproducir · ${JSON.stringify(e)}`);
      assert.equal(e.tv.estado, 'PAUSED');
      assert.ok(cerca(e.comp, quieta.t, 0.6), `el componente en el segundo de la TV (${quieta.t}): ${e.comp}`);
      assert.equal(await holas(), holas0 + 1, 'la lección nueva saludó una vez');
      assert.equal((await log()).filter((x) => x.ev === 'CMD LOAD').length, cargas0, 'adoptó: no volvió a cargar el video en la TV');
      await comprobarModoApp(p);
      // Con play sigue desde ahí.
      await p.reproducir();
      await p.debe(`window.__tv.receptor.estado === 'PLAYING'`, 8000, 'con play la TV no siguió');
      e = await p.estado();
      assert.ok(e.tv.t >= quieta.t - 0.05 && e.tv.t < quieta.t + 2, `siguió desde donde quedó (${quieta.t}): ${JSON.stringify(e.tv)}`);
      assert.equal(e.pausado, true, 'el <video> del celular sigue en pausa');
    }, { timeout: 90000 });

    paso(entorno, 'el saludo sin respuesta: no se instala nada, el video sigue igual y el toque avisa y vuelve a saludar', async () => {
      await p.abrir({ pagina: 'marco.html', query: { app: 'mudo', webview: '1', motor: 'hls' } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'el botón tiene que estar igual');
      assert.ok(await p.esperarArriba(`window.__puente.recibidos.some((m) => m.tipo === 'hola')`, 8000), 'el reproductor tenía que saludar al cargar');
      await dormir(3500);   // venció el saludo de la carga
      assert.deepEqual(await sinNada(), { cast: false, chromeCast: false, gstatic: false }, 'sin respuesta no se instala el SDK imitado ni se baja el de gstatic');
      assert.equal(await p.a('W.__ivCastDiag && W.__ivCastDiag.sdk'), 'app: sin-respuesta');
      // El reproductor, como siempre.
      await p.reproducir();
      await p.debe(`A.comp() > 1.5`, 10000, 'el video no reproduce');
      await p.clic('.iv-tv-btn');
      await p.debe(`/No se pudo preparar la transmisión\\. Probá de nuevo\\./.test(A.estado().aviso || '')`, 8000, 'no avisó');
      const e = await p.estado();
      assert.equal(e.capa, null, 'no tiene que quedar el cartel de la TV');
      assert.equal(e.pausado, false, 'el video sigue reproduciendo en el celular');
      assert.equal(await holas(), 2, 'el toque vuelve a saludar (el fallo no quedó guardado)');
      assert.ok(!/actualiz/i.test(e.aviso), `sin la casilla no se dice "actualizá": ${e.aviso}`);
    });

    paso(entorno, 'la app contesta sin Chromecast (sin Google Play Services): "Este teléfono no puede transmitir a Chromecast."', async () => {
      await p.abrir({ pagina: 'marco.html', query: { app: 'fake', webview: '1', motor: 'hls', cast: '0' } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'el botón tiene que estar igual');
      assert.ok(await p.esperarArriba(`window.__puente.holas === 1`, 8000), 'la app no recibió el saludo');
      await dormir(300);
      await p.clic('.iv-tv-btn');
      await p.debe(`/^Este teléfono no puede transmitir a Chromecast\\.$/.test(A.estado().aviso || '')`, 8000, 'no avisó que el teléfono no puede');
      assert.deepEqual(await sinNada(), { cast: false, chromeCast: false, gstatic: false });
      assert.equal((await log()).filter((x) => x.ev === 'requestSession').length, 0, 'no se pidió el selector');
    });

    paso(entorno, 'la app contesta el saludo a los 1,5 s y el toque de antes conecta igual', async () => {
      await p.abrir({ pagina: 'marco.html', query: { app: 'fake', webview: '1', motor: 'hls', lat: '120', holaLento: '1500' } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón');
      await p.clic('.iv-tv-btn');
      await p.debe(conectado, 12000, 'no conectó después del saludo lento');
      assert.ok(!/No se pudo|Tocá de nuevo/.test((await p.estado()).aviso || ''));
    });
  });

  describe('transmitir a la TV · hub-app simulada en iPhone (AirPlay según las capacidades)', () => {
    const iphone = (extra) => ({ app: 'fake', webview: '1', plataforma: 'ios', airplay: '1', motor: 'hls', lat: '120', ...extra });
    // El reproductor en iPhone: el puente sólo arriba (como iOS) y la app ya contestó.
    const listo = async () => {
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      assert.ok(await p.esperarArriba(`window.__puente.holas === 1`, 8000), 'la app no recibió el saludo');
      await dormir(400);
      assert.equal(await p.a('!!W.ReactNativeWebView'), false, 'en iOS el puente está sólo en el marco principal');
    };

    paso(entorno, 'sólo Chromecast (ninguna TV de AirPlay): el toque va directo a Chromecast', async () => {
      await p.abrir({ pagina: 'marco.html', query: iphone({ disp: '0' }) });
      await listo();
      await p.clic('.iv-tv-btn');
      await p.debe(conectado, 10000, 'no fue a Chromecast');
      assert.deepEqual(await p.a('W.__airplay.prompts'), [], 'no tenía que abrir el selector de AirPlay');
      assert.equal((await log()).filter((x) => x.ev === 'requestSession').length, 1);
      await comprobarModoApp(p);
    });

    paso(entorno, 'con TV de AirPlay y Chromecast posible: el selector propio, y cada fila hace lo suyo en el mismo toque', async () => {
      await p.abrir({ pagina: 'marco.html', query: iphone({ disp: '1' }) });
      await listo();
      await p.clic('.iv-tv-btn');
      await p.debe(`!!D.querySelector('.iv-ajustes-destinoTV')`, 3000, 'no apareció el selector');
      assert.deepEqual(await p.a('W.__airplay.prompts'), [], 'el selector todavía no transmite');
      await p.clic('.iv-ajustes-fila', { texto: 'AirPlay' });
      await dormir(300);
      const prompts = await p.a('W.__airplay.prompts');
      assert.ok(prompts.length === 1 && prompts[0].activo, `la fila de AirPlay abre el selector del sistema dentro del toque: ${JSON.stringify(prompts)}`);
      await p.a('(W.__airplay.cancelar(), true)');
      await dormir(300);
      await p.clic('.iv-tv-btn');
      await p.debe(`!!D.querySelector('.iv-ajustes-destinoTV')`, 3000, 'no volvió a aparecer el selector');
      await p.clic('.iv-ajustes-fila', { texto: 'Chromecast' });
      await p.debe(conectado, 10000, 'la fila de Chromecast no conectó');
      assert.equal((await p.a('W.__airplay.prompts')).length, 1);
    });

    paso(entorno, 'sin "airplay" en las capacidades de la app, sólo Chromecast aunque haya TV de AirPlay', async () => {
      await p.abrir({ pagina: 'marco.html', query: iphone({ disp: '1', airplayApp: '0' }) });
      await listo();
      await p.clic('.iv-tv-btn');
      await p.debe(conectado, 10000, 'no fue a Chromecast');
      assert.deepEqual(await p.a('W.__airplay.prompts'), []);
      assert.equal(await p.a(`!!D.querySelector('.iv-ajustes-destinoTV')`), false);
    });
  });

  describe('transmitir a la TV · el WebView de la app SIN puente (regresión: la app de hoy)', () => {
    paso(entorno, 'como en 1.3.3: "abrí la lección en Chrome", sin pedidos a gstatic, y "actualizala" sólo con la casilla prendida', async () => {
      await p.abrir({ pagina: 'marco.html', query: { webview: '1', motor: 'hls' } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'el botón tiene que estar');
      assert.equal(await p.a('!!(W.ReactNativeWebView || W.top.ReactNativeWebView)'), false);
      await p.clic('.iv-tv-btn');
      await p.debe(`A.estado().aviso === 'Para transmitir a la TV abrí la lección en Chrome.'`, 5000, 'el texto de siempre');
      assert.deepEqual(await sinNada(), { cast: false, chromeCast: false, gstatic: false });
      assert.notEqual(await p.a('W.__ivCastDiag && W.__ivCastDiag.modo'), 'app');
      // Con la casilla del plugin prendida (la app con Chromecast ya está en Play).
      await p.abrir({ pagina: 'marco.html', query: { webview: '1', motor: 'hls', appCastPublicada: '1' } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'el botón tiene que estar');
      await p.clic('.iv-tv-btn');
      await p.debe(`A.estado().aviso === 'Para transmitir a la TV, abrí la lección en Chrome. Si usás la app de Hub Education, actualizala.'`, 5000, 'el texto con la casilla prendida');
      assert.deepEqual(await sinNada(), { cast: false, chromeCast: false, gstatic: false });
    });
  });
}
