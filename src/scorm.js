/**
 * SCORM 1.2 API Wrapper
 * If no SCORM API is found (standalone mode), all functions are silent no-ops.
 */

let API = null;

function scanParents(win) {
  let attempts = 0;
  while (win && attempts < 10) {
    try { if (win.API) return win.API; } catch(e) {}
    if (win === win.parent) break;
    win = win.parent;
    attempts++;
  }
  return null;
}

function findAPI() {
  // 1. Search current window and parent chain
  let api = scanParents(window);
  if (api) return api;
  // 2. Search opener window and its parent chain (popup windows — SCORM Cloud)
  try {
    if (window.opener) {
      api = scanParents(window.opener);
      if (api) return api;
    }
  } catch(e) {}
  return null;
}

export function scormInit() {
  API = findAPI();
  if (!API) return false;
  const result = API.LMSInitialize("");
  if (result === "true" || result === true) {
    // Restore previous status if resuming
    const status = API.LMSGetValue("cmi.core.lesson_status");
    if (status === "not attempted" || status === "") {
      API.LMSSetValue("cmi.core.lesson_status", "incomplete");
      API.LMSCommit("");
    }
    return true;
  }
  API = null;
  return false;
}

/* ─────────────────────────────────────────────────────────────────────────
   COLA DE ENVÍOS A MOODLE

   Antes los tres POST (finalización, progreso y respuestas) eran
   `fetch(...).catch(()=>{})`: se tragaban el error y no reintentaban. Si el POST
   se caía, ese progreso NO EXISTIÓ NUNCA. El caso real de esta app no es el
   escritorio con fibra: es un piloto mirando la lección en el campo con dos
   rayitas. Miraba 18 minutos, se le caían los POST, cerraba, y al volver el
   player lo plantaba en el minuto del último save que había llegado.

   Cinco cosas que hay que tener presentes para no romper esto:

   1. LA FUENTE DE VERDAD ES LA MEMORIA, no localStorage. Si el disco no está
      disponible (modo privado, cuota llena, DOM storage apagado en el WebView)
      se pierde la persistencia ENTRE sesiones, pero los reintentos de esta
      sesión siguen andando. Al revés —tomando el disco como fuente— un disco
      caído dejaba la cola vacía y el POST no se emitía nunca: peor que el
      `fetch` suelto que había antes.

   2. EL `sesskey` NO SE GUARDA. Se estampa en el momento del envío, desde
      `window.MOODLE_CONTEXT`. Uno guardado ayer ya no vale, y era la forma más
      segura de que la entrega diferida —la razón de ser de esta cola— fallara
      siempre.

   3. `res.ok` NO ALCANZA. Los tres endpoints contestan `{success:false}` con
      HTTP 200 (ver progress.php:25, answer.php:30). Hay que mirar el cuerpo, o
      la cola borra el dato creyendo que lo entregó.

   4. FALLA DE RED ≠ RECHAZO DEL SERVIDOR. Si no hay red, no tiene sentido
      seguir con el resto: se corta y se reintenta después. Si el servidor
      contestó y rechazó, ese ítem probablemente esté podrido: se cuenta el
      intento, se sigue con los demás y se descarta a los 8 intentos. Si no, un
      solo ítem podrido bloquea la cola entera para siempre.

   5. EL PROGRESO VA POR LECCIÓN. Sólo vale el último de CADA lección, así que
      es un mapa por `cmid`, no un único casillero. Con un solo casillero, abrir
      la lección B borraba el progreso pendiente de la A.

   La escalera de reintentos NO se rinde mientras haya algo pendiente: se
   estanca en 60 s. Un piloto puede estar 40 minutos sin señal.
   ───────────────────────────────────────────────────────────────────────── */

const COLA_KEY = 'iv_cola_moodle_v1';
const MAX_EVENTOS = 500;
const MAX_INTENTOS = 8;
const ESPERAS_MS = [2_000, 5_000, 15_000, 60_000];
const TIMEOUT_MS = 15_000;

