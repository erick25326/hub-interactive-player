// La configuración del reproductor: lo que trae por defecto y la que llega de afuera en
// window.PLAYER_CONFIG (player.php, el configurador, un SCORM, las demos de la web).
// Puro, sin React: vive acá para poder probarlo sin navegador
// (tests/unit/configuracion.test.mjs). Lo usa InteractiveVideoPlayer.jsx.

// 🔴 La config por defecto NO trae video (plan de migración a Bunny, 0.3). Hasta la
// 1.4.0 traía el ID y el hash de una clase real del campus, y este repo es público: se
// podía ver entera bajando el bundle. Lo que entra acá viaja en player.html, en el
// configurador de GitHub Pages y en cada SCORM. Para probar con un video, pasarlo en
// window.PLAYER_CONFIG (ver config.example.js), nunca acá.
export const DEFAULT_CONFIG = {
  title: "Hub Education — Video Interactivo",
  // Vimeo: ID numérico, URL pública, o URL con hash para videos privados. Vacío: sin
  // video, y el reproductor lo dice (ver hayVideo) en vez de quedarse cargando.
  vimeoId: "",
  vimeoHash: null,  // Hash para videos privados/no listados
  // Alternativa a Vimeo: URL HLS (.m3u8, p. ej. Bunny Stream) o MP4 directo.
  // Si está, manda sobre vimeoId y se usa el <video> nativo (ver nativePlayer.js).
  videoUrl: null,
  poster: null,
  // Motor del video propio: 'auto' (hls.js; HLS de Safari en Apple), 'hls' o 'nativo'.
  videoMotor: 'auto',
  // Chromecast: null = receptor por defecto de Google (sin registro; la TV sólo
  // muestra el video y las preguntas salen en el celular). Un ID de 8 hexadecimales
  // = receptor propio registrado en la consola de Cast (ver cast.js y el README).
  castAppId: null,
  loop: false,              // true = repetir video al terminar
  // Las etiquetas (label): 'glosario' (desde la 1.4.0, por defecto) las suma a un
  // glosario interactivo a medida que se nombran; 'pantalla' las muestra como pines
  // sobre el video, como antes (respaldo por actividad, ajuste "Etiquetas" de
  // mod_ivplayer). Cualquier otro valor cuenta como 'glosario'.
  etiquetas: 'glosario',
  subtitlesUrl: null,
  subtitlesCues: [],
  // Texto crudo de un VTT o SRT (lo inyecta player.php desde "Editar transcripción").
  // Se usa si no vinieron subtitlesCues.
  subtitlesVtt: null,
  // Los subtitulos arrancan APAGADOS. El boton sigue estando: el alumno que los
  // quiera los prende y ahi se quedan mientras dure el video.
  // Antes arrancaban prendidos y ademas el reproductor le pedia a Vimeo que
  // activara la pista apenas cargaba, asi que aparecian solos en cada video aunque
  // nadie los hubiera pedido. Un video de catedra con el texto encima tapa
  // justamente lo que se esta mostrando -- un mapa, una pantalla de DJI Pilot.
  // Se puede prender por video con `subtitlesOn: true` en el PLAYER_CONFIG.
  subtitlesOn: false,
  // Sin interacciones de ejemplo: con un video y sin `interactions`, salían las
  // preguntas de muestra sobre el video de otro. El formato de cada tipo (y el
  // markdown que aceptan los textos: **negrita**, _cursiva_, línea en blanco para
  // separar párrafos; ver RichText) está en config.example.js.
  interactions: [],
};

export function getConfig() {
  const externa = typeof window !== "undefined" ? window.PLAYER_CONFIG : null;
  return externa ? { ...DEFAULT_CONFIG, ...externa } : DEFAULT_CONFIG;
}

// ¿Hay algo que reproducir? Lo mismo que leen nativeSrc y vimeoData en el reproductor:
// un video propio (videoUrl, o una URL que no es de Vimeo pegada en vimeoId) o un ID de
// Vimeo mayor que cero, suelto o dentro de una URL de Vimeo. Sin nada de eso el SDK de
// Vimeo tira al crearse (id vacío o NaN) y React desmontaba el reproductor entero: la
// pantalla en blanco. En el campus no se llega a ese caso (player.php muestra su propio
// cartel sin video), pero sí con la config por defecto, un SCORM o una demo mal armados.
export function hayVideo({ videoUrl, vimeoId } = {}) {
  if (videoUrl) return true;
  const v = String(vimeoId ?? "");
  if (/^https?:\/\//.test(v) && !/vimeo\.com/.test(v)) return true;
  const id = /^\d+$/.test(v) ? v : (v.match(/vimeo\.com\/(?:video\/)?(\d+)/) || [])[1];
  return Number(id) > 0;
}
