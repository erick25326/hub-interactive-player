// La TARJETA DE FIN del video (src/finVideo.js): de dónde sale el destino de "Siguiente
// lección" (la barra del tema en la página de arriba), qué se acepta como destino, cuándo
// se puede decir "Lección completada" y qué dice la tarjeta. Lo que hace el componente con
// esto (cuándo aparece, el foco, Escape, navegar), tests/navegador/escenarios/fin.mjs.
// Las URLs y los nombres son sintéticos.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leerBarraDelTema, destinoDeFin, leccionCompletada, textosDeFin, SELECTOR_SIGUIENTE } from '../../src/finVideo.js';

const BASE = 'https://campus.ejemplo.test/mod/ivplayer/view.php?id=7';
const barra = (href, { nombre = 'Lección 2: Partes del dron', fin = false } = {}) => ({ href, nombre, fin, base: BASE });

describe('destinoDeFin: a dónde lleva "Siguiente lección"', () => {
  test('la próxima lección del mismo campus, con su nombre (espacios del HTML colapsados)', () => {
    assert.deepEqual(destinoDeFin(barra('https://campus.ejemplo.test/mod/ivplayer/view.php?id=8', { nombre: '\n  Lección 2:\n   Partes del dron  ' })),
      { url: 'https://campus.ejemplo.test/mod/ivplayer/view.php?id=8', nombre: 'Lección 2: Partes del dron', ultima: false });
  });

  test('un enlace relativo se resuelve contra la página de arriba', () => {
    assert.equal(destinoDeFin(barra('/mod/page/view.php?id=9')).url, 'https://campus.ejemplo.test/mod/page/view.php?id=9');
  });

  test('la última lección: el tema marca `end` y el enlace va al curso → "Volver al curso", sin nombre', () => {
    const d = destinoDeFin(barra('https://campus.ejemplo.test/course/view.php?id=2', { nombre: 'Volver al curso', fin: true }));
    assert.deepEqual(d, { url: 'https://campus.ejemplo.test/course/view.php?id=2', nombre: '', ultima: true });
  });

  test('también es la última si el destino es la página del curso aunque falte `end`', () => {
    assert.equal(destinoDeFin(barra('/course/view.php?id=2', { nombre: 'Volver al curso' })).ultima, true);
  });

  test('"Marcar completada y continuar" (togglecompletion.php) se usa tal cual; el nombre es el de la próxima', () => {
    const backto = 'https://campus.ejemplo.test/mod/ivplayer/view.php?id=8';
    const href = `https://campus.ejemplo.test/course/togglecompletion.php?id=7&completionstate=1&sesskey=sk&backto=${encodeURIComponent(backto)}`;
    assert.deepEqual(destinoDeFin(barra(href)), { url: href, nombre: 'Lección 2: Partes del dron', ultima: false });
  });

  test('togglecompletion.php en la última lección (backto = el curso): "Volver al curso"', () => {
    const href = `/course/togglecompletion.php?id=7&completionstate=1&sesskey=sk&backto=${encodeURIComponent('https://campus.ejemplo.test/course/view.php?id=2')}`;
    const d = destinoDeFin(barra(href, { nombre: 'Volver al curso' }));
    assert.equal(d.ultima, true);
    assert.equal(d.nombre, '');
    assert.match(d.url, /togglecompletion\.php/, 'el enlace es el de marcar y seguir, no el backto');
  });

  test('nada de otro origen, de otro esquema, vacío o sólo "#…": sin destino (sólo "Volver a ver")', () => {
    for (const href of ['https://otro.ejemplo.test/mod/ivplayer/view.php?id=8', 'http://campus.ejemplo.test/mod/ivplayer/view.php?id=8',
      'javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,hola', '', '   ', '#', '#arriba', '//otro.ejemplo.test/x']) {
      assert.equal(destinoDeFin(barra(href)), null, `aceptó ${JSON.stringify(href)}`);
    }
  });

  test('sin barra, sin href o con una base rota: null', () => {
    assert.equal(destinoDeFin(null), null);
    assert.equal(destinoDeFin({ nombre: 'x', base: BASE }), null);
    assert.equal(destinoDeFin({ href: '/x', nombre: 'x', base: 'no es una url' }), null);
  });
});

