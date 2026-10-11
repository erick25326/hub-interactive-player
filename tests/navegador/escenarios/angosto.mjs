// La fila de controles en un celular angosto, en el caso más cargado: el reproductor
// en un iframe del campus (contador y Reiniciar), subtítulos, una TV a la vista y la
// pantalla completa SIMULADA (la del iPhone: la madre agranda el iframe), con el
// celular parado (aparece el botón de girar). 🔴 El botón de SALIR de pantalla
// completa no se puede recortar nunca: si no, el alumno no tiene cómo salir. Ya pasó
// dos veces (320 px; y entre 341 y ~365 px con el botón de girar, oct-2026).
// Se entra con un TOQUE real (pantalla táctil emulada), como en el celular.
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { dormir } from '../apoyo/chrome.mjs';

export function registrar(entorno) {
  const p = entorno.pagina;
  describe('celular angosto · pantalla completa simulada', () => {
    for (const ancho of [320, 360]) {
      paso(entorno, `a ${ancho} px el botón de salir de pantalla completa queda entero y se puede tocar`, async (t) => {
        await p.vista({ ancho, alto: 740, movil: true, escala: 2, tactil: true });
        try {
          await p.abrir({
            pagina: 'marco.html',
            // nofs: sin pantalla completa nativa (como el iPhone), la pide a la madre.
            query: { motor: 'hls', subs: 'vtt', cast: 'fake', nofs: '1', ancho: `${ancho}px` },
            progreso: { completed: ['n8'], currentTime: 1 },
          });
          // Con la TV a la vista el botón existe (aunque a este ancho vaya a Ajustes).
          await p.debe(`!!D.querySelector('.iv-tv-btn')`, 10000, 'no apareció el botón de la TV');
          await p.toque('.iv-fs-btn');
          await p.debe(`A.estado().botonFS === 'Salir de pantalla completa'`, 5000, 'no entró a la pantalla completa simulada');
          // La etiqueta cambia en el acto (estado optimista); la madre agranda el iframe
          // cuando le llega el mensaje, un poco después.
          assert.ok(await p.esperarArriba(`document.querySelector('iframe').classList.contains('css-fs')`, 3000), 'la madre no agrandó el iframe');
          await p.a('D.fonts.ready.then(() => true)');
          await dormir(500);
          const m = await p.a(`(() => {
            const c = D.querySelector('.iv-container').getBoundingClientRect();
            const fila = D.querySelector('.iv-controls-row');
            const b = D.querySelector('.iv-fs-btn').getBoundingClientRect();
            const play = D.querySelector('.iv-controls-row .iv-ctrl-btn').getBoundingClientRect().width;
            const x = b.left + b.width / 2, y = b.top + b.height / 2;
            const h = D.elementFromPoint(x, y);
            const visibles = [...fila.children].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('aria-label') || e.className);
            return { contenedor: [c.left, c.right], boton: [b.left, b.right, b.width], play, sobra: fila.clientWidth - fila.scrollWidth,
              tocable: !!h && !!h.closest('.iv-fs-btn'), girar: !!D.querySelector('[aria-label="Ver horizontal"]'),
              subs: !!D.querySelector('button[aria-label="Subtítulos"]'), reiniciar: !!D.querySelector('.iv-reset-ctrl'), visibles };
          })()`);
          t.diagnostic(`${ancho} px: ${JSON.stringify(m)}`);
          // Que sea el caso cargado de verdad (si no, la prueba sería fácil).
          assert.ok(m.girar && m.subs && m.reiniciar, `faltan botones del caso cargado: ${JSON.stringify(m)}`);
          // Mismo ancho que el de reproducir: no se aplasta para entrar. Ojo, lo que hace
          // entrar la fila NO es el `flex-shrink: 0` de .iv-fs-btn (sin él los botones
          // tampoco se achican: no bajan de su min-content, el ícono de tamaño fijo). Son
          // las consultas de contenedor de styles.css: a ≤340 px esconden la duración
          // total y el contador, y mandan el botón de la TV a Ajustes (a ≤372 si está el
          // de girar). Sacar la de la duración y el contador hace desbordar la fila 28 px
          // a 320 y deja este botón afuera (medido con una mutación, oct-2026).
          assert.ok(m.boton[2] >= m.play - 0.5, `el botón se achicó: ${m.boton[2]} px contra ${m.play} del de reproducir`);
          assert.ok(m.boton[0] >= m.contenedor[0] - 0.5 && m.boton[1] <= m.contenedor[1] + 0.5, `el botón de salir se sale del reproductor: ${JSON.stringify(m)}`);
          assert.ok(m.sobra >= 0, `la fila desborda ${-m.sobra} px: ${JSON.stringify(m)}`);
          assert.ok(m.tocable, `en el centro del botón de salir hay otra cosa: ${JSON.stringify(m)}`);
          // Y sale de verdad.
          await p.toque('.iv-fs-btn');
          await p.debe(`A.estado().botonFS === 'Pantalla completa'`, 5000, 'el botón de salir no sacó de la pantalla completa');
        } finally {
          await p.vista();
        }
      });
    }
  });
}
