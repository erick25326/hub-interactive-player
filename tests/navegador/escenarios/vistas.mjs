// Los TRAMOS VISTOS (1.5.0, la curva de retención): con el reproductor compilado, lo que
// llega al progress.php de mentira en el campo `vistas` mientras se mira. Lo puro (qué suma
// y qué no con cada tick) está en tests/unit/vistas.test.mjs; cómo lo suma el servidor por
// día, en tests/php/correr.php. Acá, el cableado: que el timeupdate del motor ACTIVO llegue
// a registrarTick con el "cuenta" bien armado (reproduciendo, sin salto en vuelo, sin
// pregunta abierta, pestaña a la vista o transmitiendo) y que viaje con el avance sin
// cambiar la forma de `data`, de la que depende retomar el video.
// La pestaña oculta se imita pisando document.visibilityState en el iframe del reproductor:
// Chrome headless no la oculta de verdad, y el reproductor la lee en cada tick.
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { dormir } from '../apoyo/chrome.mjs';
import { abrirConTV } from './tv.mjs';
import { diaDe, cantidadDeTramos } from '../../../src/vistas.js';

const TODAS = ['n8', 'tf25', 'tf60'];
const OCULTAR = `(Object.defineProperty(D, 'visibilityState', { configurable: true, get: () => 'hidden' }), true)`;
const MOSTRAR = `(delete D.visibilityState, true)`;

