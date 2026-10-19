// Servidor HTTP local de las pruebas (puerto que elige el SO, sólo 127.0.0.1).
//   /player.html?…  el reproductor COMPILADO con window.PLAYER_CONFIG inyectado antes
//                   de </head>, igual que mod/ivplayer/player.php. Antes del bundle va el
//                   ayudante de la página y, si se pide, los receptores simulados.
//   /marco.html?…   el reproductor en un iframe del mismo sitio, como view.php: responde
//                   el pedido de pantalla completa simulada agrandando el iframe.
//   /vacio.html     página en blanco del mismo origen (para limpiar el localStorage).
//   /hls/<GUID>/…   el video de prueba: de una carpeta local (el que genera ffmpeg) o de
//                   un HLS remoto a través de un proxy con caché en memoria. El GUID es
//                   sintético: el reproductor saca de ahí la clave del avance, como con
//                   Bunny, y el receptor de Cast simulado reconoce "este video" por él.
//   /bcdn_token=…&token_path=…&expires=E/hls/<GUID>/…
//                   el mismo video FIRMADO, como el CDN de Bunny con la autenticación por
//                   token prendida: valida el token (que lo haya emitido este servidor,
//                   para ESTE directorio y con ESTE vencimiento) y el vencimiento, con 403
//                   (y CORS abierto, como Bunny) si no vale. Ver ?firma=.
//   /firma          el firma.php de mentira: POST cmid + sesskey → una firma nueva (con
//                   subs=1, también subtitulosTv: el enlace de los subtítulos renovado).
//   /subtitulos?id&e&s
//                   el subtitulos.php de mentira: el VTT de prueba para la TV, sin sesión y
//                   con CORS abierto, si el enlace lo emitió este servidor y no venció (si
//                   no, 403). La firma de verdad (HMAC) la prueba correr.php; acá importa
//                   que la TV reciba un enlace vigente, también después de renovar.
//   /configurador.html
//                   el configurador de interacciones ARMADO como el que se publica en
//                   GitHub Pages (scripts/armar-configurador.mjs), con ESTE reproductor
//                   compilado adentro para la vista previa.
// Query de /player.html: motor=hls|nativo|auto · progreso=<json del avance> ·
// subs=vtt (con subtitlesUrlTv, el enlace firmado para la TV, salvo subsTv=0: como el
// SCORM, la demo o un sitio sin el secreto) · ias=glosario (INTERACCIONES_GLOSARIO: etiquetas, nota, pregunta, punto
// para tocar) · ias=juntas (INTERACCIONES_JUNTAS: dos que frenan a menos de 3 s, y una
// etiqueta en el mismo segundo que la segunda) · etiquetas=glosario|pantalla (el modo de la actividad) · sonido=simulado
// (Web Audio y vibración de mentira que anotan todo: simulados/sonido-simulado.js) ·
// cast=fake (la TV simulada + el emisor de Chrome; lat, hayTV… los leen los
// simulados) · airplay=1 · nofs=1 · webview=1 (como el WebView de hub-app: sin Cast Web
// SDK, sin Presentation API ni window.chrome, y el UA con "MoodleMobile"; con
// plataforma=ios, el de un iPhone) · appCastPublicada=1 (MOODLE_CONTEXT con la casilla del
// plugin prendida) · app=fake|mudo (en /marco.html: la TV simulada y hub-app simulada en la
// página de ARRIBA, como view.php; en el iframe, salvo plataforma=ios, un
// ReactNativeWebView que le pasa todo al de arriba, como Android) ·
// firma=<segundos> (el video va firmado y vence a los <segundos>; MOODLE_CONTEXT trae
// firmaUrl para renovarlo) · renovar=falla (el /firma de esa página contesta "se cerró
// la sesión", como firma.php sin sesión) · renovar=falla-hasta-403 (contesta 503, como
// sin red, hasta que un pedido de video de esa página vuelva con 403: ahí anda, y así se
// prueba el reintento después del 403) · renovar=red-tras-403 (igual, y además los DOS
// primeros pedidos después del 403 también contestan 503: la red que tarda en volver al
// desbloquear el celular) · renovar=lenta (el primer pedido de esa página
// contesta recién 2 s —o demora=<s>— DESPUÉS de que venció su firma, con una firma hecha
// al contestar: un pedido de video que sale en ese rato tiene que esperarla) ·
// rota=alta (la playlist de la calidad MÁS ALTA da 403 siempre, con cualquier firma y
// vigente: una variante rota o una regla del CDN, NO el vencimiento) · renovada=<s> (lo
// que duran las firmas que da /firma; por defecto, lo mismo que la de la página) ·
// video=ninguno (PLAYER_CONFIG sin video: vimeoId vacío y sin videoUrl) · video=texto (un
// vimeoId que no es un ID, como el de config.example.js) · config=ninguna (sin
// PLAYER_CONFIG: la config por defecto del bundle) · renovar=permiso (el /firma contesta
// 403 "sin permiso", como firma.php con la actividad oculta: no es la sesión).
// respaldo=1 (la red de seguridad prendida, como player.php con el ajuste respaldovimeo y
// la actividad con ID de Vimeo: MOODLE_CONTEXT trae respaldoUrl, progressUrl y el
// savedProgress del progress.php de mentira) · respaldoModo=sesion|sinvimeo (el /respaldo
// de esa página contesta "se cerró la sesión" o "no lo deja": la actividad sin Vimeo) ·
// falla=playlist-404 (el playlist firmado da 404) · falla=red (el playlist apunta a un
// puerto donde no escucha nadie: el CDN caído). Con respaldo=1 y origen=vimeo (la recarga
// de la red de seguridad) sirve el "Vimeo de mentira": el mismo video SIN firma (lo que se
// prueba es la recarga y el retomar, no el SDK de Vimeo), window.__ivpOrigen = 'vimeo' y
// sin respaldoUrl, como player.php en la carga forzada.
// Tarjeta de fin (1.4.0): loop=1 (PLAYER_CONFIG.loop, "Repetir video") · ias=final (las
// tres de siempre más un V/F en el segundo entero que sigue al fin del video, tfFin: como
// el configurador, que guarda segundos enteros; frena con el último tick) · completar=1
// (MOODLE_CONTEXT con completeUrl y progressUrl, como player.php: el reproductor manda
// complete.php al terminar con todo respondido) · lnav=siguiente|ultima|marcar (en
// /marco.html: la barra de navegación del tema del campus debajo del iframe, como la
// inyecta theme_hubeducation en view.php: la próxima lección, la última lección —"Volver
// al curso"— o "Marcar completada y continuar" con togglecompletion.php).
//   /completar      el complete.php de mentira: anota cada pedido (srv.fin.completados).
//   /mod/ivplayer/view.php, /course/view.php
//                   las páginas a las que lleva la barra: una página mínima que anota la
//                   llegada (srv.fin.navegacion).
//   /course/togglecompletion.php
//                   anota el pedido y redirige a `backto` (del mismo sitio), como core.
//   /progreso       el progress.php de mentira: guarda el avance (srv.respaldo.avance).
//   /respaldo       el respaldo.php de mentira: anota cada pedido (srv.respaldo.pedidos).
// srv.respaldo.fallaSegmentos = 503 | 404 | null: desde ese momento, los .ts FIRMADOS dan
// ese error (el Vimeo de mentira no se toca).
// crearMarcoAjeno(): OTRO servidor (otro puerto, o sea otro origen) con una página que
// incrusta el reproductor de éste, como una demo o un SCORM: ahí window.top no se puede
// tocar desde el iframe.
// 🔴 renovada: las pruebas de lo que pasa AL vencer la primera firma. Con firmas de 6 s
// también después, el HLS nativo cambia de fuente cada ~3 s reproduciendo y cada cambio
// cuesta un salto (2-4 s con el 1080p de Mux, 8 MB por segmento): no avanza y la prueba
// falla por algo que con firmas de 1 h o más no existe (un cambio por hora).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { armarConfigurador } from '../../../scripts/armar-configurador.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');
export const GUID_PRUEBA = '11111111-2222-4333-8444-555555555555';
export const CLAVE_AVANCE = `iv_progress_${GUID_PRUEBA}`;

