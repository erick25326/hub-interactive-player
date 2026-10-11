// El candado bajo secuencias de ticks realistas: reproducción a varias velocidades,
// pausa lenta, saltos que no pidió el reproductor, restauración del avance. Las
// decisiones son las reales de src/candado.js; el resto es el modelo de
// apoyo/simulador.mjs (ver qué replica y qué no). Porta las propiedades clave del
// simulador con que se verificó la guardia (oct-2026), con semillas fijas.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearSimulador, mulberry32, MC, NOTA, VF, HS, ETIQUETA } from './apoyo/simulador.mjs';

const VELOCIDADES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const elegir = (azar, xs) => xs[Math.floor(azar() * xs.length)];
const veces = (sim, id) => sim.C.mostradas.filter((m) => m.id === id).length;

// Tiempos al azar en [desde, hasta] separados por al menos `sep` segundos.
function tiempos(azar, n, desde, hasta, sep) {
  for (;;) {
    const ts = Array.from({ length: n }, () => Math.round((desde + azar() * (hasta - desde)) * 1000) / 1000).sort((a, b) => a - b);
    if (ts.every((t, i) => i === 0 || t - ts[i - 1] >= sep)) return ts;
  }
}
function interaccionesAlAzar(azar, n, desde, hasta, sep, { hotspots = false } = {}) {
  const tipos = hotspots ? [MC, NOTA, VF, (id, t) => HS(id, t, azar() < 0.5 ? 3 : undefined)] : [MC, NOTA, VF];
  const ias = tiempos(azar, n, desde, hasta, sep).map((t, i) => elegir(azar, tipos)('i' + i, t));
  if (azar() < 0.5) ias.push(ETIQUETA('etq', Math.round((desde + azar() * (hasta - desde)) * 10) / 10));
  // A veces desordenado: el configurador guarda ordenado por tiempo, pero un JSON escrito
  // a mano (o generado) puede no estarlo.
  return azar() < 0.3 ? ias.reverse() : ias;
}
const preguntas = (ias) => ias.filter((ia) => ia.type !== 'label');
const enOrdenDeTiempo = (sim) => sim.C.mostradas.every((m, i, xs) => i === 0 || m.tiempo >= xs[i - 1].tiempo);
// El orden se exige sólo con el arreglo ordenado por tiempo (como lo guarda el
// configurador): con un JSON escrito a mano y desordenado, un mismo tick que cruza dos
// pendientes las muestra en el orden del ARREGLO. Aparecen las dos igual.
const ordenado = (ias) => preguntas(ias).every((ia, i, xs) => i === 0 || ia.time >= xs[i - 1].time);

