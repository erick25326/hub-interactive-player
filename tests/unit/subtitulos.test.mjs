// Subtítulos de la lección (src/subtitulos.js): el VTT o SRT que el docente sube en
// "Editar transcripción" llega crudo y lo lee parseVTT. Los archivos de las pruebas son
// SINTÉTICOS (el texto de los cursos es contenido pago y el repo es público), pero
// imitan lo que sale de Premiere, Subtitle Edit, Whisper y YouTube.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVTT, textoDeCue, RE_TIEMPO_CUE } from '../../src/subtitulos.js';

const cue = (start, end, text) => ({ start, end, text });
// Los tiempos salen de una suma con decimales: se comparan redondeados al milisegundo.
const redondear = (cues) => cues.map((c) => ({ ...c, start: Math.round(c.start * 1000) / 1000, end: Math.round(c.end * 1000) / 1000 }));
const leer = (txt) => redondear(parseVTT(txt));

describe('parseVTT: tiempos', () => {
  // 🔴 La pestaña de transcripción del tema (parse_timed_cues en hook_callbacks.php,
  // repo campus-theme) usa esta MISMA expresión: si se cambia una, se cambia la otra, o
  // la transcripción y el video leen distinto el mismo archivo.
  test('la expresión del tiempo es la misma que usa el tema para la transcripción', () => {
    assert.equal(RE_TIEMPO_CUE.source,
      String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`);
    assert.equal(RE_TIEMPO_CUE.flags, '');
  });

  test('VTT con punto y SRT con coma, horas de 1 o 2 dígitos u omitidas', () => {
    assert.deepEqual(leer('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nUno\n'), [cue(1, 2.5, 'Uno')]);
    assert.deepEqual(leer('1\n00:00:01,000 --> 00:00:02,500\nUno\n'), [cue(1, 2.5, 'Uno')]);
    assert.deepEqual(leer('1\n0:00:03,000 --> 0:00:04,000\nHora de un dígito\n'), [cue(3, 4, 'Hora de un dígito')]);
    assert.deepEqual(leer('WEBVTT\n\n01:02.000 --> 01:03.000\nSin horas\n'), [cue(62, 63, 'Sin horas')]);
    // Cruzando la hora: el inicio sin horas y el fin con horas (Whisper).
    assert.deepEqual(leer('WEBVTT\n\n59:59.500 --> 01:00:02.000\nCruza la hora\n'), [cue(3599.5, 3602, 'Cruza la hora')]);
  });

  test('milisegundos de 1 a 3 dígitos se leen como fracción decimal', () => {
    assert.deepEqual(leer('1\n00:00:01,5 --> 00:00:02,25\nCortos\n'), [cue(1.5, 2.25, 'Cortos')]);
    assert.deepEqual(leer('1\n00:00:01,50 --> 00:00:02,050\nMixtos\n'), [cue(1.5, 2.05, 'Mixtos')]);
  });

  test('la flecha sin espacios y la configuración del cue después del tiempo no molestan', () => {
    assert.deepEqual(leer('WEBVTT\n\n00:00:01.000-->00:00:03.000\nPegado\n'), [cue(1, 3, 'Pegado')]);
    assert.deepEqual(leer('WEBVTT\n\n00:00:01.000 --> 00:00:03.000 line:90% position:50% align:center\nCon ajustes\n'), [cue(1, 3, 'Con ajustes')]);
  });

  test('un cue con el fin antes que el inicio (o igual) se descarta, sin romper los demás', () => {
    const txt = 'WEBVTT\n\n00:00:03.000 --> 00:00:02.000\nAl revés\n\n00:00:04.000 --> 00:00:04.000\nCero\n\n00:00:05.000 --> 00:00:06.000\nBien\n';
    assert.deepEqual(leer(txt), [cue(5, 6, 'Bien')]);
  });
});

describe('parseVTT: estructura del archivo', () => {
  const dos = [cue(1, 3, 'Hola'), cue(3, 5, 'Chau')];

  test('fin de línea CR solo (Mac viejo) y CR CR LF (CRLF escrito en modo texto en Windows)', () => {
    assert.deepEqual(leer('1\r00:00:01,000 --> 00:00:03,000\rHola\r\r2\r00:00:03,000 --> 00:00:05,000\rChau\r'), dos);
    assert.deepEqual(leer('1\r\r\n00:00:01,000 --> 00:00:03,000\r\r\nHola\r\r\n\r\r\n2\r\r\n00:00:03,000 --> 00:00:05,000\r\r\nChau\r\r\n'), dos);
    assert.deepEqual(leer('1\r\n00:00:01,000 --> 00:00:03,000\r\nHola\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,000\r\nChau\r\n'), dos);
  });

  test('un separador con espacios o tabulaciones cierra el cue (antes se metían los tiempos crudos del siguiente)', () => {
    const txt = '1\n00:00:01,000 --> 00:00:03,000\nHola\n \n2\n00:00:03,000 --> 00:00:05,000\nChau\n\t\n3\n00:00:05,000 --> 00:00:07,000\nTres\n';
    assert.deepEqual(leer(txt), [...dos, cue(5, 7, 'Tres')]);
    // Lo que sigue a ese separador (una NOTE) no se pega al texto del cue.
    const conNota = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHola\n \nNOTE esto no es un subtítulo\n\n00:00:03.000 --> 00:00:05.000\nChau\n';
    assert.deepEqual(leer(conNota), dos);
  });

  test('sin línea en blanco entre cues, el índice del SRT siguiente no entra en el texto', () => {
    assert.deepEqual(leer('1\n00:00:01,000 --> 00:00:03,000\nHola\n2\n00:00:03,000 --> 00:00:05,000\nChau\n'), dos);
  });

  test('un número solo como texto del cue no se toma por índice si no le sigue un tiempo', () => {
    assert.deepEqual(leer('1\n00:00:01,000 --> 00:00:03,000\n42\n\n2\n00:00:03,000 --> 00:00:05,000\nChau\n'),
      [cue(1, 3, '42'), cue(3, 5, 'Chau')]);
  });

  test('cabecera WEBVTT con metadatos, NOTE, STYLE y REGION no aparecen como subtítulos', () => {
    const txt = [
      'WEBVTT', 'Kind: captions', 'Language: es', '',
      'NOTE Exportado de un editor', 'segunda línea de la nota', '',
      'STYLE', '::cue(.amarillo) { color: yellow }', '',
      'REGION', 'id:abajo', 'width:40%', '',
      'intro-1', '00:00:01.000 --> 00:00:04.000', 'Primera línea', '',
      'NOTE una nota entre cues', '',
      '00:00:04.000 --> 00:00:06.000', 'Segunda', '',
    ].join('\n');
    assert.deepEqual(leer(txt), [cue(1, 4, 'Primera línea'), cue(4, 6, 'Segunda')]);
  });

  test('YouTube automático: una línea en blanco entre el tiempo y el texto no deja el cue vacío', () => {
    const txt = 'WEBVTT\nKind: captions\nLanguage: es\n\n'
      + '00:00:00.160 --> 00:00:02.270 align:start position:0%\n\nhola<00:00:00.480><c> a</c><00:00:00.800><c> todos</c>\n\n'
      + '00:00:02.270 --> 00:00:02.280 align:start position:0%\nhola a todos\n \n';
    assert.deepEqual(leer(txt), [cue(0.16, 2.27, 'hola a todos'), cue(2.27, 2.28, 'hola a todos')]);
  });

  test('un cue de dos líneas conserva el salto; los cues que se pisan quedan los dos', () => {
    const txt = 'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nLínea uno\nLínea dos\n\n00:00:02.000 --> 00:00:04.000\nOtra voz a la vez\n';
    assert.deepEqual(leer(txt), [cue(1, 5, 'Línea uno\nLínea dos'), cue(2, 4, 'Otra voz a la vez')]);
  });

  test('un cue vacío o sólo con etiquetas no aparece', () => {
    const txt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n\n00:00:02.000 --> 00:00:03.000\n<i></i>\n\n00:00:03.000 --> 00:00:04.000\nAlgo\n';
    assert.deepEqual(leer(txt), [cue(3, 4, 'Algo')]);
  });

  test('entrada vacía o sin tiempos da cero cues, sin romper', () => {
    assert.deepEqual(parseVTT(''), []);
    assert.deepEqual(parseVTT('WEBVTT\n\n'), []);
    assert.deepEqual(parseVTT('esto no es un subtítulo'), []);
    assert.deepEqual(parseVTT(null), []);
  });
});

describe('textoDeCue: etiquetas y entidades', () => {
  test('saca las etiquetas de VTT y SRT (voz, clases, cursiva, <font>) y deja el texto', () => {
    assert.equal(textoDeCue('<v Docente>Hola a todos,</v> <i>bienvenidos</i> al <b>curso</b>.'), 'Hola a todos, bienvenidos al curso.');
    assert.equal(textoDeCue('<v.fuerte Docente>¡Atención!</v>'), '¡Atención!');
    assert.equal(textoDeCue('<c.amarillo>Texto</c> fin'), 'Texto fin');
    assert.equal(textoDeCue('<font color="#ffff00">Hola.</font>'), 'Hola.');
    assert.equal(textoDeCue('<font face="Arial" color="#FFFFFF">Texto</font> fin'), 'Texto fin');
  });

  test('saca las marcas de tiempo del karaoke (YouTube automático)', () => {
    assert.equal(textoDeCue('hola<00:00:00.480><c> a</c><00:00:00.800><c> todos</c>'), 'hola a todos');
    assert.equal(textoDeCue('<00:00:06.500><c>Cada</c><00:00:07.000><c> palabra</c>'), 'Cada palabra');
  });

  test('un "<" literal (SRT no escapa nada) no se come el resto de la línea', () => {
    assert.equal(textoDeCue('Drones < 250 g y > 25 kg tienen reglas distintas'), 'Drones < 250 g y > 25 kg tienen reglas distintas');
    assert.equal(textoDeCue('Si la batería está < 20 % volvé. <i>Siempre</i>.'), 'Si la batería está < 20 % volvé. Siempre.');
    assert.equal(textoDeCue('Paso 1 --> Paso 2'), 'Paso 1 --> Paso 2');
  });

  test('resuelve las entidades de VTT y las numéricas; &amp; al final, así "&amp;lt;" queda literal', () => {
    assert.equal(textoDeCue('El dron pesa &lt; 250 g &amp; vuela &gt; 120 m'), 'El dron pesa < 250 g & vuela > 120 m');
    assert.equal(textoDeCue('Dijo &quot;despegue&quot; y &apos;listo&apos;'), 'Dijo "despegue" y \'listo\'');
    assert.equal(textoDeCue('br&#250;jula y c&#xE1;mara'), 'brújula y cámara');
    assert.equal(textoDeCue('&amp;lt;no es HTML&amp;gt;'), '&lt;no es HTML&gt;');
    // El espacio duro se escribe escapado: literal no se distingue de uno común.
    assert.equal(textoDeCue('a&nbsp;b'), 'a\u00A0b');
    assert.equal(textoDeCue('&lrm;Texto&rlm; con marcas'), 'Texto con marcas');
  });

  test('las entidades numéricas inválidas se descartan sin tirar error (antes rompían todo el archivo)', () => {
    assert.equal(textoDeCue('a&#0;b'), 'ab');
    assert.equal(textoDeCue('a&#x110000;b'), 'ab');
    assert.equal(textoDeCue('a&#99999999999;b'), 'ab');
    const txt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nRaro &#x110000; acá\n\n00:00:02.000 --> 00:00:03.000\nSigue\n';
    assert.deepEqual(leer(txt), [cue(1, 2, 'Raro  acá'), cue(2, 3, 'Sigue')]);
  });

  test('recorta los espacios de los bordes', () => {
    assert.equal(textoDeCue('   <i> hola </i>   '), 'hola');
  });
});
