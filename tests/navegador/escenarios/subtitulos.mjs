// Subtítulos de la lección (subtitlesVtt, lo que manda player.php desde "Editar
// transcripción"), en el reproductor de verdad: el botón aparece sólo si hay cues,
// arrancan apagados, el texto que se dibuja es el del cue del segundo que muestra el
// componente, y con una tarjeta abierta no se dibujan (quedarían encima de ella).
// El parser en sí (parseVTT) tiene sus pruebas unitarias.
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { CUES_PRUEBA } from '../apoyo/servidor.mjs';
import { dormir } from '../apoyo/chrome.mjs';

// Lo que se tiene que ver en el segundo t (o null).
const cueEn = (t) => (CUES_PRUEBA.find(([a, b]) => t >= a && t <= b) || [])[2] ?? null;
// Al borde de un cue el texto puede ir un tick adelante o atrás: no se juzga.
const enBorde = (t) => CUES_PRUEBA.some(([a, b]) => Math.abs(t - a) < 0.35 || Math.abs(t - b) < 0.35);

export function registrar(entorno) {
  describe('subtítulos', () => {
    const p = entorno.pagina;

    paso(entorno, 'sin cues no hay botón de subtítulos', async () => {
      const e = await p.abrir({ query: { motor: 'hls' } });
      assert.equal(e.subsBtn, null, 'apareció el botón sin subtítulos cargados');
    });

    paso(entorno, 'con cues: el botón arranca apagado, el texto sale en su tiempo y nunca encima de una tarjeta', async (t) => {
      let e = await p.abrir({ query: { motor: 'hls', subs: 'vtt' } });
      assert.equal(e.subsBtn, 'false', 'con cues el botón tiene que estar, y apagado');
      await p.reproducir();
      await p.debe(`A.comp() > 2`, 10000, 'no arrancó a reproducir');
      e = await p.estado();
      assert.equal(e.subtitulo, null, `apagados no se dibujan aunque haya cue: ${JSON.stringify(e)}`);
      await p.clic('button[aria-label="Subtítulos"]');
      await p.debe(`A.estado().subsBtn === 'true'`, 3000, 'el botón no se prendió');
      const desde = await p.a('A.ms()');
      // La nota de los 8 s, con el cue de 6 a 10,5 activo por detrás.
      await p.debe(`A.tarjeta()?.id === 'n8'`, 15000, 'no frenó en la nota de los 8');
      await dormir(700);
      await p.responder();
      await p.debe(`A.comp() > 11.2`, 10000, 'no siguió después de la nota');
      const muestras = (await p.a('A.muestras')).filter((m) => m.ms >= desde && m.comp != null);
      let juzgadas = 0;
      const malas = [], vistos = new Set();
      for (const m of muestras) {
        if (m.subtitulo) vistos.add(m.subtitulo);
        if (m.tarjeta) { if (m.subtitulo) malas.push({ ...m, motivo: 'texto encima de la tarjeta' }); continue; }
        if (enBorde(m.comp)) continue;
        juzgadas++;
        if (m.subtitulo !== cueEn(m.comp)) malas.push({ ...m, esperado: cueEn(m.comp) });
      }
      t.diagnostic(`${muestras.length} muestras, ${juzgadas} juzgadas, ${muestras.filter((m) => m.tarjeta).length} con la tarjeta abierta`);
      assert.deepEqual(malas.slice(0, 6), [], 'subtítulo equivocado, fuera de tiempo o encima de la tarjeta');
      // Que no pase de vacío: se vieron los dos textos y hubo muestras con la tarjeta.
      assert.ok(vistos.has(CUES_PRUEBA[0][2]) && vistos.has(CUES_PRUEBA[1][2]), `no se vieron los dos cues: ${JSON.stringify([...vistos])}`);
      assert.ok(muestras.some((m) => m.tarjeta), 'no hubo muestras con la tarjeta abierta');
    });
  });
}
