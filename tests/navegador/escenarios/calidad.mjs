// Cambio de calidad desde el menú de Ajustes, con los dos motores del video propio:
//  - hls.js: cambia de nivel (subir vacía el buffer y vuelve a bajar desde el segundo
//    actual) sin mover currentTime;
//  - HLS nativo: cambia de FUENTE (la playlist de la variante), el <video> pasa por 0 y
//    vuelve; nativePlayer no deja salir esos eventos.
// En los dos casos el componente no tiene que ver ninguna caída de tiempo y la
// pregunta de los 25 tiene que frenar igual, en su segundo. Se elige la calidad MÁS
// ALTA con el reproductor chico (480 px): con hls.js es una subida, el camino que
// vacía el buffer; con el nativo, siempre un cambio de fuente.
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { anomalias, cerca } from '../apoyo/pagina.mjs';
import { dormir } from '../apoyo/chrome.mjs';

// Abre Ajustes → Calidad (con clics reales) y devuelve los textos de las opciones.
async function abrirCalidades(p) {
  await p.clic('.iv-ajustes-btn');
  await p.debe(`!!D.querySelector('.iv-ajustes')`, 3000, 'no se abrió Ajustes');
  if (await p.a(`!!D.querySelector('.iv-ajustes-fila')`)) await p.clic('.iv-ajustes-fila', { texto: 'Calidad' });
  const opciones = await p.debe(`(() => { const xs = [...D.querySelectorAll('.iv-ajustes-opcion')].map((b) => b.textContent.trim()); return xs.length >= 3 ? xs : null; })()`, 3000, 'no aparecieron las calidades');
  assert.ok(parseInt(opciones[0], 10) > 0, `la primera opción no es una calidad: ${JSON.stringify(opciones)}`);
  return opciones;
}

