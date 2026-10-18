// Nivel 2 de la suite: el reproductor COMPILADO en Chrome headless, manejado por CDP.
//   npm run test:navegador     (o: node --test tests/navegador/navegador.test.mjs)
// Una sola pestaña para todas las pruebas, que corren en orden: cada una abre el
// reproductor de cero (sin avance o con el que necesita). Ver tests/navegador/apoyo/
// para el arnés y el README ("Pruebas") para qué protege cada grupo.
// Variables: CHROME_PATH (ruta de Chrome), IVP_VIDEO_URL (otro HLS de prueba) e
// IVP_EXIGIR_NAVEGADOR=1 (en CI: si falta Chrome o el video, falla en vez de saltear).
import fs from 'node:fs';
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararEntorno } from './apoyo/entorno.mjs';
import * as candado from './escenarios/candado.mjs';
import * as calidad from './escenarios/calidad.mjs';
import * as subtitulos from './escenarios/subtitulos.mjs';
import * as tv from './escenarios/tv.mjs';
import * as tvApp from './escenarios/tv-app.mjs';
import * as angosto from './escenarios/angosto.mjs';
import * as firma from './escenarios/firma.mjs';
import * as sinVideo from './escenarios/sin-video.mjs';
import * as reintentar from './escenarios/reintentar.mjs';
import * as configurador from './escenarios/configurador.mjs';
import * as configuradorBunny from './escenarios/configurador-bunny.mjs';

const entorno = await prepararEntorno();

// Un salteo tiene que verse en el resumen de `npm test` (que si no, por el código de
// salida 0, dice "bien") y en GitHub como advertencia del job: node:test lo cuenta
// como "skipped" y el job queda verde igual. IVP_AVISOS lo pone scripts/probar-todo.mjs.
function avisarSalteo(tipo, motivo) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=Pruebas de navegador ${tipo === 'salteada' ? 'salteadas' : 'salteadas en parte'}::${motivo}`);
  const archivo = process.env.IVP_AVISOS;
  if (!archivo) return;
  let a = {};
  try { a = JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch {}
  if (tipo === 'salteada') a.salteada = motivo; else (a.parcial ||= []).push(motivo);
  try { fs.writeFileSync(archivo, JSON.stringify(a)); } catch {}
}

if (entorno.omitir) {
  const exigir = process.env.IVP_EXIGIR_NAVEGADOR === '1';
  console.log(`\n[navegador] ${exigir ? 'FALLA' : 'SE SALTEA'}: ${entorno.omitir}\n`);
  if (!exigir) avisarSalteo('salteada', entorno.omitir);
  test('nivel navegador (Chrome + video de prueba)', { skip: exigir ? false : entorno.omitir }, () => {
    assert.fail(entorno.omitir);
  });
} else {
  after(() => entorno.cerrar());
  // Sin HLS nativo se saltean las del motor nativo (el camino del iPhone): las del
  // candado y las de calidad (AirPlay pasa a hls.js). Que se diga, no que quede escondido.
  if (entorno.sinNativo) avisarSalteo('parcial', `${entorno.sinNativo}: se saltean las pruebas del motor nativo (el camino del iPhone)`);

  // Lo que player.php necesita del bundle, sin abrir nada.
  describe('el bundle compilado', () => {
    test('tiene un solo </head>: player.php inyecta la config en CADA uno', () => {
      assert.equal((entorno.html.match(/<\/head>/gi) || []).length, 1);
    });
    test('lleva hls.js adentro (loadSource): si no, player.php vuelve a Vimeo en silencio', () => {
      assert.ok(entorno.html.includes('loadSource'));
    });
    test('es un solo archivo: ningún script ni hoja de estilos con src o href local', () => {
      assert.ok(!/<script[^>]+\ssrc=/i.test(entorno.html), 'hay un <script src>');
      assert.ok(!/<link[^>]+rel="stylesheet"[^>]+href="(?!https?:)/i.test(entorno.html), 'hay una hoja de estilos local');
    });
  });

  candado.registrar(entorno);
  calidad.registrar(entorno);
  subtitulos.registrar(entorno);
  tv.registrar(entorno);
  tvApp.registrar(entorno);
  angosto.registrar(entorno);
  firma.registrar(entorno);
  reintentar.registrar(entorno);
  sinVideo.registrar(entorno);
  // Al final: bloquean el SDK de Vimeo y las fuentes mientras corren (y lo devuelven).
  configurador.registrar(entorno, { avisar: (motivo) => avisarSalteo('parcial', motivo) });
  configuradorBunny.registrar(entorno, { avisar: (motivo) => avisarSalteo('parcial', motivo) });
}
