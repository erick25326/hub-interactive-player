// La TARJETA DE FIN del video (pedido de Erick, 19-oct-2026): los botones "Anterior" y
// "Siguiente" del campus quedan al pie de la página, debajo de la transcripción, y al
// terminar el video nadie los veía. Ahora, adentro del reproductor y encima del video:
// "Lección completada" (o "Terminaste el video" si no se puede saber), la próxima lección,
// "Siguiente lección" y "Volver a ver". En la última lección, "Volver al curso".
// Las decisiones viven acá, puras, para probarlas sin navegador
// (tests/unit/fin-video.test.mjs): de dónde sale el destino, qué se acepta como destino y
// qué dice la tarjeta. Cuándo aparece, el foco y la navegación son del componente
// (tests/navegador/escenarios/fin.mjs).

// La barra que inyecta el tema del campus (theme_hubeducation,
// hook_callbacks::course_activity_nav_html) en la página de la lección, view.php: la
// página de ARRIBA del reproductor, del mismo origen. Su botón de la derecha:
//   <a class="hub-lnav-btn next [end]" href="…">
//     <span class="hub-lnav-dir">Siguiente lección →</span>
//     <span class="hub-lnav-name">Nombre de la próxima</span></a>
// `end` y el nombre "Volver al curso": no hay próxima, el enlace va al curso. Con la
// finalización MANUAL sin marcar, el enlace es a togglecompletion.php ("Marcar
// completada y continuar") con el destino en `backto`: se usa tal cual (marca y sigue).
export const SELECTOR_SIGUIENTE = ".hub-lnav .hub-lnav-btn.next";

const limpio = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

/**
 * Lee el botón "Siguiente" de la barra del tema en la página de arriba. null si no hay
 * barra (el reproductor fuera del campus, el configurador, la demo de la web) o si la de
 * arriba es de otro origen (leer su `document` tira SecurityError: una demo en otro
 * sitio, un SCORM). No valida nada: eso es destinoDeFin.
 * @returns {{ href: string, nombre: string, fin: boolean, base: string } | null}
 */
export function leerBarraDelTema(ventana) {
  try {
    const arriba = ventana && ventana.top;
    const doc = arriba && arriba.document;
    const a = doc && typeof doc.querySelector === "function" ? doc.querySelector(SELECTOR_SIGUIENTE) : null;
    if (!a) return null;
    const n = typeof a.querySelector === "function" ? a.querySelector(".hub-lnav-name") : null;
    return {
      href: a.getAttribute ? a.getAttribute("href") : null,
      nombre: n ? n.textContent : "",
      fin: !!(a.classList && a.classList.contains("end")),
      base: String(arriba.location.href),
    };
  } catch (e) {
    return null;
  }
}

/**
 * A dónde lleva el botón principal, o null si no hay a dónde ir (sólo "Volver a ver").
 * 🔴 Sólo un enlace http(s) del MISMO origen que la página de arriba: se navega con
 * `window.top.location`, y un `javascript:` o un enlace a otro sitio en esa barra no es
 * algo que el reproductor tenga que seguir. Tampoco un enlace vacío o sólo `#…` (sería
 * recargar la misma lección).
 * `ultima`: no hay próxima lección (el tema marca `end`, o el destino final, el de
 * `backto` en togglecompletion.php, es la página del curso): el botón dice "Volver al
 * curso" y no hay "Siguiente: …".
 * @returns {{ url: string, nombre: string, ultima: boolean } | null}
 */
export function destinoDeFin(barra) {
  if (!barra || typeof barra.href !== "string") return null;
  const href = barra.href.trim();
  if (!href || href.startsWith("#")) return null;
  let base, url;
  try { base = new URL(barra.base); url = new URL(href, base); } catch (e) { return null; }
  if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin) return null;
  // "Marcar completada y continuar": marca y redirige a `backto`, que es lo que decide si
  // es la última (va al curso) o no.
  let final = url;
  if (/\/course\/togglecompletion\.php$/.test(url.pathname)) {
    const b = url.searchParams.get("backto");
    try { if (b) final = new URL(b, base); } catch (e) { final = url; }
  }
  const ultima = !!barra.fin || /\/course\/view\.php$/.test(final.pathname);
  return { url: url.href, nombre: ultima ? "" : limpio(barra.nombre), ultima };
}

/**
 * ¿Se puede decir "Lección completada"? Sólo si alguien la registra (Moodle, con
 * complete.php, o un LMS por SCORM) y, o ya estaba completada (MOODLE_CONTEXT
 * .alreadyCompleted), o se respondió todo lo que no es una etiqueta: es lo mismo que
 * hace que el reproductor mande complete.php al terminar. Si no (la demo de la web, el
 * configurador, una pendiente sin responder), "Terminaste el video".
 * La tarjeta no cambia CUÁNDO se completa: sólo lo dice.
 */
export function leccionCompletada({ interactions, completed, registra, yaCompletada }) {
  if (!registra) return false;
  if (yaCompletada) return true;
  const hechas = completed instanceof Set ? completed : new Set(completed || []);
  return (interactions || []).every((ia) => !ia || ia.type === "label" || hechas.has(ia.id));
}

/**
 * Los textos de la tarjeta. `principal` null: sin destino, el único botón es "Volver a
 * ver". `siguiente`: el nombre de la próxima lección (null en la última o sin nombre).
 */
export function textosDeFin({ completada, destino }) {
  return {
    titulo: completada ? "Lección completada" : "Terminaste el video",
    siguiente: destino && !destino.ultima && destino.nombre ? destino.nombre : null,
    principal: destino ? (destino.ultima ? "Volver al curso" : "Siguiente lección") : null,
  };
}
