// Puente con hub-app (protocolo ivcast v1).
//
// Dentro de la app de Hub Education (un WebView de React Native) no existe el Cast Web
// SDK: la app transmite con el Cast NATIVO y le habla al reproductor por mensajes. Este
// archivo es el canal; castNativo.js arma encima la forma del Web SDK que usa cast.js,
// así CastPlayer y el candado de preguntas no se enteran de nada.
//
// Qué hay acá:
//   - puenteDisponible(): ¿hay un ReactNativeWebView del mismo origen, que no sea un
//     marco con ese nombre? (sincrónico)
//   - pareceApp(): el UA dice "MoodleMobile" (sólo para elegir el texto de un aviso)
//   - conectarApp(): el saludo (hola → hola-ok). Lo que PRUEBA que hay una app que habla
//     ivcast es la respuesta, no la presencia del objeto.
//   - enviar() / notificar() / escuchar(): comandos con id y tope, avisos sin id, eventos.
//   - latir() / dejarDeLatir(): el latido de cada 2 s mientras hay sesión (lo prende y lo
//     apaga castNativo.js).
//
// Transporte (el contrato está en castear-hub-app-v2.md §3 y en el PEDIDO a hub-app §5):
//   web → app: (window.ReactNativeWebView || window.top.ReactNativeWebView).postMessage(JSON)
//   app → web: la app inyecta en el marco principal una llamada a window.__ivcastRecibir(texto),
//              que se registra acá en window.top (el iframe del reproductor es del mismo origen
//              que view.php). Un mensaje por inyección; se acepta también un arreglo.
//   Sobre: { ivcast: 1, tipo, id?, re?, …campos }. `id` = "<instancia>-<n>", con la
//   instancia al azar por carga del reproductor. Las respuestas (`re`) de otra instancia se
//   descartan; los eventos son para todos.
//
// 🔴 Repo PÚBLICO: el protocolo es genérico. Acá no van hosts, GUIDs ni claves.
// 🔴 Nada de esto se toca en Chrome, Safari ni en la app vieja: sin ReactNativeWebView,
// puenteDisponible() da false y cast.js sigue por el camino web de siempre.

export const VERSION_PROTOCOLO = 1;
export const VERSION_REPRODUCTOR = "1.4.0";
export const TOPE_HOLA_MS = 3000;
export const TOPE_COMANDO_MS = 10000;
export const LATIDO_MS = 2000;

// Las respuestas: se buscan en los pendientes por `re`.
const RESPUESTAS = new Set(["ok", "error", "hola-ok"]);

let instancia = null;      // prefijo de los id de esta carga del reproductor
let cuenta = 0;
const pendientes = new Map();   // id → { resolver, rechazar, timer }
const oyentes = new Set();
let registrado = null;     // { donde, fn }: el __ivcastRecibir que se puso
let conexion = null;       // promesa del hola (sólo se guarda la que salió bien)
let latido = null;         // { id, msid }
let escuchandoSalida = false;

function anotar(k, v) {
  try { (window.__ivCastDiag = window.__ivCastDiag || {})[k] = v; } catch (e) {}
}

// El objeto de la app: en Android está en TODOS los marcos; en iOS sólo en el
// principal, que se puede leer porque el iframe del reproductor es del mismo origen. Si
// el de arriba es de otro origen no hay puente: se descarta antes de mirarlo (leer su
// `document` tira SecurityError).
// 🔴 Un <iframe name="ReactNativeWebView"> se lee como window.ReactNativeWebView (y como
// window.top.ReactNativeWebView AUNQUE la página de arriba sea de otro origen: el nombre
// de un marco hijo es de lo poco que se puede leer de otro origen), y su postMessage es
// una función. Sin este control, cualquier página que incrustara el reproductor (una demo
// de la web) con un marco con ese nombre lo pasaba a modo app en Chrome común. Un marco
// se reconoce porque es su propio `window`; el objeto de la app, no.
function esPuente(rn) {
  try { return !!rn && typeof rn.postMessage === "function" && rn.window !== rn; } catch (e) { return false; }
}
function canal() {
  try {
    const rn = window.ReactNativeWebView;
    if (esPuente(rn)) return rn;
  } catch (e) {}
  try {
    const top = window.top;
    if (top && top !== window) {
      void top.document;   // de otro origen tira SecurityError: no es la página de la app
      const rn = top.ReactNativeWebView;
      if (esPuente(rn)) return rn;
    }
  } catch (e) {}
  return null;
}

