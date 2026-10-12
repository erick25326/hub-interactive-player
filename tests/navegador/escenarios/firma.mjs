// La FIRMA de Bunny que vence con la lección abierta (src/firma.js), con los dos motores.
// El servidor de pruebas sirve el video firmado como el CDN de Bunny con la
// autenticación por token prendida: valida el vencimiento en CADA pedido y contesta 403
// si venció (?firma=<segundos>). Su /firma hace de firma.php: devuelve una firma nueva,
// cuenta los pedidos y puede imitar lo que pasa en el campo (renovar=falla: se cerró la
// sesión; falla-hasta-403: sin red un rato; red-tras-403: la red tarda en volver; lenta:
// la respuesta tarda). Y rota=alta: una calidad que da 403 con la firma vigente.
// Las pruebas de lo que pasa AL VENCER la primera firma piden renovada=60 (las firmas
// nuevas duran 60 s): con 6 s también después, el HLS nativo cambia de fuente cada ~3 s
// reproduciendo, cada cambio cuesta un salto de 2-4 s con el video de Mux y no avanza.
// Eso no existe con firmas reales (un cambio por hora); lo de vencer seguido y seguido
// lo prueba la primera, con TTL.
// Con firmas de pocos segundos, una sola reproducción cruza varios vencimientos:
//  - hls.js: cada pedido sale con la firma vigente (xhrSetup), sin recargar nada;
//  - HLS nativo: se cambia de fuente al mismo segundo (el mecanismo del cambio de
//    calidad), en pausa enseguida y reproduciendo cuando falta poco.
// En los dos, el componente no puede ver ni una caída ni un salto de tiempo, y el
// candado frena igual en la pregunta que cae después. Si la renovación no llegó, un 403
// se arregla solo (firma nueva y reintento); si no se puede renovar, el cartel dice qué
// hacer en vez de quedarse trabado.
// 🔴 La pestaña "dormida" NO se prueba congelándola por CDP (Page.setWebLifecycleState):
// en Chrome headless el <video> (con hls.js o el HLS nativo) queda en "reproduciendo"
// sin avanzar al descongelar, y la pestaña ya no carga video en las pruebas que siguen
// (medido oct-2026, también sin firma). Lo de despertar lo cubren las unitarias del
// Renovador (visibilitychange/pageshow) y acá, el pedido que espera la firma (lenta).
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { anomalias, cerca } from '../apoyo/pagina.mjs';
import { dormir } from '../apoyo/chrome.mjs';
import { abrirCalidades } from './calidad.mjs';

// Lo que dura cada firma en la prueba (la real, 6 h). Con 10 s, renueva a los 5 (la
// mitad, ver margenes() en firma.js) y lo urgente del HLS nativo queda a ~1,7 s.
const TTL = 10;