describe('leerBarraDelTema: la barra en la página de ARRIBA', () => {
  // Un DOM mínimo: lo que la función usa de un <a> y de un documento.
  const enlace = ({ href, nombre, clases = ['hub-lnav-btn', 'next'] }) => ({
    getAttribute: (k) => (k === 'href' ? href : null),
    classList: { contains: (c) => clases.includes(c) },
    querySelector: (s) => (s === '.hub-lnav-name' && nombre != null ? { textContent: nombre } : null),
  });
  const ventanaCon = (a, href = BASE) => {
    const top = { document: { querySelector: (s) => (s === SELECTOR_SIGUIENTE ? a : null) }, location: { href } };
    return { top };
  };

  test('el selector es el del tema: el botón de la derecha de .hub-lnav', () => {
    assert.equal(SELECTOR_SIGUIENTE, '.hub-lnav .hub-lnav-btn.next');
    // El tema (campus-theme, hook_callbacks::course_activity_nav_html) arma exactamente esto.
    const reproductor = readFileSync(new URL('../../src/InteractiveVideoPlayer.jsx', import.meta.url), 'utf8');
    assert.match(reproductor, /leerBarraDelTema\(window\)/, 'el componente lee la barra de su propia ventana (y de ahí, la de arriba)');
  });

  test('lee href, nombre, si es la última y la URL de la página de arriba', () => {
    assert.deepEqual(leerBarraDelTema(ventanaCon(enlace({ href: '/mod/ivplayer/view.php?id=8', nombre: 'Lección 2' }))),
      { href: '/mod/ivplayer/view.php?id=8', nombre: 'Lección 2', fin: false, base: BASE });
    assert.equal(leerBarraDelTema(ventanaCon(enlace({ href: '/course/view.php?id=2', nombre: 'Volver al curso', clases: ['hub-lnav-btn', 'next', 'end'] }))).fin, true);
    assert.equal(leerBarraDelTema(ventanaCon(enlace({ href: '/x', nombre: null }))).nombre, '', 'sin el nombre, vacío');
  });

  test('sin barra (fuera del campus, el configurador, la demo de la web): null', () => {
    assert.equal(leerBarraDelTema(ventanaCon(null)), null);
    assert.equal(leerBarraDelTema(null), null);
  });

  test('la página de arriba de otro origen (leer su document tira): null, sin romper', () => {
    const ajena = { get top() { return { get document() { throw new Error('SecurityError'); }, location: {} }; } };
    assert.equal(leerBarraDelTema(ajena), null);
  });
});

describe('leccionCompletada: ¿"Lección completada" o "Terminaste el video"?', () => {
  const IAS = [
    { id: 'n8', type: 'note', time: 8 }, { id: 'tf25', type: 'true-false', time: 25 },
    { id: 'et', type: 'label', time: 3 },
  ];
  test('con quien la registre (Moodle o SCORM) y todo respondido (las etiquetas no cuentan)', () => {
    assert.equal(leccionCompletada({ interactions: IAS, completed: new Set(['n8', 'tf25']), registra: true }), true);
    assert.equal(leccionCompletada({ interactions: [], completed: new Set(), registra: true }), true, 'un video sin interacciones');
    assert.equal(leccionCompletada({ interactions: IAS, completed: ['n8', 'tf25'], registra: true }), true, 'también con un array');
  });
  test('con una pendiente sin responder: "Terminaste el video" (no se manda complete.php)', () => {
    assert.equal(leccionCompletada({ interactions: IAS, completed: new Set(['n8']), registra: true }), false);
  });
  test('ya estaba completada (MOODLE_CONTEXT.alreadyCompleted): completada, aunque se haya reiniciado', () => {
    assert.equal(leccionCompletada({ interactions: IAS, completed: new Set(), registra: true, yaCompletada: true }), true);
  });
  test('sin nadie que la registre (la demo de la web, el configurador): no se puede saber', () => {
    assert.equal(leccionCompletada({ interactions: IAS, completed: new Set(['n8', 'tf25']), registra: false }), false);
    assert.equal(leccionCompletada({ interactions: IAS, completed: new Set(['n8', 'tf25']), registra: false, yaCompletada: true }), false);
  });
});

describe('textosDeFin', () => {
  const sig = { url: 'https://campus.ejemplo.test/mod/ivplayer/view.php?id=8', nombre: 'Lección 2: Partes del dron', ultima: false };
  test('completada, con la próxima lección', () => {
    assert.deepEqual(textosDeFin({ completada: true, destino: sig }), { titulo: 'Lección completada', siguiente: 'Lección 2: Partes del dron', principal: 'Siguiente lección' });
  });
  test('sin saber si se completó', () => {
    assert.equal(textosDeFin({ completada: false, destino: sig }).titulo, 'Terminaste el video');
  });
  test('la última lección: "Volver al curso", sin "Siguiente: …"', () => {
    assert.deepEqual(textosDeFin({ completada: true, destino: { url: '/course/view.php?id=2', nombre: '', ultima: true } }), { titulo: 'Lección completada', siguiente: null, principal: 'Volver al curso' });
  });
  test('sin barra: sin botón principal (sólo "Volver a ver")', () => {
    assert.deepEqual(textosDeFin({ completada: false, destino: null }), { titulo: 'Terminaste el video', siguiente: null, principal: null });
  });
  test('una próxima sin nombre: el botón igual, sin "Siguiente: …"', () => {
    assert.deepEqual(textosDeFin({ completada: true, destino: { ...sig, nombre: '' } }), { titulo: 'Lección completada', siguiente: null, principal: 'Siguiente lección' });
  });
  test('sin emojis: el tilde es un SVG del componente, no un carácter del texto', () => {
    for (const x of [textosDeFin({ completada: true, destino: sig }), textosDeFin({ completada: false, destino: null })]) {
      assert.ok(!/[✀-➿\u{1F300}-\u{1FAFF}]/u.test(Object.values(x).join(' ')), JSON.stringify(x));
    }
  });
});

