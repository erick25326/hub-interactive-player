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

export function scormSetComplete() {
  // Moodle native completion (plugin mode).
  if (window.MOODLE_CONTEXT) {
    const data = new FormData();
    data.append('cmid', window.MOODLE_CONTEXT.cmid);
    data.append('sesskey', window.MOODLE_CONTEXT.sesskey);
    fetch(window.MOODLE_CONTEXT.completeUrl, { method: 'POST', body: data })
      .catch(() => {});
  }
  // SCORM completion.
  if (!API) return;
  API.LMSSetValue("cmi.core.lesson_status", "completed");
  API.LMSCommit("");
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
  const n = interactionIndex++;
  API.LMSSetValue(`cmi.interactions.${n}.id`, id);
  API.LMSSetValue(`cmi.interactions.${n}.type`, type);
  API.LMSSetValue(`cmi.interactions.${n}.student_response`, studentResponse);
  API.LMSSetValue(`cmi.interactions.${n}.correct_responses.0.pattern`, correctResponse);
  API.LMSSetValue(`cmi.interactions.${n}.result`, result);
  API.LMSSetValue(`cmi.interactions.${n}.time`, new Date().toLocaleTimeString("en-US", { hour12: false }));
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