export function registrar(entorno) {
  for (const motor of ['hls', 'nativo']) {
    const skip = motor === 'nativo' && entorno.sinNativo ? entorno.sinNativo : false;
    describe(`calidad · motor ${motor}`, () => {
      const p = entorno.pagina;
      paso(entorno, 'cambiar de calidad 1 s antes de una pregunta no la saltea ni mueve el tiempo', async (t) => {
        await p.vista({ ancho: 480, alto: 400 });
        try {
          const e0 = await p.abrir({ query: { motor }, progreso: { completed: ['n8'], currentTime: 20 }, esperarEn: 20 });
          assert.equal(e0.motor, motor, `se pidió el motor ${motor} y quedó ${e0.motor}`);
          const desde = await p.a('A.ms()');
          await p.reproducir();
          await p.debe(`A.comp() > 22.3`, 10000, 'no arrancó a reproducir');
          // El menú se abre ANTES (con el menú abierto los controles no se esconden) y
          // el toque en la calidad se da recién pasado el 23,9 (con el clic, ~1 s antes).
          const opciones = await abrirCalidades(p);
          const elegida = opciones[0];   // de mayor a menor: la primera es la más alta
          const alto = parseInt(elegida, 10);
          t.diagnostic(`opciones: ${opciones.join(' · ')} → elegida ${elegida}`);
          const llegada = await p.debe(`A.comp() >= 23.9 && A.comp()`, 8000, 'no llegó a 23,9');
          assert.ok(llegada < 24.5, `llegó tarde al toque (${llegada}): la prueba no estaría cambiando 1 s antes`);
          await p.clic('.iv-ajustes-opcion', { texto: elegida });
          const alElegir = await p.estado();
          assert.ok(!alElegir.tarjeta && alElegir.comp < 25, `la pregunta apareció antes del cambio: ${JSON.stringify(alElegir)}`);
          await p.debe(`A.tarjeta()?.id`, 15000, 'después del cambio no apareció la pregunta de los 25');
          await dormir(1200);
          const e = await p.estado();
          assert.equal(e.tarjeta, 'tf25', `tenía que frenar en la de los 25: ${JSON.stringify(e)}`);
          assert.ok(e.comp >= 24.99 && e.comp <= 25.5, `tenía que frenar en 25 (no antes, y no saltear): ${JSON.stringify(e)}`);
          assert.ok(cerca(e.vt, 25, 0.6) && e.pausado, `el medio tenía que quedar en pausa en 25: ${JSON.stringify(e)}`);
          // Ni una caída ni un salto en todo el recorrido (el cambio incluido).
          const serie = await p.a('A.serie');
          assert.deepEqual(anomalias(serie, { desdeMs: desde }), [], 'el componente vio el tiempo caer o saltar');
          const tarjetas = (await p.a('A.marcas')).filter((m) => m.txt === 'tarjeta tf25');
          assert.equal(tarjetas.length, 1, 'la pregunta apareció una sola vez');
          // Y el cambio pasó de verdad (si no, la prueba no probaría nada).
          if (motor === 'hls') {
            await p.debe(`A.video().dataset.nivel === '${alto}'`, 10000, `hls.js no pasó a ${alto}p`);
          } else {
            await p.debe(`!/playlist\\.m3u8$/.test(A.video().currentSrc || A.video().src)`, 10000, 'el HLS nativo no cambió a la playlist de la variante');
            const fin = await p.estado();
            assert.ok(cerca(fin.vt, 25, 0.6), `el cambio de fuente tenía que volver al mismo segundo: ${JSON.stringify(fin)}`);
          }
        } finally {
          await p.vista();
        }
      }, { skip });

      if (motor !== 'nativo') return;

      // Envuelve el setter de currentTime de TODOS los <video> de la página (está en el
      // prototipo) para imitar lo que hace iOS con el salto del cambio de fuente.
      // W.__trampa(v) recibe el segundo pedido y devuelve el que se aplica de verdad, o
      // null para descartarlo; con W.__trampa en null, todo pasa normal.
      const instalarTrampa = (p) => p.a(`(() => {
        const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
        W.__trampa = null; W.__pedidos = [];
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true,
          get() { return d.get.call(this); },
          set(v) {
            const x = W.__trampa ? W.__trampa(v) : v;
            if (W.__trampa) W.__pedidos.push([v, x]);
            if (x != null) d.set.call(this, x);
          } });
        return true; })()`);

      // 🔴 La RETENCIÓN de eventos durante el cambio de fuente. Si el salto que hace
      // nativePlayer al llegar la metadata aterriza lejos de su segundo (iOS a veces
      // descarta el salto hecho tan temprano; el HLS nativo de Chrome a veces cae al
      // principio del segmento), ese aterrizaje no le puede llegar al componente: vería
      // el tiempo caer y volver, la guardia lo leería como saltos y el autoguardado
      // podría guardar el segundo equivocado. nativePlayer lo vuelve a pedir y recién
      // al final informa el estado de una sola vez. Se imita llevando el PRIMER salto
      // después del toque 6 s antes de lo pedido; los demás pasan.
      // (La prueba de abajo, la de los tres descartes, no ve esto: en Chrome el
      // reintento sale en el mismo timeupdate que vería el 0. Medido con una mutación
      // que dejaba salir los eventos, oct-2026: ésta falla y aquélla pasa.)
      paso(entorno, 'si el salto del cambio de fuente aterriza lejos de su segundo (como iOS), el componente no ve ni la caída ni la vuelta', async (t) => {
        await p.vista({ ancho: 480, alto: 400 });
        try {
          await p.abrir({ query: { motor }, progreso: { completed: ['n8', 'tf25'], currentTime: 40 }, esperarEn: 40 });
          await p.reproducir();
          await p.debe(`A.comp() > 41`, 10000, 'no arrancó a reproducir');
          const opciones = await abrirCalidades(p);
          await instalarTrampa(p);
          const antes = await p.a('A.comp()');
          await p.a(`(W.__trampa = (v) => { W.__trampa = (x) => x; return Math.max(0, v - 6); }, true)`);
          await p.clic('.iv-ajustes-opcion', { texto: opciones[0] });
          const desde = await p.a('A.ms()');
          await p.debe(`!/playlist\\.m3u8$/.test(A.video().currentSrc || A.video().src)`, 10000, 'no cambió de fuente');
          await p.debe(`W.__pedidos.length >= 2 && !A.video().seeking && A.video().readyState >= 2 && !A.video().paused`, 12000, 'no volvió a su segundo después del aterrizaje corrido');
          await dormir(1500);
          const e = await p.estado();
          const pedidos = await p.a('W.__pedidos');
          t.diagnostic(`saltos [pedido, aplicado]: ${JSON.stringify(pedidos)} · antes ${antes} · ahora ${JSON.stringify({ comp: e.comp, vt: e.vt })}`);
          // Que el primero de verdad haya caído lejos (si no, no se probó nada).
          assert.ok(pedidos[0][0] - pedidos[0][1] > 5, `el primer salto no se corrió: ${JSON.stringify(pedidos)}`);
          const serie = (await p.a('A.serie')).filter((m) => m.ms >= desde && m.comp != null);
          const min = Math.min(...serie.map((m) => m.comp));
          assert.ok(min >= antes - 0.3, `el componente vio el tiempo caer a ${min} (estaba en ${antes}): ${JSON.stringify(serie.slice(0, 12))}`);
          assert.deepEqual(anomalias(serie), [], 'el componente vio el tiempo caer o saltar');
          const guardados = (await p.a('A.guardados')).filter((g) => g.ms >= desde);
          assert.ok(guardados.every((g) => g.currentTime >= antes - 0.3), `se guardó el segundo del aterrizaje corrido: ${JSON.stringify(guardados)}`);
          assert.ok(cerca(e.vt, e.comp, 0.6) && e.vt >= antes && e.vt < antes + 10, `tenía que seguir desde ${antes}: ${JSON.stringify(e)}`);
        } finally {
          await p.a('(W.__trampa = null, true)');
          await p.vista();
        }
      }, { skip });

      // 🔴 Algunas versiones de iOS DESCARTAN el salto que nativePlayer hace al llegar la
      // metadata de la fuente nueva, y a veces también los reintentos: el medio corre desde
      // 0. nativePlayer lo vuelve a pedir hasta SALTOS_CAMBIO veces (pausando desde el
      // segundo) y, mientras tanto, no deja salir ningún evento. Se imita en Chrome
      // ignorando las TRES primeras asignaciones de currentTime después del toque: el
      // salto de la metadata y dos reintentos; el tercero entra.
      // Ojo: en Chrome el reintento sale en el mismo timeupdate que vería el 0, así que
      // ésta NO distingue si la retención de eventos se rompe (eso lo prueba la de
      // arriba); sí que los reintentos devuelvan el medio a su segundo.
      paso(entorno, 'si el navegador descarta el salto del cambio de fuente y dos reintentos (como iOS), vuelve a su segundo y sigue', async (t) => {
        await p.vista({ ancho: 480, alto: 400 });
        try {
          await p.abrir({ query: { motor }, progreso: { completed: ['n8', 'tf25'], currentTime: 40 }, esperarEn: 40 });
          await p.reproducir();
          await p.debe(`A.comp() > 41`, 10000, 'no arrancó a reproducir');
          const opciones = await abrirCalidades(p);
          await p.a(`(() => {
            const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
            W.__descartar = 0; W.__descartados = [];
            Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true,
              get() { return d.get.call(this); },
              set(v) { if (W.__descartar > 0) { W.__descartar--; W.__descartados.push(v); return; } d.set.call(this, v); } });
            return true; })()`);
          const antes = await p.a('A.comp()');
          await p.a('(W.__descartar = 3, true)');
          await p.clic('.iv-ajustes-opcion', { texto: opciones[0] });
          const desde = await p.a('A.ms()');
          await p.debe(`!/playlist\\.m3u8$/.test(A.video().currentSrc || A.video().src)`, 10000, 'no cambió de fuente');
          await dormir(6000);
          const e = await p.estado();
          const descartados = await p.a('W.__descartados');
          t.diagnostic(`descartado: ${JSON.stringify(descartados)} · antes ${antes} · ahora ${JSON.stringify({ comp: e.comp, vt: e.vt, pausado: e.pausado })}`);
          assert.equal(descartados.length, 3, 'la prueba no llegó a descartar los tres saltos (no estaría probando nada)');
          const serie = (await p.a('A.serie')).filter((m) => m.ms >= desde && m.comp != null);
          const min = Math.min(...serie.map((m) => m.comp));
          assert.ok(min >= antes - 0.3, `el componente vio el tiempo caer a ${min} (estaba en ${antes})`);
          assert.deepEqual(anomalias(serie), [], 'el componente vio el tiempo caer o saltar');
          assert.ok(e.vt >= antes && e.vt < antes + 10 && cerca(e.comp, e.vt, 0.6), `tenía que seguir desde ${antes}, no desde 0: ${JSON.stringify(e)}`);
          assert.equal(e.pausado, false, 'y seguir reproduciendo');
        } finally {
          await p.vista();
        }
      }, { skip });
    });
  }
}