const COLA_VACIA = { progreso: {}, eventos: [] };

function leerDelDisco() {
  try {
    const c = JSON.parse(localStorage.getItem(COLA_KEY));
    if (!c || typeof c !== 'object') return { ...COLA_VACIA };
    return {
      progreso: c.progreso && typeof c.progreso === 'object' ? c.progreso : {},
      eventos: Array.isArray(c.eventos) ? c.eventos : [],
    };
  } catch {
    return { ...COLA_VACIA };
  }
}

/** Fuente de verdad. El disco es sólo su espejo. */
let cola = typeof window !== 'undefined' ? leerDelDisco() : { ...COLA_VACIA };

function persistir() {
  try {
    localStorage.setItem(COLA_KEY, JSON.stringify(cola));
  } catch {
    // Sin disco se sigue andando: se pierde la persistencia entre sesiones,
    // no los reintentos de ésta.
  }
}

class FallaDeRed extends Error {}

/**
 * Manda un envío. Devuelve true si el servidor lo aceptó, false si lo rechazó
 * explícitamente. Lanza `FallaDeRed` si no se pudo hablar con el servidor.
 */
async function postear({ url, campos }) {
  const ctx = typeof window !== 'undefined' ? window.MOODLE_CONTEXT : null;
  const data = new FormData();
  for (const [k, v] of Object.entries(campos)) data.append(k, v);
  // El sesskey se estampa AHORA, nunca se guarda: ver punto 2 de arriba.
  if (ctx && ctx.sesskey) data.append('sesskey', ctx.sesskey);

  // AbortController a mano y no `AbortSignal.timeout`, que no existe en los
  // WebView de Android viejos donde justamente corre esto.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: data, signal: ac.signal });
  } catch {
    throw new FallaDeRed('sin respuesta');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new FallaDeRed(`HTTP ${res.status}`);

  // Un 200 con HTML (por ejemplo la página de error de sesión de Moodle) no es
  // una entrega: se trata como falla de red para que se reintente.
  let cuerpo;
  try {
    cuerpo = await res.json();
  } catch {
    throw new FallaDeRed('respuesta ilegible');
  }
  return !!(cuerpo && cuerpo.success === true);
}

let vaciando = false;
let timerReintento = null;

function programar(ms, intento) {
  clearTimeout(timerReintento);
  timerReintento = setTimeout(() => {
    timerReintento = null;
    vaciando = false;
    vaciarCola(intento);
  }, ms);
}

function hayPendientes() {
  return Object.keys(cola.progreso).length > 0 || cola.eventos.length > 0;
}