export function puenteDisponible() { return !!canal(); }

// 🔴 "MoodleMobile" es también el UA de la app OFICIAL de Moodle: el texto que dependa
// de esto tiene que servir para las dos.
export function pareceApp() {
  try { return /MoodleMobile/.test(navigator.userAgent || ""); } catch (e) { return false; }
}

// Dónde registrar __ivcastRecibir: la app inyecta en el marco PRINCIPAL. Si el de
// arriba no se puede tocar (otro origen), en el propio: así anda el reproductor suelto.
function destino() {
  try {
    const top = window.top;
    if (top && top !== window && top.document) return top;
  } catch (e) {}
  return window;
}

function registrar() {
  const donde = destino();
  const fn = (x) => recibir(x);
  try { donde.__ivcastRecibir = fn; registrado = { donde, fn }; } catch (e) {}
}

function desregistrar() {
  if (!registrado) return;
  try { if (registrado.donde.__ivcastRecibir === registrado.fn) delete registrado.donde.__ivcastRecibir; } catch (e) {}
  registrado = null;
}

// Sobres válidos de lo que inyectó la app: un texto JSON, un objeto o un arreglo de
// cualquiera de los dos (se procesan en orden). Lo que no es { ivcast: 1, tipo } se
// descarta en silencio: con la regla "*" de Android, cualquier marco puede escribirle a
// la app, y del lado de acá llega sólo lo que la app inyectó, pero igual se valida.
export function leerSobres(x) {
  const uno = (m) => {
    let o = m;
    if (typeof o === "string") { try { o = JSON.parse(o); } catch (e) { return null; } }
    return o && typeof o === "object" && !Array.isArray(o) && o.ivcast === 1 && typeof o.tipo === "string" && o.tipo ? o : null;
  };
  let lista = x;
  if (typeof lista === "string") { try { lista = JSON.parse(lista); } catch (e) { return []; } }
  if (!Array.isArray(lista)) lista = [lista];
  return lista.map(uno).filter(Boolean);
}

function recibir(x) {
  for (const m of leerSobres(x)) procesar(m);
}

function procesar(m) {
  if (RESPUESTAS.has(m.tipo)) {
    // De otra instancia (otra carga del reproductor, otra pestaña): no es nuestra.
    if (typeof m.re !== "string" || !instancia || m.re.indexOf(instancia + "-") !== 0) return;
    const p = pendientes.get(m.re);
    if (!p) return;
    pendientes.delete(m.re);
    clearTimeout(p.timer);
    if (m.tipo === "error") p.rechazar({ codigo: typeof m.codigo === "string" && m.codigo ? m.codigo : "error", detalle: typeof m.detalle === "string" ? m.detalle : null });
    else p.resolver(m);
    return;
  }
  for (const fn of [...oyentes]) { try { fn(m); } catch (e) {} }
}

function postear(c, obj) {
  try { c.postMessage(JSON.stringify(obj)); return true; } catch (e) { return false; }
}

function nuevaInstancia() {
  return Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-3);
}

// Comando con id: la promesa resuelve con el `ok` (o el `hola-ok`) y rechaza con
// { codigo, detalle } (el `error` de la app) o { codigo: 'timeout' }.
// 🔴 El pendiente se anota ANTES de postear: una app (o el simulado) que contesta en
// el mismo turno no tiene que encontrar el mapa vacío.
export function enviar(tipo, datos = {}, { tope = TOPE_COMANDO_MS } = {}) {
  const c = canal();
  if (!c) return Promise.reject({ codigo: "sin_puente", detalle: null });
  if (!instancia) instancia = nuevaInstancia();
  if (!registrado) registrar();
  const id = `${instancia}-${++cuenta}`;
  return new Promise((resolver, rechazar) => {
    const timer = setTimeout(() => { if (pendientes.delete(id)) rechazar({ codigo: "timeout", detalle: null }); }, tope);
    pendientes.set(id, { resolver, rechazar, timer });
    if (!postear(c, { ...datos, ivcast: 1, tipo, id })) {
      pendientes.delete(id);
      clearTimeout(timer);
      rechazar({ codigo: "sin_puente", detalle: null });
    }
  });
}

// Aviso sin id ni respuesta (latido, adios).
export function notificar(tipo, datos = {}) {
  const c = canal();
  if (c) postear(c, { ...datos, ivcast: 1, tipo });
}