export function registrar(entorno) {
  const p = entorno.pagina;
  const F = () => entorno.srv.firma;
  // El token de la URL con que arrancó la página.
  const tokenInicial = () => p.a(`new URLSearchParams(window.PLAYER_CONFIG.videoUrl.match(/bcdn_token=[^/]*/)[0]).get('bcdn_token')`);
  const marcas = () => ({ pedidos: F().pedidos.length, servidos: F().servidos.length, rechazos: F().rechazos.length });
  const esperarVencimiento = async (vence) => { while (Date.now() / 1000 <= vence + 0.5) await dormir(100); };

  for (const motor of ['hls', 'nativo']) {
    const skip = motor === 'nativo' && entorno.sinNativo ? entorno.sinNativo : false;
    describe(`firma de Bunny que vence · motor ${motor}`, () => {
      paso(entorno, `con la firma venciendo cada ${TTL} s, el video sigue sin cortes ni saltos y frena en la de los 25`, async (t) => {
        const ini = marcas();
        const e0 = await p.abrir({ query: { motor, firma: TTL }, progreso: { completed: ['n8'], currentTime: 12 }, esperarEn: 12 });
        assert.equal(e0.motor, motor, `se pidió el motor ${motor} y quedó ${e0.motor}`);
        const token0 = await tokenInicial();
        const vence0 = F().emitidas.get(token0);
        assert.ok(vence0, `el servidor no emitió el token de la página (${token0})`);
        const desde = await p.a('A.ms()');
        await p.reproducir();
        await p.debe(`A.comp() > 12.8`, 10000, 'no arrancó a reproducir');
        await p.debe(`A.tarjeta()?.id`, 40000, 'no apareció la pregunta de los 25');
        await dormir(1200);
        const e = await p.estado();
        assert.equal(e.error, null, `apareció el cartel de error: ${JSON.stringify(e)}`);
        assert.equal(e.tarjeta, 'tf25', `tenía que frenar en la de los 25: ${JSON.stringify(e)}`);
        assert.ok(e.comp >= 24.99 && e.comp <= 25.5, `tenía que frenar en 25 (no antes, y no saltear): ${JSON.stringify(e)}`);
        assert.ok(cerca(e.vt, 25, 0.6) && e.pausado, `el medio tenía que quedar en pausa en 25: ${JSON.stringify(e)}`);
        // La prueba prueba algo sólo si la firma de la página VENCIÓ reproduciendo.
        assert.ok(Date.now() / 1000 > vence0 + 1, `la reproducción no cruzó el vencimiento de la firma inicial (vence ${vence0})`);
        // Ni una caída ni un salto del tiempo del componente en todo el recorrido.
        assert.deepEqual(anomalias(await p.a('A.serie'), { desdeMs: desde }), [], 'el componente vio el tiempo caer o saltar');
        assert.equal((await p.a('A.marcas')).filter((m) => m.txt === 'tarjeta tf25').length, 1, 'la pregunta apareció una sola vez');
        // Responde y sigue, todavía sin cortes: otra firma vence en el camino, y hls.js
        // (que tenía 30 s en el buffer) vuelve a pedir video.
        const marca = await p.a('A.ms()');
        await p.responder();
        await p.debe(`!A.tarjeta() && A.comp() > 27.5 && !A.video().paused`, 15000, 'no siguió después de responder');
        // 40 s y no 20: con el HLS nativo y firmas de 10 s hay un cambio de fuente cada ~5 s
        // reproduciendo, y cada uno cuesta un salto de 2-4 s con el 1080p de Mux (8 MB por
        // segmento). Según la red del día, de 27,5 a 36 tardaba más de 20 s sin que nada
        // estuviera mal: seguía avanzando, sin cartel ni saltos (medido, oct-2026).
        await p.debe(`A.comp() > 36 || A.estado().error`, 40000, 'no siguió reproduciendo');
        const fin = await p.estado();
        assert.equal(fin.error, null, `apareció el cartel de error después de responder: ${JSON.stringify(fin)}`);
        assert.ok(!fin.pausado, `tenía que seguir reproduciendo: ${JSON.stringify(fin)}`);
        assert.deepEqual(anomalias(await p.a('A.serie'), { desdeMs: marca + 1500 }), [], 'después de responder el tiempo cayó o saltó');
        // Y el video siguió pidiéndose DESPUÉS del vencimiento, con firmas nuevas: si los
        // pedidos salieran con la vieja, el servidor los rechazaría (403).
        const servidos = F().servidos.slice(ini.servidos);
        const despues = servidos.filter((s) => s.ms / 1000 > vence0);
        assert.ok(despues.length >= 1, `no se pidió video después del vencimiento: ${JSON.stringify(servidos.map((s) => [s.token, s.resto.slice(-30)]))}`);
        assert.ok(despues.every((s) => s.token !== token0), 'después del vencimiento se sirvió video con la firma vieja: el servidor no la validó');
        const tokens = new Set(servidos.map((s) => s.token));
        assert.ok(tokens.size >= 2, `el video tenía que seguir con una firma nueva: ${[...tokens].join(', ')}`);
        const pedidos = F().pedidos.slice(ini.pedidos);
        assert.ok(pedidos.length >= 1 && pedidos.every((x) => x.metodo === 'POST' && x.cmid === '7' && x.sesskey === 'sk-prueba'), `pedidos de firma: ${JSON.stringify(pedidos)}`);
        // Ni un 403: la firma nueva llegó antes de que hiciera falta.
        assert.deepEqual(F().rechazos.slice(ini.rechazos), [], 'algún pedido de video salió con la firma vencida');
        t.diagnostic(`firmas usadas: ${tokens.size} · pedidos a /firma: ${pedidos.length} · video pedido después del vencimiento inicial: ${despues.length}`);
      }, { skip, timeout: 120000 });

      paso(entorno, 'si la firma no se puede renovar (sesión cerrada), aparece el cartel que dice qué hacer', async () => {
        const ini = marcas();
        await p.abrir({ query: { motor, firma: 6, renovar: 'falla' }, progreso: { completed: ['n8'], currentTime: 12 }, esperarEn: 12 });
        // Que venza en pausa (la renovación ya falló a los 3 s), y recién ahí reproducir.
        await esperarVencimiento(F().emitidas.get(await tokenInicial()));
        assert.equal((await p.estado()).error, null, 'en pausa, sin pedir video, todavía no hay nada que mostrar');
        await p.reproducir();
        const error = await p.debe(`A.estado().error`, 30000, 'no apareció el cartel después de que venció la firma');
        assert.match(error, /sesión del campus/, `el cartel tenía que decir que se cerró la sesión: ${error}`);
        assert.match(error, /Reintentar/);
        assert.ok(await p.a(`!!D.querySelector('.iv-error button')`), 'falta el botón Reintentar');
        assert.ok(F().rechazos.slice(ini.rechazos).some((r) => r.motivo === 'vencida'), 'el video no llegó a pedir con la firma vencida');
        // La programada (que falló) y la de después del 403 (también, forzada).
        assert.ok(F().pedidos.slice(ini.pedidos).length >= 2, `pedidos a /firma: ${JSON.stringify(F().pedidos.slice(ini.pedidos))}`);
      }, { skip, timeout: 60000 });

      // Los dos que siguen saltan, ya vencida la firma, a un tramo que no está en el
      // buffer (45): así el video NECESITA pedir algo enseguida, y se ve qué pasa con ese
      // pedido. Las dos preguntas de antes ya están respondidas: el salto no cruza
      // ninguna pendiente (la de los 60 queda adelante).
      const saltarA45 = async () => {
        await p.a('(A.video().currentTime = 45, true)');
        await p.debe(`Math.abs(A.comp() - 45) < 0.5`, 10000, 'el componente no mostró el salto a 45');
      };

      paso(entorno, 'un 403 (la renovación no llegó: sin red un rato) se arregla solo: firma nueva y reintento, sin cartel ni saltos', async (t) => {
        // Las renovaciones programadas fallan (503) hasta que el video se topa con un
        // 403: ése es el que tiene que pedir la firma nueva y reintentar UNA vez, antes
        // de cualquier cartel.
        const ini = marcas();
        await p.abrir({ query: { motor, firma: 6, renovar: 'falla-hasta-403', renovada: 60 }, progreso: { completed: ['n8', 'tf25'], currentTime: 12 }, esperarEn: 12 });
        const token0 = await tokenInicial();
        await esperarVencimiento(F().emitidas.get(token0));
        await saltarA45();
        const desde = await p.a('A.ms()');
        await p.reproducir();
        await p.debe(`A.comp() > 48.5 || A.estado().error`, 30000, 'no siguió reproduciendo');
        const e = await p.estado();
        assert.equal(e.error, null, `apareció el cartel: el 403 tenía que arreglarse solo: ${JSON.stringify(e)}`);
        assert.ok(!e.pausado && e.comp > 48.5, JSON.stringify(e));
        const rechazos = F().rechazos.slice(ini.rechazos);
        assert.ok(rechazos.some((r) => r.motivo === 'vencida' && r.token === token0), `la prueba no probó nada: ningún pedido volvió con 403 (${JSON.stringify(rechazos)})`);
        const recorrido = [...rechazos.map((r) => ({ ...r, ev: '403' })), ...F().servidos.slice(ini.servidos).filter((s) => s.ms >= rechazos[0].ms).map((s) => ({ ...s, ev: '200' }))]
          .sort((a, b) => a.ms - b.ms).slice(0, 6).map((x) => `${x.ev} ${x.token} …${x.resto.slice(-28)}`);
        t.diagnostic(`desde el 403: ${recorrido.join(' · ')}`);
        assert.ok(F().servidos.slice(ini.servidos).some((s) => s.token !== token0 && s.ms >= rechazos[0].ms), 'después del 403 no se pidió video con la firma nueva');
        if (motor === 'hls') {
          // hls.js reintenta EL MISMO pedido con la firma nueva, y ése anda: un solo 403.
          // Sin el reintento (medido, oct-2026) hls.js igual salía del paso, pero tras
          // cuatro 403: el segmento, la playlist de OTRA calidad (dos veces, cambiando de
          // calidad para escapar del error) y el segmento otra vez, hasta que la
          // renovación programada llegaba sola.
          const r0 = rechazos.find((r) => r.motivo === 'vencida');
          assert.equal(rechazos.length, 1, `tenía que haber un solo 403 y el reintento con la firma nueva: ${recorrido.join(' · ')}`);
          assert.ok(F().servidos.slice(ini.servidos).some((s) => s.resto === r0.resto && s.token !== token0 && s.ms >= r0.ms),
            `el pedido del 403 (${r0.resto.slice(-40)}) no se reintentó con la firma nueva`);
        }
        assert.ok(F().pedidos.slice(ini.pedidos).length >= 2, `la programada (503) y la del 403: ${JSON.stringify(F().pedidos.slice(ini.pedidos))}`);
        assert.deepEqual(anomalias(await p.a('A.serie'), { desdeMs: desde }), [], 'el componente vio el tiempo caer o saltar');
      }, { skip, timeout: 60000 });

      paso(entorno, 'con la renovación todavía en camino, el pedido de video espera la firma nueva (hls.js: sin ningún 403)', async (t) => {
        // La renovación programada sale a tiempo pero su respuesta llega 2 s DESPUÉS del
        // vencimiento (Moodle lento, datos móviles). Lo que pasa en el medio es lo de una
        // pestaña que se despierta con la firma vencida: un pedido de video tiene que
        // esperar la nueva y no salir con la vieja. Con el HLS nativo no se puede esperar
        // (el navegador pide solo): ahí el 403 se recupera con la misma renovación.
        const ini = marcas();
        await p.abrir({ query: { motor, firma: 6, renovar: 'lenta', renovada: 60 }, progreso: { completed: ['n8', 'tf25'], currentTime: 12 }, esperarEn: 12 });
        const token0 = await tokenInicial();
        const vence0 = F().emitidas.get(token0);
        await esperarVencimiento(vence0);
        assert.equal(F().pedidos.length - ini.pedidos, 1, 'la renovación programada tenía que estar en camino');
        await saltarA45();
        const desde = await p.a('A.ms()');
        await p.reproducir();
        await p.debe(`A.comp() > 48.5 || A.estado().error`, 30000, 'no siguió reproduciendo');
        const e = await p.estado();
        assert.equal(e.error, null, `apareció el cartel: ${JSON.stringify(e)}`);
        assert.ok(!e.pausado && e.comp > 48.5, JSON.stringify(e));
        const rechazos = F().rechazos.slice(ini.rechazos);
        if (motor === 'hls') assert.deepEqual(rechazos, [], 'un pedido salió con la firma vencida en vez de esperar la nueva');
        else t.diagnostic(`HLS nativo: ${rechazos.length} pedido(s) con 403, recuperados`);
        assert.ok(F().servidos.slice(ini.servidos).some((s) => s.token !== token0 && s.ms / 1000 > vence0), 'después del vencimiento no se pidió video con la firma nueva');
        // Mientras la lenta estaba en camino (hasta 2 s después del vencimiento) no se
        // pidió otra: se esperó ésa. (Después vienen las programadas de la firma nueva.)
        const enCamino = F().pedidos.slice(ini.pedidos).filter((x) => x.ms < (vence0 + 2) * 1000);
        assert.equal(enCamino.length, 1, `tenía que esperar la renovación que ya estaba en camino, sin pedir otra: ${JSON.stringify(F().pedidos.slice(ini.pedidos))}`);
        assert.deepEqual(anomalias(await p.a('A.serie'), { desdeMs: desde }), [], 'el componente vio el tiempo caer o saltar');
      }, { skip, timeout: 60000 });

      paso(entorno, 'un 403 con la red que tarda en volver (dos renovaciones fallidas seguidas): insiste unos segundos y sigue, sin cartel', async (t) => {
        // Lo de desbloquear el celular: la firma venció y la red vuelve uno o dos segundos
        // después del toque. Las renovaciones fallan (503) hasta el 403 y las DOS primeras
        // de después también. Antes, la renovación del 403 se rendía en el primer fallo y
        // aparecía "No se pudo renovar el acceso al video", con la red ya de vuelta.
        const ini = marcas();
        await p.abrir({ query: { motor, firma: 6, renovar: 'red-tras-403', renovada: 60 }, progreso: { completed: ['n8', 'tf25'], currentTime: 12 }, esperarEn: 12 });
        const token0 = await tokenInicial();
        await esperarVencimiento(F().emitidas.get(token0));
        await saltarA45();
        const desde = await p.a('A.ms()');
        await p.reproducir();
        await p.debe(`A.comp() > 48.5 || A.estado().error`, 40000, 'no siguió reproduciendo');
        const e = await p.estado();
        assert.equal(e.error, null, `apareció el cartel: con dos fallas de red seguidas tenía que insistir: ${JSON.stringify(e)}`);
        assert.ok(!e.pausado && e.comp > 48.5, JSON.stringify(e));
        const rechazos = F().rechazos.slice(ini.rechazos);
        const r403 = rechazos.find((r) => r.motivo === 'vencida' && r.token === token0);
        assert.ok(r403, `la prueba no probó nada: ningún pedido volvió con 403 (${JSON.stringify(rechazos)})`);
        const tras = F().pedidos.slice(ini.pedidos).filter((x) => x.ms >= r403.ms);
        assert.ok(tras.length >= 3, `después del 403 tenía que insistir (dos 503 y la buena): ${JSON.stringify(tras.map((x) => x.ms - r403.ms))}`);
        assert.ok(F().servidos.slice(ini.servidos).some((s) => s.token !== token0 && s.ms >= r403.ms), 'después del 403 no se pidió video con la firma nueva');
        assert.deepEqual(anomalias(await p.a('A.serie'), { desdeMs: desde }), [], 'el componente vio el tiempo caer o saltar');
        t.diagnostic(`pedidos a /firma después del 403, en ms: ${tras.map((x) => x.ms - r403.ms).join(', ')}`);
      }, { skip, timeout: 60000 });

      // Un salto LEJOS de lo que el <video> ya tiene en el buffer (de 30 a 52): con la firma
      // vencida, el video NECESITA pedir algo ya. Con el HLS nativo eso da 403 y el <video>
      // queda en rescate (data-rescate) mientras llega la renovación ("lenta": 2-3 s después
      // de vencer). Chrome llega ahí a veces por 'error' y a veces por una traba sin error.
      // (Con +10 desde 30 el tramo a veces ya estaba bajado y no había ningún 403.)
      const enRescate = `A.video().dataset.rescate === '1'`;
      const saltarLejos = async () => {
        await esperarVencimiento(F().emitidas.get(await tokenInicial()));
        await p.a('(A.video().currentTime = 52, true)');
        if (motor === 'nativo') await p.debe(enRescate, 5000, 'el salto con la firma vencida no puso al <video> en rescate: la prueba no prueba nada');
        await p.debe(`Math.abs(A.comp() - 52) < 0.6`, 5000, 'el componente no mostró el salto a 52');
      };

      paso(entorno, 'con la firma recién vencida y la renovación en camino, un salto y play enseguida: sigue desde ahí', async (t) => {
        // Lo que hace el alumno al volver: adelanta y toca play. Con el HLS nativo el play
        // cae durante el rescate. Antes se lo rechazaba el <video> en error y el rescate
        // recargaba "en pausa", como estaba antes del toque: la ruedita giraba y se apagaba
        // sin reproducir. Con hls.js el pedido espera la firma y no hay ningún 403.
        const ini = marcas();
        await p.abrir({ query: { motor, firma: 8, renovar: 'lenta', renovada: 60 }, progreso: { completed: ['n8', 'tf25'], currentTime: 30 }, esperarEn: 30 });
        await saltarLejos();
        const desde = await p.a('A.ms()');
        if (motor === 'nativo') assert.ok(await p.a(enRescate), 'el play tenía que caer durante el rescate: la prueba no prueba nada');
        await p.reproducir();
        await p.debe(`(!A.video().paused && A.comp() > 54.5) || A.estado().error`, 20000, 'no siguió reproduciendo desde 52: ¿se perdió el play?');
        const e = await p.estado();
        assert.equal(e.error, null, `apareció el cartel: ${JSON.stringify(e)}`);
        assert.equal(e.boton, 'Pausar', `tenía que seguir reproduciendo: ${JSON.stringify(e)}`);
        assert.ok(e.comp < 60.1, `no podía pasar la pregunta de los 60: ${JSON.stringify(e)}`);
        assert.deepEqual(anomalias(await p.a('A.serie'), { desdeMs: desde }), [], 'el componente vio el tiempo caer o saltar');
        const rechazos = F().rechazos.slice(ini.rechazos);
        if (motor === 'hls') assert.deepEqual(rechazos, [], 'un pedido salió con la firma vencida en vez de esperar la nueva');
        else t.diagnostic(`HLS nativo: ${rechazos.length} pedido(s) con 403 durante el rescate`);
      }, { skip, timeout: 60000 });

      if (motor === 'nativo') {
        paso(entorno, 'HLS nativo: un −10 durante el rescate de la firma se respeta (no vuelve solo al segundo del error)', async () => {
          // Durante el rescate (la renovación tarda 3 s) el alumno retrocede. Antes el rescate
          // recargaba en el segundo del error (52) y el componente saltaba solo de 42 a 52.
          await p.abrir({ query: { motor, firma: 8, renovar: 'lenta', demora: 3, renovada: 60 }, progreso: { completed: ['n8', 'tf25'], currentTime: 30 }, esperarEn: 30 });
          await saltarLejos();
          await p.clic('button[aria-label="Retroceder 10 segundos"]');
          await p.debe(`Math.abs(A.comp() - 42) < 0.6`, 3000, 'el componente no mostró el −10');
          const desde = await p.a('A.ms()');
          assert.ok(await p.a(enRescate), 'el −10 tenía que caer durante el rescate (la renovación llegó antes): la prueba no prueba nada');
          await p.debe(`!(${enRescate}) && !A.video().error && A.video().readyState >= 2 && Math.abs(A.video().currentTime - 42) < 1`, 15000, 'el rescate no recargó en 42');
          await dormir(1000);
          const e = await p.estado();
          assert.equal(e.error, null, `apareció el cartel: ${JSON.stringify(e)}`);
          assert.ok(Math.abs(e.comp - 42) < 0.6 && e.pausado, `tenía que quedar en 42 y en pausa: ${JSON.stringify(e)}`);
          assert.deepEqual(anomalias(await p.a('A.serie'), { desdeMs: desde }), [], 'el rescate deshizo el salto (el tiempo del componente saltó solo)');
        }, { skip, timeout: 60000 });

        paso(entorno, 'HLS nativo: la calidad elegida con la firma recién vencida (renovación en camino) queda puesta después del rescate', async (t) => {
          // El alumno elige 1080p justo al vencer, con la renovación todavía en camino: la
          // variante y el master dan 403 y el cambio termina en un rescate. Antes el rescate
          // recargaba el MASTER y la elección se perdía sin avisar (el menú volvía a
          // Automática). Ahora se vuelve a pedir, ya con la firma nueva.
          await p.vista({ ancho: 480, alto: 400 });
          try {
            const ini = marcas();
            await p.abrir({ query: { motor, firma: 10, renovar: 'lenta', demora: 3, renovada: 60 }, progreso: { completed: ['n8'], currentTime: 14 }, esperarEn: 14 });
            const opciones = await abrirCalidades(p);
            // Una calidad que NO es la que el <video> está mostrando: así su playlist no la
            // bajó ya el navegador con la firma vieja (una vez de cinco no hubo ningún 403).
            const nivel = await p.a('A.video().dataset.nivel || ""');
            const elegida = opciones.find((o) => parseInt(o, 10) > 0 && String(parseInt(o, 10)) !== nivel) || opciones[0];
            await esperarVencimiento(F().emitidas.get(await tokenInicial()));
            const desde = await p.a('A.ms()');
            await p.clic('.iv-ajustes-opcion', { texto: elegida });
            await p.debe(enRescate, 5000, 'el cambio con la firma vencida no terminó en un rescate: la prueba no prueba nada');
            await p.debe(`!(${enRescate}) && !A.video().error && A.video().readyState >= 1 && !A.video().seeking && !/playlist\\.m3u8$/.test(A.video().currentSrc || A.video().src)`, 20000, `después del rescate no volvió a la calidad elegida (${elegida}): quedó en el master`);
            await dormir(1000);
            const e = await p.estado();
            t.diagnostic(`elegida ${elegida} · nivel ${await p.a('A.video().dataset.nivel')} · rechazos ${JSON.stringify(F().rechazos.slice(ini.rechazos).map((r) => r.motivo))}`);
            assert.equal(e.error, null, `apareció el cartel: ${JSON.stringify(e)}`);
            assert.ok(cerca(e.comp, 14, 0.6) && e.pausado, `tenía que quedar en 14 y en pausa: ${JSON.stringify(e)}`);
            assert.ok(F().rechazos.slice(ini.rechazos).some((r) => r.motivo === 'vencida'), 'ningún pedido volvió con 403: la prueba no prueba nada');
            assert.deepEqual(anomalias(await p.a('A.serie'), { desdeMs: desde }), [], 'el componente vio el tiempo caer o saltar');
          } finally {
            await p.vista();
          }
        }, { skip, timeout: 60000 });
      }

      if (motor === 'hls') {
        paso(entorno, 'hls.js: una calidad rota (403 con la firma vigente) no es el vencimiento: pasa a otra calidad, sin cartel ni firma nueva', async () => {
          // Un 403 que el vencimiento no explica (a la firma le quedaban minutos): una
          // variante rota, una regla del CDN. Antes se forzaba una renovación igual;
          // firma.php devolvía (dentro de la misma hora) LA MISMA firma, volvía el 403 y
          // salía el cartel "El acceso al video venció" con las otras calidades andando.
          // Ahora decide hls.js como siempre: vuelve a automático y sigue.
          await p.vista({ ancho: 480, alto: 400 });
          try {
            const ini = marcas();
            await p.abrir({ query: { motor, firma: 600, rota: 'alta' }, progreso: { completed: ['n8'], currentTime: 12 }, esperarEn: 12 });
            await p.reproducir();
            await p.debe(`A.comp() > 13`, 10000, 'no arrancó a reproducir');
            const opciones = await abrirCalidades(p);
            await p.clic('.iv-ajustes-opcion', { texto: opciones[0] });
            await p.debe(`A.comp() > 20 || A.estado().error`, 20000, 'ni siguió reproduciendo ni apareció el cartel');
            const e = await p.estado();
            const rechazos = F().rechazos.slice(ini.rechazos);
            assert.equal(e.error, null, `apareció el cartel por una calidad rota: ${JSON.stringify(e)}`);
            assert.equal(e.pausado, false, `tenía que seguir reproduciendo: ${JSON.stringify(e)}`);
            assert.ok(rechazos.some((r) => r.motivo === 'rota'), `la calidad elegida (${opciones[0]}) no dio 403: la prueba no prueba nada (${JSON.stringify(rechazos)})`);
            assert.deepEqual(rechazos.filter((r) => r.motivo !== 'rota'), [], 'algún pedido volvió con 403 por la firma');
            assert.deepEqual(F().pedidos.slice(ini.pedidos), [], 'pidió una firma nueva por un 403 que no era el vencimiento');
          } finally {
            await p.vista();
          }
        }, { skip, timeout: 60000 });
      }
    });
  }

  // Chromecast: la TV pide el video SOLA, con la URL que se le pasó en el LOAD. Con el
  // receptor simulado no hay 403 (no baja nada), pero sí se ve lo que importa: que la TV
  // reciba la firma nueva con un LOAD en el mismo segundo, en pausa enseguida (con la
  // pregunta abierta, quieta en la pregunta) y reproduciendo cuando a la suya le falta
  // poco, sin que el componente vea saltos ni la TV pase de largo la pregunta.
  describe('firma de Bunny que vence · Chromecast simulado', () => {
    paso(entorno, 'transmitiendo, la TV vuelve a cargar el video con la firma nueva en el mismo segundo', async () => {
      const tok = (u) => (/bcdn_token=([^&/]+)/.exec(String(u)) || [])[1] || null;
      const cargas = async () => (await p.a('window.__tv.log')).filter((x) => x.ev === 'CMD LOAD');
      await p.abrir({ query: { motor: 'hls', cast: 'fake', lat: '120', firma: TTL }, progreso: { completed: ['n8'], currentTime: 16 }, esperarEn: 16 });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      await p.reproducir();
      await p.debe(`A.comp() > 16.5`, 10000, 'no arrancó a reproducir');
      await p.clic('.iv-tv-btn');
      await p.debe(`/^Reproduciendo en/.test(A.estado().capa || '') && window.__tv.receptor.estado === 'PLAYING'`, 10000, 'no se conectó');
      const desde = await p.a('A.ms()');
      await p.debe(`A.tarjeta()?.id === 'tf25'`, 25000, 'no apareció la pregunta de los 25');
      // Con la pregunta abierta (la TV quieta) vence otra firma: la TV se recarga en pausa.
      const conPregunta = (await cargas()).length;
      await p.debe(`window.__tv.log.filter((x) => x.ev === 'CMD LOAD').length > ${conPregunta}`, TTL * 1000 + 3000, 'con la pregunta abierta la TV no recibió la firma nueva');
      await dormir(1500);
      let L = await cargas();
      const enPausa = L.slice(conPregunta);
      assert.ok(enPausa.every((x) => x.autoplay === false && x.t >= 24.98 && x.t <= 25.35), `en pausa, la TV se recarga quieta en la pregunta: ${JSON.stringify(enPausa)}`);
      let e = await p.estado();
      assert.equal(e.tarjeta, 'tf25');
      assert.ok(/^Reproduciendo en/.test(e.capa || ''), `tenía que seguir transmitiendo: ${JSON.stringify(e)}`);
      assert.equal(e.tv.estado, 'PAUSED', `la TV tenía que seguir en pausa: ${JSON.stringify(e.tv)}`);
      assert.ok(e.tv.t >= 24.98 && e.tv.t <= 25.35, `la TV tenía que seguir en 25: ${JSON.stringify(e.tv)}`);
      // Responde: la TV sigue, y reproduciendo vence otra: LOAD con autoplay cuando falta
      // poco, en el segundo donde iba.
      await p.responder();
      await p.debe(`A.comp() > 26 && window.__tv.receptor.estado === 'PLAYING'`, 10000, 'la TV no siguió después de responder');
      const alResponder = (await cargas()).length;
      await p.debe(`window.__tv.log.filter((x) => x.ev === 'CMD LOAD').length > ${alResponder}`, TTL * 1000 + 3000, 'reproduciendo, la TV no recibió la firma nueva');
      await dormir(1500);
      L = await cargas();
      const reproduciendo = L.slice(alResponder);
      assert.ok(reproduciendo.every((x) => x.autoplay === true && x.t > 25.5 && x.t < 60), `reproduciendo, se recarga reproduciendo y más adelante: ${JSON.stringify(reproduciendo)}`);
      e = await p.estado();
      assert.equal(e.tv.estado, 'PLAYING', JSON.stringify(e.tv));
      assert.equal(e.error, null);
      assert.ok(!/no pudo reproducir/.test(e.aviso || ''), `la TV cortó: ${e.aviso}`);
      // Cada LOAD con una firma que el servidor emitió y que estaba vigente, y la TV con
      // la última; ninguna repetida (cada recarga, por una firma nueva).
      const tokens = L.map((x) => tok(x.contentId));
      assert.equal(new Set(tokens).size, tokens.length, `una recarga sin firma nueva: ${tokens.join(', ')}`);
      assert.ok(tokens.every((x) => F().emitidas.has(x)), `una firma que el servidor no emitió: ${tokens.join(', ')}`);
      assert.equal(tok(await p.a('window.__tv.receptor.media.contentId')), tokens.at(-1));
      // El componente, de punta a punta: ni una caída ni un salto (los LOAD incluidos).
      assert.deepEqual(anomalias(await p.a('A.serie'), { desdeMs: desde }), [], 'el componente vio el tiempo caer o saltar');
      assert.equal((await p.a('A.marcas')).filter((m) => m.txt === 'tarjeta tf25').length, 1, 'la pregunta apareció una sola vez');
    }, { timeout: 120000 });
  });
}
