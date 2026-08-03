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
   `fetch(...).catch(()=>{})`: se tragaban el error, no miraban `res.ok` y no
   reintentaban. Si el POST se caía, ese progreso NO EXISTIÓ NUNCA. El caso real
   de esta app no es el escritorio con fibra: es un piloto mirando la lección en
   el campo con dos rayitas. Miraba 18 minutos, se le caían los POST, cerraba, y
   al volver el player lo plantaba en el minuto del último save que llegó.

   Ahora todo pasa por una cola persistida en localStorage que sobrevive al
   cierre de la app y se vacía sola: al cargar, al volver la conexión y después
   de cada envío nuevo.

   Dos comportamientos distintos según el dato, y la diferencia importa:
   - PROGRESO: sólo vale el ÚLTIMO. Se guarda UNA entrada que se pisa a sí
     misma. Así la cola no puede escribir una posición vieja encima de una
     nueva, y de paso no crece sin límite.
   - FINALIZACIÓN y RESPUESTAS: cada una es un hecho propio y no se puede
     perder ninguna (van al libro de calificaciones), así que se acumulan.
   ───────────────────────────────────────────────────────────────────────── */

const COLA_KEY = 'iv_cola_moodle_v1';
const MAX_EVENTOS = 200; // techo de seguridad: si algo va muy mal, no llenamos el disco
const ESPERAS_MS = [2_000, 5_000, 15_000, 60_000];

function leerCola() {
  try {
    const c = JSON.parse(localStorage.getItem(COLA_KEY));
    if (!c || typeof c !== 'object') return { progreso: null, eventos: [] };
    return { progreso: c.progreso ?? null, eventos: Array.isArray(c.eventos) ? c.eventos : [] };
  } catch {
    return { progreso: null, eventos: [] };
  }
}

function escribirCola(c) {
  try {
    localStorage.setItem(COLA_KEY, JSON.stringify(c));
  } catch {
    // Sin localStorage (modo privado, cuota llena) se sigue andando: se pierde
    // la garantía entre sesiones, pero los reintentos en memoria siguen vivos.
  }
}

async function postear({ url, campos }) {
  const data = new FormData();
  for (const [k, v] of Object.entries(campos)) data.append(k, v);
  const res = await fetch(url, { method: 'POST', body: data });
  // `res.ok` es la mitad que faltaba: un 403 por sesión vencida devolvía una
  // promesa RESUELTA, así que el `.catch` no se enteraba y el dato se perdía
  // igual que si no hubiera red.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return true;
}

let vaciando = false;

/** Intenta vaciar la cola. Nunca lanza; si algo falla, queda para la próxima. */
async function vaciarCola(intento = 0) {
  if (vaciando) return;
  vaciando = true;
  // Si se programa un reintento, el candado NO se suelta acá: lo suelta el
  // timer. Si no, `finally` lo suelta siempre, incluso ante una excepción.
  let reprogramado = false;
  try {
    const cola = leerCola();
    if (!cola.progreso && !cola.eventos.length) return;

    let huboFalla = false;

    if (cola.progreso) {
      try {
        await postear(cola.progreso);
        // Releer antes de borrar: mientras viajaba el POST, el player pudo
        // haber guardado una posición más nueva y no queremos tirarla.
        const ahora = leerCola();
        if (ahora.progreso && ahora.progreso.guardadoEn === cola.progreso.guardadoEn) {
          ahora.progreso = null;
          escribirCola(ahora);
        }
      } catch {
        huboFalla = true;
      }
    }

    for (const ev of [...cola.eventos]) {
      try {
        await postear(ev);
        const ahora = leerCola();
        ahora.eventos = ahora.eventos.filter((e) => e.id !== ev.id);
        escribirCola(ahora);
      } catch {
        huboFalla = true;
        break; // sin red, no tiene sentido seguir intentando el resto
      }
    }

    if (huboFalla && intento < ESPERAS_MS.length) {
      reprogramado = true;
      setTimeout(() => {
        vaciando = false;
        vaciarCola(intento + 1);
      }, ESPERAS_MS[intento]);
    }
  } finally {
    if (!reprogramado) vaciando = false;
  }
}

function encolarProgreso(envio) {
  const cola = leerCola();
  cola.progreso = envio;
  escribirCola(cola);
  vaciarCola();
}

function encolarEvento(envio) {
  const cola = leerCola();
  cola.eventos = [...cola.eventos, envio].slice(-MAX_EVENTOS);
  escribirCola(cola);
  vaciarCola();
}

if (typeof window !== 'undefined') {
  // Al volver la conexión, mandar lo pendiente sin esperar a que el alumno haga
  // nada. Es EL momento en que esto vale: bajó del campo, agarró señal.
  window.addEventListener('online', () => vaciarCola());
  // Y al arrancar, por lo que haya quedado de la sesión anterior.
  setTimeout(() => vaciarCola(), 1_500);
}

export function scormSetComplete() {
  // Moodle native completion (plugin mode).
  const ctx = window.MOODLE_CONTEXT;
  if (ctx && ctx.completeUrl) {
    encolarEvento({
      id: `fin-${ctx.cmid}-${Date.now()}`,
      url: ctx.completeUrl,
      campos: { cmid: ctx.cmid, sesskey: ctx.sesskey },
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
  const campos = { cmid: ctx.cmid, sesskey: ctx.sesskey, data: JSON.stringify(progress) };

  if (useBeacon && navigator.sendBeacon) {
    const data = new FormData();
    for (const [k, v] of Object.entries(campos)) data.append(k, v);
    // sendBeacon devuelve false si el navegador NI SIQUIERA pudo encolarlo
    // (típico: excede la cuota). En ese caso cae a la cola nuestra.
    if (navigator.sendBeacon(ctx.progressUrl, data)) return;
  }
  encolarProgreso({ url: ctx.progressUrl, campos, guardadoEn: Date.now() });
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
    campos: {
      cmid: ctx.cmid,
      sesskey: ctx.sesskey,
      interactionid: interactionId,
      answer: String(answer),
    },
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