export function escuchar(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

// Lo que importa del hola-ok, con tipos seguros: lo que no venga bien se lee como "no
// hay" (sin capacidades, sin sesión), nunca como un error que rompa la página.
export function normalizarHola(m) {
  const caps = Array.isArray(m && m.capacidades) ? m.capacidades.filter((c) => typeof c === "string") : [];
  const app = m && m.app && typeof m.app === "object" ? m.app : {};
  const cast = m && m.cast && typeof m.cast === "object" ? m.cast : {};
  return {
    app: { version: typeof app.version === "string" ? app.version : null, plataforma: app.plataforma === "ios" ? "ios" : app.plataforma === "android" ? "android" : null },
    capacidades: caps,
    cast: {
      receptor: typeof cast.receptor === "string" ? cast.receptor : null,
      estado: typeof cast.estado === "string" ? cast.estado : null,
      sesion: cast.sesion && typeof cast.sesion === "object" ? cast.sesion : null,
    },
  };
}

// El saludo. Resuelve { hola, motivo }: hola normalizado si la app contestó, o null con
// el motivo ('sin-puente', 'version', 'sin-respuesta'). Nunca rechaza.
// 🔴 El fallo NO queda guardado: el próximo toque vuelve a saludar (la app pudo estar
// resolviendo su módulo de Cast, o la página tardó en quedar como "la del reproductor").
// La respuesta buena sí: dentro de una carga las capacidades no cambian.
export function conectarApp() {
  if (conexion) return conexion;
  if (!canal()) return Promise.resolve({ hola: null, motivo: "sin-puente" });
  registrar();
  escucharSalida();
  anotar("puente", "saludando");
  const esta = enviar("hola", { soporta: [VERSION_PROTOCOLO], reproductor: VERSION_REPRODUCTOR }, { tope: TOPE_HOLA_MS }).then(
    (m) => {
      const h = normalizarHola(m);
      anotar("puente", `hola-ok (${h.app.plataforma || "?"}${h.app.version ? " " + h.app.version : ""}): ${h.capacidades.join(",") || "sin capacidades"}`);
      return { hola: h, motivo: null };
    },
    (e) => {
      if (conexion === esta) conexion = null;
      const motivo = e && e.codigo === "version" ? "version" : "sin-respuesta";
      anotar("puente", "sin hola-ok (" + ((e && e.codigo) || "?") + ")");
      return { hola: null, motivo };
    });
  conexion = esta;
  return esta;
}

// Latido mientras hay sesión: { visible, msid }. `msidActual()` lo da castNativo.js (el
// mediaSessionId del Media que maneja el CastPlayer de esta página, o null). Con él la
// app pausa la TV si esta página dejó de mirarla (colgada, navegó, otra lección).
export function latir(msidActual) {
  if (latido) { latido.msid = msidActual; return; }
  latido = { id: null, msid: msidActual };
  const tic = () => {
    let msid = null;
    try { msid = latido && latido.msid ? latido.msid() : null; } catch (e) {}
    let visible = true;
    try { visible = typeof document === "undefined" || document.visibilityState !== "hidden"; } catch (e) {}
    notificar("latido", { visible, msid: Number.isFinite(msid) ? msid : null });
  };
  tic();
  latido.id = setInterval(tic, LATIDO_MS);
}

export function dejarDeLatir() {
  if (latido) clearInterval(latido.id);
  latido = null;
}

// Al irse: `adios` (la pausa de la TV ya la manda CastPlayer.pausarAlSalir, que corre
// antes: su oyente se registró al montar el componente). Si la página vuelve del bfcache,
// se registra de nuevo y, si latía, vuelve a latir.
function escucharSalida() {
  if (escuchandoSalida || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  escuchandoSalida = true;
  let msidAlIrse = null;
  window.addEventListener("pagehide", () => {
    notificar("adios");
    msidAlIrse = latido ? latido.msid : null;
    dejarDeLatir();
    desregistrar();
  });
  window.addEventListener("pageshow", (e) => {
    if (!e || !e.persisted) return;
    registrar();
    if (msidAlIrse) latir(msidAlIrse);
    msidAlIrse = null;
  });
}

// Sólo para las pruebas unitarias: vuelve el módulo a cero.
export function _reiniciarParaPruebas() {
  for (const p of pendientes.values()) clearTimeout(p.timer);
  pendientes.clear();
  oyentes.clear();
  dejarDeLatir();
  desregistrar();
  conexion = null;
  instancia = null;
  cuenta = 0;
  escuchandoSalida = false;
}
