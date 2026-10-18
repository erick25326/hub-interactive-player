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
// (README, "Vistas en el log del campus"). Acá, sin PHP: que la función no
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

// El configurador con el video de Bunny (plan 0.3): mod_form.php firma un enlace de vida
// corta y lo deja en un bloque JSON que su script lee y saca de la página. Lo que hacen
// las dos funciones puras lo prueba correr.php (PHP de verdad, en CI); el script, el
// nivel navegador (escenarios/configurador-bunny.mjs). Acá, sin PHP: que no cambien sin
// pasar por correr.php y que el enlace sólo se arme para quien puede editar la actividad,
// sin ir a un campo del formulario, a la base ni a un log.
test('el enlace de Bunny del configurador: sólo para quien edita, en el bloque y en ningún campo', async () => {
  const fs = await import('node:fs');
  const leer = (rel) => fs.readFileSync(new URL('../../mod/ivplayer/' + rel, import.meta.url), 'utf8').split('\r\n').join('\n');
  const huellas = {
    ivplayer_bunny_configurador: '6cb9fb3cee671199',
    ivplayer_configurador_fuente_html: '79736422d51d0038',
  };
  const lib = leerLib();
  for (const [nombre, esperada] of Object.entries(huellas)) {
    const f = funcionPhp(lib, nombre);
    assert.ok(f, `${nombre} ya no está en lib.php`);
    assert.equal(huella(f), esperada,
      `${nombre} cambió en lib.php: corré npm run test:php (o el workflow "Pruebas") y, si da bien, poné la huella nueva (${huella(f)})`);
  }
  // La regla de "¿usa Bunny?" es la de la lección, con la vida corta del configurador.
  assert.match(funcionPhp(lib, 'ivplayer_bunny_configurador'), /ivplayer_bunny_video\(\$guardado, \$host, \$clave, IVPLAYER_BUNNY_TTL_CONFIGURADOR, \$ahora, \$reproductorbunny\)/);
  assert.match(lib, /^define\('IVPLAYER_BUNNY_TTL_CONFIGURADOR', 7200\);$/m, 'la vida mínima del enlace del configurador es 2 h');

  const form = leer('mod_form.php');
  // Se arma en UN lugar, después de mirar la capacidad de edición, y con el GUID guardado.
  assert.equal((form.match(/ivplayer_bunny_configurador\(/g) || []).length, 1);
  const metodo = form.slice(form.indexOf('protected function video_para_configurador()'), form.indexOf('public function add_completion_rules()'));
  const iPermiso = metodo.indexOf("has_capability('moodle/course:manageactivities', $this->get_context())");
  assert.ok(iPermiso > 0 && iPermiso < metodo.indexOf('ivplayer_bunny_configurador('), 'el enlace se firma sólo después de mirar que pueda editar la actividad');
  assert.match(metodo, /\$this->get_coursemodule\(\)/, 'sólo al editar una actividad que ya existe');
  assert.match(metodo, /\$this->current->videourl/, 'firma el GUID guardado, no lo que se tipeó');
  assert.match(metodo, /catch \(Throwable \$e\) \{\s*return null;\s*\}/, 'un problema no rompe el formulario');
  // Va en el elemento html del editor (no en un campo) y antes del script que lo lee.
  assert.match(form, /\$mform->addElement\('html', ivplayer_configurador_fuente_html\(\$this->video_para_configurador\(\)\) \. \$editorhtml\);/);
  assert.doesNotMatch(form, /addElement\('hidden'/, 'el formulario no tiene campos ocultos: el enlace no va en uno');
  // 🔴 Nada que escriba a un log o a la pantalla de depuración, ni guardarlo en la base.
  for (const [archivo, src] of [['mod_form.php', form], ['lib.php (las dos funciones)', funcionPhp(lib, 'ivplayer_bunny_configurador') + funcionPhp(lib, 'ivplayer_configurador_fuente_html')]]) {
    assert.doesNotMatch(src, /\b(debugging|error_log|mtrace|print_r|var_dump|var_export|add_to_log|set_config|insert_record|update_record|set_field)\s*\(/, `${archivo} no tiene que registrar ni guardar el enlace`);
  }
  // El script lo saca de la página al leerlo y lo manda aparte de config (lo que vuelve
  // de "Guardar en Moodle" es config) y con el origen explícito.
  assert.match(form, /bloqueFirmado\.parentNode\.removeChild\(bloqueFirmado\);/);
  assert.match(form, /var mensaje = \{ type: "ivplayer-load-config", config: config \};/);
  assert.match(form, /w\.postMessage\(mensaje, CONFIGURATOR_ORIGIN\);/);
});