// Las mismas tres preguntas en todas las pruebas: nota en 8, V/F en 25 y en 60.
export const INTERACCIONES = [
  { id: 'n8', type: 'note', time: 8, data: { title: 'Nota de los 8 s', text: 'Texto de la nota.' } },
  { id: 'tf25', type: 'true-false', time: 25, data: { statement: 'Afirmación de los 25 s', correct: true, explanation: 'Explicación.' } },
  { id: 'tf60', type: 'true-false', time: 60, data: { statement: 'Afirmación de los 60 s', correct: false, explanation: 'Explicación.' } },
];
// Las de los avisos y el glosario (?ias=glosario): etiquetas, una nota, una pregunta,
// un punto para tocar y un V/F, sin tiempos que se pisen (los tics de una pendiente son
// a los 3, 2 y 1 s antes: nota7 → 4, 5, 6; mc15 → 12, 13, 14; hs22 → 19, 20, 21;
// tf40 → 37, 38, 39). Los textos son los de la lección 3.1 de Introducción (no son
// secretos); el video de esa lección no va.
export const INTERACCIONES_GLOSARIO = [
  { id: 'data-link', type: 'label', time: 2, duration: 6, data: { text: 'Data Link', definition: 'Sistema de comunicación inalámbrica que conecta el control remoto con la aeronave. Permite el envío de comandos y la recepción de video y telemetría en tiempo real.', x: 5, y: 15 } },
  { id: 'nota7', type: 'note', time: 7, data: { title: 'Dato curioso: Wi-Fi en drones DJI', text: 'En algunos DJI, el enlace depende de **cómo se vuela**, no sólo del modelo.' } },
  { id: 'frecuencia', type: 'label', time: 10, duration: 7, data: { text: 'Frecuencia', definition: 'Cantidad de ciclos por segundo en los que oscila una onda de radio. Se mide en hertz (Hz).', x: 5, y: 30 } },
  { id: 'mc15', type: 'multiple-choice', time: 15, data: { question: '¿Por qué enlace viajan la telemetría y el video en tiempo real?', options: [{ id: 'a', text: 'Uplink' }, { id: 'b', text: 'Downlink' }, { id: 'c', text: 'Control link' }], correctId: 'b', explanation: 'Por el **downlink**: el enlace que va del dron hacia el control.' } },
  { id: 'telemetria', type: 'label', time: 18, duration: 8, data: { text: 'Telemetría', definition: 'Conjunto de datos que el dron envía al piloto: altura, distancia, velocidad, nivel de batería, señal GPS, entre otros.', x: 5, y: 15 } },
  { id: 'hs22', type: 'hotspot', time: 22, duration: 8, data: { spots: [{ id: 's1', x: 30, y: 40, label: 'Antena', info: 'Por acá sale y entra el enlace.' }] } },
  { id: 'ocusync', type: 'label', time: 32, duration: 8, data: { text: 'Ocusync', definition: 'Tecnología de transmisión inalámbrica de DJI. Gestiona el uplink y el downlink para mantener un enlace estable.', x: 5, y: 15 } },
  { id: 'tf40', type: 'true-false', time: 40, data: { statement: 'El uplink lleva los comandos del control al dron.', correct: true, explanation: 'Sí: el uplink va del control al dron.' } },
];
// Dos que frenan a menos de 3 s (?ias=juntas): los tics de la nota (4, 5, 6) se pisaban
// con los del V/F de los 9 (6, 7, 8). Sólo se anuncia la próxima: la nota con sus tres y
// el V/F con el que le queda al seguir (8). La etiqueta de los 9 cae en el mismo segundo
// que el V/F: se suma sin su plop suave encima del plop del freno.
export const INTERACCIONES_JUNTAS = [
  INTERACCIONES_GLOSARIO.find((ia) => ia.id === 'nota7'),
  { id: 'tf9', type: 'true-false', time: 9, data: { statement: 'El downlink va del dron hacia el control.', correct: true, explanation: 'Sí: por ahí viajan la telemetría y el video.' } },
  { ...INTERACCIONES_GLOSARIO.find((ia) => ia.id === 'frecuencia'), time: 9 },
];
// Subtítulos sintéticos (los de los cursos son contenido pago y no van en el repo). El
// segundo cue cruza la nota de los 8 s: con la tarjeta abierta no se tiene que ver. El
// tercero, largo, es el de la vuelta de la TV al celular (tv-subtitulos.mjs).
export const VTT_PRUEBA = [
  'WEBVTT', '',
  '00:00:01.000 --> 00:00:05.000', 'Primer subtítulo de prueba', '',
  '00:00:06.000 --> 00:00:10.500', 'Este cruza la nota de los 8 segundos', '',
  '00:00:12.000 --> 00:00:22.000', 'Tercer subtítulo de prueba', '',
].join('\n');
export const CUES_PRUEBA = [[1, 5, 'Primer subtítulo de prueba'], [6, 10.5, 'Este cruza la nota de los 8 segundos'], [12, 22, 'Tercer subtítulo de prueba']];
// La pregunta del final (?ias=final): el tiempo lo pone el servidor, el segundo entero que
// sigue a la duración del video de prueba.
export const INTERACCION_FINAL = { id: 'tfFin', type: 'true-false', data: { statement: 'Afirmación del final del video', correct: true, explanation: 'Explicación.' } };
// La barra de navegación del tema del campus (?lnav= en /marco.html), con el mismo
// marcado que arma theme_hubeducation (hook_callbacks::course_activity_nav_html). Nombres
// sintéticos.
export const LECCION_SIGUIENTE = { ruta: '/mod/ivplayer/view.php?id=8', nombre: 'Lección 2: Partes del dron' };
export const CURSO = '/course/view.php?id=2';
function barraDelTema(modo, origen) {
  const anterior = '<a class="hub-lnav-btn prev" href="/mod/ivplayer/view.php?id=6"><span class="hub-lnav-dir mono"><span aria-hidden="true">&larr;</span> Anterior</span><span class="hub-lnav-name">Lección 0: Antes de volar</span></a>';
  let siguiente;
  if (modo === 'ultima') {
    siguiente = `<a class="hub-lnav-btn next end" href="${CURSO}"><span class="hub-lnav-dir mono">Terminaste el curso <span aria-hidden="true">&rarr;</span></span><span class="hub-lnav-name">Volver al curso</span></a>`;
  } else if (modo === 'marcar') {
    const href = `/course/togglecompletion.php?${new URLSearchParams({ id: String(CMID_PRUEBA), completionstate: '1', sesskey: SESSKEY_PRUEBA, backto: origen + LECCION_SIGUIENTE.ruta })}`.replace(/&/g, '&amp;');
    siguiente = `<a class="hub-lnav-btn next" href="${href}"><span class="hub-lnav-dir mono"><span aria-hidden="true">&#10003;</span> Marcar completada y continuar</span><span class="hub-lnav-name">${LECCION_SIGUIENTE.nombre}</span></a>`;
  } else {
    siguiente = `<a class="hub-lnav-btn next" href="${LECCION_SIGUIENTE.ruta}"><span class="hub-lnav-dir mono">Siguiente lección <span aria-hidden="true">&rarr;</span></span><span class="hub-lnav-name">${LECCION_SIGUIENTE.nombre}</span></a>`;
  }
  return `<nav class="hub-lnav" aria-label="Navegación entre lecciones">${anterior}${siguiente}</nav>`;
}