/** Intenta vaciar la cola. Nunca lanza. */
async function vaciarCola(intento = 0) {
  if (vaciando) return;
  vaciando = true;
  // Si se programa un reintento, el candado lo suelta el timer; si no, el
  // `finally`, incluso ante una excepción inesperada.
  let reprogramado = false;
  try {
    if (!hayPendientes()) return;
    let sinRed = false;
    // Foto de lo que había AL EMPEZAR. Sirve para distinguir, al terminar, lo
    // que entró nuevo durante el vaciado de lo que quedó porque el servidor lo
    // rechazó. Sin esta distinción, un ítem rechazado dispara un re-vaciado
    // inmediato, que lo vuelve a rechazar, y se queman los 8 intentos en
    // milisegundos en vez de espaciarlos.
    const alEmpezar = new Set([
      ...Object.keys(cola.progreso).map((k) => 'p:' + k),
      ...cola.eventos.map((e) => 'e:' + e.id),
    ]);

    for (const cmid of Object.keys(cola.progreso)) {
      const envio = cola.progreso[cmid];
      if (!envio) continue;
      try {
        const aceptado = await postear(envio);
        // Releer antes de borrar: mientras viajaba el POST, el alumno pudo
        // haber avanzado y no queremos tirar la posición más nueva.
        const actual = cola.progreso[cmid];
        if (actual && actual.guardadoEn === envio.guardadoEn) {
          if (aceptado || (envio.intentos ?? 0) + 1 >= MAX_INTENTOS) {
            delete cola.progreso[cmid];
          } else {
            envio.intentos = (envio.intentos ?? 0) + 1;
          }
          persistir();
        }
      } catch (e) {
        if (e instanceof FallaDeRed) { sinRed = true; break; }
      }
    }

    if (!sinRed) {
      for (const ev of [...cola.eventos]) {
        try {
          const aceptado = await postear(ev);
          if (aceptado || (ev.intentos ?? 0) + 1 >= MAX_INTENTOS) {
            cola.eventos = cola.eventos.filter((e) => e.id !== ev.id);
          } else {
            ev.intentos = (ev.intentos ?? 0) + 1;
          }
          persistir();
        } catch (e) {
          if (e instanceof FallaDeRed) { sinRed = true; break; }
        }
      }
    }

    const hayNuevos =
      Object.keys(cola.progreso).some((k) => !alEmpezar.has('p:' + k)) ||
      cola.eventos.some((e) => !alEmpezar.has('e:' + e.id));

    if (sinRed) {
      // No se rinde: la escalera se estanca en el último escalón.
      reprogramado = true;
      programar(ESPERAS_MS[Math.min(intento, ESPERAS_MS.length - 1)], intento + 1);
    } else if (hayNuevos) {
      // Entró algo NUEVO mientras vaciábamos (el alumno terminó el video
      // mientras viajaba la respuesta anterior). Sin esto quedaba huérfano: no
      // estaba en la foto del bucle y nadie lo reprogramaba.
      reprogramado = true;
      programar(0, 0);
    } else if (hayPendientes()) {
      // Sólo quedan ítems que el servidor RECHAZÓ. Se reintentan espaciados,
      // nunca en bucle cerrado.
      reprogramado = true;
      programar(ESPERAS_MS[Math.min(intento, ESPERAS_MS.length - 1)], intento + 1);
    }
  } finally {
    if (!reprogramado) vaciando = false;
  }
}

function despachar() {
  // Si ya hay un reintento en camino, dejarlo: reprogramar en cada guardado
  // (uno cada 5 s) reiniciaría la escalera y martillaría la red.
  if (timerReintento === null) vaciarCola(0);
}

function encolarProgreso(cmid, envio) {
  cola.progreso[String(cmid)] = envio;
  persistir();
  despachar();
}

function encolarEvento(envio) {
  cola.eventos = [...cola.eventos, envio].slice(-MAX_EVENTOS);
  persistir();
  despachar();
}

if (typeof window !== 'undefined') {
  // Al volver la conexión, mandar lo pendiente YA: es EL momento en que esto
  // vale (bajó del campo, agarró señal). Se cancela el reintento en curso y se
  // reinicia la escalera, porque la espera larga ya no tiene sentido.
  window.addEventListener('online', () => {
    clearTimeout(timerReintento);
    timerReintento = null;
    vaciando = false;
    vaciarCola(0);
  });
  // Y al arrancar, por lo que haya quedado de la sesión anterior.
  setTimeout(() => despachar(), 1_500);
}

export function scormSetComplete() {
  // Moodle native completion (plugin mode).
  const ctx = window.MOODLE_CONTEXT;
  if (ctx && ctx.completeUrl) {
    encolarEvento({
      id: `fin-${ctx.cmid}-${Date.now()}`,
      url: ctx.completeUrl,
      campos: { cmid: ctx.cmid },
    });
  }
  // SCORM completion.
  if (!API) return;
  API.LMSSetValue("cmi.core.lesson_status", "completed");
  API.LMSCommit("");
}

/**
 * Save per-user progress to Moodle (plugin mode). No-op outside Moodle.
 * @param {{completed: string[], currentTime: number}} progress
 * @param {boolean} useBeacon - use sendBeacon (page is unloading)
 */
