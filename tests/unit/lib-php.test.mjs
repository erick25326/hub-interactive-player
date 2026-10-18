// Funciones puras de mod/ivplayer/lib.php que SÓLO prueba PHP de verdad
// (tests/php/correr.php, que corre en CI) y no tienen espejo en Node.
//
// Por qué existe: en las máquinas de desarrollo no hay PHP, así que un cambio en una
// de estas funciones pasaba toda la suite local sin que nada lo mirara (oct-2026: sacar
// la rama que quita el BOM de UTF-8 de los subtítulos pasaba `npm test` entero). Esto
// no prueba el resultado —eso lo hace correr.php—, sólo AVISA que el código cambió:
// quien lo cambie tiene que correr la prueba PHP (`npm run test:php`, o el workflow
// "Pruebas" en GitHub) y, si da bien, poner acá la huella nueva.
// Cambiar comentarios de línea entera o la sangría no la dispara (ver fuente-php.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerLib, funcionPhp, huella } from './apoyo/fuente-php.mjs';

test('la normalización de subtítulos de lib.php no cambió sin pasar por la prueba PHP', () => {
  const huellas = {
    // VTT/SRT del docente → UTF-8 sin BOM (BOM de UTF-8, UTF-16 con BOM, Windows-1252,
    // bytes rotos) o null. Un byte inválido deja al reproductor sin PLAYER_CONFIG.
    ivplayer_subtitulos_normalizar: '5e2d500184fcd715',
  };
  const src = leerLib();
  for (const [nombre, esperada] of Object.entries(huellas)) {
    const f = funcionPhp(src, nombre);
    assert.ok(f, `${nombre} ya no está en lib.php`);
    assert.equal(huella(f), esperada,
      `${nombre} cambió en lib.php: sólo la prueba de verdad tests/php/correr.php (corre en CI). `
      + `Corré npm run test:php (o el workflow "Pruebas") y, si da bien, poné la huella nueva (${huella(f)})`);
  }
});

// La casilla "La app con Chromecast ya está publicada" (1.4.0). El valor lo prueba
// correr.php (PHP de verdad, en CI); acá, sin PHP, que las cuatro puntas sigan
// enchufadas: la función pura (por huella), el ajuste en settings.php (apagado por
// defecto), sus textos en los dos idiomas y player.php pasándola en MOODLE_CONTEXT. Si
// se suelta una, el reproductor nunca dice "actualizá la app", o lo dice desde el día uno.
test('la casilla appcastpublicada llega al reproductor apagada por defecto', async () => {
  const fs = await import('node:fs');
  const leer = (rel) => fs.readFileSync(new URL('../../mod/ivplayer/' + rel, import.meta.url), 'utf8').split('\r\n').join('\n');
  const f = funcionPhp(leerLib(), 'ivplayer_app_cast_publicada');
  assert.ok(f, 'ivplayer_app_cast_publicada ya no está en lib.php');
  assert.equal(huella(f), '0b8dfe15f67f04dc',
    `ivplayer_app_cast_publicada cambió en lib.php: corré npm run test:php (o el workflow "Pruebas") y, si da bien, poné la huella nueva (${huella(f)})`);
  const player = leer('player.php');
  assert.match(player, /'appCastPublicada' => ivplayer_app_cast_publicada\(get_config\('mod_ivplayer', 'appcastpublicada'\)\),/,
    'player.php tiene que pasar la casilla en $contexto (MOODLE_CONTEXT), no en PLAYER_CONFIG');
  const iContexto = player.indexOf('$contexto = ['), iCasilla = player.indexOf("'appCastPublicada'"), iJson = player.indexOf('$moodlecontext = json_encode($contexto');
  assert.ok(iContexto > 0 && iCasilla > iContexto && iJson > iCasilla, 'la casilla tiene que ir dentro de $contexto, antes de armar MOODLE_CONTEXT');
  const ajustes = leer('settings.php');
  assert.match(ajustes, /new admin_setting_configcheckbox\('mod_ivplayer\/appcastpublicada',[\s\S]*?get_string\('appcastpublicada_desc', 'ivplayer'\),\s*0\)\);/,
    'el ajuste tiene que ser una casilla apagada por defecto (0)');
  for (const idioma of ['es', 'en']) {
    const lang = leer(`lang/${idioma}/ivplayer.php`);
    for (const clave of ['appheading', 'appheading_desc', 'appcastpublicada', 'appcastpublicada_desc']) {
      assert.ok(lang.includes(`$string['${clave}'] = '`), `falta el texto ${clave} en lang/${idioma}`);
    }
  }
});

// El evento de vista (1.4.0, plan 0.3). Lo que hace ivplayer_view() lo prueba correr.php
// con reemplazos mínimos de Moodle (corre en CI); que el log lo guarde, sólo el campus
// (README, "Verificar el evento de vista en el campus"). Acá, sin PHP: que la función no
// cambie sin pasar por correr.php y que esté enchufada donde va.
test('el evento de vista sale de view.php, una vez por carga, y nunca de player.php', async () => {
  const fs = await import('node:fs');
  const leer = (rel) => fs.readFileSync(new URL('../../mod/ivplayer/' + rel, import.meta.url), 'utf8').split('\r\n').join('\n');
  const f = funcionPhp(leerLib(), 'ivplayer_view');
  assert.ok(f, 'ivplayer_view ya no está en lib.php');
  assert.equal(huella(f), '0bcefa3c5520168c',
    `ivplayer_view cambió en lib.php: corré npm run test:php (o el workflow "Pruebas") y, si da bien, poné la huella nueva (${huella(f)})`);
  const view = leer('view.php');
  assert.equal((view.match(/ivplayer_view\(\$/g) || []).length, 1, 'view.php tiene que llamar a ivplayer_view una sola vez');
  assert.match(view, /ivplayer_view\(\$ivplayer, \$course, \$cm, \$context\);/);
  const llamada = view.indexOf('ivplayer_view($');
  assert.ok(llamada > view.indexOf('require_capability(') && llamada < view.indexOf('$OUTPUT->header()'),
    'la vista se registra después de los permisos y antes de imprimir la página');
  assert.doesNotMatch(view, /set_module_viewed/, 'la finalización va adentro de ivplayer_view (después del evento), no suelta en view.php');
  // 🔴 player.php se recarga dentro del iframe (giro en iOS, Reintentar): contaría de más.
  for (const otro of ['player.php', 'firma.php', 'progress.php', 'complete.php', 'answer.php']) {
    const src = leer(otro);
    assert.doesNotMatch(src, /ivplayer_view\(|course_module_viewed|set_module_viewed/, `${otro} no tiene que registrar vistas`);
  }
  const clase = leer('classes/event/course_module_viewed.php');
  assert.match(clase, /^namespace mod_ivplayer\\event;$/m);
  assert.match(clase, /class course_module_viewed extends \\core\\event\\course_module_viewed \{/);
  assert.match(clase, /\$this->data\['objecttable'\] = 'ivplayer';\s*parent::init\(\);/);
});