const leerAqui = (...p) => fs.readFileSync(path.join(AQUI, ...p), 'utf8');
const AYUDANTE = leerAqui('ayudante-pagina.js');
const TV = leerAqui('..', 'simulados', 'tv-simulada.js');
const CAST = leerAqui('..', 'simulados', 'cast-simulado.js');
const PUENTE = leerAqui('..', 'simulados', 'puente-app-simulado.js');
const AIRPLAY = leerAqui('..', 'simulados', 'airplay-simulado.js');
const SONIDO = leerAqui('..', 'simulados', 'sonido-simulado.js');

// Como JSON_HEX_TAG de player.php: un "</script>" dentro de un texto no corta el bloque.
const json = (x) => JSON.stringify(x).replace(/</g, '\\u003c');

// El WebView de hub-app: ni Cast Web SDK ni Presentation API, y "MoodleMobile" en el UA
// (lo que pone la app para el autologin del campus). Si el reproductor se cayera al camino
// web, acá no encuentra nada: la prueba falla en vez de pasar por Chrome.
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MoodleMobile';
function scriptWebview(q) {
  const ua = q.get('plataforma') === 'ios' ? JSON.stringify(UA_IPHONE) : 'navigator.userAgent + " MoodleMobile"';
  return `(() => {
  const ua = ${ua};
  try { Object.defineProperty(Navigator.prototype, 'userAgent', { configurable: true, get: () => ua }); } catch (e) {}
  try { Object.defineProperty(Navigator.prototype, 'presentation', { configurable: true, get: () => undefined }); } catch (e) {}
  try { Object.defineProperty(window, 'PresentationRequest', { configurable: true, writable: true, value: undefined }); } catch (e) {}
  try { Object.defineProperty(window, 'chrome', { configurable: true, writable: true, value: undefined }); } catch (e) {}
})();`;
}
// Android: el ReactNativeWebView está en TODOS los marcos (cada uno con el suyo, que va a
// la misma app). En el iframe, uno que le pasa los mensajes al de la página de arriba.
const PUENTE_IFRAME = 'window.ReactNativeWebView = { postMessage: (s) => parent.ReactNativeWebView.postMessage(s) };';

