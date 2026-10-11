// El CANDADO de preguntas con el reproductor de verdad: el bundle compilado, el
// <video> con hls.js o con el HLS nativo de Chrome, y los ticks reales del medio.
// Las decisiones (debeFrenar, pendienteARetomar, tiempoAGuardar) tienen pruebas
// unitarias; acá se prueba que el componente las use bien con eventos de verdad: el
// orden del efecto de disparo (guardia antes del bucle, `prev` quieto con la tarjeta
// abierta), la restauración optimista, el seek, la pausa y el freno de 'play'. El
// simulador unitario REPLICA ese cableado: sólo estas pruebas ven el del componente.
// "Salto externo" = asignar currentTime al <video> sin pasar por el reproductor, que
// es lo que hacen la pantalla de bloqueo, los auriculares o el Centro de control.
// Preguntas: nota en 8 (n8), V/F en 25 (tf25) y V/F en 60 (tf60).
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { anomalias, cerca } from '../apoyo/pagina.mjs';
import { dormir } from '../apoyo/chrome.mjs';

const saltoExterno = (p, t) => p.a(`(A.video().currentTime = ${t}, true)`);

export function registrar(entorno) {
  for (const motor of ['hls', 'nativo']) {
    const skip = motor === 'nativo' && entorno.sinNativo ? entorno.sinNativo : false;
    describe(`candado de preguntas · motor ${motor}`, () => {
      const p = entorno.pagina;
      const query = { motor };
      // El motor pedido tiene que ser el que quedó: si no, la prueba "del nativo"
      // estaría probando hls.js sin avisar.
      const abrir = async (op = {}) => {
        const e = await p.abrir({ query, ...op });
        assert.equal(e.motor, motor, `se pidió el motor ${motor} y quedó ${e.motor}`);
        return e;
      };

      paso(entorno, 'un salto externo en pausa de 0 a 40 vuelve a la nota de los 8 y la muestra', async () => {
        await abrir();
        await dormir(500);
        await saltoExterno(p, 40);
        await p.debe(`A.tarjeta()?.id`, 8000, 'no apareció ninguna tarjeta después del salto');
        await dormir(1000);
        const e = await p.estado();
        assert.equal(e.tarjeta, 'n8', `tenía que mostrar la PRIMERA pendiente cruzada (n8): ${JSON.stringify(e)}`);
        assert.ok(cerca(e.comp, 8, 0.3) && cerca(e.vt, 8, 0.4), `el video tenía que volver a 8: ${JSON.stringify(e)}`);
        assert.equal(e.pausado, true, 'con la tarjeta abierta el video queda en pausa');
      }, { skip });

      paso(entorno, 'un salto externo de 10 a 60,2 en pausa, dentro de la ventana de la restauración, vuelve a la de los 25', async () => {
        // La restauración marca un salto propio por 3 s. Un salto EXTERNO que llega en
        // esa ventana pero lejos de su destino tiene que pasar por la guardia igual
        // (reloj + destino): con sólo el reloj, salteaba la pregunta de los 25.
        await abrir({ progreso: { completed: ['n8'], currentTime: 10 }, esperarEn: 10, asentar: false });
        await dormir(800);
        const restaurado = (await p.a('A.serie')).find((m) => cerca(m.comp, 10, 0.3));
        const enVentana = (await p.a('A.ms()')) - restaurado.ms;
        await saltoExterno(p, 60.2);
        // Si el salto no cayó dentro de los 3 s, la prueba no estaría probando la ventana.
        assert.ok(enVentana < 2500, `el salto llegó ${enVentana} ms después de restaurar: fuera de la ventana`);
        await p.debe(`A.tarjeta()?.id`, 8000, 'no apareció ninguna tarjeta después del salto');
        await dormir(1000);
        const e = await p.estado();
        assert.equal(e.tarjeta, 'tf25', `tenía que volver a la de los 25: ${JSON.stringify(e)}`);
        assert.ok(cerca(e.comp, 25, 0.3) && cerca(e.vt, 25, 0.4), `el video tenía que quedar en 25: ${JSON.stringify(e)}`);
        assert.equal(e.pausado, true);
        assert.equal(e.actividades, '1/3');
      }, { skip });

      paso(entorno, 'un salto externo reproduciendo, ya fuera de la ventana de la restauración, de ~13 a 60,2 vuelve a la de los 25', async () => {
        // La del salto DENTRO de la ventana de 3 s es la de arriba (en pausa, medida).
        // Ésta salta siempre DESPUÉS: antes caía a veces adentro y a veces afuera según
        // cuánto tardaba el play, y cubría una u otra regla sin decir cuál.
        await abrir({ progreso: { completed: ['n8'], currentTime: 10 }, esperarEn: 10 });
        const restaurado = (await p.a('A.serie')).find((m) => cerca(m.comp, 10, 0.3));
        await p.reproducir();
        await p.debe(`A.comp() > 11.5 && !A.video().paused && A.ms() - ${restaurado.ms} > 3500`, 12000, 'no arrancó a reproducir');
        await saltoExterno(p, 60.2);
        await p.debe(`A.tarjeta()?.id`, 8000, 'no apareció ninguna tarjeta después del salto');
        await dormir(1000);
        const e = await p.estado();
        assert.equal(e.tarjeta, 'tf25', `tenía que volver a la de los 25: ${JSON.stringify(e)}`);
        assert.ok(cerca(e.comp, 25, 0.3) && cerca(e.vt, 25, 0.5), `el video tenía que quedar en 25: ${JSON.stringify(e)}`);
        assert.equal(e.pausado, true, 'la tarjeta pausa el video');
      }, { skip });

      paso(entorno, 'un salto externo con la nota de los 8 abierta se corrige al cerrarla: vuelve a la de los 25 que cruzó', async () => {
        // 🔴 Con la tarjeta abierta el efecto de disparo no corre, y `prev` se queda en el
        // tick que la disparó (el comentario "Después del return, no antes"). Si avanzara
        // con la tarjeta abierta, al cerrarla el salto de 8 a 35 ya no se vería como un
        // salto y la de los 25 quedaba salteada para siempre. La prueba unitaria de esto
        // corre sobre la RÉPLICA del efecto (apoyo/simulador.mjs): ésta es la única que
        // mira el componente de verdad (oct-2026, una mutación así pasaba toda la suite).
        await abrir({ progreso: { completed: [], currentTime: 6 }, esperarEn: 6 });
        await p.reproducir();
        await p.debe(`A.tarjeta()?.id === 'n8'`, 10000, 'no frenó en la nota de los 8');
        await dormir(800);
        const desde = await p.a('A.ms()');
        // Pantalla de bloqueo o auriculares con la nota abierta: el medio salta a 35.
        await saltoExterno(p, 35);
        await p.debe(`Math.abs(A.video().currentTime - 35) < 0.3 && !A.video().seeking`, 8000, 'el salto externo no aterrizó');
        await dormir(800);
        let e = await p.estado();
        assert.equal(e.tarjeta, 'n8', `la nota sigue abierta mientras no se responde: ${JSON.stringify(e)}`);
        await p.responder();
        await p.debe(`A.tarjeta()?.id`, 8000, 'al cerrar la nota no apareció ninguna tarjeta');
        await dormir(800);
        e = await p.estado();
        assert.equal(e.tarjeta, 'tf25', `al cerrar la nota tenía que volver a la de los 25: ${JSON.stringify(e)}`);
        assert.ok(cerca(e.comp, 25, 0.3) && cerca(e.vt, 25, 0.5), `el video tenía que quedar en 25: ${JSON.stringify(e)}`);
        assert.equal(e.pausado, true, 'la tarjeta pausa el video');
        assert.equal(e.actividades, '1/3', 'la nota quedó respondida');
        // Y en ningún momento se guardó un avance más allá de la pregunta que quedó atrás.
        const guardados = (await p.a('A.guardados')).filter((g) => g.ms >= desde);
        assert.ok(guardados.every((g) => g.currentTime <= 25.001), `se guardó un avance pasado la de los 25: ${JSON.stringify(guardados)}`);
      }, { skip });

      paso(entorno, 'un avance guardado más allá de una pendiente retoma en ella y la muestra sin esperar al play', async () => {
        // Un avance viejo (de antes de la guardia, o de un salto que ella no vio) en 40
        // con la de 25 sin responder: se retoma EN 25 y se la muestra ya.
        await p.abrir({ query, progreso: { completed: ['n8'], currentTime: 40 } });
        await p.debe(`A.tarjeta()?.id`, 8000, 'no apareció la tarjeta al restaurar');
        await dormir(800);
        const e = await p.estado();
        assert.equal(e.motor, motor);
        assert.equal(e.tarjeta, 'tf25', JSON.stringify(e));
        assert.ok(cerca(e.comp, 25, 0.3), `tenía que retomar en 25: ${JSON.stringify(e)}`);
        assert.equal(e.boton, 'Reproducir', 'sin que nadie diera play');
      }, { skip });

      paso(entorno, 'retomar un avance normal no arrastra hacia atrás (ni a la nota de 8 ni al principio)', async () => {
        // 🔴 Lo que rompía la guardia sin la restauración optimista: el primer tick
        // llegaba con prev = 0 y la guardia lo leía como un salto que cruzó la nota.
        await abrir({ progreso: { completed: ['n8'], currentTime: 15 }, esperarEn: 15, ubicar: false });
        const desde = await p.a('A.ms()');
        await dormir(1200);
        let e = await p.estado();
        // Dónde aterrizó el medio. Con hls.js, en 15. Con el HLS nativo de Chrome puede
        // ser el principio del segmento (ver Pagina.abrir): eso es de Chrome, pero nunca
        // puede ser la nota de 8 ni el principio del video.
        const piso = motor === 'nativo' ? 15 - entorno.video.segmento - 0.1 : 14.9;
        assert.ok(!e.tarjeta && e.comp >= piso && e.comp <= 15.3, `quieto tenía que seguir en 15 (o, con el nativo de Chrome, en el segmento) y sin tarjeta: ${JSON.stringify(e)}`);
        assert.ok(cerca(e.comp, e.vt, 0.3), `el componente tiene que mostrar donde está el medio: ${JSON.stringify(e)}`);
        if (e.comp < 14.9) console.log(`[navegador] nota: el HLS nativo de Chrome restauró en ${e.vt} en vez de 15 (salto temprano impreciso de Chrome)`);
        const arranque = e.comp, asentado = e.ms;
        await p.reproducir();
        await p.debe(`A.comp() > ${arranque + 2}`, 10000, `no avanzó desde ${arranque}`);
        e = await p.estado();
        assert.equal(e.tarjeta, null, `ninguna tarjeta al seguir: ${JSON.stringify(e)}`);
        const serie = await p.a('A.serie');
        const min = Math.min(...serie.filter((m) => m.ms >= desde && m.comp != null).map((m) => m.comp));
        assert.ok(min >= piso, `el tiempo del componente bajó a ${min} después de restaurar en 15`);
        const guardados = await p.a('A.guardados');
        assert.ok(guardados.every((g) => g.currentTime >= piso), `se guardó un avance hacia atrás: ${JSON.stringify(guardados)}`);
        // Ya asentado, ni una caída ni un salto: el reloj sigue de corrido desde ahí.
        assert.deepEqual(anomalias(serie, { desdeMs: asentado }), []);
      }, { skip });

      paso(entorno, 'el botón +10 frena en la pendiente que alcanza y, ya respondida, la cruza sin frenar ni volver atrás', async () => {
        await abrir({ progreso: { completed: ['n8'], currentTime: 20 }, esperarEn: 20 });
        await p.reproducir();
        await p.debe(`A.comp() > 20.5`, 10000, 'no arrancó a reproducir');
        // De ~20,5 a 30,5 cruza la de 25: el +10 se queda en 25 y la muestra ahí.
        await p.clic('button[aria-label="Adelantar 10 segundos"]');
        await p.debe(`A.tarjeta()?.id`, 8000, 'el +10 no frenó en la pregunta de los 25');
        await dormir(600);
        let e = await p.estado();
        assert.equal(e.tarjeta, 'tf25');
        assert.ok(cerca(e.comp, 25, 0.1), `el +10 tenía que quedar justo en 25: ${JSON.stringify(e)}`);
        await p.responder();
        await p.debe(`!A.tarjeta() && A.comp() > 25.8 && !A.video().paused`, 10000, 'no siguió después de responder');
        // En pausa, −10 y +10: el segundo salto CRUZA la de los 25, ya respondida. No
        // tiene que frenar en ella (el +10 sólo frena en las PENDIENTES), ni volver a
        // mostrarla, ni retroceder después de aterrizar. En pausa para que la base del
        // salto sea exacta. (Antes acá había un +10 sin ninguna pregunta en el tramo: lo
        // que afirmaba, "no dispara la guardia", no podía fallar.)
        await p.clic('.iv-controls-row button[aria-label="Pausar"]');
        await p.debe(`A.video().paused`, 5000, 'no pausó');
        await p.clic('button[aria-label="Retroceder 10 segundos"]');
        await p.debe(`A.comp() < 20 && !A.video().seeking && A.video().readyState >= 2`, 8000, 'el −10 no retrocedió');
        await dormir(400);
        const antes = await p.a('A.comp()');
        const marca = await p.a('A.ms()');
        await p.clic('button[aria-label="Adelantar 10 segundos"]');
        await p.debe(`A.comp() > ${antes + 9}`, 6000, `el +10 desde ${antes} no pasó la de los 25 (¿frenó en una respondida?)`);
        await dormir(1500);
        e = await p.estado();
        assert.equal(e.tarjeta, null, `no tenía que aparecer ninguna tarjeta: ${JSON.stringify(e)}`);
        const serie = (await p.a('A.serie')).filter((m) => m.ms >= marca && m.comp != null);
        // El primer render que se movió es el aterrizaje: en antes + 10, no en 25.
        const aterrizaje = serie.find((m) => m.comp > antes + 0.5);
        assert.ok(aterrizaje && cerca(aterrizaje.comp, antes + 10, 0.15), `el +10 tenía que aterrizar en ${antes + 10}: ${JSON.stringify(serie.slice(0, 8))}`);
        const min = Math.min(...serie.filter((m) => m.ms >= aterrizaje.ms).map((m) => m.comp));
        assert.ok(min >= antes + 9.9, `después del +10 el componente volvió atrás (a ${min}): ${JSON.stringify(serie.slice(0, 12))}`);
        assert.ok(cerca(e.comp, antes + 10, 0.15) && e.pausado, `en pausa, quieto en ${antes + 10}: ${JSON.stringify(e)}`);
        assert.equal((await p.a('A.marcas')).filter((m) => m.txt === 'tarjeta tf25').length, 1, 'la de los 25 apareció más de una vez');
        assert.equal(e.actividades, '2/3');
      }, { skip });

      paso(entorno, 'un play de afuera con la pregunta abierta vuelve a pausa en el mismo segundo', async () => {
        // Auriculares, Centro de control o la notificación de Android: play() directo
        // sobre el medio con la tarjeta abierta. Sin el freno de 'play', el video corría
        // por detrás de la pregunta.
        await p.abrir({ query, progreso: { completed: ['n8'], currentTime: 40 } });
        await p.debe(`A.tarjeta()?.id === 'tf25'`, 8000, 'no apareció la tarjeta de los 25');
        await dormir(600);
        await p.a(`(A.video().play().catch(() => {}), true)`);
        await dormir(1500);
        const e = await p.estado();
        assert.equal(e.tarjeta, 'tf25', 'la tarjeta sigue abierta');
        assert.equal(e.pausado, true, `el play de afuera tenía que volver a pausa: ${JSON.stringify(e)}`);
        assert.ok(cerca(e.vt, 25, 0.6), `y quedar en 25: ${JSON.stringify(e)}`);
        assert.equal(e.boton, 'Reproducir');
      }, { skip });
    });
  }
}
