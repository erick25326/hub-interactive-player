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
  // Lo que vuelve: sólo de la ventana que abrió esta página (el origen solo es el de
  // TODAS las páginas de GitHub Pages de la cuenta), y el tipo se escapa en la vista
  // previa (venía crudo al innerHTML). El recorrido, en escenarios/configurador-bunny.mjs.
  assert.ok(form.includes('if (!esElConfigurador(e.source)) return;'), 'el manejador de mod_form.php no mira e.source');
  assert.ok(form.includes('if (w) ventanaConfigurador = w;'));
  assert.ok(form.includes('var label = escapeHtml(typeNames[ia.type] || ia.type);'), 'el tipo va crudo a la vista previa');
});

// La red de seguridad (plan Bunny 0.4): Vimeo si el CDN de Bunny falla. Lo que hacen las
// funciones puras y el registro lo prueba correr.php (PHP de verdad, en CI); el
// reproductor, tests/unit/respaldo.test.mjs y el nivel navegador (escenarios/respaldo.mjs).
// Acá, sin PHP: que no cambien sin pasar por correr.php y que las puntas sigan enchufadas.
// Si se suelta una, la red salta por la sesión, no salta nunca, o player.php ignora el
// pedido y el alumno entra en un bucle de recargas con Bunny.
test('la red de seguridad: player.php, respaldo.php, el ajuste apagado y el evento, enchufados', async () => {
  const fs = await import('node:fs');
  const leer = (rel) => fs.readFileSync(new URL('../../mod/ivplayer/' + rel, import.meta.url), 'utf8').split('\r\n').join('\n');
  const lib = leerLib();
  const huellas = {
    ivplayer_respaldo_vimeo: '5d9175d30c381769',
    ivplayer_respaldo_forzar: '26a77b798830dc40',
    ivplayer_respaldo_datos: 'e84b63b4a6724f54',
    ivplayer_respaldo_registrar: '99b8ec1221a05941',
  };
  for (const [nombre, esperada] of Object.entries(huellas)) {
    const f = funcionPhp(lib, nombre);
    assert.ok(f, `${nombre} ya no está en lib.php`);
    assert.equal(huella(f), esperada,
      `${nombre} cambió en lib.php: corré npm run test:php (o el workflow "Pruebas") y, si da bien, poné la huella nueva (${huella(f)})`);
  }

  // player.php: lee origen, decide ANTES de firmar (con origen=vimeo no firma nada) y
  // ofrece la red sólo en una carga de Bunny, adentro de MOODLE_CONTEXT.
  const player = leer('player.php');
  assert.match(player, /\$origen = optional_param\('origen', '', PARAM_ALPHA\);/);
  assert.match(player, /\$ajusterespaldo = get_config\('mod_ivplayer', 'respaldovimeo'\);/);
  assert.match(player, /\$forzarvimeo = ivplayer_respaldo_forzar\(\$ajusterespaldo, \$ivplayer->vimeoid, \$origen\);/);
  assert.match(player, /\$bunny = \$forzarvimeo \? null : ivplayer_bunny_de_actividad\(\$ivplayer, \$playerhtml, \$ahora\);/);
  assert.equal((player.match(/ivplayer_bunny_de_actividad\(\$ivplayer/g) || []).length, 1, 'player.php firma en un solo lugar');
  assert.match(player, /if \(\$bunny !== null && ivplayer_respaldo_vimeo\(\$ajusterespaldo, \$ivplayer->vimeoid\)\) \{\s*(\/\/[^\n]*\n\s*)*\$contexto\['respaldoUrl'\] = \(new moodle_url\('\/mod\/ivplayer\/respaldo\.php'\)\)->out\(false\);/,
    'respaldoUrl sólo con Bunny en esta carga y la actividad con red');
  const iUrl = player.indexOf("$contexto['respaldoUrl']"), iJson = player.indexOf('$moodlecontext = json_encode($contexto');
  assert.ok(iUrl > player.indexOf('$contexto = [') && iUrl < iJson, 'respaldoUrl va en MOODLE_CONTEXT, no en PLAYER_CONFIG');
  assert.doesNotMatch(player, /respaldo_vimeo_usado|ivplayer_respaldo_registrar/, 'player.php no registra saltos: se recarga solo (giro en iOS, Reintentar) y contaría de más');

  // respaldo.php: POST, siempre JSON, sesión y permisos ANTES de mirar la causa, la causa
  // validada, la misma regla que player.php y recién ahí el registro.
  const r = leer('respaldo.php');
  assert.match(r, /^define\('AJAX_SCRIPT', true\);$/m);
  assert.doesNotMatch(r, /define\('NO_SESSION_UPDATE'/, 'cuenta como actividad: así Moodle cierra en el pedido una sesión vencida y contesta sesion');
  assert.match(r, /\(\$_SERVER\['REQUEST_METHOD'\] \?\? ''\) !== 'POST'/);
  const orden = ['require_login($course, false, $cm, false, true);', "require_capability('mod/ivplayer:view', $context);", 'require_sesskey();',
    '$datos = ivplayer_respaldo_datos(', 'ivplayer_bunny_de_actividad($ivplayer', "ivplayer_respaldo_vimeo(get_config('mod_ivplayer', 'respaldovimeo'), $ivplayer->vimeoid)",
    'ivplayer_respaldo_registrar($ivplayer, $course, $cm, $context, $datos)', "ivplayer_respaldo_responder(200, ['ok' => true"];
  let antes = -1;
  for (const pieza of orden) {
    const i = r.indexOf(pieza);
    assert.ok(i > antes, `respaldo.php: "${pieza}" tiene que estar, y después de lo anterior`);
    antes = i;
  }
  assert.match(r, /if \(!isloggedin\(\) \|\| isguestuser\(\)\) \{\s*ivplayer_respaldo_responder\(401, \['ok' => false, 'motivo' => 'sesion'\]\);/, 'sin sesión: 401 sesion (el reproductor no salta)');
  assert.match(r, /if \(\$datos === null\) \{\s*ivplayer_respaldo_responder\(400,/);
  assert.match(r, /ivplayer_respaldo_responder\(409, \['ok' => false, 'motivo' => 'apagado'\]\);/);
  for (const otro of ['player.php', 'view.php', 'firma.php', 'progress.php', 'complete.php', 'answer.php', 'mod_form.php']) {
    assert.doesNotMatch(leer(otro), /respaldo_vimeo_usado|ivplayer_respaldo_registrar\(/, `${otro} no tiene que registrar saltos`);
  }

  // El ajuste: una casilla APAGADA por defecto, con sus textos en los dos idiomas.
  const ajustes = leer('settings.php');
  assert.match(ajustes, /new admin_setting_configcheckbox\('mod_ivplayer\/respaldovimeo',[\s\S]*?get_string\('respaldovimeo_desc', 'ivplayer'\),\s*0\)\);/,
    'la red tiene que ser una casilla apagada por defecto (0)');
  for (const idioma of ['es', 'en']) {
    const lang = leer(`lang/${idioma}/ivplayer.php`);
    for (const clave of ['respaldovimeo', 'respaldovimeo_desc', 'eventrespaldovimeo']) {
      assert.ok(lang.includes(`$string['${clave}'] = '`), `falta el texto ${clave} en lang/${idioma}`);
    }
  }

  // El evento: de core, en el contexto del módulo, con la causa obligatoria.
  const clase = leer('classes/event/respaldo_vimeo_usado.php');
  assert.match(clase, /^namespace mod_ivplayer\\event;$/m);
  assert.match(clase, /class respaldo_vimeo_usado extends \\core\\event\\base \{/);
  assert.match(clase, /\$this->data\['objecttable'\] = 'ivplayer';/);
  assert.match(clase, /get_string\('eventrespaldovimeo', 'mod_ivplayer'\)/);
  assert.match(lib, /class_exists\(\\mod_ivplayer\\event\\respaldo_vimeo_usado::class\)/,'antes del upgrade la clase no está: el registro pregunta antes');
  // La clase nueva entra al mapa de clases con el upgrade: la versión tiene que haber subido.
  const version = Number((leer('version.php').match(/\$plugin->version = (\d+);/) || [])[1]);
  assert.ok(version >= 2026101902, `la versión del plugin tiene que subir con la clase nueva del evento: ${version}`);
});

// Las etiquetas (1.4.0): glosario interactivo (por defecto) o en pantalla, por actividad.
// El valor y el paso del upgrade los prueba correr.php (PHP de verdad, con XMLDB de
// mentira; en CI o en el servidor). Acá, sin PHP: que las dos funciones no cambien sin
// pasar por correr.php y que las puntas estén enchufadas. Si se suelta una, la actividad
// guarda un modo que el reproductor no recibe, o una instalación nueva queda distinta
// de un sitio actualizado, o el modo se pierde al duplicar o restaurar la actividad.
test('el modo de las etiquetas: formulario, columna, upgrade, backup y PLAYER_CONFIG, enchufados', async () => {
  const fs = await import('node:fs');
  const leer = (rel) => fs.readFileSync(new URL('../../mod/ivplayer/' + rel, import.meta.url), 'utf8').split('\r\n').join('\n');
  const lib = leerLib();
  const huellas = {
    ivplayer_modo_etiquetas: '9a3a29d3c2dd9370',
    ivplayer_config_base: '29067e5c84491b65',
  };
  for (const [nombre, esperada] of Object.entries(huellas)) {
    const f = funcionPhp(lib, nombre);
    assert.ok(f, `${nombre} ya no está en lib.php`);
    assert.equal(huella(f), esperada,
      `${nombre} cambió en lib.php: corré npm run test:php (o el workflow "Pruebas") y, si da bien, poné la huella nueva (${huella(f)})`);
  }
  assert.match(funcionPhp(lib, 'ivplayer_config_base'), /'etiquetas' => ivplayer_modo_etiquetas\(\$ivplayer->etiquetas \?\? null\)/);
  // add/update guardan sólo uno de los dos valores.
  assert.match(funcionPhp(lib, 'ivplayer_add_instance'), /\$data->etiquetas = ivplayer_modo_etiquetas\(\$data->etiquetas \?\? null\);/);
  assert.match(funcionPhp(lib, 'ivplayer_update_instance'), /if \(property_exists\(\$data, 'etiquetas'\)\) \{\s*\$data->etiquetas = ivplayer_modo_etiquetas\(\$data->etiquetas\);/);

  // player.php: el modo va en PLAYER_CONFIG (no en MOODLE_CONTEXT: es de la actividad).
  const player = leer('player.php');
  assert.match(player, /\$base = ivplayer_config_base\(\$ivplayer, \$video\);/);
  const iBase = player.indexOf('$base = ivplayer_config_base('), iConfig = player.indexOf('$config = json_encode(');
  assert.ok(iBase > 0 && iConfig > iBase, 'la config se arma con ivplayer_config_base antes del json_encode de PLAYER_CONFIG');

  // El formulario: un menú con los dos modos, el glosario por defecto, con su ayuda.
  const form = leer('mod_form.php');
  assert.match(form, /\$mform->addElement\('select', 'etiquetas', get_string\('etiquetas', 'ivplayer'\), \[\s*'glosario' => get_string\('etiquetas_glosario', 'ivplayer'\),\s*'pantalla' => get_string\('etiquetas_pantalla', 'ivplayer'\),\s*\]\);/);
  assert.match(form, /\$mform->setDefault\('etiquetas', 'glosario'\);/);
  assert.match(form, /\$mform->addHelpButton\('etiquetas', 'etiquetas', 'ivplayer'\);/);
  for (const idioma of ['es', 'en']) {
    const lang = leer(`lang/${idioma}/ivplayer.php`);
    for (const clave of ['etiquetas', 'etiquetas_help', 'etiquetas_glosario', 'etiquetas_pantalla']) {
      assert.ok(lang.includes(`$string['${clave}'] = '`), `falta el texto ${clave} en lang/${idioma}`);
    }
  }

  // La columna: la misma en install.xml y en el paso del upgrade, con la versión nueva.
  assert.match(leer('db/install.xml'), /<FIELD NAME="etiquetas" TYPE="char" LENGTH="16" NOTNULL="true" DEFAULT="glosario"/);
  const upgrade = leer('db/upgrade.php');
  assert.match(upgrade, /if \(\$oldversion < 2026101903\) \{[\s\S]*?new xmldb_field\('etiquetas', XMLDB_TYPE_CHAR, '16', null, XMLDB_NOTNULL, null, 'glosario', 'videoloop'\);[\s\S]*?upgrade_mod_savepoint\(true, 2026101903, 'ivplayer'\);/);
  const version = leer('version.php');
  // 2026101903 es el paso de la columna; la versión siguió subiendo (2026101904: el secreto
  // de los subtítulos en la TV, ver la prueba de abajo).
  assert.ok(Number((version.match(/\$plugin->version = (\d+);/) || [])[1]) >= 2026101903);
  assert.match(version, /\$plugin->release = '1\.4\.0';/);

  // Backup y restore: el modo viaja con la actividad.
  assert.match(leer('backup/moodle2/backup_ivplayer_stepslib.php'), /'videoloop', 'etiquetas', 'interactions'/);
  assert.match(leer('backup/moodle2/restore_ivplayer_stepslib.php'), /\$data->etiquetas = ivplayer_modo_etiquetas\(\$data->etiquetas\);/);
});

// Subtítulos en la TV (1.4.0): la TV baja el VTT de subtitulos.php sin la sesión del
// campus, con un enlace firmado. La firma, la verificación y el paso a WebVTT los prueba
// correr.php (PHP de verdad, en CI o en el servidor) con vectores que comparte con
// subtitulos-tv.test.mjs. Acá, sin PHP: que no cambien sin pasar por correr.php y que las
// puntas sigan enchufadas. Si se suelta una, la TV no recibe la pista (o recibe una
// vencida), el endpoint mira la base sin firma, o el secreto queda a la vista.
test('subtítulos en la TV: subtitulos.php, player.php, firma.php, el secreto y la versión, enchufados', async () => {
  const fs = await import('node:fs');
  const leer = (rel) => fs.readFileSync(new URL('../../mod/ivplayer/' + rel, import.meta.url), 'utf8').split('\r\n').join('\n');
  const lib = leerLib();
  const huellas = {
    ivplayer_subtitulos_tv_firma: 'f7510b69dece50ac',
    ivplayer_subtitulos_tv_parametros: '447a1ad5322a1267',
    ivplayer_subtitulos_tv_valida: '72bc21b2c27d0afd',
    ivplayer_subtitulos_tv_tope: 'b5b734f8a4722062',
    ivplayer_subtitulos_cues: '3e97e4825923d8de',
    ivplayer_subtitulos_a_vtt: 'fcca70b60190614a',
    ivplayer_subtitulos_tv_secreto: '54fdf1f2702392f8',
    ivplayer_subtitulos_tv_url: '4b0adf06818af121',
  };
  for (const [nombre, esperada] of Object.entries(huellas)) {
    const f = funcionPhp(lib, nombre);
    assert.ok(f, `${nombre} ya no está en lib.php`);
    assert.equal(huella(f), esperada,
      `${nombre} cambió en lib.php: corré npm run test:php (o el workflow "Pruebas") y, si da bien, poné la huella nueva (${huella(f)})`);
  }
  // La firma: HMAC-SHA256 de "cmid|e" con el secreto como clave, comparada con hash_equals.
  assert.match(funcionPhp(lib, 'ivplayer_subtitulos_tv_firma'), /hash_hmac\('sha256', \$cmid \. '\|' \. \$expires, \$secreto, true\)/);
  assert.match(funcionPhp(lib, 'ivplayer_subtitulos_tv_valida'), /hash_equals\(\$esperada, \$firma\)/);
  assert.match(funcionPhp(lib, 'ivplayer_subtitulos_tv_url'), /new moodle_url\('\/mod\/ivplayer\/subtitulos\.php', \$parametros\)/);

  // subtitulos.php: sin cookies, la firma ANTES de tocar la base, CORS abierto, VTT con
  // caché privada corta, 403 sin detalle.
  const s = leer('subtitulos.php');
  const iCookies = s.indexOf("define('NO_MOODLE_COOKIES', true);"), iConfig = s.indexOf("require_once(__DIR__ . '/../../config.php');");
  assert.ok(iCookies > 0 && iCookies < iConfig, 'NO_MOODLE_COOKIES antes de cargar Moodle: la TV no tiene que recibir ni crear sesión');
  assert.doesNotMatch(s, /\b(require_login|require_course_login|require_capability|require_sesskey|sesskey)\s*\(/, 'sin sesión: la firma es el permiso');
  const iValida = s.indexOf('ivplayer_subtitulos_tv_valida('), iDb = s.indexOf('get_coursemodule_from_id(');
  assert.ok(iValida > 0 && iDb > iValida, 'la firma se verifica antes de mirar la base');
  assert.match(s, /ivplayer_subtitulos_tv_tope\(ivplayer_bunny_ttl\(\)\)/);
  assert.match(s, /if \(!\$valida\) \{\s*ivplayer_subtitulos_responder\(403\);/, '403 sin detalle');
  assert.match(s, /get_coursemodule_from_id\('ivplayer', \$cmid, 0, false, IGNORE_MISSING\)/, 'sólo actividades de este plugin');
  assert.match(s, /ivplayer_subtitulos_texto\(\$context\)/, 'el mismo archivo que la transcripción y el celular');
  assert.match(s, /ivplayer_subtitulos_a_vtt\(\$texto\)/, 'en WebVTT estricto (un SRT incluido)');
  assert.match(s, /header\('Access-Control-Allow-Origin: \*'\);/);
  assert.match(s, /header\('Content-Type: text\/vtt; charset=utf-8'\);/);
  assert.match(s, /header\('Cache-Control: private, max-age=300'\);/);
  assert.doesNotMatch(s, /\b(debugging|error_log|mtrace|print_r|var_dump|var_export)\s*\(/, 'nada a un log');

  // player.php: subtitlesUrlTv en PLAYER_CONFIG, sólo con Bunny y subtítulos, con el
  // vencimiento de la firma del video.
  const player = leer('player.php');
  assert.match(player, /if \(\$bunny !== null && \$subtitulos !== null\) \{/);
  assert.doesNotMatch(player, /ivplayer_subtitulos_a_vtt\(/, 'player.php no parsea los subtítulos (correría en cada carga)');
  assert.match(player, /ivplayer_subtitulos_tv_url\(\$cm->id, \$bunny\['expires'\] \?\? ivplayer_bunny_expires\(\$ahora, ivplayer_bunny_ttl\(\)\)\)/);
  assert.match(player, /\$extra\['subtitlesUrlTv'\] = \$subtitulostv;/);
  const iUrl = player.indexOf("$extra['subtitlesUrlTv']"), iCfg = player.indexOf('$config = json_encode($base + $extra');
  assert.ok(iUrl > 0 && iCfg > iUrl, 'subtitlesUrlTv va en PLAYER_CONFIG (lo lee el componente al conectar la TV)');
  assert.doesNotMatch(player, /subtitulos_tv_secreto|subtitulossecreto/, 'el secreto no sale de lib.php');

  // firma.php: con cada renovación, el enlace nuevo con el vencimiento nuevo.
  const firma = leer('firma.php');
  assert.match(firma, /ivplayer_subtitulos_tv_url\(\$cm->id, \$video\['expires'\]\)/);
  assert.match(firma, /\$respuesta\['subtitulosTv'\] = \$subtitulostv;/);
  assert.ok(firma.indexOf("$respuesta['subtitulosTv']") < firma.indexOf('ivplayer_firma_responder(200, $respuesta);'));

  // El secreto: lo crean la instalación y el paso 2026101904 del upgrade, y no hay un campo
  // que lo muestre (settings.php sólo dice si está).
  assert.match(leer('db/install.php'), /mod_ivplayer_crear_secreto_subtitulos\(\);/);
  const upgrade = leer('db/upgrade.php');
  assert.match(upgrade, /if \(\$oldversion < 2026101904\) \{[\s\S]*?mod_ivplayer_crear_secreto_subtitulos\(\);[\s\S]*?upgrade_mod_savepoint\(true, 2026101904, 'ivplayer'\);/);
  const ulib = leer('db/upgradelib.php');
  assert.match(ulib, /random_bytes\(32\)/);
  assert.match(ulib, /set_config\('subtitulossecreto', \$secreto, 'mod_ivplayer'\);/);
  assert.match(ulib, /mod_ivplayer_marcar_sensible\('subtitulossecreto@@mod_ivplayer'\);/);
  const ajustes = leer('settings.php');
  assert.doesNotMatch(ajustes, /mod_ivplayer\/subtitulossecreto/, 'el secreto no es un ajuste del panel: no se muestra ni se exporta');
  assert.match(ajustes, /new admin_setting_heading\('mod_ivplayer\/subtitulostvheading',/);
  for (const idioma of ['es', 'en']) {
    const lang = leer(`lang/${idioma}/ivplayer.php`);
    for (const clave of ['subtitulostvheading', 'subtitulostvheading_desc', 'subtitulostv_listo', 'subtitulostv_sinsecreto']) {
      assert.ok(lang.includes(`$string['${clave}'] = '`), `falta el texto ${clave} en lang/${idioma}`);
    }
  }
  const version = leer('version.php');
  assert.equal(Number((version.match(/\$plugin->version = (\d+);/) || [])[1]), 2026101904);
  assert.match(version, /\$plugin->release = '1\.4\.0';/);
});