describe('reproducción de corrido', () => {
  test('propiedad: a 0,5×–2× con pausa lenta, cada pregunta aparece una sola vez, en orden y nunca antes de su tiempo', () => {
    const azar = mulberry32(2026);
    for (let caso = 0; caso < 300; caso++) {
      const sep = elegir(azar, [0.2, 0.5, 1, 3]);
      const ias = interaccionesAlAzar(azar, 1 + Math.floor(azar() * 4), 3, 50, sep);
      const rate = elegir(azar, VELOCIDADES);
      const op = { interactions: ias, duracion: 60, rate, jitterMs: Math.floor(azar() * 80), latPausaMs: Math.floor(azar() * 600), respuestaMs: 500 + Math.floor(azar() * 2500), semilla: caso + 1 };
      const sim = crearSimulador(op);
      sim.listo(); sim.play();
      sim.correrHasta(() => sim.pos() >= 60);
      const donde = `caso ${caso} ${JSON.stringify({ rate, sep, latPausaMs: op.latPausaMs, ias: ias.map((i) => [i.id, i.time]) })}`;
      for (const ia of preguntas(ias)) assert.equal(veces(sim, ia.id), 1, `${ia.id} mostrada ${veces(sim, ia.id)} veces — ${donde}`);
      if (ordenado(ias)) assert.ok(enOrdenDeTiempo(sim), `fuera de orden — ${donde}`);
      for (const m of sim.C.mostradas) {
        assert.ok(m.en >= m.tiempo - 1e-9, `${m.id} frenó en ${m.en}, antes de ${m.tiempo} — ${donde}`);
        // Separadas por 3 s o más, frena dentro de un tick y la guardia no se mete.
        if (sep >= 3) {
          assert.ok(m.en - m.tiempo <= rate * (250 + 80 + 3) / 1000 + 1e-6, `${m.id} frenó tarde (${m.en}) — ${donde}`);
          assert.equal(m.porGuardia, false, `la guardia se metió en la reproducción normal — ${donde}`);
        }
      }
    }
  });

  // Pegadas: `n` preguntas separadas por `d` segundos, a partir de los 20.
  function pegadas({ n, d, rate, latPausaMs, desc = false, semilla }) {
    const ias = Array.from({ length: n }, (_, k) => (k % 2 ? VF : NOTA)('p' + k, 20 + k * d));
    if (desc) ias.reverse();
    const sim = crearSimulador({ interactions: ias, duracion: 40, rate, latPausaMs, respuestaMs: 1200, semilla });
    sim.listo(); sim.play();
    sim.correrHasta(() => sim.pos() >= 30);
    return { sim, ias, donde: JSON.stringify({ n, d, rate, latPausaMs, desc, semilla }) };
  }

  test('dos preguntas pegadas (0,2–1 s), en cualquier orden del arreglo, aparecen las dos aunque la pausa tarde hasta 900 ms', () => {
    let semilla = 0;
    for (const d of [0.2, 0.4, 0.6, 0.8, 1.0]) for (const rate of [1, 1.5, 2]) for (const latPausaMs of [0, 300, 600, 900])
      for (const desc of [false, true]) for (let r = 0; r < 3; r++) {
        const { sim, ias, donde } = pegadas({ n: 2, d, rate, latPausaMs, desc, semilla: ++semilla });
        for (const ia of ias) assert.equal(veces(sim, ia.id), 1, `${ia.id} — ${donde}`);
        if (!desc) assert.ok(enOrdenDeTiempo(sim), `fuera de orden — ${donde}`);
        for (const m of sim.C.mostradas) assert.ok(m.en >= m.tiempo - 1e-9, `${m.id} antes de tiempo — ${donde}`);
      }
  });

  test('tres preguntas pegadas con la pausa rápida (≤300 ms) aparecen las tres, en orden', () => {
    let semilla = 500;
    for (const d of [0.2, 0.4, 0.6, 0.8, 1.0]) for (const rate of [1, 1.5, 2]) for (const latPausaMs of [0, 300]) for (let r = 0; r < 3; r++) {
      const { sim, ias, donde } = pegadas({ n: 3, d, rate, latPausaMs, semilla: ++semilla });
      for (const ia of ias) assert.equal(veces(sim, ia.id), 1, `${ia.id} — ${donde}`);
      assert.ok(enOrdenDeTiempo(sim), `fuera de orden — ${donde}`);
    }
  });

  // 🔴 LÍMITE encontrado al portar el simulador (oct-2026), sin arreglar: con TRES
  // pendientes a ~0,2 s y una pausa que tarda ≥600 ms (Vimeo en un celular), cada
  // tarjeta se abre con el video ya pasado de la siguiente; el bucle muestra una por
  // render y la tercera queda más de 0,8 s detrás de `prev`: no la frena nadie (la
  // guardia sólo mira las que cruzó el último salto). Con dos pegadas no pasa (prueba de
  // arriba). Raro en un curso real; si se arregla, sacar el `todo`.
  test('tres preguntas pegadas con la pausa lenta (600 ms) no pierden la tercera', {
    todo: 'límite conocido: la tercera pendiente queda detrás de prev (ver el comentario)',
  }, () => {
    const { sim, ias, donde } = pegadas({ n: 3, d: 0.2, rate: 1.5, latPausaMs: 600, semilla: 24 });
    for (const ia of ias) assert.equal(veces(sim, ia.id), 1, `${ia.id} — ${donde}`);
  });

  test('un play de afuera con la pregunta abierta (auriculares, Centro de control) se vuelve a pausar', () => {
    const sim = crearSimulador({ interactions: [MC('q10', 10)], duracion: 30, respuestaMs: null });
    sim.listo(); sim.play();
    assert.ok(sim.correrHasta(() => sim.C.activa != null));
    sim.correrHasta(() => !sim.M.reproduciendo);
    const quieto = sim.pos();
    sim.playDeAfuera();
    sim.esperar(10000);   // corre el reloj un buen rato
    assert.equal(sim.M.reproduciendo, false);
    assert.ok(sim.pos() - quieto < 0.2, `el video corrió por detrás de la pregunta: de ${quieto} a ${sim.pos()}`);
  });
});