// El cableado en el componente que estas funciones no ven: el video ya no vuelve a 0 ni
// repite solo al terminar (la tarjeta lo frena), y la tarjeta la abre un efecto DESPUÉS
// del de disparo (una pregunta del final va primero). Lo prueba de verdad el nivel
// navegador; esto avisa rápido si alguien vuelve a poner el bucle.
describe('el componente', () => {
  const jsx = readFileSync(new URL('../../src/InteractiveVideoPlayer.jsx', import.meta.url), 'utf8');
  test('alTerminar no rebobina ni repite: ni config.loop ni setCurrentTime(0) ahí adentro', () => {
    const m = /alTerminarRef\.current=\(\)=>\{([\s\S]*?)\n  \};/.exec(jsx);
    assert.ok(m, 'no encontré alTerminar');
    assert.ok(!/config\.loop|setCurrentTime\(0\)|\.play\(/.test(m[1]), 'alTerminar volvió a rebobinar o a reproducir');
    assert.ok(!/config\.loop/.test(jsx), 'config.loop volvió a usarse en el componente');
  });
  test('el efecto de la tarjeta va después del de disparo', () => {
    const disparo = jsx.indexOf('const mostrar=(ia)=>');
    const tarjeta = jsx.indexOf('abrirTarjetaFinRef.current();');
    assert.ok(disparo > 0 && tarjeta > disparo, `disparo ${disparo}, tarjeta ${tarjeta}`);
  });
});

describe('el toque de fin de lección (1.5.0)', async () => {
  const { PULSO_PREGUNTA, PULSO_GRUPOS, pulsoGuardado, alternarPulso, comentarioParaEnviar, COMENTARIO_MAX, TEXTOS_COMENTARIO } = await import('../../src/finVideo.js');
  const VACIO = { dificultad: null, utilidad: null };

  test('la pregunta y las cinco opciones: los textos y el orden de Erick, en dos grupos', () => {
    assert.equal(PULSO_PREGUNTA, '¿Cómo te resultó esta lección?');
    assert.deepEqual(PULSO_GRUPOS.map((g) => [g.clave, g.opciones]), [
      ['dificultad', [['bien', 'La seguí bien'], ['costo', 'Me costó un poco'], ['perdi', 'Me perdí']]],
      ['utilidad', [['poco', 'Sentí que no me aportó mucho'], ['nada', 'Sentí que no me aportó nada']]],
    ]);
  });

  test('los mismos códigos que el servidor (ivplayer_pulso_opciones en lib.php)', () => {
    const lib = readFileSync(new URL('../../mod/ivplayer/lib.php', import.meta.url), 'utf8');
    const m = /function ivplayer_pulso_opciones\(\): array \{\s*return (\[.*?\]);/s.exec(lib);
    assert.ok(m, 'no encontré ivplayer_pulso_opciones');
    assert.equal(m[1], "['dificultad' => ['bien', 'costo', 'perdi'], 'utilidad' => ['poco', 'nada']]");
  });

  test('hasta una de cada grupo: tocar otra la cambia, tocar la marcada la saca', () => {
    let e = alternarPulso(VACIO, 'dificultad', 'costo');
    assert.deepEqual(e, { dificultad: 'costo', utilidad: null });
    e = alternarPulso(e, 'utilidad', 'poco');
    assert.deepEqual(e, { dificultad: 'costo', utilidad: 'poco' });
    e = alternarPulso(e, 'dificultad', 'perdi');
    assert.deepEqual(e, { dificultad: 'perdi', utilidad: 'poco' });
    e = alternarPulso(e, 'utilidad', 'poco');
    assert.deepEqual(e, { dificultad: 'perdi', utilidad: null });
  });

  test('una opción de otro grupo o desconocida no cambia nada', () => {
    const e = { dificultad: 'bien', utilidad: null };
    assert.equal(alternarPulso(e, 'dificultad', 'nada'), e);
    assert.equal(alternarPulso(e, 'otra', 'bien'), e);
  });

  test('lo guardado: sólo códigos válidos de su grupo', () => {
    assert.deepEqual(pulsoGuardado({ dificultad: 'perdi', utilidad: 'nada' }), { dificultad: 'perdi', utilidad: 'nada' });
    assert.deepEqual(pulsoGuardado({ dificultad: 'nada', utilidad: 'x' }), VACIO);
    assert.deepEqual(pulsoGuardado(null), VACIO);
    assert.deepEqual(pulsoGuardado('bien'), VACIO);
  });

  test('el comentario: sin espacios en las puntas, hasta 1000, vacío no se manda', () => {
    assert.equal(comentarioParaEnviar('  ¿Y el downlink?  '), '¿Y el downlink?');
    assert.equal(comentarioParaEnviar(' \n '), null);
    assert.equal(comentarioParaEnviar(undefined), null);
    assert.equal(comentarioParaEnviar('x'.repeat(1500)).length, COMENTARIO_MAX);
    assert.equal(TEXTOS_COMENTARIO.enlace, 'Dejar una duda o comentario');
    assert.equal(TEXTOS_COMENTARIO.enviado, 'Recibimos tu mensaje. Te respondemos por mail.');
  });
});