export function moodleSaveProgress(progress, useBeacon = false) {
  const ctx = window.MOODLE_CONTEXT;
  if (!ctx || !ctx.progressUrl) return;
  const campos = { cmid: ctx.cmid, data: JSON.stringify(progress) };

  // Se encola SIEMPRE, también en el camino del beacon: `sendBeacon` devolviendo
  // true sólo dice que el navegador lo aceptó para mandarlo, no que haya
  // llegado. Si llegó, el reenvío escribe el mismo valor y no molesta a nadie.
  encolarProgreso(ctx.cmid, { url: ctx.progressUrl, campos, guardadoEn: Date.now() });

  if (useBeacon && navigator.sendBeacon) {
    const data = new FormData();
    for (const [k, v] of Object.entries(campos)) data.append(k, v);
    if (ctx.sesskey) data.append('sesskey', ctx.sesskey);
    navigator.sendBeacon(ctx.progressUrl, data);
  }
}

/**
 * Report a quiz answer to Moodle for grading (plugin mode).
 * Correctness is verified server-side. No-op outside Moodle.
 */
export function moodleReportAnswer(interactionId, answer) {
  const ctx = window.MOODLE_CONTEXT;
  if (!ctx || !ctx.answerUrl) return;
  encolarEvento({
    id: `resp-${ctx.cmid}-${interactionId}-${Date.now()}`,
    url: ctx.answerUrl,
    campos: { cmid: ctx.cmid, interactionid: interactionId, answer: String(answer) },
  });
}

/**
 * Returns the saved progress injected by Moodle, or null.
 */
export function moodleGetSavedProgress() {
  const ctx = window.MOODLE_CONTEXT;
  return (ctx && ctx.savedProgress) || null;
}

export function scormSetIncomplete() {
  if (!API) return;
  API.LMSSetValue("cmi.core.lesson_status", "incomplete");
  API.LMSCommit("");
}

export function scormSetTime(seconds) {
  if (!API) return;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const time = `${String(h).padStart(4, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  API.LMSSetValue("cmi.core.session_time", time);
  API.LMSCommit("");
}

let interactionIndex = 0;

/**
 * Report an individual interaction result to SCORM.
 * @param {string} id - Interaction ID (e.g. "mc-1")
 * @param {string} type - SCORM type: "choice", "true-false", "performance"
 * @param {string} studentResponse - What the student answered
 * @param {string} correctResponse - The correct answer
 * @param {string} result - "correct", "wrong", or "neutral"
 */
export function scormReportInteraction(id, type, studentResponse, correctResponse, result) {
  if (!API) return;
  // SCORM 1.2: para type "true-false", student_response y el pattern deben ser
  // UN carácter (t|f|0|1). Mandar "true"/"false" da error 405 en LMS estrictos
  // (SCORM Cloud lo rechaza; el de Moodle es laxo y por eso "funcionaba").
  // OJO: esto es solo para SCORM — answer.php espera 'true'/'false' y no cambia.
  if (type === "true-false") {
    const tf = (v) => {
      const s = String(v).toLowerCase();
      return s === "true" ? "t" : s === "false" ? "f" : s;
    };
    studentResponse = tf(studentResponse);
    correctResponse = tf(correctResponse);
  }
  const n = interactionIndex++;
  API.LMSSetValue(`cmi.interactions.${n}.id`, id);
  API.LMSSetValue(`cmi.interactions.${n}.type`, type);
  API.LMSSetValue(`cmi.interactions.${n}.student_response`, studentResponse);
  API.LMSSetValue(`cmi.interactions.${n}.correct_responses.0.pattern`, correctResponse);
  API.LMSSetValue(`cmi.interactions.${n}.result`, result);
  // Formato manual HH:MM:SS — toLocaleTimeString('en-US',{hour12:false}) puede
  // producir "24:00:00" a medianoche (CMITime inválido).
  const d = new Date();
  const hhmmss = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  API.LMSSetValue(`cmi.interactions.${n}.time`, hhmmss);
  API.LMSCommit("");
}

export function scormFinish() {
  if (!API) return;
  API.LMSCommit("");
  API.LMSFinish("");
  API = null;
}

export function isScormAvailable() {
  return API !== null;
}