describe('saltos que no pidió el reproductor (la guardia)', () => {
  test('propiedad: con saltos externos hacia adelante, en pausa o reproduciendo, ninguna pregunta se saltea y aparecen en orden', () => {
    const azar = mulberry32(15);
    for (let caso = 0; caso < 400; caso++) {
      const ias = interaccionesAlAzar(azar, 2 + Math.floor(azar() * 4), 3, 70, 0.3, { hotspots: true });
      const rate = elegir(azar, VELOCIDADES);
      const sim = crearSimulador({ interactions: ias, duracion: 90, rate, latPausaMs: Math.floor(azar() * 500), respuestaMs: 800 + Math.floor(azar() * 2000), semilla: 100 + caso });
      sim.listo(); sim.play();
      // Entre 1 y 3 saltos en momentos al azar, a veces con el video en pausa (salto en la
      // pantalla de bloqueo). Con una tarjeta abierta no: eso tiene sus propias pruebas
      // más abajo (y un caso que hoy falla, marcado como pendiente).
      const saltos = [];
      let w = 0;
      for (let k = 1 + Math.floor(azar() * 3); k > 0; k--) {
        w += 1000 + azar() * 15000;
        const largo = 1 + azar() * 40, enPausa = azar() < 0.4;
        saltos.push({ w, largo, enPausa });
        sim.at(w, () => {
          if (sim.C.activa) return;
          const destino = Math.min(85, sim.pos() + largo);
          if (enPausa) {
            sim.pausa();
            sim.at(sim.ahora + 300, () => { if (!sim.C.activa) sim.saltoExterno(Math.min(85, sim.pos() + largo)); });
            sim.at(sim.ahora + 2500, () => sim.play());   // el alumno vuelve y le da play
          } else sim.saltoExterno(destino);
        });
      }
      // Si quedó en pausa sin tarjeta (un salto que no cruzó nada), el alumno sigue.
      const seguir = () => { if (!sim.C.activa && !sim.M.reproduciendo && sim.pos() < 90) sim.play(); sim.at(sim.ahora + 5000, seguir); };
      sim.at(20000, seguir);
      sim.correrHasta(() => sim.pos() >= 89.5 && !sim.C.activa);
      const donde = `caso ${caso} ${JSON.stringify({ rate, saltos: saltos.map((s) => [Math.round(s.w), +s.largo.toFixed(2), s.enPausa]), ias: ias.map((i) => [i.id, i.type, i.time, i.duration]), mostradas: sim.C.mostradas.map((m) => [m.id, +m.en.toFixed(2)]) })}`;
      for (const ia of preguntas(ias)) assert.equal(veces(sim, ia.id), 1, `${ia.id} mostrada ${veces(sim, ia.id)} veces — ${donde}`);
      if (ordenado(ias)) assert.ok(enOrdenDeTiempo(sim), `fuera de orden — ${donde}`);
    }
  });

  test('con el video quieto, un salto externo muestra la pregunta en el acto, sin esperar otro tick', () => {
    const sim = crearSimulador({ interactions: [NOTA('n8', 8), VF('tf25', 25)], duracion: 120, respuestaMs: null });
    sim.listo();
    sim.saltoExterno(40);
    const antes = sim.M.timeupdates;
    sim.correrHasta(() => sim.M.timeupdates > antes);   // procesa SÓLO el timeupdate del salto
    assert.equal(sim.C.activa?.id, 'n8');
    assert.equal(sim.C.currentTime, 8);
    assert.equal(sim.M.timeupdates, antes + 1);
  });

  test('un salto de 10 a 60,2 que cruza dos pendientes vuelve a la de los 25, en pausa y reproduciendo', () => {
    for (const reproduciendo of [false, true]) {
      const sim = crearSimulador({ interactions: [NOTA('n8', 8), VF('tf25', 25), MC('q40', 40)], duracion: 120, respuestaMs: null });
      sim.listo();
      sim.restaurar({ completed: ['n8'], currentTime: 10 });
      sim.esperar(4000);   // fuera de la ventana de 3 s de la restauración
      if (reproduciendo) { sim.play(); sim.correrHasta(() => sim.C.currentTime > 11.5); }
      sim.saltoExterno(60.2);
      sim.correrHasta(() => sim.C.activa != null);
      assert.equal(sim.C.activa.id, 'tf25', `reproduciendo=${reproduciendo}`);
      assert.equal(sim.C.currentTime, 25);
      sim.esperar(15000);
      assert.ok(Math.abs(sim.pos() - 25) < 0.2, `el medio no volvió a 25: ${sim.pos()}`);
    }
  });

  // Con una pregunta abierta el efecto de disparo no corre: un salto hecho en ese rato
  // (Vimeo en la pantalla de bloqueo, el control del Apple TV) lo corrige la guardia
  // recién al cerrar la tarjeta.
  test('un salto externo con la tarjeta abierta se corrige al cerrarla: vuelve a la primera pendiente que cruzó', () => {
    const sim = crearSimulador({ interactions: [NOTA('n10', 10), MC('q20', 20), VF('tf30', 30)], duracion: 120, respuestaMs: null });
    sim.listo(); sim.play();
    sim.correrHasta(() => sim.C.activa != null);
    assert.equal(sim.C.activa.id, 'n10');
    sim.correrHasta(() => !sim.M.reproduciendo);
    sim.saltoExterno(35);
    sim.correrHasta(() => sim.pos() === 35 && sim.C.currentTime === 35);
    sim.cerrar();
    sim.correrHasta(() => sim.C.activa != null);
    assert.equal(sim.C.activa.id, 'q20');
    assert.equal(sim.C.currentTime, 20);
  });

  // Bug encontrado al portar el simulador y ARREGLADO (oct-2026): cuando la tarjeta la
  // abrió la GUARDIA, prevTimeRef se quedaba en el destino del primer salto (60,55) y no
  // en la vuelta (38,06). Un segundo salto con la tarjeta abierta que caía ANTES de ese
  // destino (48,06) se leía al cerrar como un salto hacia atrás y la pendiente del medio
  // (40,785) se perdía. Ahora la guardia lleva prevTimeRef a `vuelta`.
  test('un segundo salto externo con la tarjeta de la guardia abierta no saltea las pendientes del medio', () => {
    const sim = crearSimulador({ interactions: [VF('tf38', 38.06), MC('q40', 40.785)], duracion: 120, respuestaMs: null });
    sim.listo();
    sim.restaurar({ completed: [], currentTime: 36.6 });
    sim.esperar(4000);
    sim.saltoExterno(60.55);
    sim.correrHasta(() => sim.C.activa != null);
    assert.equal(sim.C.activa.id, 'tf38');
    sim.esperar(1000);
    sim.saltoExterno(48.06);
    sim.esperar(1000);
    sim.cerrar();
    sim.correrHasta(() => sim.C.activa != null || sim.pos() >= 70);
    assert.equal(sim.C.activa?.id, 'q40');
  });

  test('un salto externo dentro de la ventana de un salto propio igual pasa por la guardia (cuenta el destino, no sólo el reloj)', () => {
    const sim = crearSimulador({ interactions: [NOTA('n8', 8), VF('tf25', 25), MC('q40', 40)], duracion: 120, respuestaMs: null });
    sim.listo();
    sim.restaurar({ completed: ['n8'], currentTime: 10 });
    sim.esperar(3500);
    sim.play();
    sim.correrHasta(() => sim.C.currentTime > 11);
    sim.saltoPropio(21);                          // skip +10: no cruza nada
    sim.correrHasta(() => sim.C.seekTarget == null);
    sim.esperar(400);                             // 400 ms después, adentro de los 1,5 s
    assert.equal(sim.C.mostradas.length, 0);
    const ventana = sim.C.propioHasta;
    sim.saltoExterno(60.2);
    sim.correrHasta(() => sim.C.tiempos.at(-1).t === 60.2 || sim.C.activa != null);
    assert.ok(sim.ahora <= ventana, 'la prueba tenía que caer dentro de la ventana del salto propio');
    sim.correrHasta(() => sim.C.activa != null);
    assert.equal(sim.C.activa.id, 'tf25');
  });

  // El skip y el scrub frenan en la próxima pendiente (lo decide el componente) y el
  // medio puede aterrizar unas centésimas antes: la rama de seek de debeFrenar la frena
  // igual, en el acto, también en pausa. Si no, quedaba parado delante de la pregunta.
  test('el skip que aterriza en la pendiente, o hasta 0,25 s antes, la frena en el acto (en pausa o reproduciendo)', () => {
    const azar = mulberry32(10);
    for (let caso = 0; caso < 200; caso++) {
      const T = 30 + Math.round(azar() * 10000) / 1000;
      const distancia = 2.5 + azar() * 9, antes = azar() * 0.25, reproduciendo = azar() < 0.5;
      const sim = crearSimulador({ interactions: [MC('q', T)], duracion: 80, rate: elegir(azar, [1, 2]), respuestaMs: null, semilla: caso + 1 });
      sim.listo();
      sim.restaurar({ currentTime: T - distancia });
      sim.esperar(3500);
      if (reproduciendo) { sim.play(); sim.esperar(500); }
      if (sim.C.activa) continue;   // a 2× pudo llegar sola: no es el caso que se prueba
      const desde = sim.C.currentTime, donde = JSON.stringify({ caso, T, distancia, antes, reproduciendo, desde });
      sim.saltoPropio(T - antes);
      if (T - antes - desde > 2) {
        assert.equal(sim.C.activa?.id, 'q', donde);
      } else {
        // Un salto de menos de 2 s es reproducción para debeFrenar: no frena antes de
        // tiempo, la frena al llegar.
        assert.equal(sim.C.activa, null, donde);
        sim.correrHasta(() => sim.C.activa != null);
        assert.ok(sim.C.mostradas[0].en >= T, donde);
      }
    }
  });

  test('un salto propio que no cruza nada no muestra tarjetas ni vuelve atrás', () => {
    const sim = crearSimulador({ interactions: [NOTA('n8', 8), VF('tf25', 25), MC('q45', 45)], duracion: 120, respuestaMs: null });
    sim.listo();
    sim.restaurar({ completed: ['n8', 'tf25'], currentTime: 30 });
    sim.esperar(3500);
    sim.play();
    sim.correrHasta(() => sim.C.currentTime > 30.7);
    const desde = sim.C.tiempos.length;
    sim.saltoPropio(40.7);
    sim.correrHasta(() => sim.C.currentTime > 43);
    assert.equal(sim.C.mostradas.length, 0);
    assert.ok(sim.C.tiempos.slice(desde).every((x) => x.t >= 40.7 - 1e-9), 'el tiempo volvió atrás después del salto');
  });
});