// La firma de prueba: el directorio firmado (como token_path=/<guid>/ en Bunny) y lo que
// manda la página para pedir otra (lo que pondría player.php en MOODLE_CONTEXT).
export const DIR_FIRMADO = `/hls/${GUID_PRUEBA}/`;
export const CMID_PRUEBA = 7;
export const SESSKEY_PRUEBA = 'sk-prueba';

const TIPOS = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.aac': 'audio/aac', '.vtt': 'text/vtt' };

// La causa que acepta respaldo.php (ivplayer_respaldo_datos en lib.php).
const CAUSA_RESPALDO = /^(red|medio|otro|http-404|http-5\d\d)$/;

// Un puerto de 127.0.0.1 donde no escucha nadie (se abre y se cierra uno): el CDN caído.
function puertoCerrado() {
  return new Promise((ok, mal) => {
    const s = http.createServer();
    s.once('error', mal);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

export async function crearServidor({ html, video }) {
  // `video`: { tipo: 'local', dir } o { tipo: 'remoto', url }.
  if ((html.match(/<\/head>/gi) || []).length !== 1) throw new Error('el bundle no tiene exactamente un </head>');
  const cache = new Map();
  const pedidosHls = [];
  // Cuántas veces se pidió cada página: así se ve QUÉ recargó un "Reintentar" (la de
  // arriba trae la del reproductor con ella; sólo el iframe, nada más que ésa).
  const cargas = { reproductor: 0, marco: 0 };
  // Firmas emitidas (token → expires) y lo que pasó con ellas, para que las pruebas vean
  // si el video siguió con la firma nueva o se topó con una vencida.
  //   pedidos: cada pedido a /firma · servidos: cada pedido de video firmado que se sirvió
  //   · rechazos: cada 403 (con el motivo).
  //   paginaDe: token → página que lo pidió · rotas: páginas con rota=alta.
  const firma = { emitidas: new Map(), pedidos: [], servidos: [], rechazos: [], n: 0, paginas: 0, inicial: new Map(), lentas: new Set(), paginaDe: new Map(), rotas: new Set(), fallas: new Map() };
  // La red de seguridad (respaldo=1): lo que recibieron el progress.php y el respaldo.php
  // de mentira, el avance guardado, cuántas cargas fueron del "Vimeo de mentira" y la falla
  // de los segmentos firmados que una prueba prende a mitad de camino.
  const respaldo = { pedidos: [], progresos: [], avance: null, cargasVimeo: 0, fallaSegmentos: null };
  // Los enlaces de subtítulos para la TV que emitió este servidor (s → e) y cada pedido
  // que le llegó a /subtitulos (con lo que se contestó).
  const subs = { emitidas: new Map(), pedidos: [], n: 0 };
  // La tarjeta de fin: lo que recibió el complete.php de mentira y a dónde se navegó desde
  // la barra del tema (incluido el paso por togglecompletion.php).
  const fin = { completados: [], navegacion: [] };
  function emitirSubs(expires, origen) {
    const s = `sub-prueba-${++subs.n}`;
    subs.emitidas.set(s, expires);
    return `${origen}/subtitulos?${new URLSearchParams({ id: String(CMID_PRUEBA), e: String(expires), s })}`;
  }
  const cdnCaido = `http://127.0.0.1:${await puertoCerrado()}`;
  const segundos = () => Date.now() / 1000;
  function emitirFirma(ttl, origen, pag) {
    const token = `HS256-prueba${++firma.n}`;
    const expires = Math.floor(segundos()) + ttl;
    firma.emitidas.set(token, expires);
    if (pag != null) firma.paginaDe.set(token, pag);
    const tramo = `bcdn_token=${token}&token_path=${encodeURIComponent(DIR_FIRMADO)}&expires=${expires}`;
    return {
      token, expires,
      playlist: `${origen}/${tramo}${DIR_FIRMADO}playlist.m3u8`,
      // La miniatura, como la de Bunny: misma firma, en la query (acá no hay imagen: 404).
      poster: `${origen}${DIR_FIRMADO}thumbnail.jpg?token=${token}&token_path=${encodeURIComponent(DIR_FIRMADO)}&expires=${expires}`,
    };
  }

  async function traerRemoto(url) {
    if (!cache.has(url)) {
      const p = fetch(url, { signal: AbortSignal.timeout(20000) }).then(async (r) => ({
        estado: r.status, tipo: r.headers.get('content-type') || 'application/octet-stream', cuerpo: Buffer.from(await r.arrayBuffer()),
      }));
      cache.set(url, p);
      // Sólo quedan en caché las respuestas buenas: un error se vuelve a pedir.
      p.then((x) => { if (x.estado !== 200) cache.delete(url); }, () => cache.delete(url));
    }
    return cache.get(url);
  }

  // La playlist de la calidad más alta (mayor alto y, a igual alto, mayor bitrate: la que
  // elige nativePlayer para ese alto), relativa al master, para rota=alta.
  let varianteAlta = null;
  function laVarianteAlta() {
    if (!varianteAlta) {
      const texto = video.tipo === 'local'
        ? Promise.resolve(fs.readFileSync(path.join(video.dir, 'playlist.m3u8'), 'utf8'))
        : traerRemoto(video.url).then((r) => r.cuerpo.toString('utf8'));
      varianteAlta = texto.then((txt) => {
        const lineas = txt.split(/\r?\n/).map((l) => l.trim());
        let mejor = null;
        lineas.forEach((l, i) => {
          if (!/^#EXT-X-STREAM-INF:/i.test(l)) return;
          const uri = lineas.slice(i + 1).find((x) => x && !x.startsWith('#'));
          const alto = Number((/RESOLUTION=\d+x(\d+)/i.exec(l) || [])[1]) || 0;
          const bps = Number((/[:,]BANDWIDTH=(\d+)/i.exec(l) || [])[1]) || 0;
          if (uri && (!mejor || alto > mejor.alto || (alto === mejor.alto && bps > mejor.bps))) mejor = { uri, alto, bps };
        });
        return mejor ? mejor.uri : null;
      });
    }
    return varianteAlta;
  }

  function paginaReproductor(q, origen) {
    // La recarga de la red de seguridad: el "Vimeo de mentira" (ver arriba).
    const vimeoDeMentira = q.get('respaldo') === '1' && q.get('origen') === 'vimeo';
    const config = {
      title: 'Prueba del reproductor',
      // URL absoluta: el HLS nativo arma las URL de las variantes con new URL(…, master).
      videoUrl: `${origen}/hls/${GUID_PRUEBA}/playlist.m3u8`,
      videoMotor: q.get('motor') || 'auto',
      interactions: INTERACCIONES,
    };
    if (q.get('subs') === 'vtt') config.subtitlesVtt = VTT_PRUEBA;
    // Los avisos y el glosario: otras interacciones y el modo de las etiquetas (lo que
    // pone player.php con el ajuste de la actividad; sin él, el de por defecto).
    if (q.get('ias') === 'glosario') config.interactions = INTERACCIONES_GLOSARIO;
    if (q.get('ias') === 'juntas') config.interactions = INTERACCIONES_JUNTAS;
    // Tarjeta de fin: una pregunta del final y "Repetir video".
    if (q.get('ias') === 'final') config.interactions = [...INTERACCIONES, { ...INTERACCION_FINAL, time: Math.ceil(video.duracion || 78) }];
    if (q.get('loop') === '1') config.loop = true;
    if (['glosario', 'pantalla'].includes(q.get('etiquetas'))) config.etiquetas = q.get('etiquetas');
    if (q.get('video') === 'ninguno') { delete config.videoUrl; config.vimeoId = ''; }
    if (q.get('video') === 'texto') { delete config.videoUrl; config.vimeoId = 'ID_DEL_VIDEO'; config.vimeoHash = 'HASH_DEL_VIDEO'; }
    let contexto = null;
    const ttl = vimeoDeMentira ? 0 : Number(q.get('firma'));
    if (ttl > 0) {
      // Lo que hace player.php con la clave de Bunny cargada: la URL firmada y, en
      // MOODLE_CONTEXT, a dónde pedir otra y la hora del servidor al firmar.
      const pag = String(++firma.paginas);
      const f0 = emitirFirma(ttl, origen, pag);
      config.videoUrl = f0.playlist;
      firma.inicial.set(pag, f0);
      if (q.get('rota') === 'alta') firma.rotas.add(pag);
      const modo = ['falla', 'falla-hasta-403', 'red-tras-403', 'lenta', 'permiso'].includes(q.get('renovar')) ? q.get('renovar') : 'ok';
      const f = new URLSearchParams({ ttl: String(Number(q.get('renovada')) > 0 ? Number(q.get('renovada')) : ttl), modo, pag });
      if (q.get('subs') === 'vtt' && q.get('subsTv') !== '0') f.set('subs', '1');
      if (Number(q.get('demora')) > 0) f.set('demora', q.get('demora'));
      contexto = { cmid: CMID_PRUEBA, sesskey: SESSKEY_PRUEBA, firmaUrl: `${origen}/firma?${f}`, firmaAhora: segundos() };
      if (q.get('falla') === 'playlist-404') firma.fallas.set(pag, q.get('falla'));
      // El CDN caído: la misma URL firmada, en un puerto donde no escucha nadie.
      if (q.get('falla') === 'red') config.videoUrl = f0.playlist.replace(origen, cdnCaido);
    }
    if (q.get('respaldo') === '1') {
      // Lo que agrega player.php con la red prendida (respaldoUrl sólo en la carga de
      // Bunny) y lo de siempre de Moodle para el avance (progressUrl, savedProgress).
      if (vimeoDeMentira) {
        respaldo.cargasVimeo++;
        config.title = 'Prueba del reproductor (Vimeo de mentira)';
      } else {
        let avance = null;
        try { avance = q.get('progreso') ? JSON.parse(q.get('progreso')) : null; } catch {}
        respaldo.avance = avance;
      }
      const modo = ['sesion', 'sinvimeo'].includes(q.get('respaldoModo')) ? q.get('respaldoModo') : 'ok';
      contexto = {
        ...(contexto || {}), cmid: CMID_PRUEBA, sesskey: SESSKEY_PRUEBA,
        progressUrl: `${origen}/progreso`, savedProgress: respaldo.avance,
        ...(vimeoDeMentira ? {} : { respaldoUrl: `${origen}/respaldo?modo=${modo}` }),
      };
    }
    // Subtítulos en la TV: lo que agrega player.php con Bunny y subtítulos (el enlace a
    // subtitulos.php con el vencimiento de la firma del video; sin firma, una hora).
    if (q.get('subs') === 'vtt' && q.get('subsTv') !== '0' && config.videoUrl && !vimeoDeMentira) {
      const inicial = ttl > 0 ? firma.inicial.get(String(firma.paginas)) : null;
      config.subtitlesUrlTv = emitirSubs(inicial ? inicial.expires : Math.floor(segundos()) + 3600, origen);
    }
    // La casilla "La app con Chromecast ya está publicada" (player.php la pone siempre).
    if (q.get('appCastPublicada') === '1') contexto = { ...(contexto || {}), appCastPublicada: true };
    // Lo de Moodle para la finalización y el avance (player.php siempre los pone).
    if (q.get('completar') === '1') contexto = { ...(contexto || {}), cmid: CMID_PRUEBA, sesskey: SESSKEY_PRUEBA, completeUrl: `${origen}/completar`, progressUrl: `${origen}/progreso` };
    let antes = `<script>${AYUDANTE}</script>\n`;
    if (q.get('webview') === '1') antes += `<script>${scriptWebview(q)}</script>\n`;
    if (['fake', 'mudo'].includes(q.get('app')) && q.get('plataforma') !== 'ios') antes += `<script>${PUENTE_IFRAME}</script>\n`;
    if (q.get('cast') === 'fake') antes += `<script>${TV}</script>\n<script>${CAST}</script>\n`;
    if (q.get('airplay') === '1') antes += `<script>${AIRPLAY}</script>\n`;
    if (q.get('sonido') === 'simulado') antes += `<script>${SONIDO}</script>\n`;
    // Sin pantalla completa nativa (como el iPhone): fuerza la simulada de la madre.
    if (q.get('nofs') === '1') antes += '<script>delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen;</script>\n';
    if (q.get('progreso') && !vimeoDeMentira) antes += `<script>try { localStorage.setItem(${json(CLAVE_AVANCE)}, ${json(q.get('progreso'))}); } catch (e) {}</script>\n`;
    if (vimeoDeMentira) antes += `<script>window.__ivpOrigen = 'vimeo';</script>\n`;
    // 🔴 Con función y no con texto de reemplazo: en un texto, "$'" (que aparece en el
    // ayudante: $('.iv-…')) significa "lo que sigue al hallazgo" y rompía la página.
    const conHead = html.replace(/<head>/i, () => `<head>\n${antes}`);
    if (q.get('config') === 'ninguna') return conHead;
    return conHead
      .replace(/<\/head>/i, () => `<script>\nwindow.PLAYER_CONFIG = ${json(config)};${contexto ? `\nwindow.MOODLE_CONTEXT = ${json(contexto)};` : ''}\n</script>\n</head>`);
  }

  function paginaMarco(q, origen) {
    const ancho = /^\d+px$/.test(q.get('ancho') || '') ? q.get('ancho') : '100vw';
    q.delete('ancho');
    // La barra del tema, debajo del video como en view.php (la lee la tarjeta de fin).
    const lnav = ['siguiente', 'ultima', 'marcar'].includes(q.get('lnav')) ? barraDelTema(q.get('lnav'), origen) : '';
    // hub-app simulada (y su TV) en la página de arriba: es la que tiene la sesión de Cast,
    // y sobrevive a que el iframe del reproductor se recargue (salir y volver).
    const app = ['fake', 'mudo'].includes(q.get('app')) ? `<script>${TV}</script>\n<script>${PUENTE}</script>\n` : '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${app}
<style>html,body{margin:0;background:#222}iframe{border:0;width:${ancho};aspect-ratio:16/9;display:block}
iframe.css-fs{position:fixed;inset:0;width:100vw;height:100vh;aspect-ratio:auto;z-index:9}</style></head>
<body><iframe src="/player.html?${q.toString().replace(/"/g, '&quot;')}" title="Reproductor" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>
${lnav}
<script>
  // Lo que hace view.php con el pedido de pantalla completa simulada del reproductor.
  const f = document.querySelector('iframe');
  addEventListener('message', (e) => {
    if (e.source !== f.contentWindow || !e.data || e.data.type !== 'ivplayer-fullscreen') return;
    const en = e.data.action === 'enter';
    f.classList.toggle('css-fs', en);
    f.contentWindow.postMessage({ type: 'ivplayer-fullscreen-state', isFS: en }, '*');
  });
</script></body></html>`;
  }

  async function servirHls(resto, res) {
    pedidosHls.push(resto);
    if (video.tipo === 'local') {
      const archivo = path.resolve(video.dir, resto);
      // Nada fuera de la carpeta del video.
      if (!archivo.startsWith(path.resolve(video.dir) + path.sep)) { res.writeHead(403); return res.end(); }
      fs.readFile(archivo, (err, cuerpo) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(cuerpo);
      });
      return;
    }
    const master = new URL(video.url);
    const destino = resto === 'playlist.m3u8' ? master : new URL(resto, master);
    if (!destino.search && master.search) destino.search = master.search;
    const r = await traerRemoto(destino.href);
    res.writeHead(r.estado, { 'content-type': r.tipo, 'cache-control': 'no-store' });
    res.end(r.cuerpo);
  }

  // El CDN con la autenticación por token: el tramo /bcdn_token=…/ tiene que ser una
  // firma emitida acá, de este directorio y sin vencer. Si no, 403 (con CORS, como Bunny).
  async function servirFirmado(pathname, res) {
    const m = /^\/bcdn_token=([^/]*)(\/.*)$/.exec(pathname);
    const p = new URLSearchParams('bcdn_token=' + (m ? m[1] : ''));
    const token = p.get('bcdn_token'), expires = Number(p.get('expires'));
    const resto = m ? m[2] : '';
    let motivo = null;
    if (!m || !resto.startsWith(DIR_FIRMADO)) motivo = 'ruta';
    else if (p.get('token_path') !== DIR_FIRMADO) motivo = 'token_path';
    else if (firma.emitidas.get(token) !== expires) motivo = 'token desconocido';
    else if (segundos() > expires) motivo = 'vencida';
    // Con la firma en regla: la calidad rota de esa página (rota=alta) da 403 igual.
    else if (firma.rotas.has(firma.paginaDe.get(token)) && decodeURIComponent(resto.slice(DIR_FIRMADO.length)) === await laVarianteAlta()) motivo = 'rota';
    if (motivo) {
      firma.rechazos.push({ ms: Date.now(), token, motivo, resto });
      res.writeHead(403, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      return res.end('403');
    }
    // Las fallas del CDN para la red de seguridad (con la firma en regla: no es la firma).
    const archivo = decodeURIComponent(resto.slice(DIR_FIRMADO.length));
    const falla = firma.fallas.get(firma.paginaDe.get(token));
    const estadoFalla = (falla === 'playlist-404' && archivo === 'playlist.m3u8') ? 404
      : (respaldo.fallaSegmentos && /\.ts$/i.test(archivo)) ? respaldo.fallaSegmentos : 0;
    if (estadoFalla) {
      firma.rechazos.push({ ms: Date.now(), token, motivo: `falla ${estadoFalla}`, resto });
      res.writeHead(estadoFalla, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      return res.end(String(estadoFalla));
    }
    firma.servidos.push({ ms: Date.now(), token, expires, resto });
    return servirHls(archivo, res);
  }

  // firma.php de mentira. Los modos (ver renovar= arriba) imitan lo que puede pasar en el
  // campo: la sesión cerrada, sin red un rato, una respuesta que tarda.
  function responderFirma(req, u, origen, res) {
    const responder = (estado, cuerpo) => { res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(cuerpo)); };
    let cuerpo = '';
    req.on('data', (d) => { cuerpo += d; });
    req.on('end', () => {
      const b = new URLSearchParams(cuerpo);
      firma.pedidos.push({ ms: Date.now(), metodo: req.method, cmid: b.get('cmid'), sesskey: b.get('sesskey'), modo: u.searchParams.get('modo'), pag: u.searchParams.get('pag') });
      if (req.method !== 'POST') return responder(405, { ok: false, motivo: 'metodo' });
      const modo = u.searchParams.get('modo'), inicial = firma.inicial.get(u.searchParams.get('pag'));
      if (modo === 'falla-hasta-403' || modo === 'red-tras-403') {
        const r403 = inicial && firma.rechazos.find((r) => r.token === inicial.token);
        if (!r403) return responder(503, { ok: false, motivo: 'error' });
        // red-tras-403: los DOS primeros pedidos de después del 403, también 503.
        const tras403 = firma.pedidos.filter((x) => x.pag === u.searchParams.get('pag') && x.ms >= r403.ms).length;
        if (modo === 'red-tras-403' && tras403 <= 2) return responder(503, { ok: false, motivo: 'error' });
      }
      if (modo === 'lenta' && inicial && !firma.lentas.has(inicial.token)) {
        firma.lentas.add(inicial.token);
        // La firma se hace al contestar (como firma.php cuando por fin atiende): hecha al
        // pedir, con una demora mayor que la mitad del TTL llegaba vencida.
        return setTimeout(() => {
          const f = emitirFirma(Number(u.searchParams.get('ttl')) || 60, origen, u.searchParams.get('pag'));
          responder(200, { ok: true, playlist: f.playlist, poster: f.poster, expires: f.expires, ahora: segundos(), ...subsDe(f) });
        }, Math.max(0, (inicial.expires + (Number(u.searchParams.get('demora')) || 2)) * 1000 - Date.now()));
      }
      if (modo === 'permiso') return responder(403, { ok: false, motivo: 'permiso' });
      if (modo === 'falla' || b.get('cmid') !== String(CMID_PRUEBA) || b.get('sesskey') !== SESSKEY_PRUEBA) return responder(401, { ok: false, motivo: 'sesion' });
      const f = emitirFirma(Number(u.searchParams.get('ttl')) || 60, origen, u.searchParams.get('pag'));
      responder(200, { ok: true, playlist: f.playlist, poster: f.poster, expires: f.expires, ahora: segundos(), ...subsDe(f) });
    });
    // Como firma.php: con subtítulos, el enlace nuevo con el vencimiento de la firma nueva.
    function subsDe(f) { return u.searchParams.get('subs') === '1' ? { subtitulosTv: emitirSubs(f.expires, origen) } : {}; }
  }

  // subtitulos.php de mentira: sin sesión, CORS abierto, el VTT si el enlace es de acá y
  // está vigente; 403 sin detalle si no (también para los enlaces vencidos).
  function responderSubtitulos(req, u, res) {
    const s = u.searchParams.get('s'), e = Number(u.searchParams.get('e'));
    const bien = subs.emitidas.get(s) === e && u.searchParams.get('id') === String(CMID_PRUEBA) && segundos() < e;
    subs.pedidos.push({ ms: Date.now(), metodo: req.method, s, e, estado: bien ? 200 : 403, cookie: !!req.headers.cookie });
    if (!bien) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'private, max-age=300' });
    res.end(VTT_PRUEBA + '\n');
  }

  // progress.php de mentira. scorm.js manda FormData (multipart): lo lee undici.
  async function responderProgreso(req, res) {
    const trozos = [];
    for await (const t of req) trozos.push(t);
    let campos = {};
    try { campos = Object.fromEntries(await new Response(Buffer.concat(trozos), { headers: { 'content-type': req.headers['content-type'] || '' } }).formData()); } catch {}
    let data = null;
    try { data = JSON.parse(campos.data); } catch {}
    respaldo.progresos.push({ ms: Date.now(), cmid: campos.cmid, sesskey: campos.sesskey, data });
    if (data) respaldo.avance = data;
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ success: !!data }));
  }

  // complete.php de mentira (scorm.js manda FormData: cmid + sesskey). Contesta como el de
  // verdad, { success: true }: si no, la cola lo reintentaría.
  async function responderCompletar(req, res) {
    const trozos = [];
    for await (const t of req) trozos.push(t);
    let campos = {};
    try { campos = Object.fromEntries(await new Response(Buffer.concat(trozos), { headers: { 'content-type': req.headers['content-type'] || '' } }).formData()); } catch {}
    fin.completados.push({ ms: Date.now(), metodo: req.method, cmid: campos.cmid, sesskey: campos.sesskey });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ success: true }));
  }

  // respaldo.php de mentira: las mismas respuestas (ver mod/ivplayer/respaldo.php).
  function responderRespaldo(req, u, res) {
    const responder = (estado, cuerpo) => { res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(cuerpo)); };
    let cuerpo = '';
    req.on('data', (d) => { cuerpo += d; });
    req.on('end', () => {
      const b = new URLSearchParams(cuerpo);
      const modo = u.searchParams.get('modo');
      respaldo.pedidos.push({ ms: Date.now(), metodo: req.method, modo, cmid: b.get('cmid'), sesskey: b.get('sesskey'), causa: b.get('causa'), codigo: Number(b.get('codigo')), detalle: b.get('detalle') });
      if (req.method !== 'POST') return responder(405, { ok: false, motivo: 'metodo' });
      if (modo === 'sesion' || b.get('cmid') !== String(CMID_PRUEBA) || b.get('sesskey') !== SESSKEY_PRUEBA) return responder(401, { ok: false, motivo: 'sesion' });
      if (!CAUSA_RESPALDO.test(b.get('causa') || '')) return responder(400, { ok: false, motivo: 'causa' });
      if (modo === 'sinvimeo') return responder(409, { ok: false, motivo: 'apagado' });
      responder(200, { ok: true, registrado: true });
    });
  }

  const srv = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const origen = `http://${req.headers.host}`;
      const pagina = (cuerpo) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(cuerpo); };
      if (u.pathname === '/player.html') { cargas.reproductor++; return pagina(paginaReproductor(u.searchParams, origen)); }
      if (u.pathname === '/marco.html') { cargas.marco++; return pagina(paginaMarco(new URLSearchParams(u.searchParams), origen)); }
      // La tarjeta de fin: complete.php y a dónde lleva la barra del tema.
      if (u.pathname === '/completar') return await responderCompletar(req, res);
      if (u.pathname === '/mod/ivplayer/view.php' || u.pathname === '/course/view.php') {
        fin.navegacion.push({ ms: Date.now(), ruta: u.pathname + u.search });
        return pagina(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Destino</title></head><body><p id="destino">${u.pathname}</p></body></html>`);
      }
      if (u.pathname === '/course/togglecompletion.php') {
        fin.navegacion.push({ ms: Date.now(), ruta: u.pathname + u.search, id: u.searchParams.get('id'), completionstate: u.searchParams.get('completionstate'), sesskey: u.searchParams.get('sesskey') });
        let backto = null;
        try { const b = new URL(u.searchParams.get('backto') || '', origen); if (b.origin === origen) backto = b.pathname + b.search; } catch {}
        if (!backto) { res.writeHead(400); return res.end(); }
        res.writeHead(303, { location: backto, 'cache-control': 'no-store' });
        return res.end();
      }
      if (u.pathname === '/vacio.html') return pagina('<!doctype html><title>vacío</title>');
      // Se lee en cada pedido: así prueba el configurador como está en el disco.
      if (u.pathname === '/configurador.html') return pagina(armarConfigurador({
        playerHtml: html,
        manifest: fs.readFileSync(path.join(RAIZ, 'scorm', 'imsmanifest.xml'), 'utf8'),
        configurator: fs.readFileSync(path.join(RAIZ, 'configurator', 'index.html'), 'utf8'),
      }));
      if (u.pathname === '/firma') return responderFirma(req, u, origen, res);
      if (u.pathname === '/subtitulos') return responderSubtitulos(req, u, res);
      if (u.pathname === '/progreso') return await responderProgreso(req, res);
      if (u.pathname === '/respaldo') return responderRespaldo(req, u, res);
      if (u.pathname.startsWith('/bcdn_token=')) return await servirFirmado(u.pathname, res);
      const pre = `/hls/${GUID_PRUEBA}/`;
      if (u.pathname.startsWith(pre)) return await servirHls(decodeURIComponent(u.pathname.slice(pre.length)), res);
      res.writeHead(404); res.end();
    } catch (e) {
      try { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(String(e && e.message)); } catch {}
    }
  });

  return new Promise((ok, mal) => {
    srv.once('error', mal);
    srv.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      ok({
        base, pedidosHls, firma, cargas, respaldo, subs, fin,
        cerrar: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
      });
    });
  });
}

// Una página de OTRO origen (otro puerto) que incrusta el reproductor del servidor de
// pruebas, como una demo de la web o un SCORM. Desde el iframe, window.top no se puede
// leer (SecurityError): "Reintentar" tiene que recargar el iframe, como siempre.
// /marco-ajeno.html?<query del reproductor>
export function crearMarcoAjeno({ baseReproductor }) {
  const cargas = { marco: 0 };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/marco-ajeno.html') { res.writeHead(404); return res.end(); }
    cargas.marco++;
    const src = `${baseReproductor}/player.html?${u.searchParams.toString().replace(/"/g, '&quot;')}`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Página de otro origen</title>
<style>html,body{margin:0;background:#222}iframe{border:0;width:100vw;aspect-ratio:16/9;display:block}</style></head>
<body><iframe src="${src}" title="Reproductor" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe></body></html>`);
  });
  return new Promise((ok, mal) => {
    srv.once('error', mal);
    srv.listen(0, '127.0.0.1', () => ok({
      base: `http://127.0.0.1:${srv.address().port}`,
      cargas,
      cerrar: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
    }));
  });
}