export function registrar(entorno) {
  const p = entorno.pagina;
  const srv = entorno.srv;
  const dur = entorno.video.duracion;
  // Las preguntas ya respondidas: el video corre sin frenar.
  const abrir = (query = {}, desde = 0) => p.abrir({ query: { motor: 'hls', completar: '1', ...query }, progreso: { completed: TODAS, currentTime: desde }, esperarEn: desde || null });
  const pausar = () => p.clic('.iv-controls-row button[aria-label="Pausar"]');
  // El último envío con tramos desde `n0`, o null.
  const ultimo = (n0) => srv.respaldo.progresos.slice(n0).filter((x) => x.vistas && x.vistas.length).pop() || null;
  // Espera un envío cuyas cifras cumplan `cond` (los envíos salen cada 5 s mientras el
  // tiempo avanza, y con el beacon de pagehide).
  async function esperarEnvio(n0, cond, tope, que) {
    const fin = Date.now() + tope;
    for (;;) {
      const u = ultimo(n0);
      if (u && cond(u.vistas[u.vistas.length - 1].tramos, u)) return u;
      if (Date.now() > fin) throw new Error(`${que}: el último envío fue ${JSON.stringify(u && u.vistas)}`);
      await dormir(200);
    }
  }
  const cifra = (tramos, i) => Number(tramos[i] || 0);

  describe('tramos vistos (1.5.0): viajan con el avance', () => {
    paso(entorno, 'de corrido cuenta cada tramo una vez, y `data` sigue siendo {completed, currentTime}', async () => {
      const n0 = srv.respaldo.progresos.length;
      await abrir();
      await p.reproducir();
      const u = await esperarEnvio(n0, (t) => cifra(t, 2) >= 1, 25000, 'no llegó un envío con los tres primeros tramos');
      const e = u.vistas[u.vistas.length - 1];
      assert.match(e.sesion, /^[a-z0-9]{16}$/, 'el id de la carga: 16 letras y números');
      assert.equal(e.dia, diaDe(new Date()), 'el día local del alumno');
      assert.equal(e.duracion, Math.round(dur));
      assert.equal(e.tramos.length, cantidadDeTramos(dur), 'una cifra por tramo del video');
      assert.match(e.tramos, /^111[01]?0*$/, `de corrido desde el principio, cada tramo una vez: ${e.tramos}`);
      assert.ok(e.segundos >= 9 && e.segundos <= 21, `segundos vistos: ${e.segundos}`);
      assert.deepEqual(Object.keys(u.data).sort(), ['completed', 'currentTime'], 'la forma del avance no cambia');
      assert.deepEqual(JSON.parse(u.crudo), u.data);
      await pausar();
    });

    paso(entorno, 'un salto adelante no suma lo salteado; retroceder y volver a mirar, sí', async () => {
      const n0 = srv.respaldo.progresos.length;
      await abrir();
      await p.reproducir();
      await p.debe('A.comp() > 6.5', 15000, 'no arrancó');
      // Un salto de afuera (como la pantalla de bloqueo): el reproductor no lo pidió.
      await p.a('(A.video().currentTime = 41, true)');
      await esperarEnvio(n0, (t) => cifra(t, 8) >= 1 && cifra(t, 9) >= 1, 20000, 'no contó lo que se miró después del salto');
      const t1 = ultimo(n0).vistas.at(-1).tramos;
      assert.ok(cifra(t1, 0) === 1 && cifra(t1, 1) === 1, `los dos primeros, una vez: ${t1}`);
      for (let i = 3; i <= 7; i++) assert.equal(cifra(t1, i), 0, `el tramo ${i} quedó salteado y no cuenta: ${t1}`);
      // Para atrás, al tramo 8 otra vez (40-45 s): vuelve a contar.
      await p.a('(A.video().currentTime = 39, true)');
      await esperarEnvio(n0, (t) => cifra(t, 8) >= 2, 20000, 'retroceder y volver a mirar no sumó');
      await pausar();
    });

    paso(entorno, 'con la pestaña oculta no cuenta; al volver, sí', async () => {
      const n0 = srv.respaldo.progresos.length;
      await abrir();
      await p.reproducir();
      await p.debe('A.comp() > 3', 15000, 'no arrancó');
      await p.a(OCULTAR);
      const desde = await p.a('A.comp()');
      await p.debe(`A.comp() > ${desde + 16}`, 25000, 'el video no siguió con la pestaña "oculta"');
      await dormir(5500);   // un envío más con la pestaña oculta
      const oculta = ultimo(n0);
      const hasta = await p.a('A.comp()');
      if (oculta) {
        const t = oculta.vistas.at(-1).tramos;
        for (let i = Math.floor(desde / 5) + 1; i < Math.floor(hasta / 5); i++) assert.equal(cifra(t, i), 0, `oculta, el tramo ${i} no cuenta: ${t}`);
      }
      await p.a(MOSTRAR);
      const i = Math.floor((await p.a('A.comp()')) / 5) + 1;
      await esperarEnvio(n0, (t) => cifra(t, i) >= 1, 20000, `a la vista otra vez, el tramo ${i} tenía que contar`);
      await pausar();
    });

    paso(entorno, 'transmitiendo a la TV cuenta igual, aunque el celular esté bloqueado (pestaña oculta)', async () => {
      const n0 = srv.respaldo.progresos.length;
      await abrirConTV(p, 'web', { query: { motor: 'hls', completar: '1' }, progreso: { completed: TODAS, currentTime: 0 } });
      await p.debe(`A.estado().botonTV === 'Transmitir a la TV'`, 10000, 'no apareció el botón de la TV');
      await p.reproducir();
      await p.debe('A.comp() > 1', 10000, 'no arrancó');
      await p.clic('.iv-tv-btn');
      await p.debe(`/^Reproduciendo en/.test(A.estado().capa || '') && window.__tv.receptor.estado === 'PLAYING'`, 15000, 'no pasó a la TV');
      await p.a(OCULTAR);
      const desde = await p.a('A.comp()');
      const i = Math.floor(desde / 5) + 2;
      await esperarEnvio(n0, (t) => cifra(t, i) >= 1 && cifra(t, i + 1) >= 1, 30000, `la TV reprodujo los tramos ${i} y ${i + 1} y no contaron`);
      const t = ultimo(n0).vistas.at(-1).tramos;
      assert.ok(!/[2-9]/.test(t.slice(0, i + 2)), `pasar a la TV no cuenta dos veces el tramo donde estaba: ${t}`);
      await p.a(MOSTRAR);
    });
  });
}