describe('restaurar el avance (restauración optimista)', () => {
  const ias = () => [NOTA('n8', 8), VF('tf25', 25), MC('q50', 50)];

  test('un avance guardado más allá de una pendiente retoma en ella y la muestra sin esperar al play', () => {
    const sim = crearSimulador({ interactions: ias(), duracion: 120, respuestaMs: null });
    sim.listo();
    sim.restaurar({ completed: ['n8'], currentTime: 40 });
    sim.esperar(2000);
    assert.equal(sim.C.activa?.id, 'tf25');
    assert.equal(sim.C.currentTime, 25);
  });

  test('un avance normal se retoma donde quedó, sin arrastrar hacia atrás al reproducir', () => {
    const sim = crearSimulador({ interactions: ias(), duracion: 120, respuestaMs: null });
    sim.listo();
    sim.restaurar({ completed: ['n8'], currentTime: 15 });
    sim.esperar(2000);
    assert.equal(sim.C.activa, null);
    assert.equal(sim.C.currentTime, 15);
    const desde = sim.C.tiempos.length;
    sim.play();
    sim.correrHasta(() => sim.C.currentTime > 18);
    assert.equal(sim.C.mostradas.length, 0);
    assert.ok(sim.C.tiempos.slice(desde).every((x) => x.t >= 15), 'el primer tick arrastró al alumno hacia atrás');
    sim.correrHasta(() => sim.C.activa != null);
    assert.equal(sim.C.activa.id, 'tf25');
    assert.ok(sim.C.currentTime >= 25);
  });

  test('un salto externo apenas restaurado (dentro de los 3 s) igual pasa por la guardia', () => {
    const sim = crearSimulador({ interactions: ias(), duracion: 120, respuestaMs: null });
    sim.listo();
    sim.restaurar({ completed: ['n8'], currentTime: 10 });
    sim.esperar(1500);
    const ventana = sim.C.propioHasta;
    sim.saltoExterno(60.2);
    sim.correrHasta(() => sim.C.activa != null);
    assert.ok(sim.ahora <= ventana, 'la prueba tenía que caer dentro de la ventana de la restauración');
    assert.equal(sim.C.activa.id, 'tf25');
    assert.equal(sim.C.currentTime, 25);
  });
});
