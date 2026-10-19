import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useId, Fragment } from "react";
import Player from "@vimeo/player";
import NativePlayer from "./nativePlayer.js";
import { Renovador, recargarParaReintentar } from "./firma.js";
// La red de seguridad (Vimeo si el CDN de Bunny falla): la decisión es pura y vive aparte.
import { decidirRespaldo, datosDelError, pedirRespaldo, urlDeRespaldo, yaEsRespaldo, GUARDAR_AVANCE_MS } from "./respaldo.js";
import { cuandoHayaTV, cargarCast, contextoCast, observarCast, nombreDelEquipo, mismoVideo, CastPlayer, castPosible, infoApp, pareceApp } from "./cast.js";
import { scormInit, scormSetComplete, scormSetTime, scormFinish, scormReportInteraction, moodleSaveProgress, moodleGuardarAvanceYa, moodleGetSavedProgress, moodleReportAnswer, isScormAvailable } from "./scorm.js";
// El candado de preguntas y el parser de subtítulos son puros y viven aparte para
// poder probarlos sin navegador (tests/unit). Acá sólo se llaman.
import { debeFrenar, tiempoAGuardar, esTickPropio, pendienteARetomar } from "./candado.js";
import { parseVTT } from "./subtitulos.js";
// La config por defecto (sin video) y la de window.PLAYER_CONFIG: ver configuracion.js.
import { getConfig, hayVideo } from "./configuracion.js";
// Los avisos de las interacciones que frenan (tic-tac de 3 s, cuenta regresiva, "plop"
// y vibración) y el glosario interactivo de las etiquetas: las decisiones son puras y
// viven aparte (tests/unit/avisos.test.mjs, glosario.test.mjs). Los sonidos, Web Audio.
import { ticsEntre, olvidarTics, cuentaRegresiva, textoCuenta, queSeViene, comoAvisar, VIBRA_TIC, VIBRA_FRENO, CLAVE_SONIDO, CLAVE_VIBRACION, leerPreferencia, guardarPreferencia } from "./avisos.js";
import { terminosNuevos, entradas as entradasDelGlosario, hayGlosario, totalPosible, cobertura, pausarAlAbrir, pasoATapar, reanudarAlCerrar, RECIEN_MS, AVISO_MS } from "./glosario.js";
import { crearSonidos, vibracionPosible } from "./sonidos.js";
// La tarjeta de fin del video (la próxima lección del campus y "Volver a ver"): lo puro.
import { leerBarraDelTema, destinoDeFin, leccionCompletada, textosDeFin } from "./finVideo.js";

// parseVTT y textoDeCue (subtítulos VTT/SRT) viven en subtitulos.js.

// Icons
const PlayIcon = () => <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
const PauseIcon = () => <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;
const FullscreenIcon = () => <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>;
const ExitFullscreenIcon = () => <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>;
const VolumeIcon = ({ muted }) => muted
  ? <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
  : <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>;
const SkipBackIcon = () => <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fontFamily="sans-serif">10</text></svg>;
const SkipFwdIcon = () => <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/><text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fontFamily="sans-serif">10</text></svg>;
const SubsIcon = ({ on }) => <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" opacity={on?1:0.4}><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6v-2zm0 4h8v2H6v-2zm10 0h2v2h-2v-2zm-6-4h8v2h-8v-2z"/></svg>;
const RotateIcon = () => <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5C23.44 4.84 18.29 0 12 0l-.66.03 3.81 3.81 1.33-1.32zm-6.25-.77a1.49 1.49 0 0 0-2.12 0L1.75 8.11a1.49 1.49 0 0 0 0 2.12l12.02 12.02c.59.59 1.54.59 2.12 0l6.36-6.36c.59-.59.59-1.54 0-2.12L10.23 1.75zm4.6 19.44L2.81 9.17l6.36-6.36 12.02 12.02-6.36 6.36zm-7.31.29C4.25 19.94 1.91 16.76 1.55 13H.05C.56 19.16 5.71 24 12 24l.66-.03-3.81-3.81-1.33 1.32z"/></svg>;
const CheckIcon = () => <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>;
const CrossIcon = () => <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>;
const InfoIcon = () => <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>;

// Engranaje de Ajustes (velocidad y calidad, como YouTube): reemplaza al botón "1x".
const GearIcon = () => <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>;
const CloseIcon = () => <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>;
// Volver a ver (tarjeta de fin).
const ReplayIcon = () => <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>;
// Transmitir a la TV: el mismo ícono para Chromecast y AirPlay (un solo botón).
const CastIcon = () => <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z"/></svg>;
const CastOnIcon = () => <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm18-7H5v1.63c3.96 1.28 7.09 4.41 8.37 8.37H19V7zM1 10v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg>;
// Glosario: un libro abierto.
const GlosarioIcon = () => <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/></svg>;

// El localStorage puede tirar al leerlo (modo privado, datos bloqueados): las
// preferencias del alumno lo piden por acá y, sin él, valen "sí".
const almacenLocal = () => { try { return window.localStorage; } catch (e) { return null; } };

const fmt = (s) => { const m=Math.floor(s/60); return `${m}:${Math.floor(s%60).toString().padStart(2,"0")}`; };
// El tiempo dicho en palabras, para el lector de pantalla ("1 minuto, 23 segundos"):
// "1:23" se lee "uno dos tres" o "una y veintitrés".
const hablado = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, p = [];
  if (h) p.push(`${h} ${h === 1 ? "hora" : "horas"}`);
  if (m) p.push(`${m} ${m === 1 ? "minuto" : "minutos"}`);
  if (x || !p.length) p.push(`${x} ${x === 1 ? "segundo" : "segundos"}`);
  return p.join(", ");
};
// Texto plano de una interacción para avisarla sin mover el foco (sin el markdown).
const textoAviso = (ia) => {
  const d = ia?.data || {};
  const limpio = (t) => String(t || "").replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
  if (ia?.type === "note") return `Nota: ${limpio(d.title || d.text)}`;
  if (ia?.type === "multiple-choice") return `Pregunta: ${limpio(d.question)}`;
  if (ia?.type === "true-false") return `Verdadero o falso: ${limpio(d.statement)}`;
  if (ia?.type === "hotspot") return "Tocá los puntos del video para seguir";
  return "";
};
const etiquetaVelocidad = (s) => (s === 1 ? "Normal" : `${s}x`);

/* ─── TEXTO CON FORMATO ─────────────────────────────────────────
 * Las etiquetas, notas y explicaciones se escriben a mano en el JSON de
 * configuración, y ahí hacía falta poder resaltar una palabra y separar
 * párrafos. Antes todo salía como texto plano: los \n se los comía el HTML.
 *
 * Se soporta un subconjunto mínimo de markdown, el que se usa de verdad
 * escribiendo una definición:
 *
 *     **negrita**            _cursiva_   o   *cursiva*
 *     una línea en blanco  → párrafo nuevo
 *     un salto simple      → salto de línea
 *
 * Se parsea a elementos de React a propósito, en vez de inyectar HTML con
 * dangerouslySetInnerHTML. El reproductor se incrusta en el campus y el texto
 * sale de un JSON que edita el configurador: no conviene abrir esa puerta a
 * cambio de un par de negritas. Como efecto secundario, un `<` suelto en una
 * definición se ve como `<` en vez de romper el render.
 */
/* El guion bajo SOLO abre y cierra cursiva en borde de palabra. Sin esa regla,
 * "hub_student_identity" se renderizaba como hub<em>student</em>identity — y en
 * estos cursos las definiciones nombran metas y funciones todo el tiempo
 * (hub_student_fullname, hub_is_gift, hub_course_map). Es la misma regla que usa
 * markdown de verdad; el asterisco sí permite cursiva dentro de una palabra.
 *
 * El borde de la izquierda se captura como grupo en vez de usar lookbehind: los
 * lookbehind recién andan en Safari 16.4, y esto se ve en iPads del aula.
 *
 * Grupos: 1 = negrita · 2 = cursiva con * · 3 = caracter previo · 4 = cursiva con _
 */
const RE_INLINE = /\*\*([^*]+?)\*\*|\*([^*\n]+?)\*|(^|[^A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/g;

function conFormato(linea, base) {
  const partes = [];
  let ultimo = 0, m, n = 0;
  RE_INLINE.lastIndex = 0;
  while ((m = RE_INLINE.exec(linea)) !== null) {
    if (m.index > ultimo) partes.push(linea.slice(ultimo, m.index));
    if (m[1] !== undefined) {
      partes.push(<strong key={`${base}b${n++}`}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      partes.push(<em key={`${base}i${n++}`}>{m[2]}</em>);
    } else {
      // m[3] es el caracter que habilitó el borde de palabra: no es parte de la
      // cursiva, así que vuelve al texto tal cual.
      if (m[3]) partes.push(m[3]);
      partes.push(<em key={`${base}i${n++}`}>{m[4]}</em>);
    }
    ultimo = m.index + m[0].length;
  }
  if (ultimo < linea.length) partes.push(linea.slice(ultimo));
  return partes;
}

export function RichText({ children, className = "", id }) {
  const texto = typeof children === "string" ? children : "";
  if (!texto.trim()) return null;
  // Una o más líneas en blanco separan párrafos; un solo salto es <br>.
  const parrafos = texto.trim().split(/\n[ \t]*\n+/);
  return (
    <div id={id} className={`iv-rich ${className}`.trim()}>
      {parrafos.map((parrafo, p) => {
        const lineas = parrafo.split("\n");
        return (
          <p key={p}>
            {lineas.map((linea, l) => (
              <Fragment key={l}>
                {conFormato(linea, `${p}-${l}-`)}
                {l < lineas.length - 1 && <br />}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// Interaction overlays
// Accesibilidad de las tarjetas: son role="dialog" con tabIndex -1 para que el
// componente les pueda llevar el foco al aparecer (ver el efecto de activeIA). La
// corrección ("Correcto / Incorrecto") vive en una región role="status" que existe
// desde el principio: si la región aparece junto con el texto, el lector de
// pantalla muchas veces no lo anuncia.
const Siguiente = () => <>Continuar<span aria-hidden="true"> ▸</span></>;
const Correccion = ({ ok }) => <strong>{ok
  ? <><span aria-hidden="true">✓ </span>¡Correcto!</>
  : <><span aria-hidden="true">✗ </span>Incorrecto</>}</strong>;

function NoteOverlay({ data, onDismiss }) {
  const idTitulo = useId();
  return (
    <div className="iv-overlay-backdrop">
      <div className="iv-card iv-note-card" role="dialog" aria-labelledby={idTitulo} tabIndex={-1}>
        <div className="iv-note-header"><InfoIcon /><span id={idTitulo} className="iv-note-title">{data.title}</span></div>
        {data.image && <img className="iv-interaction-image" src={data.image} alt="" />}
        <RichText className="iv-note-text">{data.text}</RichText>
        <button className="iv-btn-primary" onClick={onDismiss}><Siguiente/></button>
      </div>
    </div>
  );
}

function MCOverlay({ data, onDismiss }) {
  const [sel, setSel] = useState(null);
  const [done, setDone] = useState(false);
  const idPregunta = useId();
  const ok = sel === data.correctId;
  return (
    <div className="iv-overlay-backdrop">
      <div className="iv-card iv-quiz-card" role="dialog" aria-labelledby={idPregunta} tabIndex={-1}>
        <div className="iv-badge">PREGUNTA</div>
        {data.image && <img className="iv-interaction-image" src={data.image} alt="" />}
        <RichText id={idPregunta} className="iv-question">{data.question}</RichText>
        <div className="iv-options">
          {data.options.map(o => {
            let c="iv-option";
            if(done){if(o.id===data.correctId)c+=" correct";else if(o.id===sel)c+=" wrong";else c+=" disabled";}
            else if(o.id===sel)c+=" selected";
            return <button key={o.id} className={c} onClick={()=>!done&&setSel(o.id)} disabled={done} aria-pressed={o.id===sel}>
              <span className="iv-option-id">{o.id.toUpperCase()}</span>
              <span className="iv-option-text">{o.text}</span>
              {done&&o.id===data.correctId&&<span className="iv-option-icon correct"><CheckIcon/></span>}
              {done&&o.id===sel&&o.id!==data.correctId&&<span className="iv-option-icon wrong"><CrossIcon/></span>}
            </button>;
          })}
        </div>
        <div role="status">
          {done&&<div className={`iv-explanation ${ok?"correct":"wrong"}`}><Correccion ok={ok}/><RichText>{data.explanation}</RichText></div>}
        </div>
        {!done
          ? <button className="iv-btn-primary" style={{opacity:sel?1:0.4}} onClick={()=>sel&&setDone(true)} disabled={!sel}>Confirmar respuesta</button>
          : <button className="iv-btn-primary" onClick={()=>onDismiss({answer:sel,correct:ok})}><Siguiente/></button>}
      </div>
    </div>
  );
}

function TFOverlay({ data, onDismiss }) {
  const [ans, setAns] = useState(null);
  const [done, setDone] = useState(false);
  const idTipo = useId(), idEnunciado = useId();
  const ok = ans === data.correct;
  const bc = v => { let c="iv-tf-btn"; if(done){if(v===data.correct)c+=" correct";else if(v===ans)c+=" wrong";else c+=" disabled";}else if(v===ans)c+=" selected"; return c; };
  return (
    <div className="iv-overlay-backdrop">
      <div className="iv-card iv-quiz-card iv-tf-card" role="dialog" aria-labelledby={`${idTipo} ${idEnunciado}`} tabIndex={-1}>
        <div id={idTipo} className="iv-badge tf">VERDADERO O FALSO</div>
        {data.image && <img className="iv-interaction-image" src={data.image} alt="" />}
        <RichText id={idEnunciado} className="iv-question">{data.statement}</RichText>
        <div className="iv-tf-row">
          <button className={bc(true)} onClick={()=>!done&&setAns(true)} disabled={done} aria-pressed={ans===true}>Verdadero</button>
          <button className={bc(false)} onClick={()=>!done&&setAns(false)} disabled={done} aria-pressed={ans===false}>Falso</button>
        </div>
        <div role="status">
          {done&&<div className={`iv-explanation ${ok?"correct":"wrong"}`}><Correccion ok={ok}/><RichText>{data.explanation}</RichText></div>}
        </div>
        {!done
          ? <button className="iv-btn-primary" style={{opacity:ans!==null?1:0.4}} onClick={()=>ans!==null&&setDone(true)} disabled={ans===null}>Confirmar</button>
          : <button className="iv-btn-primary" onClick={()=>onDismiss({answer:String(ans),correct:ok})}><Siguiente/></button>}
      </div>
    </div>
  );
}

function HotspotOverlay({ data, onDismiss }) {
  const [active, setActive] = useState(null);
  const [viewed, setViewed] = useState(new Set());
  const base = useId();
  const tap = s => { setActive(active?.id===s.id?null:s); setViewed(p=>new Set([...p,s.id])); };
  const allDone = viewed.size===data.spots.length;
  return (
    <div className="iv-hotspot-container" role="group" aria-label={`Tocá los puntos (${viewed.size}/${data.spots.length})`}>
      {data.spots.map(s=>(
        <div key={s.id}>
          <button className={`iv-hotspot-dot ${viewed.has(s.id)?"viewed":""} ${active?.id===s.id?"active":""}`}
            style={{left:`${s.x}%`,top:`${s.y}%`}} onClick={()=>tap(s)}
            aria-expanded={active?.id===s.id} aria-controls={`${base}-${s.id}`}>
            <span className="iv-hotspot-pulse" aria-hidden="true"/><span className="iv-hotspot-label">{s.label}</span>
          </button>
          {/* Con el punto bajo (y>60) el popup va ARRIBA del punto: abajo lo
              cortaba el overflow:hidden del contenedor, sobre todo en mobile. */}
          {active?.id===s.id&&<div id={`${base}-${s.id}`} className="iv-hotspot-info" style={
            s.y>60
              ? {left:`${Math.min(s.x,55)}%`,top:`${s.y-6}%`,transform:'translateY(-100%)'}
              : {left:`${Math.min(s.x,55)}%`,top:`${s.y+6}%`}
          }>
            <strong>{s.label}</strong><p>{s.info}</p>
          </div>}
        </div>
      ))}
      <div className="iv-hotspot-bar">
        <span className="iv-hotspot-hint" aria-hidden="true">Tocá los puntos ({viewed.size}/{data.spots.length})</span>
        {allDone&&<button className="iv-btn-primary iv-btn-small" onClick={onDismiss}><Siguiente/></button>}
      </div>
    </div>
  );
}

function LabelOverlay({ interactions, currentTime, playerRef }) {
  const [openId, setOpenId] = useState(null);
  const wasPlayingRef = useRef(false);
  const visible = interactions.filter(ia=>
    ia.type==="label"&&currentTime>=ia.time&&currentTime<=ia.time+(ia.duration||5)
  );
  // Close popup automatically when the label's time window ends
  useEffect(()=>{
    if(openId && !visible.find(ia=>ia.id===openId)) {
      setOpenId(null);
      if(wasPlayingRef.current){ wasPlayingRef.current=false; }
    }
  }, [visible, openId]);
  const toggleOpen = async (ia) => {
    const p = playerRef?.current;
    if(openId === ia.id) {
      // Closing: resume if we paused it
      setOpenId(null);
      if(wasPlayingRef.current && p) { p.play().catch(()=>{}); }
      wasPlayingRef.current = false;
    } else {
      // Opening: pause if playing, remember state
      if(p){
        try {
          const paused = await p.getPaused();
          wasPlayingRef.current = !paused;
          if(!paused) p.pause();
        } catch(e){}
      }
      setOpenId(ia.id);
    }
  };
  if(!visible.length) return null;
  return <>{visible.map(ia=>{
    const x = ia.data.x, y = ia.data.y;
    // Edge-aware pin anchoring: near left edge → anchor button's left edge to x;
    // near right edge → anchor right edge; else centered.
    const hAlign = x < 20 ? "left" : x > 80 ? "right" : "center";
    const vAlign = y > 65 ? "above" : "below";
    const pinCls = `iv-label-pin iv-label-pin-${hAlign}`;
    const popupCls = `iv-label-popup iv-label-popup-h-${hAlign} iv-label-popup-v-${vAlign}`;
    return (
      <div key={ia.id} className={pinCls} style={{left:`${x}%`,top:`${y}%`}}>
        <button className="iv-label-btn" onClick={(e)=>{e.stopPropagation();toggleOpen(ia);}} aria-expanded={openId===ia.id}>
          {ia.data.text}
        </button>
        {openId===ia.id&&<div className={popupCls} onClick={e=>e.stopPropagation()}>
          <div className="iv-label-popup-title">{ia.data.text}</div>
          <RichText className="iv-label-popup-def">{ia.data.definition}</RichText>
        </div>}
      </div>
    );
  })}</>;
}

const TYPE_COLORS = { note:"#84F4BE", "multiple-choice":"#0162F5", "true-false":"#14CCF7", hotspot:"#F59E0B", label:"#14CCF7" };

function TimelineMarkers({ interactions, duration }) {
  if(!duration) return null;
  return <>{interactions.map(ia=><div key={ia.id} className="iv-timeline-marker" style={{left:`${(ia.time/duration)*100}%`,background:TYPE_COLORS[ia.type]||"#fff"}}/>)}</>;
}

function SubtitleDisplay({ cues, currentTime, visible, sobreControles }) {
  if(!visible||!cues||!cues.length) return null;
  const activos = cues.filter(c=>currentTime>=c.start&&currentTime<=c.end);
  if(!activos.length) return null;
  // Con los controles a la vista el subtítulo sube, así la barra no lo cruza.
  return <div className={`iv-subtitle-container ${sobreControles?"sobre-controles":""}`}><span className="iv-subtitle-text">{activos.map(c=>c.text).join("\n")}</span></div>;
}

// Qué dice el cartel de error del video propio. Si el acceso venció y no se pudo
// renovar la firma de Bunny (ver firma.js), dice por qué y qué hacer: el botón
// Reintentar recarga la lección, y en Moodle eso firma un acceso nuevo (o pide
// ingresar de nuevo, si se cerró la sesión: ahí recarga la página entera, no el
// iframe; ver recargarParaReintentar en firma.js).
function textoDelError(e) {
  if (e.code === 404) return "El video no está disponible.";
  if (e.tipo === "acceso") {
    if (e.renovacion === "sesion") return "Se cerró tu sesión del campus. Tocá Reintentar y, si te lo pide, volvé a ingresar.";
    if (e.renovacion === "red") return "No se pudo renovar el acceso al video. Revisá tu conexión y tocá Reintentar.";
    return "El acceso al video venció. Tocá Reintentar para seguir.";
  }
  if (e.tipo === "red") return "Revisá tu conexión.";
  return "Hubo un problema al reproducirlo.";
}

// Sin nada que reproducir (ver hayVideo en configuracion.js): un cartel que lo dice, en
// vez de "Cargando video..." para siempre o la pantalla en blanco. Es otro componente, y
// no un estado del reproductor, a propósito: así no corre ninguno de sus efectos (SDK de
// Vimeo, Cast, avance en localStorage, puente con la app) sin un video atrás.
function SinVideo({ title }) {
  const isEmbedded = window !== window.parent;
  return (
    <div className={`iv-wrapper ${isEmbedded ? "embedded" : ""}`}>
      <div className="iv-top-bar"><span className="iv-top-title">{title}</span></div>
      <div className="iv-container iv-container-sin-video">
        <div className="iv-sin-video" role="status">
          <strong>No hay video para mostrar</strong>
          <span>A esta actividad le falta el video (de Vimeo o de Bunny Stream).</span>
        </div>
      </div>
    </div>
  );
}

export default function InteractiveVideoPlayer() {
  const config = getConfig();
  return hayVideo(config) ? <Reproductor/> : <SinVideo title={config.title}/>;
}

// Main player
// debeFrenar, tiempoAGuardar y la decisión de la guardia de saltos viven en candado.js.

function Reproductor() {
  const config = getConfig();
  // subtitlesUrlTv: el VTT firmado de subtitulos.php para la TV (player.php, sólo con Bunny
  // y subtítulos). Ver "Subtítulos en la TV" en cast.js.
  const { title, vimeoId, vimeoHash, videoUrl, poster, videoMotor, subtitlesUrl, subtitlesCues, subtitlesVtt, subtitlesUrlTv, subtitlesOn, interactions, castAppId, etiquetas } = config;
  // Video propio (HLS/MP4) en vez de Vimeo. También se acepta pegado en vimeoId,
  // para poder probar sin tocar el formulario de Moodle.
  const nativeSrc = videoUrl
    || (typeof vimeoId === "string" && /^https?:\/\//.test(vimeoId) && !/vimeo\.com/.test(vimeoId) ? vimeoId : null);
  const containerRef = useRef(null);
  // La pantalla completa NATIVA va sobre el wrapper, no sobre el contenedor: ver toggleFS.
  const wrapperRef = useRef(null);
  const vimeoRef = useRef(null);
  const playerRef = useRef(null);
  // Renovación de la firma de Bunny con la lección abierta (ver firma.js): uno solo para
  // el <video> y la TV, que la piden y la usan cada uno a su manera.
  const firmaRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  playingRef.current = playing;
  // Último momento en que el video se estaba reproduciendo (ver enUso del Renovador).
  const ultimoUsoRef = useRef(Date.now());
  if (playing) ultimoUsoRef.current = Date.now();
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showVolSlider, setShowVolSlider] = useState(false);
  const [isFS, setIsFS] = useState(false);
  const [fakeFS, setFakeFS] = useState(false);
  // Giro simulado: el reproductor se gira 90° con CSS cuando la pantalla no gira sola
  // (rotación automática bloqueada, iPhone sin screen.orientation.lock).
  const [girar, setGirar] = useState(false);
  const [vertical, setVertical] = useState(() => !!window.matchMedia?.('(orientation: portrait)').matches);
  const [bloqueoOk, setBloqueoOk] = useState(false);   // screen.orientation.lock('landscape') resolvió
  const giroRef = useRef(0);
  const [activeIA, setActiveIA] = useState(null);
  const [completed, setCompleted] = useState(new Set());
  const [showCtrl, setShowCtrl] = useState(true);
  const [subsOn, setSubsOn] = useState(!!subtitlesOn);
  const [cues, setCues] = useState(()=> (subtitlesCues&&subtitlesCues.length) ? subtitlesCues : (typeof subtitlesVtt==='string' && subtitlesVtt ? parseVTT(subtitlesVtt) : []));
  const [hasVimeoSubs, setHasVimeoSubs] = useState(false);
  const cuesRef=useRef(cues); cuesRef.current=cues;
  const subsOnRef=useRef(subsOn); subsOnRef.current=subsOn;
  const [speed, setSpeed] = useState(1);
  // Menú de Ajustes (engranaje): null | 'principal' | 'velocidad' | 'calidad'. El
  // ref acompaña al estado porque lo leen manejadores de toque y de teclado que
  // no se vuelven a crear en cada render.
  const [menu, setMenuEstado] = useState(null);
  const menuRef = useRef(null);
  const setMenu = useCallback((m)=>{ menuRef.current=m; setMenuEstado(m); },[]);
  const ajustesBtnRef = useRef(null);
  const ajustesPanelRef = useRef(null);
  const moverFocoMenuRef = useRef(false);
  // Calidad: lo que ofrece el motor (getQualities, misma forma en Vimeo y en el
  // video propio), la elegida y el alto que se ve en automático.
  const [calidades, setCalidades] = useState([]);   // [{ id, label, alto }] de mayor a menor, sin 'auto'
  const [calidad, setCalidad] = useState('auto');
  const [calidadViendo, setCalidadViendo] = useState(null);
  const [calidadNoDisponible, setCalidadNoDisponible] = useState(false);
  const calidadElegidaRef = useRef(null);   // lo que eligió el alumno en el menú (null: nunca tocó)
  const refrescarCalidadesRef = useRef(()=>{});
  const calidadPendienteRef = useRef(null); // elegida con un salto en vuelo: la aplica seekTo al aterrizar
  const aplicarCalidadRef = useRef(()=>{});
  const playBtnRef = useRef(null);
  // Aviso para el lector de pantalla cuando aparece una interacción y el foco no
  // se puede mover a ella (ver el efecto de activeIA).
  const [aviso, setAviso] = useState('');
  const devolverFocoRef = useRef(false);
  const [anunciarTotal, setAnunciarTotal] = useState(false);
  const [skipFeedback, setSkipFeedback] = useState(null);
  const [videoEnded, setVideoEnded] = useState(false);
  // ─── Tarjeta de fin (src/finVideo.js) ──────────────────────────────
  // null o { completada, destino } (destino: la próxima lección de la barra del tema, o
  // null). La pide alTerminar con finPendienteRef + senalFin, y la abre un efecto que
  // corre DESPUÉS del de disparo: así una pregunta del final se muestra primero y la
  // tarjeta aparece al responderla (ver "La tarjeta de fin" más abajo).
  const [tarjetaFin, setTarjetaFinEstado] = useState(null);
  const tarjetaFinRef = useRef(null);
  const setTarjetaFin = useCallback((v) => { tarjetaFinRef.current = v; setTarjetaFinEstado(v); }, []);
  const finPendienteRef = useRef(false);
  const [senalFin, setSenalFin] = useState(0);
  const finPrincipalRef = useRef(null);
  const [avisoFin, setAvisoFin] = useState('');   // para el lector de pantalla, si el foco no se pudo mover
  const idFin = useId();
  const [buffering, setBuffering] = useState(false);
  // Error que no se puede recuperar (token vencido, sin conexión, formato). Con
  // Vimeo lo mostraba su propio iframe; con el <video> propio, si no lo dibujamos
  // nosotros, el alumno ve un spinner eterno.
  const [videoError, setVideoError] = useState(null);
  // Red de seguridad (src/respaldo.js; ver respaldoRef más abajo): mientras se guarda el
  // avance y se le avisa a Moodle antes de recargar con Vimeo, la ruedita de carga en vez
  // del cartel. Se intenta una sola vez por carga.
  const [respaldando, setRespaldando] = useState(false);
  const respaldoIntentadoRef = useRef(false);
  const respaldoRef = useRef(()=>false);
  // Ya se restauró el avance guardado (ver el efecto de "Load progress"): antes, el estado
  // todavía está en 0 y sin respondidas, y guardarlo pisaría el del alumno.
  const [avanceListo, setAvanceListo] = useState(false);
  // Transmisión a la TV (sólo con video propio). `tv`: null o { tipo: 'cast' |
  // 'airplay', estado: 'conectando' | 'conectado', nombre, subtitulos } (AirPlay no da
  // nombre; subtitulos: con Chromecast, si los subtítulos van en la TV).
  // `tvDisp`: si hay una TV a la vista, para mostrar el botón sólo entonces.
  const [tv, setTv] = useState(null);
  const tvRef = useRef(null);
  const [tvDisp, setTvDisp] = useState({ cast: false, airplay: false });
  const [tvAviso, setTvAviso] = useState('');   // aviso breve ("Se dejó de transmitir…")
  const tvAvisoTimer = useRef(null);
  const [tvEnMenu, setTvEnMenu] = useState(false);   // reproductor angosto: el botón va en Ajustes
  const castCtxRef = useRef(null);
  // Con Chromecast, playerRef apunta al adaptador (CastPlayer) y el <video> espera
  // acá, en pausa y vivo, para la vuelta.
  const localPlayerRef = useRef(null);
  const errorLocalRef = useRef(null);   // error del <video> mientras transmitía: se muestra al volver
  const activeIARef = useRef(null);
  const ctrlTimer = useRef(null);
  const triggered = useRef(new Set());
  const currentTimeRef = useRef(0); // último tiempo real de Vimeo, sin pasar por React
  const lastTapRef = useRef({ time: 0, x: 0 });
  const singleTapTimer = useRef(null);
  const lastSaveRef = useRef(0);
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // ─── Avisos de las interacciones que frenan (src/avisos.js) ───────
  // Tic-tac 3 s antes (en tiempo de video), con una cuenta regresiva chica y vibración
  // corta en cada tic; "plop" y vibración más larga al frenar. Valen en los DOS modos de
  // las etiquetas (glosario y en pantalla). Los sonidos se crean en el primer gesto
  // (src/sonidos.js) y el alumno los apaga en Ajustes; la preferencia queda en su navegador.
  const sonidosRef = useRef(null);
  if (!sonidosRef.current) sonidosRef.current = crearSonidos(window);
  const [sonidoOn, setSonidoOn] = useState(() => leerPreferencia(CLAVE_SONIDO, almacenLocal()));
  const [vibraOn, setVibraOn] = useState(() => leerPreferencia(CLAVE_VIBRACION, almacenLocal()));
  const sonidoOnRef = useRef(sonidoOn); sonidoOnRef.current = sonidoOn;
  const vibraOnRef = useRef(vibraOn); vibraOnRef.current = vibraOn;
  const puedeVibrar = useMemo(() => vibracionPosible(window), []);
  const prevAvisoRef = useRef(0);        // tiempo del render anterior, sólo para los avisos (no es el del candado)
  const ticsRef = useRef(new Map());     // tics ya tocados (clave → marca), ver olvidarTics
  const [cuenta, setCuentaEstado] = useState(null);   // { id, ia }: la interacción que se está anunciando
  const cuentaRef = useRef(null);
  const setCuenta = useCallback((c) => { cuentaRef.current = c; setCuentaEstado(c); }, []);
  const [avisoCuenta, setAvisoCuenta] = useState('');   // para el lector de pantalla, una vez por aviso
  // 🔴 El video en silencio calla los SONIDOS de aviso, no la vibración (decisión de
  // Erick, 19-oct-2026; ver comoAvisar): el silencio que cuenta es el que muestra el botón
  // de volumen (`muted`), también transmitiendo (el de la TV, como lo refleja el ícono).
  const silencioRef = useRef(muted); silencioRef.current = muted;
  // que: 'tic' (alto o bajo) | 'plop' (al frenar) | 'suave' (término nuevo: sin vibrar).
  const avisarRef = useRef(null);
  avisarRef.current = (que, alto) => {
    const s = sonidosRef.current;
    const c = comoAvisar(que, { sonido: sonidoOnRef.current, vibracion: vibraOnRef.current, silenciado: silencioRef.current });
    if (c.suena) { if (que === 'tic') s.tic(alto); else if (que === 'plop') s.plop(); else s.plopSuave(); }
    if (c.vibra) s.vibrar(que === 'tic' ? VIBRA_TIC : VIBRA_FRENO);
  };

  // ─── Glosario interactivo (src/glosario.js) ────────────────────────
  // Modo de las etiquetas de la actividad (mod_ivplayer → PLAYER_CONFIG.etiquetas):
  // 'glosario' (por defecto) o 'pantalla' (los pines sobre el video, como hasta la
  // 1.4.0, de respaldo). En pantalla no hay glosario: el reproductor es el de antes.
  const modoGlosario = etiquetas !== 'pantalla';
  const conGlosario = modoGlosario && hayGlosario(interactions);
  const totalGlosario = useMemo(() => totalPosible(interactions), [interactions]);
  const nombradosRef = useRef(new Set());
  const [nombrados, setNombrados] = useState(() => new Set());
  const [recienes, setRecienes] = useState({});          // id → hasta cuándo dice "recién"
  const [avisoGlosario, setAvisoGlosario] = useState(null);   // { id, nombre }: "Nuevo en el glosario: …"
  const avisoGlosarioTimer = useRef(null);
  const [anuncioPanel, setAnuncioPanel] = useState('');   // lo mismo con el panel abierto, sólo para el lector de pantalla
  const anuncioPanelTimer = useRef(null);
  const [latido, setLatido] = useState(0);               // cambia → el contador late UNA vez
  const [glosarioAbierto, setGlosarioAbiertoEstado] = useState(false);
  const glosarioRef = useRef(false);
  const setGlosarioAbierto = useCallback((v) => { glosarioRef.current = v; setGlosarioAbiertoEstado(v); }, []);
  const [expandidos, setExpandidos] = useState(() => new Set());
  const glosarioBtnRef = useRef(null);
  const glosarioPanelRef = useRef(null);
  // true mientras la pausa vigente la puso el glosario al abrirse (tapaba el video):
  // cerrarlo la retoma. Ver el efecto de "El panel que tapa el video".
  const pausaGlosarioRef = useRef(false);
  const enfocarTerminoRef = useRef(null);
  const moverFocoGlosarioRef = useRef(false);
  const idGlosario = useId();

  // Parse Vimeo ID and hash from various URL formats
  const vimeoData = useMemo(()=>{
    // Con video propio, el "id" sólo sirve de clave del progreso en localStorage:
    // el GUID de Bunny (…/<guid>/playlist.m3u8) o, si no hay, la URL entera.
    if(nativeSrc){
      const g = nativeSrc.match(/\/([0-9a-f]{8}-[0-9a-f-]{27,})\//i);
      return { id: g ? g[1] : nativeSrc, hash: null };
    }
    let id = String(vimeoId || ""), hash = vimeoHash || null;
    if(/^\d+$/.test(id)) return { id, hash };
    // Parse URL: vimeo.com/ID/HASH or vimeo.com/video/ID/HASH
    const m = id.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([a-f0-9]+))?/);
    if(m) { id = m[1]; if(m[2]) hash = m[2]; }
    return { id, hash };
  },[vimeoId, vimeoHash, nativeSrc]);

  useEffect(()=>{
    if(subtitlesUrl) fetch(subtitlesUrl).then(r=>r.text()).then(t=>setCues(parseVTT(t))).catch(()=>{});
  },[subtitlesUrl]);

  useEffect(()=>{
    if(!vimeoRef.current||playerRef.current) return;
    const crearVimeo=()=>{
      const opts = {
        controls: false, responsive: true,
        loop: false, muted: false, pip: false, title: false, byline: false, portrait: false, dnt: true,
      };
      if(vimeoData.hash) {
        opts.url = `https://vimeo.com/${vimeoData.id}/${vimeoData.hash}`;
      } else {
        opts.id = parseInt(vimeoData.id);
      }
      return new Player(vimeoRef.current, opts);
    };
    // Firma de Bunny: con MOODLE_CONTEXT.firmaUrl (player.php la pone sólo si el video
    // va firmado) se renueva antes de vencer. Sin ella (página de prueba, configurador,
    // SCORM) o con una URL sin token, el Renovador queda inactivo y no hace nada.
    let firma=null;
    if(nativeSrc){
      const ctx=window.MOODLE_CONTEXT||null;
      firma=new Renovador({ url:nativeSrc, poster, firmaUrl:ctx&&ctx.firmaUrl, cmid:ctx&&ctx.cmid, sesskey:ctx&&ctx.sesskey, ahoraServidor:ctx&&ctx.firmaAhora,
        // Reproduciendo o hace menos de 20 min: una pausa corta (una pregunta, ir a buscar
        // algo) no corta la renovación, pero una lección olvidada abierta no le alarga
        // la sesión al campus para siempre.
        enUso:()=>playingRef.current||Date.now()-ultimoUsoRef.current<20*60*1000 });
      firmaRef.current=firma;
    }
    // Misma interfaz en los dos casos (ver nativePlayer.js): el resto del
    // componente no sabe si atrás hay Vimeo o un <video> propio.
    // `momento`: lo que el <video> no sabe para elegir cuándo estrenar una firma nueva
    // con el HLS nativo (no con una pregunta abierta si se puede; nunca en un salto).
    const momento=()=>({ pregunta:!!activeIARef.current, saltando:seekTargetRef.current!=null });
    const p = nativeSrc ? new NativePlayer(vimeoRef.current, { src: nativeSrc, poster, motor: videoMotor, firma, momento }) : crearVimeo();
    playerRef.current = p;
    p.ready().then(()=>{
      setReady(true);
      p.getDuration().then(setDuration);
      // Se AVERIGUA si el video trae pista de subtitulos, pero no se activa sola.
      // `hasVimeoSubs` decide quien los dibuja -- Vimeo o nuestro SubtitleDisplay --,
      // asi que hay que saberlo igual aunque arranquen apagados. La pista se activa
      // recien cuando el alumno toca el boton (ver toggleSubs), o de entrada solo si
      // el video se configuro con subtitlesOn.
      p.getTextTracks().then(tracks=>{
        // 🔴 Una pista autogenerada de Vimeo (idioma "es-x-autogen") no le gana al
        // archivo que subió el docente en "Editar transcripción", que está corregido.
        const propias=(tracks||[]).filter(t=>!/-x-autogen$/i.test(t.language||""));
        if(tracks&&tracks.length>0&&(propias.length||!(cuesRef.current&&cuesRef.current.length))){
          setHasVimeoSubs(true);
          // El botón ya estaba (por los cues propios) y el alumno lo prendió antes de
          // que llegara la lista de pistas: activarla ahora o quedaba prendido y vacío.
          if(subtitlesOn||subsOnRef.current){
            const esTrack=tracks.find(t=>t.language==='es');
            const track=esTrack||tracks[0];
            p.enableTextTrack(track.language,track.kind).catch(()=>{});
          }
        }
      }).catch(()=>{});
    });
    suscribirRef.current(p);
    // AirPlay (sólo el <video> en WebKit): el <video> sigue siendo el dueño, así que
    // sólo hace falta saber si hay una TV y si se está transmitiendo.
    if(p.transmisionDisponible){
      p.on("remotechange", d=>{
        if(!d) return;
        setTvDisp(x=>x.airplay===!!d.disponible?x:{...x,airplay:!!d.disponible});
        if(d.estado==='connected') setTv({tipo:'airplay',estado:'conectado',nombre:null});
        else if(d.estado==='connecting') setTv({tipo:'airplay',estado:'conectando',nombre:null});
        else if(tvRef.current?.tipo==='airplay'){
          if(tvRef.current.estado==='conectado') avisarTVRef.current('Se dejó de transmitir a la TV.');
          setTv(null);
        }
      });
    }
    // No cleanup — Vimeo Player does not survive StrictMode destroy/recreate cycle
  },[vimeoData]);

  // Suscribe el componente a los eventos de un motor: el de arranque (Vimeo o el
  // <video>) y el adaptador de Chromecast mientras se transmite (ver cast.js).
  // 🔴 Sólo el motor ACTIVO (playerRef.current) le habla al componente. Al pasar a
  // la TV, el <video> queda en pausa y su 'pause' pondría el botón en "Reproducir"
  // con la TV andando; al volver, un tick tardío del adaptador movería el reloj. Los
  // manejadores sólo usan refs y setters: no importa en qué render se suscriben.
  const suscribirRef=useRef(null);
  suscribirRef.current=(p)=>{
    const activo=()=>playerRef.current===p;
    p.on("timeupdate", d=>{
      if(!activo()) return;
      // Tras Reiniciar, descartar los ticks de la posición vieja que ya venían en
      // camino: con el tiempo puesto en 0, uno de esos parecía un cruce y mostraba
      // al instante una pregunta ya respondida. Lo apaga el primer tick del
      // principio (el seek aterrizado o el play desde 0), o 1 s de tope.
      if(resetHastaRef.current){ if(d.seconds>1&&Date.now()<resetHastaRef.current) return; resetHastaRef.current=0; }
      if(d.duration>0)finRef.current=d.duration;currentTimeRef.current=d.seconds;setCurrent(d.seconds);
    });
    // La duración puede llegar después de ready() (iOS sin metadata hasta el
    // primer toque, o un HLS que todavía no la conoce). Vimeo también la emite.
    p.on("durationchange", d=>{ if(activo()&&d&&d.duration>0) setDuration(d.duration); });
    p.on("play", ()=>{
      if(firmaRef.current) firmaRef.current.alUsar();
      if(!activo()){
        // 🔴 Transmitiendo con Chromecast, el <video> del celular espera en pausa pero
        // VIVO, y su sesión de medios sigue activa: la notificación de Android, el
        // botón de un auricular o los controles de medios de Chrome le hacen play
        // directo. Sonaba en el celular detrás del cartel, a la vez que la TV, y el
        // reloj no se enteraba. Se lo vuelve a pausar en el acto.
        if(!p.esTV&&playerRef.current?.esTV){ try{ p.pause(); }catch(e){} }
        return;
      }
      // Un play que no pidió el reproductor (Centro de control, auriculares, el
      // control remoto de la TV o Google Home) con una pregunta abierta corría el
      // video por detrás y salteaba interacciones.
      if(activeIARef.current){ playIntentRef.current=null; p.pause(); return; }
      terminoRef.current=false;
      // Volvió a reproducir (Volver a ver, el play después de cerrar la tarjeta, o uno de
      // afuera: auriculares, la pantalla de bloqueo): la tarjeta de fin se va.
      soltarFinRef.current();
      // Alguien lo puso a andar con el glosario abierto (el alumno, los auriculares, la
      // pantalla de bloqueo): la pausa ya no es del glosario y cerrarlo no la retoma,
      // aunque en el medio lo vuelvan a pausar (ver reanudarAlCerrar).
      pausaGlosarioRef.current=false;
      setPlaying(true);
      // Moodle móvil: el gesto nunca llega al iframe de Vimeo (pointer-events:
      // none) y el navegador fuerza arranque muteado; el ícono decía "sonido
      // activo" con audio en silencio. Leer el estado REAL y reflejarlo.
      Promise.all([p.getVolume(), p.getMuted ? p.getMuted() : Promise.resolve(false)])
        .then(([v,m])=>{ if(activo()&&(m||v===0)) setMuted(true); })
        .catch(()=>{});
    });
    p.on("pause", ()=>{ if(activo()) setPlaying(false); });
    // Con controls:false el spinner propio de Vimeo no existe: un buffering
    // normal tras un seek se veía como "se congeló el video". Exponer el
    // estado para mostrar nuestro propio spinner.
    p.on("bufferstart", ()=>{ if(activo()) setBuffering(true); });
    p.on("bufferend", ()=>{ if(activo()) setBuffering(false); });
    p.on("seeked", ()=>{ if(activo()) setBuffering(false); });
    // Sólo los errores definitivos (nativePlayer los marca `fatal`; Vimeo también
    // emite 'error' por un play rechazado, que no lo es). Uno del <video> mientras
    // transmite (no debería: está quieto) se guarda para mostrarlo al volver.
    p.on("error", e=>{
      if(!e||!e.fatal) return;
      if(!activo()){ if(!p.esTV) errorLocalRef.current=e; return; }
      playIntentRef.current=null;
      setBuffering(false);
      setPlaying(false);
      // Red de seguridad: una falla del CDN de Bunny recarga la lección con Vimeo, sin
      // cartel (respaldoRef dice si se hace cargo).
      if(respaldoRef.current(e)) return;
      setVideoError(e);
    });
    p.on("ended", ()=>{ if(activo()) alTerminarRef.current(); });
    // Calidad: el video propio avisa la elegida y lo que se ve ('viendo', para
    // "Automática (480p)"); Vimeo emite el evento sin 'viendo'. En los dos casos se
    // vuelve a leer la lista, que es la fuente de verdad del menú.
    p.on("qualitychange", d=>{
      if(!activo()) return;
      if(d&&typeof d.viendo==='number'&&d.viendo>0) setCalidadViendo(d.viendo);
      refrescarCalidadesRef.current();
    });
  };

  // Lee las calidades del motor y las deja listas para el menú: de mayor a menor,
  // sin duplicados, y sólo si hay algo que elegir (dos o más). Vimeo nombra '4K' y
  // '2K'; el video propio, siempre '<alto>p'.
  refrescarCalidadesRef.current=()=>{
    const p=playerRef.current; if(!p||!p.getQualities) return;
    p.getQualities().then(qs=>{
      if(!Array.isArray(qs)) qs=[];
      const altoDeId=(id)=>id==='4K'?2160:id==='2K'?1440:(parseInt(id,10)||0);
      const vistos=new Set();
      const lista=qs
        .filter(q=>q&&q.id&&q.id!=='auto')
        .map(q=>({id:String(q.id),label:String(q.label||q.id),alto:altoDeId(String(q.id))}))
        .filter(q=>q.alto>0&&!vistos.has(q.id)&&vistos.add(q.id))
        .sort((a,b)=>b.alto-a.alto);
      setCalidades(lista.length>=2?lista:[]);
      const activa=qs.find(q=>q&&q.active);
      // Con una elección esperando que aterrice un salto (ver elegirCalidad), la
      // etiqueta ya dice la elegida: no volver a la vieja por un instante.
      if(activa&&calidadPendienteRef.current==null) setCalidad(String(activa.id));
    }).catch(()=>{});
  };
  useEffect(()=>{ if(ready) refrescarCalidadesRef.current(); },[ready]);

  // Lo que pasa al terminar el video. Lo llama 'ended' y también dismiss: si el
  // pause de una pregunta cae justo en el fin, Vimeo a veces deja el medio
  // terminado SIN emitir 'ended', y un play() ahí arrancaba desde 0 sin
  // completar la actividad.
  // 🔴 Desde la tarjeta de fin (1.4.0) el video se QUEDA en el final: no vuelve a 0 ni
  // repite solo con "Repetir video" (loop). Se frena en la tarjeta, y "Volver a ver" (o el
  // play después de cerrarla) arranca de nuevo desde 0 (ver volverAEmpezar). Lo que se
  // guarda como avance sigue siendo 0, como cuando volvía a 0 (ver tiempoDelAvance).
  const alTerminarRef=useRef(()=>{});
  alTerminarRef.current=()=>{
    if(terminoRef.current) return; // ya terminó (un 'ended' tardío no lo procesa dos veces)
    // Sin intent, el watchdog de safePlay no relanza el video terminado; terminoRef
    // evita que cerrar una pregunta del final lo arranque.
    terminoRef.current=true;
    // 🔴 Evaluar una vez contra el fin (lo mismo que hace dismiss): si 'ended' llega
    // antes de que el efecto de disparo vea el último segundo, la pregunta del final
    // se perdía. Pasa transmitiendo: la TV avisa que terminó (el último segundo y
    // 'ended' en la misma tarea) y React los junta en un solo render. Con el celular
    // bloqueado (timers alineados al segundo) o una TV que termina un poco antes de la
    // duración que informa, el FINISHED le gana al freno: se perdía en 7 de 11
    // corridas. Con una pregunta ya abierta no hace falta.
    if(!activeIARef.current) evaluarEnFinRef.current=true;
    playIntentRef.current=null;
    setPlaying(false);
    setVideoEnded(true);
    // La barra, en el final (el último tick puede haber quedado un poco antes). Y la
    // tarjeta: la abre el efecto de "La tarjeta de fin", después del de disparo (senalFin
    // hace que los dos corran aunque el tiempo no cambie).
    const fin=finRef.current<Infinity?finRef.current:Math.max(currentTimeRef.current,duration||0);
    if(fin>0){ currentTimeRef.current=fin; setCurrent(fin); }
    finPendienteRef.current=true;
    setSenalFin(n=>n+1);
  };

  // Tiempo del tick anterior, para disparar por CRUCE y no solo por proximidad:
  // los timeupdate de Vimeo llegan ~cada 250ms de reloj, así que a 2× (o con la
  // pestaña throttleada) el cruce podía caer fuera de una ventana fija y la
  // interacción no disparaba nunca. La decisión vive en debeFrenar().
  const prevTimeRef=useRef(0);
  const finRef=useRef(Infinity); // duración real del medio, del timeupdate
  // Al cerrar una pregunta con el video ya terminado, evaluar una vez contra el fin:
  // dos interacciones del último tramo vencen con el mismo tick final y el efecto
  // muestra de a una (break), así que la segunda sólo aparece si se la mira desde el
  // fin (y no desde donde haya quedado el estado, que con la TV puede ser otro segundo).
  const evaluarEnFinRef=useRef(false);
  useEffect(()=>{ activeIARef.current=activeIA; },[activeIA]);
  // Foco a la interacción que aparece, así el teclado y el lector de pantalla
  // quedan EN la pregunta y no en un botón que ya no se ve. preventScroll: sin eso
  // focus() también desplaza la página del campus para traer el iframe a la vista.
  // Sólo si el reproductor tiene el foco: si el alumno está escribiendo en la
  // página madre (la búsqueda de la transcripción) no se le roba; se avisa por la
  // región role="status".
  useEffect(()=>{
    if(!activeIA){
      setAviso('');
      if(devolverFocoRef.current){ devolverFocoRef.current=false; try{ playBtnRef.current?.focus({preventScroll:true}); }catch(e){} }
      return;
    }
    const raiz=containerRef.current;
    const destino=raiz&&(activeIA.type==='hotspot'?raiz.querySelector('.iv-hotspot-dot'):raiz.querySelector('.iv-card'));
    let movido=false;
    try{ if(destino&&document.hasFocus()){ destino.focus({preventScroll:true}); movido=document.activeElement===destino; } }catch(e){}
    setAviso(movido?'':textoAviso(activeIA));
  },[activeIA]);
  useEffect(()=>{
    const prev=prevTimeRef.current;
    if(!ready||activeIA) return;
    const t=evaluarEnFinRef.current&&finRef.current<Infinity?finRef.current:currentTime;
    evaluarEnFinRef.current=false;
    // 🔴 Después del return, no antes: con la pregunta abierta prev se queda en
    // el tick que la disparó. Si avanzara hasta donde terminó de frenar (a 2× con
    // el pause lento, más de 0,8 s después), una segunda pregunta pegada a la
    // primera se salteaba al cerrarla.
    prevTimeRef.current=t;
    // Al frenar: "plop" y vibración (los dos los puede apagar el alumno). También si se
    // llegó saltando: el aviso previo es el que no suena (ver ticsEntre).
    const mostrar=(ia)=>{ triggered.current.add(ia.id); playIntentRef.current=null; playerRef.current?.pause(); activeIARef.current=ia; setActiveIA(ia); avisarRef.current('plop'); };
    // 🔴 GUARDIA de saltos que NO pidió el reproductor: los ±15 s de la pantalla de
    // bloqueo, el Centro de control o los auriculares (iOS los aplica directo al
    // medio, sin pasar por la barra) o un hilo trabado largo. Si el salto dejó atrás
    // una pregunta pendiente, se vuelve a la MÁS TEMPRANA y se la muestra ahí mismo.
    // Va ANTES del bucle: si el salto aterrizaba en la ventana de otra pendiente (o
    // dentro de los 8 s de un hotspot), el bucle frenaba ésa y las anteriores
    // quedaban salteadas para siempre. Si cruzó una sola y el bucle igual la frena
    // (tick lento, hilo trabado corto), se deja como estaba: sin un seek de más.
    // La muestra la guardia y no el render siguiente: con el video quieto (salto en
    // pausa, o que pasó el fin) ese render no llega y el alumno veía el video parado
    // sin la pregunta.
    // Los saltos propios (barra, skip, transcripción, restaurar) no pasan por acá:
    // en vuelo (seekTargetRef) o ya resueltos, mientras el tick caiga cerca de SU
    // destino (ver seekPropioDestinoRef). Lejos del destino es otro salto.
    // 🔴 No va sin la restauración optimista de más abajo: sin ella, con Vimeo el
    // primer tick después de restaurar llega con prev=0 y la guardia arrastraba al
    // alumno hacia atrás.
    // La decisión (qué pendiente retomar y a qué segundo) es pura: pendienteARetomar.
    const tickPropio=esTickPropio(t,seekPropioDestinoRef.current,seekPropioHastaRef.current,Date.now());
    if(seekTargetRef.current==null&&!tickPropio){
      const retomar=pendienteARetomar({interactions,completed,triggered:triggered.current,prev,t,currentTime,fin:finRef.current});
      if(retomar){
        const vuelta=retomar.vuelta;
        // 🔴 prev pasa a la VUELTA, no se queda en el destino del salto. Si no, un
        // segundo salto de afuera con esta tarjeta abierta que caía ANTES de ese destino
        // se leía al cerrarla como un salto hacia atrás, y la pendiente del medio se
        // perdía (lo encontró el simulador de las pruebas, oct-2026).
        prevTimeRef.current=vuelta;
        currentTimeRef.current=vuelta;
        setCurrent(vuelta);
        seekTo(vuelta);
        mostrar(retomar.ia);
        return;
      }
    }
    for(const ia of interactions){
      if(ia.type==="label") continue; // Labels don't pause the video.
      if(completed.has(ia.id)||triggered.current.has(ia.id)) continue;
      if(ia.type==="hotspot"){
        if(currentTime>=ia.time&&currentTime<=ia.time+(ia.duration||8)){ mostrar(ia); return; }
      } else if(debeFrenar(ia.time,prev,t,finRef.current)){ mostrar(ia); return; }
    }
    // senalFin: alTerminar pide la pasada contra el fin aunque el tiempo no haya cambiado
    // (el video ya no vuelve a 0 al terminar: ver alTerminar).
  },[currentTime,ready,completed,interactions,activeIA,senalFin]);

  // ─── La tarjeta de fin (src/finVideo.js) ──────────────────────────────
  // Va DESPUÉS del efecto de disparo, a propósito: si el video terminó con una pregunta
  // del final pendiente (o una pasada contra el fin encuentra otra del mismo tramo), el
  // de disparo ya la mostró (mostrar pone activeIARef en el acto) y la tarjeta espera a
  // que la respondan; al cerrarla (activeIA cambia) vuelve a mirar. No tapa nunca una
  // pregunta. Si en el medio se volvió a reproducir o se saltó (terminoRef en false), no
  // se abre.
  useEffect(()=>{
    if(!finPendienteRef.current) return;
    if(!terminoRef.current){ finPendienteRef.current=false; return; }
    if(activeIA||activeIARef.current) return;
    finPendienteRef.current=false;
    abrirTarjetaFinRef.current();
  },[currentTime,activeIA,senalFin]);

  // Avisos y glosario, con el mismo tiempo que mira el candado (el del componente: el
  // del <video>, el de Vimeo o el de la TV). Va DESPUÉS del efecto de disparo y no lo
  // toca: el candado decide cuándo se frena; acá sólo se avisa antes y se suman los
  // términos. "Reproduciendo" es el estado del botón: un salto (barra, ±10 s,
  // transcripción, restaurar el avance) no avisa ni hace sonar el glosario.
  useEffect(()=>{
    const prev=prevAvisoRef.current, t=currentTime;
    prevAvisoRef.current=t;
    if(!ready) return;
    // 🔴 Un salto PEDIDO (barra, ±10 s, teclado, transcripción, restaurar, la vuelta de
    // la TV) deja seekTargetRef puesto hasta que resuelve: ese paso es un salto aunque
    // sea corto. El ±10 que frena EXACTO en una pendiente a menos de SEEK_MIN se leía
    // como reproducción y sonaban el plop suave de una etiqueta del medio y un tic de la
    // pendiente siguiente, que además cortaba la vibración del freno (oct-2026).
    const reproduciendo=playingRef.current&&seekTargetRef.current==null;
    // Frenó en este mismo paso (el efecto de disparo va antes y ya puso la tarjeta,
    // aunque activeIA de este render siga en null): el plop del freno es el único sonido.
    const frenando=!!(activeIA||activeIARef.current);
    if(conGlosario){
      const nuevos=terminosNuevos({interactions,nombrados:nombradosRef.current,prev,t,reproduciendo,velocidad:speed});
      if(nuevos.length){
        const sig=new Set(nombradosRef.current);
        nuevos.forEach(n=>sig.add(n.id));
        nombradosRef.current=sig;
        setNombrados(sig);
        // Los que se cruzaron reproduciendo: "plop" suave (sin vibrar), "recién" unos
        // segundos, el contador late una vez y, con el panel cerrado, el aviso. Los que
        // quedaron atrás en un salto se suman callados.
        const oidos=nuevos.filter(n=>n.sonido);
        if(oidos.length){
          // Una etiqueta en el mismo segundo que una pregunta: se suma (con "recién" y
          // el latido) sin su plop suave encima del plop del freno.
          if(!frenando) avisarRef.current('suave');
          const hasta=Date.now()+RECIEN_MS;
          setRecienes(r=>{ const x={...r}; oidos.forEach(n=>{ x[n.id]=hasta; }); return x; });
          setLatido(n=>n+1);
          const n=oidos[oidos.length-1];
          if(!glosarioRef.current&&!activeIARef.current){
            clearTimeout(avisoGlosarioTimer.current);
            setAvisoGlosario({id:n.id,nombre:n.nombre});
            avisoGlosarioTimer.current=setTimeout(()=>setAvisoGlosario(null),AVISO_MS);
          } else if(glosarioRef.current&&!activeIARef.current){
            // Con el panel abierto no hay aviso a la vista, pero el lector de pantalla
            // se tiene que enterar igual (la lista cambia sin mover el foco).
            clearTimeout(anuncioPanelTimer.current);
            setAnuncioPanel(`Nuevo en el glosario: ${n.nombre}`);
            anuncioPanelTimer.current=setTimeout(()=>setAnuncioPanel(''),AVISO_MS);
          }
        }
      }
    }
    // Tic-tac. Volver antes de la marca de un tic (un salto hacia atrás, Reiniciar) lo
    // olvida: se repite la próxima vez que se cruce.
    ticsRef.current=olvidarTics(ticsRef.current,t);
    const c=cuentaRef.current;
    if(frenando){ if(c){ setCuenta(null); setAvisoCuenta(''); } return; }
    if(c&&(completed.has(c.id)||triggered.current.has(c.id)||cuentaRegresiva(c.ia,t,finRef.current)==null)){ setCuenta(null); setAvisoCuenta(''); }
    const tics=ticsEntre({interactions,completed,triggered:triggered.current,prev,t,reproduciendo,tocados:ticsRef.current,fin:finRef.current,velocidad:speed});
    if(!tics.length) return;
    tics.forEach(x=>ticsRef.current.set(x.clave,x.marca));
    // Dos marcas en el mismo paso (un tick largo) sonarían como una: se toca la última.
    const x=tics[tics.length-1];
    avisarRef.current('tic',x.alto);
    if(cuentaRef.current?.id!==x.id){
      setCuenta({id:x.id,ia:x.ia});
      setAvisoCuenta(`${textoCuenta(x.ia)} en ${x.restan} ${x.restan===1?'segundo':'segundos'}.`);
    }
  },[currentTime,ready,activeIA,completed,interactions,conGlosario]);
  // Lo que dice la cuenta regresiva en este render (null: no se ve).
  const restanCuenta=cuenta&&!activeIA?cuentaRegresiva(cuenta.ia,currentTime,finRef.current):null;

  // "recién" se apaga solo: un temporizador hasta el próximo vencimiento.
  useEffect(()=>{
    const ids=Object.keys(recienes);
    if(!ids.length) return;
    const prox=Math.min(...ids.map(k=>recienes[k]));
    const h=setTimeout(()=>setRecienes(r=>{ const ahora=Date.now(), x={}; for(const k in r) if(r[k]>ahora) x[k]=r[k]; return x; }),Math.max(0,prox-Date.now())+20);
    return()=>clearTimeout(h);
  },[recienes]);

  // Gesto o botón de ATRÁS con la pantalla completa simulada (iPhone, página
  // suelta): cierra la pantalla completa como en YouTube en vez de irse de la
  // página. Entrada propia en el historial al entrar con un toque (Safari ignora
  // al volver las entradas agregadas sin gesto del usuario); al salir con el
  // botón se consume con history.back(). Dentro de un iframe NO se toca el
  // historial: lo hace la página que lo contiene (view.php / prueba-campus).
  const esperandoBackRef=useRef(false);
  const fakeFSRef=useRef(false);
  useEffect(()=>{ fakeFSRef.current=fakeFS; },[fakeFS]);
  useEffect(()=>{
    if(window.parent!==window) return;
    // Recargó estando en pantalla completa: la entrada propia sobrevive a la recarga
    // y el primer atrás del alumno sólo la consumía, sin nada visible. Se la consume
    // acá (es del mismo documento: no navega). Desmarcarla no alcanza, la entrada
    // seguiría estando.
    try{ if(history.state&&history.state.ivplayerFS) history.back(); }catch(e){}
    const h=(e)=>{
      esperandoBackRef.current=false;
      if(fakeFSRef.current&&!(e.state&&e.state.ivplayerFS)){ setFakeFS(false); setIsFS(false); }
    };
    window.addEventListener("popstate",h);
    return()=>window.removeEventListener("popstate",h);
  },[]);
  const soltarHorizontal=()=>{ setBloqueoOk(false); try{ screen.orientation?.unlock?.(); }catch(e){} };
  const aplicarPreferenciaGiro=()=>{ try{ if(localStorage.getItem('iv_girar')==='1') setGirar(true); }catch(e){} };
  const bloquearHorizontal=()=>{
    const so=screen.orientation; let p=null;
    try{ p=so?.lock?.('landscape'); }catch(e){ p=null; }
    // Sólo se llama tras una pantalla completa NATIVA, donde el giro CSS no aplica
    // (ver fsNativo): si el lock falla no se ofrece nada, se gira el equipo a mano.
    if(!p||!p.then) return;
    // Con tope: si el sistema ignora el pedido (tablets con Android 16) la promesa
    // queda pendiente para siempre.
    Promise.race([p.then(()=>true,()=>false), new Promise(r=>setTimeout(()=>r(false),1500))])
      .then(ok=>setBloqueoOk(ok));
  };
  const toggleFS = useCallback(async()=>{
    // 🔴 Pantalla completa sobre el WRAPPER, no sobre .iv-container. Vimeo con
    // `responsive: true` arma una caja de alto = ancho × 9/16 pegada ARRIBA de su
    // contenedor. Si el que se agrandaba a la pantalla era .iv-container, en un
    // celular —que no es 16:9, ni parado ni acostado— el video quedaba arriba y
    // el resto en negro, con los controles abajo y los puntos desalineados. Es lo
    // que veían los alumnos en la app (14-sep-2026); en la compu no se nota porque
    // el monitor es 16:9. Con el wrapper, el contenedor conserva su 16:9 centrado:
    // el mismo diseño de la pantalla completa simulada (.fake-fs), que ya andaba.
    const el=wrapperRef.current; if(!el) return;
    const inIframe=window!==window.parent;
    // Try native Fullscreen API on the wrapper (desktop/Android/standalone)
    try{
      if(!document.fullscreenElement&&!document.webkitFullscreenElement&&!fakeFS){
        if(el.requestFullscreen) { await el.requestFullscreen({navigationUI:'hide'}); bloquearHorizontal(); return; }
        if(el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return; }
      } else if(document.fullscreenElement||document.webkitFullscreenElement){
        soltarHorizontal();
        if(document.exitFullscreen) { await document.exitFullscreen(); return; }
        if(document.webkitExitFullscreen) { document.webkitExitFullscreen(); return; }
      }
    }catch(e){}
    // If in iframe (Moodle plugin), ask parent to fullscreen the iframe
    if(inIframe){
      try{
        const action=fakeFS?'exit':'enter';
        window.parent.postMessage({type:'ivplayer-fullscreen',action},'*');
        if(action==='enter') aplicarPreferenciaGiro();
        setFakeFS(!fakeFS);
        setIsFS(!fakeFS);
        return;
      }catch(e){}
    }
    // Last fallback: CSS fake-fullscreen (iPhone en la página suelta)
    const entering=!fakeFS;
    if(entering&&esperandoBackRef.current) return;   // un toque durante nuestro propio atrás
    setFakeFS(entering);
    setIsFS(entering);
    if(entering){
      aplicarPreferenciaGiro();
      if(!(history.state&&history.state.ivplayerFS)){ try{ history.pushState({ivplayerFS:1},""); }catch(e){} }
    } else if(history.state&&history.state.ivplayerFS){
      esperandoBackRef.current=true;
      setTimeout(()=>{ esperandoBackRef.current=false; },1000);
      try{ history.back(); }catch(e){}
    }
  },[fakeFS]);

  // Listen for fullscreen state changes from parent (Moodle plugin)
  // y pedidos de salto de la página (la transcripción del campus): pasan por
  // seekExternoRef, que respeta el candado de preguntas igual que la barra.
  // 🔴 Antes la transcripción manejaba el iframe de Vimeo directo y salteaba
  // las preguntas pendientes; con Bunny ni siquiera habría iframe de Vimeo.
  const seekExternoRef=useRef(null);
  useEffect(()=>{
    const handler=(e)=>{
      if(e.data?.type==='ivplayer-fullscreen-state'&&e.source===window.parent&&typeof e.data.isFS==='boolean'){
        setIsFS(e.data.isFS);
        setFakeFS(e.data.isFS);
      }
      // Sólo de la página que nos contiene y del mismo sitio (el campus), y sólo
      // un número de segundos válido (nada de '30', null o [30] convertidos).
      if(e.data?.type==='ivplayer-seek'&&e.source===window.parent&&window.parent!==window&&e.origin===location.origin){
        const t=e.data.t;
        if(typeof t==='number'&&Number.isFinite(t)&&t>=0) seekExternoRef.current?.(t);
      }
    };
    window.addEventListener('message',handler);
    return()=>window.removeEventListener('message',handler);
  },[]);

  // API para la página que nos contiene (la transcripción del campus): en qué
  // segundo va el video. Sale del ESTADO, no del timeupdate crudo, así también
  // sigue los saltos optimistas (barra, transcripción, Reiniciar) aunque el medio
  // todavía no informe tiempo. Sólo el tiempo, nada del alumno, y sólo al mismo
  // sitio: los dos que nos incrustan (view.php y el modal de la web) lo son.
  const ultimoTiempoPublicadoRef=useRef(null);
  useEffect(()=>{
    if(window.parent===window||currentTime===ultimoTiempoPublicadoRef.current) return;
    ultimoTiempoPublicadoRef.current=currentTime;
    try{ window.parent.postMessage({type:'ivplayer-time',t:currentTime,d:finRef.current<Infinity?finRef.current:(duration||0)},location.origin); }catch(e){}
  },[currentTime]);

  useEffect(()=>{
    const h=()=>{ const en=!!(document.fullscreenElement||document.webkitFullscreenElement); setIsFS(en); if(!en) soltarHorizontal(); };
    document.addEventListener("fullscreenchange",h);
    document.addEventListener("webkitfullscreenchange",h);
    return()=>{document.removeEventListener("fullscreenchange",h);document.removeEventListener("webkitfullscreenchange",h);};
  },[]);

  // Fullscreen quality boost: Vimeo picks the stream rendition from the
  // player's CSS size, so on mobile it serves a low quality (~360/540p)
  // and keeps it when going fullscreen. Force the best rendition (capped
  // at 1080p) while in fullscreen; back to auto on exit. setQuality is
  // unavailable on some Vimeo plans — failures are silently ignored.
  useEffect(()=>{
    const p=playerRef.current;
    // Sólo Vimeo. Con video propio: hls.js sube la calidad solo al agrandarse
    // (capLevelToPlayerSize), y con el HLS nativo de iPhone fijar una calidad es
    // cambiar de FUENTE (ver nativePlayer.setQuality): hacerlo en cada entrada y
    // salida de pantalla completa sería un corte cada vez. Ahí la calidad fija la
    // elige el alumno en el menú, y sólo él.
    if(!p||!ready||nativeSrc) return;
    // 🔴 Lo que eligió el alumno en el menú manda, también "Automática": no se
    // fuerza 720p/1080p al entrar ni se vuelve a 'auto' al salir (así, al salir,
    // queda SU elección). Dura lo que dura la página.
    if(calidadElegidaRef.current!=null) return;
    if(isFS||fakeFS){
      p.getQualities().then(qs=>{
        if(!Array.isArray(qs)||!qs.length) return;
        // En táctil (celular) preferir 720p: forzar 1080p vaciaba el buffer en
        // cada seek y la imagen quedaba congelada con el audio corriendo
        // (la pista de audio pesa poco y sigue; la de video no llega a
        // rellenarse en conexiones móviles). 720p en pantalla de teléfono es
        // visualmente equivalente con la mitad de bitrate.
        const coarse=window.matchMedia?.('(pointer: coarse)').matches;
        const order=coarse?['720p','1080p','540p']:['1080p','720p','540p'];
        const best=order.find(q=>qs.some(x=>x.id===q));
        if(best) p.setQuality(best).catch(()=>{}).then(()=>refrescarCalidadesRef.current());
      }).catch(()=>{});
    } else {
      p.setQuality('auto').catch(()=>{}).then(()=>refrescarCalidadesRef.current());
    }
  },[isFS,fakeFS,ready]);

  useEffect(()=>{
    const mq=window.matchMedia?.('(orientation: portrait)'); if(!mq) return;
    // Si la pantalla gira sola (rotación automática prendida), el giro simulado sobra.
    const h=()=>{ setVertical(mq.matches); if(!mq.matches) setGirar(false); };
    mq.addEventListener?.('change',h);
    return()=>mq.removeEventListener?.('change',h);
  },[]);
  useEffect(()=>{ if(!isFS&&!fakeFS){ setGirar(false); setBloqueoOk(false); } },[isFS,fakeFS]);

  // Keyboard shortcuts
  useEffect(()=>{
    const handleKey=(e)=>{
      // 🔴 Con modificadores no son atajos nuestros: Ctrl+C prendía los subtítulos
      // y Ctrl+F entraba a pantalla completa. Lo que ya atendió otro (la barra de
      // avance, que maneja sus propias flechas) tampoco.
      if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey) return;
      if(menuRef.current){
        if(e.key==='Escape'){ e.preventDefault(); cerrarMenuRef.current(true); }
        return;   // con el menú abierto las teclas son del menú (Tab, Enter, espacio)
      }
      // Lo mismo con el glosario abierto: Escape lo cierra y el resto es del panel.
      if(glosarioRef.current){
        if(e.key==='Escape'){ e.preventDefault(); cerrarGlosarioRef.current(true); }
        return;
      }
      // La tarjeta de fin: Escape la cierra (el video queda en el final) y el resto de las
      // teclas son de sus botones (Tab, Enter, espacio).
      if(tarjetaFinRef.current){
        if(e.key==='Escape'){ e.preventDefault(); cerrarTarjetaFinRef.current(true); }
        return;
      }
      if(activeIA) return;
      const el=e.target, tag=el&&el.tagName;
      // Escribiendo, o en un control que usa esas teclas (el volumen, un slider).
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||el?.isContentEditable||el?.getAttribute?.('role')==='slider') return;
      switch(e.key){
        // En un botón enfocado, el espacio es de ese botón (subtítulos, ajustes…).
        case ' ': if(tag==='BUTTON'||tag==='A') return; e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); skip(-10); break;
        case 'ArrowRight': e.preventDefault(); skip(10); break;
        case 'ArrowUp': e.preventDefault(); changeVolume(Math.min(1,volume+0.1)); break;
        case 'ArrowDown': e.preventDefault(); changeVolume(Math.max(0,volume-0.1)); break;
        // Transmitiendo no se entra a pantalla completa (el video está en la TV).
        case 'f': case 'F': if(!tv) toggleFS(); break;
        case 'm': case 'M': toggleMute(); break;
        case 'c': case 'C': toggleSubs(); break;
      }
    };
    document.addEventListener('keydown',handleKey);
    return()=>document.removeEventListener('keydown',handleKey);
  },[activeIA,playing,volume,muted,subsOn,duration,tv]);

  // Initialize SCORM when ready
  useEffect(()=>{
    if(!ready) return;
    scormInit();
    // pagehide además de beforeunload: en iOS Safari beforeunload muchas veces
    // no dispara. scormFinish es idempotente (LMSFinish repetido es inocuo).
    const handleUnload=()=>scormFinish();
    window.addEventListener("beforeunload",handleUnload);
    window.addEventListener("pagehide",handleUnload);
    return()=>{window.removeEventListener("beforeunload",handleUnload);window.removeEventListener("pagehide",handleUnload);};
  },[ready]);

  // Load progress: prefer server-saved (Moodle, cross-device), fall back to localStorage
  useEffect(()=>{
    if(!ready) return;
    try{
      let data=moodleGetSavedProgress();
      if(!data){
        const saved=localStorage.getItem(`iv_progress_${vimeoData.id}`);
        if(saved) data=JSON.parse(saved);
      }
      if(data){
        // Postergar el próximo autosave: en este mismo commit corre el efecto
        // de guardado con el estado TODAVÍA vacío (setCompleted es asíncrono)
        // y, sin esto, pisaba el progreso del servidor con {completed:[], t:0}.
        lastSaveRef.current=Date.now();
        if(data.completed){setCompleted(new Set(data.completed));data.completed.forEach(id=>triggered.current.add(id));}
        // Un avance viejo guardado más allá de una pendiente (de antes de la guardia,
        // o de un salto que ella no vio) se retoma EN la pendiente: restaurar en su
        // tiempo la frena por el seek. Si no, esa pregunta no aparecía más.
        const tRetomar=data.currentTime?tiempoAGuardar(data.currentTime,null,Infinity,interactions,new Set(data.completed||[])):0;
        if(tRetomar&&playerRef.current){
          // Optimista: si el video todavía no cargó, el estado ya queda en la
          // posición guardada y no se vuelve a guardar 0 al salir.
          marcarSaltoPropio(tRetomar,3000); // salto propio: la guardia no lo toca
          currentTimeRef.current=tRetomar;
          setCurrent(tRetomar);
          playerRef.current.setCurrentTime(tRetomar);
        }
      }
    }catch(e){}
    // En el mismo render que lo restaurado (React junta los dos cambios de estado).
    setAvanceListo(true);
  },[ready]);

  // El segundo del video que cuenta para el avance. Terminado (hasta el próximo play o
  // salto), 0: el video se queda en el final para la tarjeta de fin, pero lo que se
  // guardaba al terminar era 0 (volvía al principio) y la próxima vez la lección arranca
  // de nuevo, como antes. Con una pregunta abierta manda la pregunta (tiempoAGuardar).
  const tiempoDelAvance=(t)=>terminoRef.current?0:t;

  // Save progress to localStorage + Moodle + SCORM (throttled)
  useEffect(()=>{
    if(!ready||videoError) return;   // con el video caído, el tiempo no es confiable
    if(Date.now()-lastSaveRef.current<5000) return;
    lastSaveRef.current=Date.now();
    const tVideo=tiempoDelAvance(currentTime);
    const tGuardar=tiempoAGuardar(tVideo,activeIA,finRef.current,interactions,completed);
    const snapshot={completed:[...completed],currentTime:tGuardar,updatedAt:Date.now()};
    try{
      localStorage.setItem(`iv_progress_${vimeoData.id}`,JSON.stringify(snapshot));
    }catch(e){}
    moodleSaveProgress({completed:snapshot.completed,currentTime:tGuardar});
    scormSetTime(tVideo);
  },[completed,currentTime,ready,vimeoData.id,videoError,activeIA]);

  // Final progress save when leaving the page (sendBeacon survives unload)
  useEffect(()=>{
    if(!ready||videoError) return;
    const onUnload=()=>moodleSaveProgress({completed:[...completed],currentTime:tiempoAGuardar(tiempoDelAvance(currentTime),activeIA,finRef.current,interactions,completed)},true);
    window.addEventListener("pagehide",onUnload);
    return()=>window.removeEventListener("pagehide",onUnload);
  },[ready,completed,currentTime,videoError,activeIA]);

  // Red de seguridad (plan Bunny 0.4; la decisión, en src/respaldo.js). La llama el
  // manejador de 'error' del motor activo con un error fatal y devuelve true si se hace
  // cargo (sin cartel): guarda el avance, le avisa a respaldo.php (registra el salto con
  // su causa y confirma que hay sesión y que el sitio lo permite) y recarga ESTA carga
  // con ?origen=vimeo, que retoma del avance guardado. Si respaldo.php no confirma, el
  // cartel de siempre; con la sesión cerrada, el de la sesión ("Reintentar" recarga la
  // página entera).
  // 🔴 El avance se guarda sólo con lo restaurado ya en el estado (avanceListo): un 404
  // del playlist llega ANTES de ready, con el tiempo en 0 y sin respondidas, y guardar
  // eso pisaba el avance del alumno en el servidor. Sin guardar, la carga con Vimeo
  // retoma del que ya estaba.
  respaldoRef.current=(e)=>{
    const ctx=window.MOODLE_CONTEXT||null;
    const causa=decidirRespaldo({
      error:e, respaldoUrl:ctx&&ctx.respaldoUrl,
      transmitiendo:!!tvRef.current||!!(playerRef.current&&playerRef.current.esTV),
      intentado:respaldoIntentadoRef.current, enRespaldo:yaEsRespaldo(window.location.href),
    });
    if(!causa) return false;
    respaldoIntentadoRef.current=true;
    setRespaldando(true);
    const avance=avanceListo?{completed:[...completed],currentTime:tiempoAGuardar(tiempoDelAvance(currentTimeRef.current),activeIA,finRef.current,interactions,completed)}:null;
    // Con tope: si el guardado tarda, queda en la cola (la carga siguiente lo manda).
    const guardado=avance?Promise.race([moodleGuardarAvanceYa(avance).catch(()=>false),new Promise(r=>setTimeout(()=>r(false),GUARDAR_AVANCE_MS))]):Promise.resolve(true);
    const aviso=pedirRespaldo({url:ctx.respaldoUrl,cmid:ctx.cmid,sesskey:ctx.sesskey,...datosDelError(e,causa)});
    Promise.all([guardado,aviso]).then(([,r])=>{
      if(r.ok){ window.location.replace(urlDeRespaldo(window.location.href)); return; }
      setRespaldando(false);
      setVideoError(r.motivo==='sesion'?{fatal:true,tipo:'acceso',code:null,renovacion:'sesion',message:e.message}:e);
    });
    return true;
  };

  // Report completion when the video ends with every interaction done
  // (covers videos with zero interactions and progress restored from a
  // previous session, where dismiss() never fires).
  useEffect(()=>{
    if(!videoEnded) return;
    const pending=interactions.filter(ia=>ia.type!=="label"&&!completed.has(ia.id));
    if(pending.length===0) scormSetComplete();
  },[videoEnded,completed,interactions]);

  // Con el menú de Ajustes abierto los controles no se ocultan: el menú cuelga del
  // engranaje y se desvanecía con la barra (lo hacía el viejo menú de velocidad).
  // Lo mismo con el glosario abierto.
  const resetCtrl = useCallback(()=>{
    setShowCtrl(true); clearTimeout(ctrlTimer.current);
    if(playing&&!activeIA&&!menuRef.current&&!glosarioRef.current) ctrlTimer.current=setTimeout(()=>setShowCtrl(false), fakeFS?2500:3000);
  },[playing,activeIA,fakeFS]);

  // Auto-hide controls when playing starts or fullscreen changes
  useEffect(()=>{
    if(playing&&!activeIA&&!menu&&!glosarioAbierto){
      clearTimeout(ctrlTimer.current);
      ctrlTimer.current=setTimeout(()=>setShowCtrl(false), fakeFS?2500:3000);
    } else {
      setShowCtrl(true);
      clearTimeout(ctrlTimer.current);
    }
    return()=>clearTimeout(ctrlTimer.current);
  },[playing,activeIA,fakeFS,menu,glosarioAbierto]);

  // ─── Menú de Ajustes ───────────────────────────────────────────
  // Transmitiendo no se ofrece Calidad: la elige la TV (ABR del receptor o del
  // Apple TV). Con AirPlay el <video> todavía tendría la lista: se oculta igual.
  const hayCalidad=calidades.length>=2&&!calidadNoDisponible&&!tv;
  const altoElegido=hayCalidad&&calidad!=='auto'?(calidades.find(q=>q.id===calidad)?.alto||parseInt(calidad,10)||0):0;
  // Botón de la TV: SIEMPRE con video propio (pedido de Erick, oct-2026). Antes
  // aparecía sólo con una TV a la vista, y si la detección fallaba (Android preguntando
  // con la Presentation API, iPhone sin watchAvailability) el alumno no tenía ni el
  // botón ni una pista de por qué. Ahora al tocarlo se abre el selector del sistema o
  // un aviso que explica qué pasa. Con Vimeo no se ofrece nada.
  const tvBoton=!!nativeSrc;
  // Transmitiendo no hay botón de pantalla completa (ni de girar), salvo que siga
  // en pantalla completa: ahí el de SALIR no se esconde nunca.
  const fsVisible=!tv||isFS||fakeFS;
  // Sin el de pantalla completa sobra lugar: el de la TV entra también a ≤340 px.
  const tvSiempre=!!tv&&!(isFS||fakeFS);
  // En la pantalla completa NATIVA el wrapper es el elemento :fullscreen y la regla del
  // navegador (transform:none, inset:0, width/height:100% !important) anula el giro:
  // el video no giraba y fraccionX leía la barra por la altura del dedo (iPad, tablets).
  // Se mira el documento PROPIO: en el campus la madre manda isFS:true también ahí.
  const fsNativo=!!(document.fullscreenElement||document.webkitFullscreenElement);
  // Botón de girar: pantalla completa simulada con el celular parado.
  const girarVisible=(isFS||fakeFS)&&vertical&&!bloqueoOk&&!fsNativo&&!tv;
  // 🔴 Con el de girar en la fila, el corte del botón de la TV sube de 340 a 372 px:
  // entre 341 y ~365 vuelven el total y el contador, y el de la TV recortaba el de
  // SALIR de pantalla completa (iPhone parado en el campus, con subtítulos y
  // Reiniciar). El mismo corte que .con-girar en styles.css.
  const anchoTvEnMenu=girarVisible?372:340;
  const etiquetaTV=tv?.tipo==='cast'?(tv.estado==='conectando'?'Cancelar la conexión con la TV':'Dejar de transmitir')
    :tv?.tipo==='airplay'?'Dejar de transmitir o elegir otra TV':'Transmitir a la TV';
  const tituloMenu=menu==='calidad'?'Calidad':menu==='velocidad'?'Velocidad':menu==='destinoTV'?'Transmitir a la TV':'Ajustes';
  const etiquetaAuto=calidadViendo?`Automática (${calidadViendo}p)`:'Automática';
  const etiquetaCalidad=calidad==='auto'?etiquetaAuto:(calidades.find(q=>q.id===calidad)?.label||calidad);
  // Marca chica sobre el engranaje (no ocupa ancho en la fila): la velocidad si no
  // es la normal —antes se leía en el botón "1x"— o HD si se fijó una calidad alta.
  const marcaAjustes=speed!==1?`${speed}x`:(altoElegido>=720?'HD':'');
  // A dónde va el foco al abrir o cambiar de vista: sólo si ya estaba en el menú o
  // en el engranaje (teclado, o el clic de escritorio, que enfoca el botón). En un
  // celular el toque no enfoca nada y así se queda.
  const irAMenu=(m)=>{
    const a=document.activeElement;
    moverFocoMenuRef.current=!!a&&(a===ajustesBtnRef.current||!!ajustesPanelRef.current?.contains(a));
    setMenu(m);
  };
  const cerrarMenu=(devolverFoco)=>{
    const a=document.activeElement;
    const enMenu=!!a&&(!!ajustesPanelRef.current?.contains(a));
    setMenu(null);
    if(devolverFoco||enMenu){ try{ ajustesBtnRef.current?.focus({preventScroll:true}); }catch(e){} }
  };
  const cerrarMenuRef=useRef(cerrarMenu);
  cerrarMenuRef.current=cerrarMenu;
  const toggleAjustes=()=>{
    if(menuRef.current){ cerrarMenu(true); return; }
    // Con una pregunta abierta, no: el menú quedaba encima de la tarjeta (con
    // teclado se llegaba al engranaje; ahora los controles están inert, ver abajo).
    if(activeIARef.current||tarjetaFinRef.current||videoError) return;
    refrescarCalidadesRef.current();
    // Reproductor angosto (≤340 px, o ≤372 con el botón de girar: el mismo corte de
    // los container query ivc): el botón de la TV no entra en la fila sin recortar el
    // de pantalla completa, y va acá.
    const ancho=containerRef.current?containerRef.current.clientWidth:Infinity;
    const enMenu=tvBoton&&!tvSiempre&&ancho<=anchoTvEnMenu;
    setTvEnMenu(enMenu);
    if(glosarioRef.current) setGlosarioAbierto(false);
    // Siempre en la vista principal: ahí están también "Sonidos de aviso" y "Vibración"
    // (antes, sin calidades ni TV en el menú, se abría directo en Velocidad).
    irAMenu('principal');
  };
  useEffect(()=>{
    if(!menu) return;
    const panel=ajustesPanelRef.current; if(!panel) return;
    // Si el panel no entra entero (reproductor bajo, o un video con muchas
    // calidades), la opción elegida a la vista, también con el dedo o el mouse:
    // "Automática", que va al final, quedaba tapada justo cuando es la tildada. A
    // mano y no con scrollIntoView, que además desplaza la página del campus.
    const activa=panel.querySelector('[aria-pressed="true"]');
    if(activa&&panel.scrollHeight>panel.clientHeight+1){
      const arriba=activa.offsetTop, abajo=arriba+activa.offsetHeight;   // relativos al panel (su offsetParent)
      if(abajo>panel.scrollTop+panel.clientHeight) panel.scrollTop=abajo-panel.clientHeight+6;
      else if(arriba<panel.scrollTop) panel.scrollTop=Math.max(0,arriba-6);
    }
    if(!moverFocoMenuRef.current) return;
    const destino=activa||panel.querySelector('.iv-ajustes-fila, .iv-ajustes-opcion');
    try{ destino?.focus({preventScroll:true}); }catch(e){}
  },[menu]);
  // Un toque o clic afuera lo cierra. La capa de toques no: lo cierra ella misma
  // y SIN pausar (ver handleTouchEnd / handleClickLayer).
  useEffect(()=>{
    if(!menu) return;
    const h=(e)=>{
      const t=e.target;
      if(ajustesPanelRef.current?.contains(t)||ajustesBtnRef.current?.contains(t)) return;
      if(t?.classList?.contains('iv-click-layer')) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown',h,true);
    return()=>document.removeEventListener('pointerdown',h,true);
  },[menu]);
  // Una pregunta o un error tapan todo: el menú no queda abierto debajo.
  useEffect(()=>{ if(activeIA||videoError) setMenu(null); },[activeIA,videoError]);

  // Preferencias del alumno (Ajustes): se guardan en su navegador. Al prenderlas, una
  // muestra (dentro del toque, que además desbloquea el sonido). Con el video en
  // silencio la muestra del sonido tampoco suena (ver comoAvisar): el toque igual lo
  // desbloquea, así suena al quitar el silencio.
  const cambiarSonido=(v)=>{
    setSonidoOn(v); sonidoOnRef.current=v;
    guardarPreferencia(CLAVE_SONIDO,v,almacenLocal());
    if(v){ sonidosRef.current.desbloquear(); if(comoAvisar('suave',{sonido:true,silenciado:silencioRef.current}).suena) sonidosRef.current.plopSuave(); }
  };
  const cambiarVibracion=(v)=>{
    setVibraOn(v); vibraOnRef.current=v;
    guardarPreferencia(CLAVE_VIBRACION,v,almacenLocal());
    if(v){ sonidosRef.current.desbloquear({audio:sonidoOnRef.current}); sonidosRef.current.vibrar(VIBRA_TIC); }
  };

  // ─── Glosario: el panel ────────────────────────────────────────
  // Encima del video, adentro del contenedor (así vale en pantalla completa, en el
  // iframe del campus y en hub-app): lateral derecho si el reproductor es ancho, hoja
  // de abajo si es angosto (ver .iv-glosario-capa en styles.css). Se cierra con la X,
  // Escape o tocando afuera; una pregunta o un error lo cierran. `enfocar`: el id del
  // término a mostrar abierto (el del aviso "Nuevo en el glosario").
  const listaGlosario=useMemo(()=>conGlosario?entradasDelGlosario({interactions,nombrados,completed}):[],[conGlosario,interactions,nombrados,completed]);
  const abrirGlosario=(enfocar)=>{
    if(activeIARef.current||tarjetaFinRef.current||videoError) return;
    if(menuRef.current) setMenu(null);
    clearTimeout(avisoGlosarioTimer.current);
    setAvisoGlosario(null);
    if(enfocar) setExpandidos(s=>new Set([...s,enfocar]));
    // El foco va al panel sólo si venía del botón (teclado, o el clic de escritorio) o
    // desde el aviso; un toque en el botón no enfoca nada y así se queda.
    const a=document.activeElement;
    moverFocoGlosarioRef.current=!!enfocar||(!!a&&a===glosarioBtnRef.current);
    enfocarTerminoRef.current=enfocar||null;
    setGlosarioAbierto(true);
  };
  const cerrarGlosario=(devolverFoco)=>{
    const a=document.activeElement;
    const adentro=!!a&&!!glosarioPanelRef.current?.contains(a);
    setGlosarioAbierto(false);
    if(devolverFoco||adentro){ try{ glosarioBtnRef.current?.focus({preventScroll:true}); }catch(e){} }
  };
  const cerrarGlosarioRef=useRef(cerrarGlosario);
  cerrarGlosarioRef.current=cerrarGlosario;
  const alternarTermino=(id)=>setExpandidos(s=>{ const x=new Set(s); if(x.has(id)) x.delete(id); else x.add(id); return x; });
  useEffect(()=>{
    if(!glosarioAbierto) return;
    const panel=glosarioPanelRef.current; if(!panel) return;
    const id=enfocarTerminoRef.current;
    enfocarTerminoRef.current=null;
    // El término del aviso, a la vista (a mano y no con scrollIntoView, que además
    // desplaza la página del campus).
    const fila=id!=null?[...panel.querySelectorAll('[data-termino]')].find(el=>el.dataset.termino===id):null;
    const lista=panel.querySelector('.iv-glosario-lista');
    if(fila&&lista&&lista.scrollHeight>lista.clientHeight+1){
      const arriba=fila.offsetTop, abajo=arriba+fila.offsetHeight;   // relativos a la lista (position: relative)
      if(abajo>lista.scrollTop+lista.clientHeight) lista.scrollTop=abajo-lista.clientHeight+6;
      else if(arriba<lista.scrollTop) lista.scrollTop=Math.max(0,arriba-6);
    }
    if(!moverFocoGlosarioRef.current) return;
    moverFocoGlosarioRef.current=false;
    const destino=(fila&&fila.querySelector('button'))||panel.querySelector('.iv-glosario-termino button, .iv-glosario-cerrar');
    try{ destino?.focus({preventScroll:true}); }catch(e){}
  },[glosarioAbierto]);
  // Un toque o clic afuera lo cierra (como el menú). La capa de toques lo cierra ella
  // misma y SIN pausar (handleTouchEnd / handleClickLayer); el botón y el aviso, también.
  useEffect(()=>{
    if(!glosarioAbierto) return;
    const h=(e)=>{
      const t=e.target;
      if(glosarioPanelRef.current?.contains(t)||glosarioBtnRef.current?.contains(t)) return;
      if(t?.closest?.('.iv-glosario-aviso')) return;
      if(t?.classList?.contains('iv-click-layer')) return;
      // 🔴 El botón de reproducir decide él: si cerrar retomara el video que pausó el
      // glosario, el clic que viene detrás lo encontraba andando y lo pausaba. También
      // el GRANDE (a la vista si, pausado por el glosario, el celular se acuesta y el
      // panel pasa al costado): al retomar desaparece bajo el dedo y el clic del toque
      // caía en la capa de toques, que lo volvía a pausar.
      if(playBtnRef.current?.contains(t)||t?.closest?.('.iv-big-play')) pausaGlosarioRef.current=false;
      setGlosarioAbierto(false);
    };
    document.addEventListener('pointerdown',h,true);
    return()=>document.removeEventListener('pointerdown',h,true);
  },[glosarioAbierto]);
  useEffect(()=>{ if(activeIA||videoError){ setGlosarioAbierto(false); setAvisoGlosario(null); } },[activeIA,videoError]);
  useEffect(()=>()=>{ clearTimeout(avisoGlosarioTimer.current); clearTimeout(anuncioPanelTimer.current); },[]);

  const togglePlay=()=>{
    const p=playerRef.current;if(!p||!ready)return;
    // 🔴 Una pausa del alumno con el glosario abierto es suya: cerrarlo no la retoma. No
    // alcanza con el pointerdown sobre Reproducir: el toque en el costado del video
    // pausa 300 ms DESPUÉS (por si viene el doble toque), y si en ese rato se abrió el
    // glosario, esta pausa llega con el panel ya abierto y sin pasar por ahí.
    if(playing){playIntentRef.current=null;pausaGlosarioRef.current=false;p.pause();return;}
    // El play es EL gesto: ahí se crea (o se reanuda) el sonido de los avisos.
    sonidosRef.current.desbloquear({audio:sonidoOnRef.current});
    // Terminado, el video quedó en el final (la tarjeta de fin): play es volver a empezar.
    if(terminoRef.current) volverAEmpezar(); else safePlay();
    // Reintentar desmuteo dentro del MISMO gesto del usuario: si el navegador
    // forzó arranque muteado (iframe anidado en Moodle), este es el único
    // momento con activación válida para levantar el silencio.
    if(!muted){
      if(p.setMuted) p.setMuted(false).catch(()=>{});
      p.setVolume(volume||1).catch(()=>{});
    }
  };
  // Los comandos del SDK de Vimeo viajan por postMessage y NO se garantizan
  // entre sí: reproducido en pruebas, un play() cerca de un seek pendiente se
  // pierde (queda "congelado" en pausa) y un setCurrentTime justo antes de un
  // play se traga (la barra muestra el destino pero el video sigue donde
  // estaba). En móvil, con roundtrips más lentos, la ventana es mayor.
  // Estrategia: serializar seeks + verificar el resultado y reintentar una vez.
  const seekBusyRef=useRef(false);
  const seekNextRef=useRef(null);
  const seekTargetRef=useRef(null); // último destino pedido; null si no hay seek pendiente
  // Hasta cuándo, y A DÓNDE, un salto se considera propio (la guardia de saltos no
  // lo toca): cubre el tick tardío del medio después de que el seek ya resolvió.
  // 🔴 El destino importa tanto como el reloj: con sólo la ventana de tiempo, un
  // salto EXTERNO que llegaba en esos 1,5 s (3 s después de restaurar) —pantalla
  // de bloqueo, auriculares, Vimeo— pasaba sin guardia y salteaba preguntas. Un
  // tick que cae lejos del destino pedido es externo aunque llegue en la ventana.
  const seekPropioHastaRef=useRef(0);
  const seekPropioDestinoRef=useRef(null);
  const marcarSaltoPropio=(t,ms)=>{ seekPropioHastaRef.current=Date.now()+ms; seekPropioDestinoRef.current=t; };
  const seekTo=useCallback((t)=>{
    const p=playerRef.current;if(!p)return;
    terminoRef.current=false; // saltar después del final vuelve a ser ver el video
    resetHastaRef.current=0;  // un salto pedido termina el filtro de Reiniciar: sus ticks son los buenos
    marcarSaltoPropio(t,1500);
    seekTargetRef.current=t;
    if(seekBusyRef.current){seekNextRef.current=t;return;}
    seekBusyRef.current=true;
    p.setCurrentTime(t).catch(()=>{}).then(()=>p.getCurrentTime().catch(()=>t)).then(actual=>{
      seekBusyRef.current=false;
      if(seekNextRef.current!=null){const n=seekNextRef.current;seekNextRef.current=null;seekTo(n);return;}
      seekTargetRef.current=null;
      // Verificación: si Vimeo se tragó el seek, re-emitirlo UNA vez.
      if(Math.abs(actual-t)>1.5) p.setCurrentTime(t).catch(()=>{});
      const q=calidadPendienteRef.current;
      if(q!=null){ calidadPendienteRef.current=null; aplicarCalidadRef.current(q); }
    });
  },[]);
  // Watchdog de play: si el play se pierde (carrera con un seek), verificar el
  // estado real a los 700ms y reintentar una vez. El intent se invalida al
  // pausar para no "revivir" un video que el usuario o una interacción pausó.
  const playIntentRef=useRef(null);
  // true desde 'ended' hasta el próximo play o seek. No sirve videoEnded: ese
  // estado sólo vuelve a false al reiniciar, y en una segunda vista dejaría el
  // video frenado después de cada respuesta.
  const terminoRef=useRef(false);
  const resetHastaRef=useRef(0); // tras Reiniciar: hasta cuándo descartar timeupdate viejos
  const safePlay=useCallback(()=>{
    const p=playerRef.current;if(!p)return;
    const intent=Symbol();
    playIntentRef.current=intent;
    p.play().catch(()=>{});
    setTimeout(()=>{
      if(playIntentRef.current!==intent)return;
      Promise.all([p.getPaused(),p.getCurrentTime()]).then(([paused,t])=>{
        if(!paused||playIntentRef.current!==intent) return;
        // Pausado EN el fin = terminó. Vimeo a veces contesta paused=true antes
        // de mandar 'ended' (y hasta antes del tick final): un play() acá lo
        // relanzaba desde 0 al responder una pregunta a ~1 s del final.
        if(Math.max(t,currentTimeRef.current)>=finRef.current-0.3) alTerminarRef.current();
        else p.play().catch(()=>{});
      }).catch(()=>{});
    },700);
  },[]);

  // ─── El panel que tapa el video (decisión de Erick, 19-oct-2026) ──────
  // Si al abrirse el glosario tapa más del 70 % del video (el reproductor bajo: el iframe
  // del campus o la pantalla completa con el celular parado), lo pausa; al cerrarse lo
  // retoma, sólo si nada más lo frenó o lo tomó en el medio (src/glosario.js:
  // pausarAlAbrir y reanudarAlCerrar). Transmitiendo a la TV, nunca: ahí el video está en
  // la TV. Se mide al abrir, ANTES de pintar, en coordenadas del contenedor (offset*: no
  // las mueve el giro de 90° ni la animación de entrada); el área del video es la del
  // contenedor, que siempre es 16:9 (la pantalla completa también lo centra).
  // 🔴 La pausa y la vuelta son las del botón (pause con el intent anulado, safePlay):
  // para el candado, los avisos, el avance y la firma es una pausa más del alumno.
  // Lo último que se midió con el panel abierto (ver el ResizeObserver de abajo).
  const tapaGlosarioRef=useRef(0);
  const medirTapaGlosario=()=>{
    const panel=glosarioPanelRef.current, capa=panel&&panel.parentElement;
    return panel&&capa?cobertura(
      {x:panel.offsetLeft,y:panel.offsetTop,ancho:panel.offsetWidth,alto:panel.offsetHeight},
      {x:0,y:0,ancho:capa.clientWidth,alto:capa.clientHeight}):0;
  };
  const transmitiendoAhora=()=>{ const p=playerRef.current; return !!tvRef.current||!!(p&&p.esTV); };
  const pausarSiTapa=(tapa)=>{
    const p=playerRef.current;
    if(p&&pausarAlAbrir({reproduciendo:playingRef.current,transmitiendo:transmitiendoAhora(),cobertura:tapa})){
      pausaGlosarioRef.current=true;
      playIntentRef.current=null;
      p.pause();
    }
  };
  useLayoutEffect(()=>{
    if(glosarioAbierto){
      const tapa=medirTapaGlosario();
      tapaGlosarioRef.current=tapa;
      pausarSiTapa(tapa);
      return;
    }
    // La tarjeta de fin cuenta como una pregunta: lo cerró ella y el video terminó.
    const volver=reanudarAlCerrar({pausoElGlosario:pausaGlosarioRef.current,
      pregunta:!!(activeIA||activeIARef.current||tarjetaFinRef.current),error:!!videoError,transmitiendo:transmitiendoAhora()});
    pausaGlosarioRef.current=false;
    if(volver) safePlay();
  },[glosarioAbierto]);
  // 🔴 Con el panel abierto el reproductor puede cambiar de tamaño sin que nadie toque
  // nada: el celular que se para con el glosario abierto (acostado iba al costado y el
  // video seguía; parado, en el iframe del campus, el panel tapa todo) o la pantalla
  // completa que se cierra con el atrás del sistema. Medir sólo al abrir dejaba el video
  // corriendo debajo, que es lo que se quería evitar. Si PASA a tapar, vale lo mismo que
  // al abrirlo (pasoATapar); si deja de tapar, no se retoma: eso lo hace cerrar el panel.
  useEffect(()=>{
    if(!glosarioAbierto||typeof ResizeObserver!=='function') return;
    const capa=glosarioPanelRef.current?.parentElement; if(!capa) return;
    const ro=new ResizeObserver(()=>{
      const antes=tapaGlosarioRef.current, ahora=medirTapaGlosario();
      tapaGlosarioRef.current=ahora;
      if(pasoATapar(antes,ahora)) pausarSiTapa(ahora);   // sólo usa refs: vale la de este render
    });
    ro.observe(capa);
    return()=>ro.disconnect();
  },[glosarioAbierto]);
  const skip=(seconds)=>{
    const p=playerRef.current;if(!p||!ready)return;
    soltarFinRef.current();   // ±10 s de la pantalla de bloqueo con la tarjeta de fin abierta
    // Base del salto, SIN await (el roundtrip de getCurrentTime hacía que dos
    // taps rápidos de ±10s calcularan ambos desde el tiempo viejo y colapsaran
    // en un solo salto): el destino del seek pendiente si lo hay (así dos taps
    // encadenan ±20s), o el último tiempo real reportado por Vimeo vía ref
    // (los atajos de teclado capturan un currentTime de closure viejo).
    const now=seekTargetRef.current!=null?seekTargetRef.current:currentTimeRef.current;
    // Sin duración todavía (iOS antes del primer toque), Math.min(0, …) mandaba
    // siempre a 0 y pisaba la posición restaurada.
    const tope=duration>0?duration:Infinity;
    let targetTime=Math.max(0,Math.min(tope,now+seconds));
    if(seconds>0){
      // Las "label" no bloquean (nunca entran a completed): no frenan el skip.
      const next=interactions.filter(ia=>ia.type!=="label"&&!completed.has(ia.id)&&ia.time>now&&ia.time<=targetTime).sort((a,b)=>a.time-b.time)[0];
      if(next) targetTime=next.time;
    }
    setCurrent(targetTime); // optimista, igual que el scrub
    seekTo(targetTime);
  };
  // Salto pedido desde afuera (clic en una línea de la transcripción): las mismas
  // reglas que la barra. Hacia adelante no pasa una pregunta pendiente: frena en
  // ella y la muestra. Con una pregunta abierta no hace nada (primero se responde).
  seekExternoRef.current=(t,{sinPlay=false}={})=>{
    const p=playerRef.current;
    if(!p||!ready||activeIARef.current||!Number.isFinite(t)) return;
    // Con la tarjeta de fin abierta, ir a una línea de la transcripción es volver al video.
    soltarFinRef.current();
    const now=seekTargetRef.current!=null?seekTargetRef.current:currentTimeRef.current;
    // Nunca dentro del último medio segundo: un salto al final terminaba el video
    // con el <video> nativo y Vimeo lo perdía en silencio. Fin real si ya se conoce.
    const fin=finRef.current<Infinity?finRef.current:(duration>0?duration:Infinity);
    let targetTime=Math.max(0,Math.min(fin-0.5,t));
    let frena=false;
    if(targetTime>now){
      const next=interactions.filter(ia=>ia.type!=="label"&&!completed.has(ia.id)&&ia.time>now&&ia.time<=targetTime).sort((a,b)=>a.time-b.time)[0];
      if(next){ targetTime=next.time; frena=true; }
    }
    setCurrent(targetTime);
    seekTo(targetTime);
    // Como antes (saltar y seguir), salvo que caiga en una pregunta: la frena el efecto.
    // Desde la pantalla de bloqueo no: el sistema salta y deja el video como estaba
    // (en pausa, si estaba en pausa); con video propio el seek no corta la reproducción.
    if(!frena&&!sinPlay) safePlay();
  };
  const skipRef=useRef(null);
  skipRef.current=skip;
  // Pantalla de bloqueo, Centro de control y auriculares (Media Session): con
  // video propio, sus saltos pasan por skip/seekExterno, que respetan el candado.
  // Sin handlers, iOS salta ±15 s directo sobre el medio (para eso queda además
  // la guardia del efecto de disparo). Con una pregunta abierta no hacen nada.
  useEffect(()=>{
    if(!nativeSrc||!('mediaSession' in navigator)) return;
    const ms=navigator.mediaSession;
    const poner=(accion,fn)=>{ try{ ms.setActionHandler(accion,fn); }catch(e){} };
    try{ if(window.MediaMetadata) ms.metadata=new window.MediaMetadata({title:title||'Video'}); }catch(e){}
    poner('seekbackward',d=>{ if(!activeIARef.current) skipRef.current?.(-((d&&d.seekOffset)||10)); });
    poner('seekforward',d=>{ if(!activeIARef.current) skipRef.current?.((d&&d.seekOffset)||10); });
    poner('seekto',d=>{ if(d&&typeof d.seekTime==='number') seekExternoRef.current?.(d.seekTime,{sinPlay:true}); });
    return()=>{ ['seekbackward','seekforward','seekto'].forEach(a=>poner(a,null)); };
  },[nativeSrc,title]);

  // ─── Transmitir a la TV ────────────────────────────────────────
  // Dos caminos con UN botón:
  //  - AirPlay (Safari/iPhone con HLS nativo): el <video> sigue siendo el dueño y
  //    la TV es sólo a dónde sale la imagen. El candado no cambia en nada.
  //  - Chromecast (Chrome/Edge de escritorio y Android): la TV baja el video sola.
  //    playerRef pasa a un adaptador (CastPlayer) con la MISMA forma que el <video>,
  //    que emite lo que pasa en la TV; el <video> espera en pausa (localPlayerRef).
  //    Así debeFrenar, la guardia, el freno de 'play' y tiempoAGuardar no cambian.
  // Con Vimeo no se ofrece nada.
  useEffect(()=>{ tvRef.current=tv; },[tv]);
  const avisarTVRef=useRef(null);
  avisarTVRef.current=(txt)=>{
    clearTimeout(tvAvisoTimer.current);
    setTvAviso(txt);
    tvAvisoTimer.current=setTimeout(()=>setTvAviso(''),5000);
  };

  // El SDK de Cast (~90 KB) se baja con el reproductor listo, en un rato libre (no
  // compite con el primer segmento), sólo donde existe (ver cargarCast) y sólo si el
  // navegador ve una TV con Cast en la red (ver cuandoHayaTV): sin TV, ni un pedido
  // a Google. Si la TV aparece después, se baja en ese momento.
  const alCambiarSesionCastRef=useRef(()=>{});
  useEffect(()=>{
    if(!ready||!nativeSrc) return;
    let vivo=true, quitar=null, soltarVigia=null;
    const conectarContexto=()=>cargarCast().then(ok=>{
      if(!vivo||!ok) return;
      let ctx=null;
      try{ ctx=contextoCast(castAppId); }catch(e){ ctx=null; }
      if(!ctx||!vivo) return;
      castCtxRef.current=ctx;
      quitar=observarCast(ctx,{
        onDisponible:(d)=>setTvDisp(x=>x.cast===d?x:{...x,cast:d}),
        onSesion:(estado,sesion,error)=>alCambiarSesionCastRef.current(estado,sesion,error),
      });
    });
    const arrancar=()=>{ if(vivo) soltarVigia=cuandoHayaTV(castAppId,conectarContexto); };
    const idle=typeof window.requestIdleCallback==='function';
    const id=idle?window.requestIdleCallback(arrancar,{timeout:3000}):setTimeout(arrancar,1500);
    return()=>{ vivo=false; if(soltarVigia) soltarVigia(); if(quitar) quitar(); if(idle) window.cancelIdleCallback(id); else clearTimeout(id); };
  },[ready,nativeSrc]);

  // 🔴 "Cancelar la conexión con la TV" mientras la app arranca en la TV
  // (SESSION_STARTING): endCurrentSession no hace nada todavía (el SDK recién tiene
  // la sesión en SESSION_STARTED), así que la TV igual recibía el video y el celular
  // se pausaba, contra lo que pidió el alumno. Se marca acá y se corta al llegar.
  const cancelarCastRef=useRef(false);
  // 🔴 Un rechazo de requestSession o un SESSION_START_FAILED puede llegar mientras la TV
  // todavía abre la app y carga el video, y la conexión termina bien igual: en un
  // Android real aparecía "No se pudo conectar con la TV" con la TV cargando (prueba de
  // Erick, oct-2026). Ahora el fallo se confirma unos segundos después, mirando lo que
  // dice el propio SDK: si sigue conectando, ya conectó o ya se transmite, no se avisa.
  const castSigueVivo=()=>{
    if(playerRef.current?.esTV) return true;
    try{
      const CS=window.cast.framework.CastState;
      const st=castCtxRef.current&&castCtxRef.current.getCastState();
      return st===CS.CONNECTING||st===CS.CONNECTED;
    }catch(e){ return false; }
  };
  const avisarFalloCast=(texto,origen)=>{
    try{ (window.__ivCastDiag=window.__ivCastDiag||{}).error=origen; }catch(e){}
    setTimeout(()=>{
      if(castSigueVivo()) return;
      setTv(x=>x&&x.tipo==='cast'&&!playerRef.current?.esTV?null:x);
      avisarTVRef.current(texto);
    },3500);
  };
  alCambiarSesionCastRef.current=(estado,sesion,error)=>{
    const SS=(window.cast&&window.cast.framework&&window.cast.framework.SessionState)||{};
    const transmitiendo=!!playerRef.current?.esTV;
    if(estado===SS.SESSION_STARTING){ if(!transmitiendo&&!cancelarCastRef.current) setTv({tipo:'cast',estado:'conectando',nombre:null}); }
    else if(estado===SS.SESSION_STARTED){
      if(cancelarCastRef.current){
        cancelarCastRef.current=false;
        try{ castCtxRef.current?.endCurrentSession(true); }catch(e){}
        return;
      }
      conectarCast(sesion,false);
    }
    else if(estado===SS.SESSION_RESUMED) conectarCast(sesion,true);
    else if(estado===SS.SESSION_START_FAILED){
      const cancelado=cancelarCastRef.current;
      cancelarCastRef.current=false;
      if(cancelado||!error||error==='cancel'){ if(!transmitiendo) setTv(null); return; }
      avisarFalloCast('No se pudo conectar con la TV.','START_FAILED '+error);
    }
    else if(estado===SS.SESSION_ENDED){
      cancelarCastRef.current=false;
      if(transmitiendo) volverALocalRef.current('sesion');
      else setTv(x=>x&&x.tipo==='cast'?null:x);
    }
  };

  // La TV toma la reproducción. `reanudada`: Chrome reenganchó una sesión que ya
  // existía (se recargó la lección, o se pasó a otra del mismo campus). Se adopta
  // sólo si la TV tiene ESTE video; si tiene otro no se toca, y el botón carga éste.
  const conectarCast=(sesion,reanudada)=>{
    // Si no se transmite, que no quede el "Conectando…" de SESSION_STARTING.
    const noSeTransmite=()=>{ if(!playerRef.current?.esTV) setTv(x=>x&&x.tipo==='cast'?null:x); };
    const actual=playerRef.current;
    if(!sesion||!actual||!nativeSrc||videoError) return noSeTransmite();
    if(actual.esTV){
      if(actual.session===sesion) return;
      volverALocalRef.current('sesion');
    }
    const local=playerRef.current;
    if(!local||local.esTV) return noSeTransmite();
    let adoptar=false;
    if(reanudada){
      // Con AirPlay andando (iPhone en la app), una sesión de Chromecast que la app
      // reanuda no se adopta: la TV de AirPlay es la que eligió el alumno.
      if(tvRef.current?.tipo==='airplay') return;
      const m=sesion.getMediaSession&&sesion.getMediaSession();
      const id=m&&m.media&&(m.media.contentId||m.media.contentUrl);
      if(!(m&&m.playerState!=='IDLE'&&mismoVideo(id,nativeSrc))) return noSeTransmite();
      adoptar=true;
    }
    // 🔴 La TV arranca REPRODUCIENDO aunque el celular estuviera en pausa, como YouTube:
    // quien elige una TV quiere verla ahí. Antes copiaba el estado del celular y, si se
    // tocaba el botón antes de dar play, la TV quedaba quieta en el primer cuadro y había
    // que volver a tocar (prueba de Erick con una TV real, oct-2026). Con una pregunta
    // abierta o el video terminado, en pausa.
    const seguia=!adoptar&&!activeIARef.current&&!terminoRef.current;
    // El segundo de arranque: el destino de un salto en vuelo, o donde está el
    // <video> AHORA (el último tick puede estar ~250 ms atrás; se pausa en este mismo
    // turno, más abajo). Con una pregunta abierta, el de la pregunta
    // (tiempoAGuardar), así la TV muestra ese cuadro.
    let t0=seekTargetRef.current!=null?seekTargetRef.current:(local.tiempo?local.tiempo():currentTimeRef.current);
    if(!Number.isFinite(t0)) t0=currentTimeRef.current;
    if(activeIARef.current) t0=tiempoAGuardar(t0,activeIARef.current,finRef.current);
    // Con el video terminado (quedó en el final para la tarjeta de fin), la TV carga el
    // principio, en pausa: lo mismo que cuando el celular volvía a 0 al terminar.
    else if(terminoRef.current&&!adoptar) t0=0;
    // Subtítulos en la TV: la pista con el VTT firmado (subtitlesUrlTv) y el estado del
    // botón; la TV los dibuja y el botón los prende y apaga ahí (setSubtitulos). Una sesión
    // adoptada trae los suyos (onSubtitulos). Sin cues propios (Vimeo, o sin archivo) no hay.
    const subsTv=typeof subtitlesUrlTv==='string'&&subtitlesUrlTv&&cuesRef.current&&cuesRef.current.length?subtitlesUrlTv:null;
    const ad=new CastPlayer(sesion,{
      src:nativeSrc, titulo:title, poster, inicio:t0, reproducir:seguia, velocidad:speed,
      duracion:finRef.current<Infinity?finRef.current:duration, adoptar, firma:firmaRef.current,
      subtitulos:subsTv, subtitulosActivos:subsOnRef.current,
      onSubtitulos:(on)=>{ if(playerRef.current===ad) setSubsOn(!!on); },
      onListo:()=>{ if(playerRef.current===ad) setTv(x=>x&&x.tipo==='cast'?{...x,estado:'conectado'}:x); },
      onFin:(motivo,est)=>{ if(playerRef.current===ad) volverALocalRef.current(motivo,est); },
    });
    // El watchdog de un play local en vuelo no tiene que relanzar el <video>.
    playIntentRef.current=null;
    localPlayerRef.current=local;
    suscribirRef.current(ad);
    // 🔴 ANTES de pausar el <video>: su 'pause' ya no le llega al componente. El
    // botón sigue diciendo lo que hace la TV (que arranca reproduciendo si seguía).
    playerRef.current=ad;
    // 🔴 Y el botón se pone YA en lo que va a hacer la TV. Una sesión reanudada (se
    // recargó la página transmitiendo) llega con la TV en pausa —pagehide la pausó—
    // y si el alumno había tocado play en el celular mientras Chrome la reenganchaba,
    // el botón quedaba en "Pausar" para siempre: cada toque llamaba pause() sobre una
    // TV ya quieta. Si la TV en realidad reproduce, su primer aviso emite 'play'.
    setPlaying(!ad.pausado());
    // El ícono del sonido dice lo que pasa en la TV, no en el celular: con el celular
    // silenciado, la TV sonaba y el ícono decía "Activar sonido" (el primer toque no
    // hacía nada). Al volver, el del <video> (ver volverALocal).
    ad.getMuted().then(m=>{ if(playerRef.current===ad) setMuted(!!m); }).catch(()=>{});
    try{ local.pause(); }catch(e){}
    if(local.detenerCarga) local.detenerCarga();
    setBuffering(false);
    setTv({tipo:'cast',estado:adoptar?'conectado':'conectando',nombre:nombreDelEquipo(sesion),subtitulos:ad.subtitulosEnTV()});
    setMenu(null);
    refrescarCalidadesRef.current();   // la calidad la elige la TV: el menú no la ofrece
  };

  // Vuelve al <video> en el segundo donde quedó la TV (el último tick del adaptador,
  // más fino que el savedPlayerState del SDK, que atrasa hasta 1 s). Como salto
  // PROPIO: ni la guardia ni debeFrenar lo leen como un salto de afuera. Si la TV
  // reproducía y no hay pregunta, sigue reproduciendo (si el navegador rechaza el
  // play, queda en pausa con el botón grande).
  const volverALocalRef=useRef(null);
  volverALocalRef.current=(motivo,est)=>{
    const ad=playerRef.current, local=localPlayerRef.current;
    if(!ad||!ad.esTV||!local) return;
    const t=est&&Number.isFinite(est.t)?est.t:ad.tiempo();
    const seguia=est?!!est.seguia:!ad.pausado();
    playIntentRef.current=null;
    playerRef.current=local;   // ANTES de destruirlo: lo que emita el adaptador ya no cuenta
    localPlayerRef.current=null;
    ad.destroy();
    setTv(null);
    setBuffering(false);
    refrescarCalidadesRef.current();
    // El ícono del sonido vuelve a ser el del <video>, que conservó el suyo.
    Promise.all([local.getVolume(),local.getMuted?local.getMuted():Promise.resolve(false)])
      .then(([v,m])=>{ if(playerRef.current===local) setMuted(!!m||v===0); }).catch(()=>{});
    if(errorLocalRef.current){ const e=errorLocalRef.current; errorLocalRef.current=null; setPlaying(false); setVideoError(e); return; }
    const fin=finRef.current<Infinity?finRef.current:(duration>0?duration:Infinity);
    const tt=Math.max(0,Math.min(t,fin-0.05));
    // El video ya había terminado en la TV (la tarjeta de fin, abierta o cerrada): sigue
    // terminado en el celular, y su play vuelve a empezar (seekTo lo daría por visto).
    const termino=terminoRef.current;
    marcarSaltoPropio(tt,3000);
    currentTimeRef.current=tt;
    setCurrent(tt);
    seekTo(tt);
    if(termino) terminoRef.current=true;
    if(seguia&&!activeIARef.current&&!terminoRef.current) safePlay();
    else setPlaying(false);
    if(motivo==='error') avisarTVRef.current('La TV no pudo reproducir el video. Sigue en esta pantalla.');
    else if(motivo!=='usuario') avisarTVRef.current('Se dejó de transmitir a la TV.');
  };

  // El botón "Transmitir a la TV" (o su fila en Ajustes).
  // 🔴 Todo dentro del toque y SIN await antes: el selector de Chrome
  // (PresentationRequest.start) y el de AirPlay (remote.prompt) exigen el gesto.
  const tocarTV=()=>{
    // También es un gesto: conectar la TV antes del primer play hace arrancar la TV sola
    // y, sin esto, los avisos de la primera interacción no sonaban ni vibraban hasta el
    // primer "Continuar". Sincrónico (no consume el toque que piden los selectores).
    sonidosRef.current.desbloquear({audio:sonidoOnRef.current});
    const p=playerRef.current;
    if(p&&p.esTV){
      // Dejar de transmitir. El <video> retoma ya, dentro del toque (el play vale
      // como gesto). 🔴 endCurrentSession(TRUE): con false la TV se desconecta pero
      // SIGUE reproduciendo, sin nadie que frene en las preguntas.
      volverALocalRef.current('usuario');
      try{ castCtxRef.current?.endCurrentSession(true); }catch(e){}
      return;
    }
    if(tv&&tv.tipo==='cast'){
      // Cancelar "Conectando…": la sesión todavía no existe y endCurrentSession no la
      // corta; se corta al llegar SESSION_STARTED (ver cancelarCastRef).
      cancelarCastRef.current=true;
      try{ castCtxRef.current?.endCurrentSession(true); }catch(e){}
      setTv(null);
      return;
    }
    const app=infoApp();
    const conAirPlay=!!(p&&p.transmitir&&p.airplayPosible&&p.airplayPosible());
    if(app.puente){
      // Modo app (hub-app): AirPlay sólo si la app lo declara ('airplay' en capacidades:
      // iPhone con allowsAirPlayForMediaPlayback). 🔴 No alcanza con airplayPosible(): la
      // marca de WebKit existe en cualquier WKWebView, y un iPhone en una casa con
      // Chromecast y sin Apple TV no llegaba nunca a Chromecast.
      const caps=app.capacidades||[];
      if(conAirPlay&&caps.includes('airplay')){
        // ¿Chromecast ya buscó y no encontró nada? (En iPhone la app dice NOT_CONNECTED
        // hasta la primera búsqueda, así que eso cuenta como "puede haber".)
        const sinCast=!caps.includes('cast')||estadoCastActual()==='NO_DEVICES_AVAILABLE';
        if(tvDisp.airplay&&!sinCast){ irAMenu('destinoTV'); return; }   // las dos: que elija
        if(tvDisp.airplay||sinCast){ transmitirAirPlay(p); return; }     // sólo AirPlay, o ninguna: lo dice el selector del sistema
        // Sin TV de AirPlay a la vista: directo a Chromecast (el primer toque es el que
        // dispara el permiso de red local en iPhone).
      }
      // iPhone con el saludo sin contestar todavía (sin capacidades): no se sabe si la app
      // permite AirPlay. Se vuelve a saludar y se decide con la respuesta (ver tocarCast).
      else if(conAirPlay&&!app.capacidades){ tocarCast(true); return; }
    } else if(conAirPlay){ transmitirAirPlay(p); return; }
    tocarCast();
  };
  const transmitirAirPlay=(p)=>{
    p.transmitir().then(ok=>{
      // prompt() rechaza sin TV; el selector webkit no avisa nada (ok=true).
      if(!ok&&tvRef.current==null&&!tvDisp.airplay) avisarTVRef.current('No encontramos una TV con AirPlay en esta Wi-Fi. Fijate que el celular y la TV estén en la misma red.');
    });
  };
  const estadoCastActual=()=>{
    try{
      const c=castCtxRef.current||(window.cast&&window.cast.framework&&window.cast.framework.CastContext.getInstance());
      return c?c.getCastState():null;
    }catch(e){ return null; }
  };
  // Textos de "no se puede transmitir". 🔴 "Actualizá la app" sólo con la casilla del
  // plugin prendida (MOODLE_CONTEXT.appCastPublicada: la versión con Chromecast ya está en
  // Play para todos), salvo error{version}, que con un solo protocolo hoy no pasa. Antes de
  // eso, al alumno con la app vieja no se le pide algo que todavía no existe.
  const textoAbrirEnNavegador=()=>{
    const nav=/iPhone|iPad|iPod/i.test(navigator.userAgent||'')?'Safari':'Chrome';
    let publicada=false;
    try{ publicada=window.MOODLE_CONTEXT?.appCastPublicada===true; }catch(e){}
    // "MoodleMobile" es también la app oficial de Moodle: el texto sirve para las dos.
    if(pareceApp()&&publicada) return `Para transmitir a la TV, abrí la lección en ${nav}. Si usás la app de Hub Education, actualizala.`;
    return `Para transmitir a la TV abrí la lección en ${nav}.`;
  };
  const textoSinCast=()=>{
    const app=infoApp();
    if(!app.puente) return 'Este navegador no puede transmitir a la TV. Probá con Chrome.';
    // Adentro de la app nada de "probá con Chrome": el teléfono no tiene Chromecast (sin
    // Google Play Services), o la app no contestó y el próximo toque vuelve a probar.
    if(app.motivo==='sin-cast') return 'Este teléfono no puede transmitir a Chromecast.';
    if(app.motivo==='version') return 'Para transmitir a la TV, actualizá la app de Hub Education.';
    return 'No se pudo preparar la transmisión. Probá de nuevo.';
  };
  // Chromecast: el selector de Chrome o, en la app, el nativo. `iphoneSinSaludo`: iPhone en
  // la app con el saludo todavía sin contestar (ver tocarTV).
  const tocarCast=(iphoneSinSaludo)=>{
    const ctx=castCtxRef.current;
    if(!ctx){
      if(!castPosible()){ avisarTVRef.current(textoAbrirEnNavegador()); return; }
      // El SDK todavía no está (en la compu se baja recién con una TV a la vista; en la
      // app, el saludo pudo no tener respuesta): se baja ahora y se abre el selector
      // apenas llega. Chrome deja abrirlo unos segundos después del toque; si ya venció,
      // se pide tocar de nuevo.
      avisarTVRef.current('Buscando TVs…');
      cargarCast().then(ok=>{
        if(!ok){ avisarTVRef.current(textoSinCast()); return; }
        let c=null;
        try{ c=contextoCast(castAppId); }catch(e){ c=null; }
        if(!c){ avisarTVRef.current('No se pudo preparar la transmisión. Probá de nuevo.'); return; }
        if(!castCtxRef.current){
          castCtxRef.current=c;
          observarCast(c,{
            onDisponible:(d)=>setTvDisp(x=>x.cast===d?x:{...x,cast:d}),
            onSesion:(estado,sesion,error)=>alCambiarSesionCastRef.current(estado,sesion,error),
          });
        }
        // iPhone: recién ahora se sabe si la app permite AirPlay. Con una TV de AirPlay a
        // la vista va el selector propio y no Chromecast directo: el gesto del toque ya
        // pasó y el de AirPlay (prompt) no se puede abrir solo, pero cada fila trae el suyo.
        // Si en la espera saltó una pregunta, el menú no va encima de la tarjeta: el toque
        // siguiente ya sabe las capacidades y decide como siempre.
        if(iphoneSinSaludo===true&&tvDisp.airplay&&(infoApp().capacidades||[]).includes('airplay')){
          if(activeIARef.current){ avisarTVRef.current('Tocá de nuevo el botón de la TV.'); return; }
          setTvAviso('');
          irAMenu('destinoTV');
          return;
        }
        pedirSesionCast(c,true);
      });
      return;
    }
    // Ya hay una sesión (la reenganchó Chrome con otra lección en la TV): cargar ésta
    // ahí mismo, sin selector.
    const s=ctx.getCurrentSession&&ctx.getCurrentSession();
    if(s){ conectarCast(s,false); return; }
    pedirSesionCast(ctx,false);
  };
  // Abre el selector de Chrome. diferido = el SDK se bajó después del toque.
  const pedirSesionCast=(ctx,diferido)=>{
    // Un pedido nuevo: lo que se haya cancelado antes ya no corre.
    cancelarCastRef.current=false;
    try{
      const r=ctx.requestSession();
      if(diferido) setTvAviso('');
      if(r&&r.catch) r.catch(err=>{
        const cancelado=cancelarCastRef.current;
        cancelarCastRef.current=false;
        if(playerRef.current?.esTV) return;
        // Canceló el alumno: se saca el "Conectando…" ya.
        if(cancelado||err==='cancel'){ setTv(x=>x&&x.tipo==='cast'?null:x); return; }
        const cod=String((err&&(err.code||err))||'');
        // Sin TV en la red el SDK no siempre devuelve receiver_unavailable: también se
        // mira el estado que informa el propio SDK.
        let sinTV=/receiver_unavailable/.test(cod);
        try{ sinTV=sinTV||ctx.getCastState()===window.cast.framework.CastState.NO_DEVICES_AVAILABLE; }catch(e){}
        // 🔴 Sin esto el "Conectando…" podía quedar fijo: el SDK sólo despacha
        // SESSION_START_FAILED si al pedir no había otra conexión en curso. Lo saca
        // avisarFalloCast, recién si la TV de verdad no conectó.
        avisarFalloCast(sinTV
          ?'No encontramos una TV con Chromecast en esta Wi-Fi. Fijate que el celular y la TV estén en la misma red.'
          :diferido?'Tocá de nuevo el botón de la TV.':'No se pudo conectar con la TV.','requestSession '+cod);
      });
    }catch(e){ if(diferido) avisarTVRef.current('Tocá de nuevo el botón de la TV.'); }
  };

  // Freno anticipado (sólo Chromecast): el adaptador pausa la TV un ida y vuelta
  // ANTES de la próxima pendiente, así frena en su segundo y no con el audio de la
  // frase siguiente sonando. La decisión de mostrarla sigue siendo de debeFrenar.
  useEffect(()=>{
    const p=playerRef.current;
    if(!p||!p.frenarEn) return;
    if(activeIA){ p.frenarEn(null); return; }
    const fin=finRef.current;
    let prox=null;
    for(const ia of interactions){
      if(ia.type==="label"||completed.has(ia.id)||triggered.current.has(ia.id)) continue;
      const t=Math.min(ia.time,fin-0.05);
      if(t>currentTime&&(prox==null||t<prox)) prox=t;
    }
    p.frenarEn(prox);
  },[currentTime,completed,activeIA,tv,interactions]);

  // 🔴 Con una pregunta abierta, un salto hecho desde la TV (control remoto, Google
  // Home, el control del Apple TV) se deshace YA: la TV se ve, y el alumno estaría
  // mirando lo que viene después. En el celular la guardia lo corregiría recién al
  // responder (el efecto de disparo no corre con la tarjeta abierta).
  useEffect(()=>{
    if(!tv||tv.estado!=='conectado'||!activeIA||seekTargetRef.current!=null) return;
    const desde=Math.min(activeIA.time,finRef.current-0.05);
    const hasta=activeIA.type==='hotspot'?activeIA.time+(activeIA.duration||8):desde+1.5;
    if(currentTime>=desde-1.5&&currentTime<=hasta) return;
    seekTo(desde);
    playerRef.current?.pause();
  },[currentTime,activeIA,tv]);

  // Hotspot con Chromecast: los puntos se dibujan sobre el cuadro del CELULAR, que
  // quedó en el segundo en que se conectó. Se lleva el <video> (quieto) al cuadro de
  // la TV para que cada punto caiga sobre lo que marca. (Con AirPlay el celular no
  // dibuja el video: los puntos quedan sobre negro. Ver README.)
  useEffect(()=>{
    if(activeIA?.type!=='hotspot'||tv?.tipo!=='cast') return;
    const local=localPlayerRef.current;
    if(local) local.setCurrentTime(Math.max(0,currentTimeRef.current)).catch(()=>{});
  },[activeIA,tv?.tipo]);

  // Transmitiendo, la pantalla completa del celular no sirve (el video está en la
  // TV): se sale al conectar y el botón no se ofrece (ver la fila de controles).
  const tvActiva=!!tv;
  useEffect(()=>{ if(tvActiva&&(isFS||fakeFS)) toggleFS(); },[tvActiva]);

  // Pantalla encendida mientras se transmite: con la pantalla apagada o la página
  // oculta, los timers se frenan (1 por minuto después de 5 min) y la TV pasaría
  // las preguntas de largo. Se libera sola al ocultarse; se vuelve a pedir al volver.
  // En el iframe del campus (mismo origen) la política 'screen-wake-lock' ya lo
  // permite; si falla, no pasa nada.
  const tvConectada=tv?.estado==='conectado';
  useEffect(()=>{
    if(!tvConectada||!navigator.wakeLock||typeof navigator.wakeLock.request!=='function') return;
    let lock=null, vivo=true;
    const pedir=()=>{
      if(document.visibilityState!=='visible') return;
      navigator.wakeLock.request('screen').then(l=>{ if(!vivo){ l.release().catch(()=>{}); return; } lock=l; }).catch(()=>{});
    };
    const alVolver=()=>{ if(document.visibilityState==='visible'&&(!lock||lock.released)) pedir(); };
    pedir();
    document.addEventListener('visibilitychange',alVolver);
    return()=>{ vivo=false; document.removeEventListener('visibilitychange',alVolver); try{ if(lock) lock.release().catch(()=>{}); }catch(e){} };
  },[tvConectada]);

  // Transmitiendo con Chromecast, play y pausa de la sesión de medios (la
  // notificación de Android, un auricular, los controles de medios de Chrome) van a
  // la TV por el mismo camino que el botón, y no al <video> escondido del celular. Con
  // una pregunta abierta, play no hace nada (primero se responde). El estado que
  // muestran sale del botón: el <video> del celular está siempre en pausa.
  const tvCast=tv?.tipo==='cast';
  useEffect(()=>{
    if(!tvCast||!('mediaSession' in navigator)) return;
    const ms=navigator.mediaSession;
    const poner=(accion,fn)=>{ try{ ms.setActionHandler(accion,fn); }catch(e){} };
    poner('play',()=>{ if(!activeIARef.current&&playerRef.current?.esTV) safePlay(); });
    poner('pause',()=>{ const p=playerRef.current; if(p&&p.esTV){ playIntentRef.current=null; p.pause(); } });
    return()=>{ poner('play',null); poner('pause',null); try{ ms.playbackState='none'; }catch(e){} };
  },[tvCast]);
  useEffect(()=>{
    if(!tvCast||!('mediaSession' in navigator)) return;
    try{ navigator.mediaSession.playbackState=playing?'playing':'paused'; }catch(e){}
  },[tvCast,playing]);

  // Al irse de la lección con Chromecast, la TV queda en PAUSA: si siguiera, nadie
  // frenaría en las preguntas. Al volver, Chrome reengancha la sesión y, si es este
  // video, se retoma desde ahí (ver conectarCast).
  useEffect(()=>{
    const h=()=>{ const p=playerRef.current; if(p&&p.esTV) p.pausarAlSalir(); };
    window.addEventListener('pagehide',h);
    return()=>window.removeEventListener('pagehide',h);
  },[]);
  const toggleMute=()=>{
    const p=playerRef.current;if(!p)return;
    const m=!muted;
    // setMuted además de setVolume: en móvil el mute real es el atributo
    // muted del <video> (el volumen puede ser de solo lectura), y setVolume
    // solo no siempre lo levanta.
    if(p.setMuted) p.setMuted(m).catch(()=>{});
    // Desmutear con el slider en 0 dejaba "sonido activo" pero en silencio.
    if(!m&&volume===0){ setVolume(0.5); p.setVolume(0.5); setMuted(false); return; }
    p.setVolume(m?0:volume);setMuted(m);
  };
  const changeVolume=(v)=>{const p=playerRef.current;if(!p)return;setVolume(v);p.setVolume(v);setMuted(v===0);};
  const progressRef=useRef(null);
  // Scrubbing: while dragging, the bar follows the pointer locally;
  // the actual (expensive, async) Vimeo seek runs once on release.
  const [scrubPct,setScrubPct]=useState(null);
  const scrubbingRef=useRef(false);
  // Fracción a lo largo del eje X LOCAL de un elemento. Con el reproductor girado
  // 90°, el eje X local corre de arriba hacia abajo en la pantalla, y clientX /
  // getBoundingClientRect() siguen en coordenadas de pantalla.
  const fraccionX=(el,cx,cy)=>{
    const r=el?.getBoundingClientRect();
    if(!r) return 0;
    const f=giroRef.current===90?(cy-r.top)/r.height:(cx-r.left)/r.width;
    return Math.max(0,Math.min(1,f));
  };
  const pctFromX=(e)=>fraccionX(progressRef.current,e.clientX,e.clientY);
  const onScrubStart=(e)=>{
    if(!duration) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubbingRef.current=true;
    setScrubPct(pctFromX(e));
  };
  const onScrubMove=(e)=>{
    if(!scrubbingRef.current) return;
    setScrubPct(pctFromX(e));
  };
  const onScrubEnd=(e)=>{
    if(!scrubbingRef.current) return;
    scrubbingRef.current=false;
    setScrubPct(null);
    let targetTime=pctFromX(e)*duration;
    // Forward seeks can't skip past pending interactions (labels don't block:
    // they never enter `completed`, so without the type guard every forward
    // scrub crossing a label landed on it forever).
    const next=interactions.filter(ia=>ia.type!=="label"&&!completed.has(ia.id)&&ia.time>currentTime&&ia.time<=targetTime).sort((a,b)=>a.time-b.time)[0];
    if(next) targetTime=next.time;
    setCurrent(targetTime); // optimistic — avoids the bar jumping back while Vimeo buffers
    seekTo(targetTime);
  };
  const onScrubCancel=()=>{
    scrubbingRef.current=false;
    setScrubPct(null);
  };
  // La barra con teclado (patrón "Media Seek Slider" de la APG). 🔴 Todo pasa por
  // skip / seekExterno, que frenan en la próxima pregunta pendiente: NUNCA
  // setCurrentTime directo, que la saltearía. preventDefault + stopPropagation para
  // que el atajo global de las flechas no salte otros 10 s encima.
  const onBarraKey=(e)=>{
    if(e.ctrlKey||e.metaKey||e.altKey||!ready||activeIARef.current) return;
    let accion=null;
    switch(e.key){
      case 'ArrowLeft': case 'ArrowDown': accion=()=>skip(-10); break;
      case 'ArrowRight': case 'ArrowUp': accion=()=>skip(10); break;
      case 'PageDown': accion=()=>skip(-60); break;
      case 'PageUp': accion=()=>skip(60); break;
      case 'Home': accion=()=>seekExternoRef.current?.(0,{sinPlay:true}); break;
      // Al final no: seekExterno lo deja medio segundo antes (y en la pregunta pendiente).
      case 'End': accion=()=>seekExternoRef.current?.(Math.max(duration||0,finRef.current<Infinity?finRef.current:0),{sinPlay:true}); break;
      default: return;
    }
    e.preventDefault(); e.stopPropagation();
    setAnunciarTotal(false);
    accion();
  };
  const changeSpeed=(rate)=>{playerRef.current?.setPlaybackRate(rate);setSpeed(rate);cerrarMenu();};
  // Calidad elegida en el menú. 🔴 setQuality va DENTRO del toque, sin await antes:
  // con el HLS nativo de iPhone cambia la fuente y retoma con play(), que iOS sólo
  // acepta dentro de un gesto. El candado no se toca: con hls.js el tiempo no se
  // mueve, y con el HLS nativo nativePlayer no deja salir los eventos del cambio
  // (la caída a 0 y la vuelta) y retoma en el mismo segundo; si aterrizara más
  // allá de una pregunta, la guardia de saltos la frena (no es un salto propio).
  const elegirCalidad=(id)=>{
    const p=playerRef.current; if(!p||!ready||!p.setQuality) return;
    if(activeIARef.current) return;
    calidadElegidaRef.current=id;
    setCalidad(id);
    cerrarMenu();
    // 🔴 Con un salto en vuelo, el pedido se GUARDA y lo aplica seekTo al aterrizar:
    // el cambio tiene que partir del segundo ya aterrizado (el HLS nativo recarga la
    // fuente y retoma en el tiempo de ESE momento; con Vimeo, seekTo verifica el
    // salto leyendo el tiempo y no conviene cruzarlo con una recarga). Antes se
    // descartaba en silencio: el menú quedaba abierto y el toque, perdido. Con el
    // video propio el salto resuelve en microtareas, dentro del mismo toque, así
    // que el play del cambio de fuente sigue valiendo para iOS.
    if(seekTargetRef.current!=null){ calidadPendienteRef.current=id; return; }
    calidadPendienteRef.current=null;
    aplicarCalidadRef.current(id);
  };
  aplicarCalidadRef.current=(id)=>{
    const p=playerRef.current; if(!p||!p.setQuality) return;
    p.setQuality(id)
      .then(()=>refrescarCalidadesRef.current())
      .catch(()=>{
        // Vimeo sin la opción en el plan: la etiqueta mentiría. Se saca la fila.
        if(!nativeSrc) setCalidadNoDisponible(true);
        refrescarCalidadesRef.current();
      });
  };
  const toggleSubs=()=>{
    const next=!subsOn;
    setSubsOn(next);
    // Transmitiendo con Chromecast y los subtítulos en la TV: se prenden o apagan ALLÁ.
    const ad=playerRef.current;
    if(ad&&ad.esTV&&ad.setSubtitulos) ad.setSubtitulos(next);
    if(hasVimeoSubs){
      const p=playerRef.current;
      if(!next) p?.disableTextTrack().catch(()=>{});
      else p?.getTextTracks().then(tracks=>{
        if(tracks.length){const t=tracks.find(t=>t.language==='es')||tracks[0];p.enableTextTrack(t.language,t.kind).catch(()=>{});}
      });
    }
  };

  // Touch double-tap handler (mobile only, separate from click)
  const lastTouchAction=useRef(0);
  const handleTouchEnd=(e)=>{
    if(activeIA) return;
    lastTouchAction.current=Date.now();
    // 🔴 Con el menú de Ajustes o el glosario abiertos, un toque en el video SÓLO los
    // cierra: no pausa ni salta (YouTube igual).
    if(menuRef.current||glosarioRef.current){ clearTimeout(singleTapTimer.current); lastTapRef.current={time:0,x:0}; setMenu(null); setGlosarioAbierto(false); return; }
    // Dentro del toque: los avisos pueden sonar aunque el play salga 300 ms después.
    sonidosRef.current.desbloquear({audio:sonidoOnRef.current});
    const now=Date.now();
    const touch=e.changedTouches?.[0];
    if(!touch) return;
    const x=touch.clientX;
    const rel=fraccionX(containerRef.current,touch.clientX,touch.clientY);
    // El 40% del medio NO participa del doble tap: ahí un toque es play/pausa y
    // se ejecuta al instante. Antes todo toque esperaba 300 ms por si venía un
    // segundo, así que el 100% de los alumnos pagaba ese retardo para habilitar
    // un gesto que casi nadie usa: tocaban para pausar y el video seguía tres
    // décimas. Eso es lo que se describe como "el reproductor va lento".
    // Por qué zonas y no "actuar y deshacer": deshacer encadenaría un play()
    // pegado a un seek(), que es JUSTO la carrera que arregló la v1.2.3 (los
    // comandos del SDK de Vimeo viajan por postMessage y se pisan). Separando
    // las zonas no se crea ningún par nuevo de comandos.
    // Los bordes conservan el doble tap para saltar ±10 s, igual que YouTube.
    if(rel>0.3&&rel<0.7){
      clearTimeout(singleTapTimer.current);
      lastTapRef.current={time:0,x};
      togglePlay();
      return;
    }
    const isLeft=rel<0.5;
    if(now-lastTapRef.current.time<300){
      // Double tap — skip ±10s, cancel pending play/pause, keep playing
      e.preventDefault();
      clearTimeout(singleTapTimer.current);
      skip(isLeft?-10:10);
      setSkipFeedback(isLeft?'left':'right');
      setTimeout(()=>setSkipFeedback(null),600);
      lastTapRef.current={time:0,x};
    } else {
      // First tap — wait to see if a second tap comes; if not, toggle play
      singleTapTimer.current=setTimeout(()=>togglePlay(),300);
      lastTapRef.current={time:now,x};
    }
  };
  // Desktop click — immediate play/pause
  const handleClickLayer=()=>{
    // On mobile, touchEnd already handles it; block click for 500ms after any touch
    if(Date.now()-lastTouchAction.current<500) return;
    if(menuRef.current||glosarioRef.current){ setMenu(null); setGlosarioAbierto(false); return; }   // sólo cierra, no pausa
    togglePlay();
  };

  const dismiss=(result)=>{
    if(activeIA){
      const ia=activeIA;
      const next=new Set([...completed,ia.id]);
      // El foco estaba en la tarjeta que se va: devolverlo al reproducir/pausar
      // (si no, cae al <body> y quien usa teclado vuelve a empezar desde arriba).
      devolverFocoRef.current=!!containerRef.current?.contains(document.activeElement);
      setCompleted(next);
      setActiveIA(null);
      activeIARef.current=null;
      // "Continuar" también es un gesto (por si el sonido no se desbloqueó con el play).
      sonidosRef.current.desbloquear({audio:sonidoOnRef.current});
      // Una nota, después de verla, queda en el glosario: arriba, con "recién", y el
      // contador late una vez (sin sonido ni aviso: se acaba de leer).
      if(conGlosario&&ia.type==='note'){ setRecienes(r=>({...r,[ia.id]:Date.now()+RECIEN_MS})); setLatido(n=>n+1); }
      // Frenó pegado al fin: el medio pudo terminar sin 'ended' (ver alTerminar).
      // Darlo por terminado en vez de un play() que arrancaría desde 0. Se mira
      // también el tiempo de la interacción: un play externo con ella abierta
      // (auriculares, Centro de control) rebobina el medio terminado a 0.
      // (Reiniciar vacía triggered: una que quedó abierta al reiniciar no cuenta.)
      if(!terminoRef.current&&Math.max(currentTimeRef.current,triggered.current.has(ia.id)?Math.min(ia.time,finRef.current):0)>=finRef.current-0.3) alTerminarRef.current();
      else if(!terminoRef.current) safePlay();
      // Una pregunta del último tramo puede seguir abierta cuando el video ya terminó:
      // cerrarla no lo arranca (tampoco con "Repetir video") y se revisa contra el fin si
      // quedó otra del mismo tramo. Si no queda ninguna, aparece la tarjeta de fin.
      if(terminoRef.current) evaluarEnFinRef.current=true;
      // Report individual interaction to SCORM + Moodle gradebook
      if(result&&(ia.type==="multiple-choice"||ia.type==="true-false")){
        const scormType=ia.type==="multiple-choice"?"choice":"true-false";
        const correctResp=ia.type==="multiple-choice"?ia.data.correctId:String(ia.data.correct);
        scormReportInteraction(ia.id,scormType,result.answer,correctResp,result.correct?"correct":"wrong");
        moodleReportAnswer(ia.id,result.answer);
      }
      // Report completion if all interactions done and the video was watched
      // to the end (otherwise the videoEnded effect reports it later).
      if(videoEnded&&next.size===interactions.filter(i=>i.type!=="label").length) scormSetComplete();
    }
  };

  // ─── Tarjeta de fin: abrir, cerrar, volver a ver, ir a la próxima ──────────
  // Abre la tarjeta (la llama el efecto de "La tarjeta de fin"). El destino se lee de la
  // barra del tema en la página de arriba EN ESTE MOMENTO (ver finVideo.js).
  const abrirTarjetaFinRef=useRef(()=>{});
  abrirTarjetaFinRef.current=()=>{
    const ctx=window.MOODLE_CONTEXT||null;
    const completada=leccionCompletada({ interactions, completed,
      registra:!!(ctx&&ctx.completeUrl)||isScormAvailable(), yaCompletada:!!(ctx&&ctx.alreadyCompleted) });
    const destino=destinoDeFin(leerBarraDelTema(window));
    const t={ completada, destino };
    // La tarjeta tapa todo, como una pregunta: el menú y el glosario se cierran debajo
    // (antes de soltar el glosario, la marca: así cerrarlo no retoma nada).
    setTarjetaFin(t);
    setMenu(null);
    setGlosarioAbierto(false);
    clearTimeout(avisoGlosarioTimer.current); setAvisoGlosario(null);
  };
  // Cierra la tarjeta (X o Escape): el video queda en el final, terminado. El foco vuelve
  // al botón de reproducir si estaba en la tarjeta (o si se pide, con Escape). Lo mueve el
  // efecto de abajo, después del render: hasta entonces los controles siguen `inert` y
  // un focus() ahí no hace nada.
  const devolverFocoFinRef=useRef(false);
  const focoEnTarjetaFin=()=>{ const a=document.activeElement; return !!a&&!!a.closest?.('.iv-fin'); };
  const cerrarTarjetaFin=(devolverFoco)=>{
    devolverFocoFinRef.current=!!devolverFoco||focoEnTarjetaFin();
    setTarjetaFin(null);
    setAvisoFin('');
  };
  const cerrarTarjetaFinRef=useRef(cerrarTarjetaFin);
  cerrarTarjetaFinRef.current=cerrarTarjetaFin;
  // Se va sola cuando el video vuelve a andar o se salta a otro lado (Volver a ver, play,
  // la transcripción, Reiniciar…), y ya no se abre si estaba por abrirse.
  const soltarFinRef=useRef(()=>{});
  soltarFinRef.current=()=>{
    finPendienteRef.current=false;
    if(tarjetaFinRef.current) cerrarTarjetaFin(false);
  };
  // Desde el principio y reproduciendo: "Volver a ver", y el play con el video terminado
  // (la tarjeta cerrada con Escape o la X). Es lo que antes hacía alTerminar al llegar al
  // final (volver a 0), más el play: un salto PROPIO a 0 (seekTo: la guardia no lo toca y
  // pone terminoRef en false) y safePlay, como un clic en la transcripción. Dentro del
  // toque: el play vale como gesto.
  const volverAEmpezar=()=>{
    const p=playerRef.current; if(!p||!ready) return;
    soltarFinRef.current();
    currentTimeRef.current=0; setCurrent(0);
    seekTo(0);
    safePlay();
  };
  // El foco, que estaba en la tarjeta, pasa al botón de reproducir (que ya dice Pausar).
  const volverAVer=()=>{
    sonidosRef.current.desbloquear({audio:sonidoOnRef.current});
    volverAEmpezar();
  };
  // "Siguiente lección" / "Volver al curso": navega la página de ARRIBA (la lección,
  // view.php, del mismo origen) dentro del mismo toque. Antes sale de la pantalla completa:
  // la del iframe, la de la página de arriba (la nativa de view.php) o la simulada (se la
  // pide a la madre, como el botón). Navegar igual la cerraría, pero en el WebView de
  // hub-app una pantalla completa que queda abierta mientras la página se va no es algo
  // que convenga dejar librado al sistema.
  const irAlDestino=()=>{
    const d=tarjetaFinRef.current&&tarjetaFinRef.current.destino;
    if(!d) return;
    const salir=(doc)=>{
      try{
        if(doc.fullscreenElement&&doc.exitFullscreen){ const r=doc.exitFullscreen(); if(r&&r.catch) r.catch(()=>{}); return true; }
        if(doc.webkitFullscreenElement&&doc.webkitExitFullscreen){ doc.webkitExitFullscreen(); return true; }
      }catch(e){}
      return false;
    };
    let arriba=null;
    try{ arriba=window.top; void arriba.document; }catch(e){ arriba=null; }
    if(!(arriba&&arriba!==window&&salir(arriba.document))) salir(document);
    if(fakeFS&&window.parent!==window){ try{ window.parent.postMessage({type:'ivplayer-fullscreen',action:'exit'},'*'); }catch(e){} }
    try{ (arriba||window).location.assign(d.url); }catch(e){}
  };
  // Foco al botón principal al aparecer (o a "Volver a ver", si es el único), como las
  // preguntas: sólo si el reproductor tiene el foco (no se le roba a quien escribe en la
  // página de arriba, la búsqueda de la transcripción); si no, se avisa.
  useEffect(()=>{
    if(!tarjetaFin){
      if(devolverFocoFinRef.current){ devolverFocoFinRef.current=false; try{ playBtnRef.current?.focus({preventScroll:true}); }catch(e){} }
      return;
    }
    let movido=false;
    try{ const b=finPrincipalRef.current; if(b&&document.hasFocus()){ b.focus({preventScroll:true}); movido=document.activeElement===b; } }catch(e){}
    const tx=textosDeFin(tarjetaFin);
    setAvisoFin(movido?'':`${tx.titulo}.${tx.siguiente?` Siguiente: ${tx.siguiente}.`:''}`);
  },[tarjetaFin]);

  const resetProgress=()=>{
    soltarFinRef.current();
    localStorage.removeItem(`iv_progress_${vimeoData.id}`);
    setCompleted(new Set());
    triggered.current=new Set();
    setVideoEnded(false);
    terminoRef.current=false; // reiniciar es volver a ver el video, como un seek
    moodleSaveProgress({completed:[],currentTime:0});
    // El tiempo del componente pasa a 0 ya, sin esperar el timeupdate del seek:
    // si se quedaba en el fin, las interacciones del final volvían a vencer.
    currentTimeRef.current=0; prevTimeRef.current=0; setCurrent(0);
    resetHastaRef.current=Date.now()+1000;
    playerRef.current?.setCurrentTime(0);
    // Volver a empezar es también el glosario y los avisos: lo que se nombre se vuelve a
    // sumar (con su sonido) y los tics vuelven a sonar.
    nombradosRef.current=new Set(); setNombrados(new Set()); setRecienes({});
    clearTimeout(avisoGlosarioTimer.current); setAvisoGlosario(null);
    ticsRef.current=new Map(); setCuenta(null); setAvisoCuenta('');
  };

  // fsNativo: ver arriba, junto al botón de girar.
  const girado=girar&&vertical&&!fsNativo&&(isFS||fakeFS);
  giroRef.current=girado?90:0;
  const progress=scrubPct!=null?scrubPct*100:(duration?(currentTime/duration)*100:0);
  const displayTime=scrubPct!=null?scrubPct*duration:currentTime;
  const hasCues=cues&&cues.length>0;
  const isEmbedded=window!==window.parent;
  const completableInteractions=interactions.filter(ia=>ia.type!=="label");
  // Lo que dice la tarjeta de fin (null: cerrada).
  const txFin=tarjetaFin?textosDeFin(tarjetaFin):null;

  return (
    <div ref={wrapperRef} className={`iv-wrapper ${fakeFS||isFS?"fake-fs":""} ${girado?"girado":""} ${isEmbedded?"embedded":""}`}>
      <div className="iv-top-bar">
        <span className="iv-top-title">{title}</span>
        <span className="iv-top-progress">
          {completed.size}/{completableInteractions.length} actividades
          {completed.size>0&&<button className="iv-reset-btn-top" onClick={resetProgress}>Reiniciar</button>}
        </span>
      </div>
      <div ref={containerRef} className="iv-container"
        onMouseMove={resetCtrl} onTouchStart={resetCtrl}>

        <div ref={vimeoRef} className="iv-vimeo-wrap"/>
        {/* Transmitiendo: tapa el video del celular (con Chromecast quedó quieto en el
            segundo en que se conectó; con AirPlay el celular no lo dibuja). Debajo de
            la capa de toques: tocar sigue pausando y reproduciendo la TV. Con un
            hotspot no, que sus puntos van sobre el cuadro (ver el efecto del hotspot). */}
        {tv&&activeIA?.type!=='hotspot'&&<div className="iv-tv-capa" aria-hidden="true">
          <CastOnIcon/>
          <span className="iv-tv-capa-titulo">{tv.estado==='conectando'?'Conectando con la TV…':`Reproduciendo en ${tv.nombre||'la TV'}`}</span>
          {tv.estado!=='conectando'&&<span className="iv-tv-capa-sub">Las preguntas aparecen en esta pantalla.</span>}
        </div>}
        {ready&&!activeIA&&!tarjetaFin&&!respaldando&&<div className="iv-click-layer" onClick={handleClickLayer} onTouchStart={resetCtrl} onTouchEnd={handleTouchEnd}/>}
        {skipFeedback&&<div className={`iv-skip-feedback ${skipFeedback}`} aria-hidden="true">{skipFeedback==='left'?'⟲ 10s':'10s ⟳'}</div>}
        {ready&&buffering&&!activeIA&&!tarjetaFin&&!videoError&&!respaldando&&<div className="iv-buffering"><div className="iv-spinner"/></div>}
        {/* También mientras la red de seguridad pasa a Vimeo: para el alumno, es el video que carga. */}
        {(!ready||respaldando)&&!videoError&&<div className="iv-loading"><div className="iv-spinner"/><span>Cargando video...</span></div>}
        {/* Transmitiendo, sin el botón grande: taparía el cartel de la TV, y la fila de
            controles ya queda visible con el video en pausa. */}
        {ready&&!playing&&!activeIA&&!tarjetaFin&&!videoError&&!tv&&!respaldando&&<button className="iv-big-play" onClick={togglePlay} aria-label="Reproducir video"><PlayIcon/></button>}
        {/* Avisos para el lector de pantalla (una interacción que aparece sin poder
            llevarle el foco). Existe siempre: una región que aparece junto con su
            texto muchas veces no se anuncia. */}
        <div className="iv-sr" role="status" aria-live="polite">{aviso}</div>
        {/* Lo mismo para la TV: el cartel de arriba es aria-hidden y lo dice éste. */}
        <div className="iv-sr" role="status" aria-live="polite">{tv?(tv.estado==='conectando'?'Conectando con la TV':`Reproduciendo en ${tv.nombre||'la TV'}. Las preguntas aparecen en esta pantalla.`):''}</div>
        <div className={`iv-tv-aviso ${tvAviso?'visible':''}`} role="status" aria-live="polite">{tvAviso}</div>
        {/* Cuenta regresiva de la interacción que va a frenar el video (ver ticsEntre). La
            ve el que mira; al lector de pantalla se le dice una vez, abajo. Con el glosario
            abierto va adentro del panel (acá quedaba tapada, o tapaba su X). */}
        {restanCuenta!=null&&!glosarioAbierto&&<div className={`iv-cuenta iv-cuenta-${queSeViene(cuenta.ia)}`} aria-hidden="true">
          <span key={restanCuenta} className="iv-cuenta-num">{restanCuenta}</span>
          <span className="iv-cuenta-texto">{textoCuenta(cuenta.ia)}</span>
        </div>}
        <div className="iv-sr" role="status" aria-live="polite">{avisoCuenta}</div>
        {/* "Nuevo en el glosario: …" con el panel cerrado: tocarlo abre el panel en ese
            término. La región existe siempre (aria-live); el botón, sólo con aviso. */}
        {conGlosario&&<div className={`iv-glosario-aviso-zona ${restanCuenta!=null?'con-cuenta':''}`} role="status" aria-live="polite">
          {avisoGlosario&&!activeIA&&!tarjetaFin&&!glosarioAbierto&&<button className="iv-glosario-aviso" onClick={()=>abrirGlosario(avisoGlosario.id)}>
            <GlosarioIcon/><span>Nuevo en el glosario: <strong>{avisoGlosario.nombre}</strong></span>
          </button>}
        </div>}
        {/* Con el panel abierto el aviso no se muestra (la lista ya tiene el término con
            "recién"): éste se lo dice al lector de pantalla. Existe siempre, como las otras. */}
        {conGlosario&&<div className="iv-sr iv-glosario-anuncio" role="status" aria-live="polite">{glosarioAbierto?anuncioPanel:''}</div>}
        {videoError&&<div className="iv-error" role="alert">
          <strong>No se pudo cargar el video</strong>
          <span>{textoDelError(videoError)} Tu avance está guardado.</span>
          {/* Recargar pide la página de nuevo, y en Moodle eso firma un acceso nuevo. Con la
              sesión cerrada, la de ARRIBA (view.php): ver recargarParaReintentar. */}
          <button className="iv-btn-primary" onClick={()=>recargarParaReintentar(videoError)}>Reintentar</button>
        </div>}

        {/* 🔴 Con los subtítulos en la TV (Chromecast con subtitlesUrlTv) el celular NO los
            dibuja: los muestra la TV, y acá irían encima del cartel "Reproduciendo en…",
            duplicados y con el reloj estimado de la TV. Sin pista en la TV (SCORM, demo,
            sitio sin el secreto, app sin 'subtitulos', AirPlay), como antes: acá. */}
        {!hasVimeoSubs&&<SubtitleDisplay cues={cues} currentTime={currentTime} visible={subsOn&&!activeIA&&!tarjetaFin&&!(tv&&tv.subtitulos)} sobreControles={showCtrl||!playing||scrubPct!=null}/>}

        {/* Etiquetas en pantalla: sólo en el modo "En pantalla" (el de antes). En el de
            glosario se suman al panel (ver más abajo). */}
        {ready&&!activeIA&&!tarjetaFin&&!modoGlosario&&<LabelOverlay interactions={interactions} currentTime={currentTime} playerRef={playerRef}/>}

        {activeIA?.type==="note"&&<NoteOverlay data={activeIA.data} onDismiss={dismiss}/>}
        {activeIA?.type==="multiple-choice"&&<MCOverlay data={activeIA.data} onDismiss={dismiss}/>}
        {activeIA?.type==="true-false"&&<TFOverlay data={activeIA.data} onDismiss={dismiss}/>}
        {activeIA?.type==="hotspot"&&<HotspotOverlay data={activeIA.data} onDismiss={dismiss}/>}

        {/* Tarjeta de fin (ver "La tarjeta de fin"): encima del video, también del cartel
            de la TV (transmitiendo, el celular es el que la muestra). Nunca junto con una
            pregunta. Sin barra del tema arriba, sólo "Volver a ver". */}
        {txFin&&!activeIA&&<div className="iv-fin-capa"><div className="iv-overlay-backdrop iv-fin-fondo">
          <div className={`iv-card iv-fin ${tarjetaFin.completada?'completada':''}`} role="dialog" aria-modal="true"
            aria-labelledby={`${idFin}-titulo`} aria-describedby={txFin.siguiente?`${idFin}-siguiente`:undefined}>
            <button className="iv-fin-cerrar" onClick={()=>cerrarTarjetaFin(true)} aria-label="Cerrar"><CloseIcon/></button>
            <p id={`${idFin}-titulo`} className="iv-fin-titulo">{tarjetaFin.completada&&<CheckIcon/>}<span>{txFin.titulo}</span></p>
            {txFin.siguiente&&<p id={`${idFin}-siguiente`} className="iv-fin-siguiente">Siguiente: <strong>{txFin.siguiente}</strong></p>}
            <div className="iv-fin-botones">
              {txFin.principal&&<button ref={finPrincipalRef} className="iv-btn-primary iv-fin-ir" onClick={irAlDestino}>
                {txFin.principal}{!tarjetaFin.destino.ultima&&<span aria-hidden="true"> →</span>}
              </button>}
              <button ref={txFin.principal?null:finPrincipalRef} className={`iv-fin-ver ${txFin.principal?'':'unico'}`} onClick={volverAVer}>
                <ReplayIcon/><span>Volver a ver</span>
              </button>
            </div>
          </div>
        </div></div>}
        <div className="iv-sr" role="status" aria-live="polite">{avisoFin}</div>

        {/* 🔴 inert con una pregunta abierta: la tarjeta tapa los controles para el
            dedo, pero con Tab se llegaba a reproducir, a ±10 s y a Ajustes detrás de
            ella. Así el foco queda en la pregunta. (Safari < 15.5 ignora inert: ahí
            sigue valiendo el freno de 'play' con la pregunta abierta.) Lo mismo con la
            tarjeta de fin. */}
        <div className={`iv-controls ${showCtrl||!playing||activeIA||scrubPct!=null||menu||glosarioAbierto?"visible":""}`} inert={activeIA||tarjetaFin?true:undefined}>
          {/* La barra es también un slider de teclado (ver onBarraKey). El total se
              agrega a lo que se lee sólo al enfocarla, como en el ejemplo de la APG,
              para no repetirlo en cada segundo. */}
          <div ref={progressRef} className="iv-progress-container"
            role="slider" tabIndex={0} aria-label="Avance del video"
            aria-valuemin={0} aria-valuemax={Math.max(1,Math.round(duration))}
            aria-valuenow={Math.min(Math.max(1,Math.round(duration)),Math.max(0,Math.floor(displayTime)))}
            aria-valuetext={`${hablado(displayTime)}${anunciarTotal&&duration?` de ${hablado(duration)}`:''}`}
            onKeyDown={onBarraKey} onFocus={()=>setAnunciarTotal(true)} onBlur={()=>setAnunciarTotal(false)}
            onPointerDown={onScrubStart} onPointerMove={onScrubMove}
            onPointerUp={onScrubEnd} onPointerCancel={onScrubCancel}>
            <div className="iv-progress-track">
              <TimelineMarkers interactions={interactions} duration={duration}/>
              <div className="iv-progress-fill" style={{width:`${progress}%`}}/>
              <div className="iv-progress-thumb" style={{left:`${progress}%`}}/>
            </div>
          </div>
          <div className={`iv-controls-row ${girarVisible?'con-girar':''} ${conGlosario?'con-glosario':''}`}>
            <button ref={playBtnRef} className="iv-ctrl-btn" onClick={togglePlay} aria-label={playing?"Pausar":"Reproducir"}>{playing?<PauseIcon/>:<PlayIcon/>}</button>
            <button className="iv-ctrl-btn" onClick={()=>skip(-10)} aria-label="Retroceder 10 segundos"><SkipBackIcon/></button>
            <button className="iv-ctrl-btn" onClick={()=>skip(10)} aria-label="Adelantar 10 segundos"><SkipFwdIcon/></button>
            <div className="iv-volume-group" onMouseEnter={()=>setShowVolSlider(true)} onMouseLeave={()=>setShowVolSlider(false)}>
              <button className="iv-ctrl-btn" onClick={toggleMute} aria-label={muted?"Activar sonido":"Silenciar"}><VolumeIcon muted={muted}/></button>
              {showVolSlider&&<div className="iv-volume-slider-wrap">
                <input type="range" className="iv-volume-slider" min="0" max="1" step="0.05" aria-label="Volumen"
                  value={muted?0:volume} onChange={e=>changeVolume(parseFloat(e.target.value))}/>
              </div>}
            </div>
            <span className="iv-time" aria-hidden="true">{fmt(displayTime)}<span className="iv-time-total">/{fmt(duration)}</span></span>
            {isEmbedded&&<span className="iv-ctrl-progress" aria-label={`${completed.size} de ${completableInteractions.length} actividades`}>{completed.size}/{completableInteractions.length}</span>}
            <div style={{flex:1}}/>
            {isEmbedded&&completed.size>0&&<button className="iv-ctrl-btn iv-reset-ctrl" onClick={resetProgress} title="Reiniciar progreso" aria-label="Reiniciar progreso"><span aria-hidden="true">↺</span></button>}
            {/* Glosario: con el contador de lo ya nombrado, que late una vez con cada
                término nuevo (latido cambia la key y reinicia la animación). */}
            {conGlosario&&<button ref={glosarioBtnRef} className={`iv-ctrl-btn iv-glosario-btn ${glosarioAbierto?'abierto':''}`}
              onClick={()=>glosarioRef.current?cerrarGlosario(true):abrirGlosario(null)}
              aria-label={`Glosario: ${listaGlosario.length} ${listaGlosario.length===1?'entrada':'entradas'}`} title="Glosario"
              aria-haspopup="dialog" aria-expanded={glosarioAbierto} aria-controls="iv-glosario">
              <GlosarioIcon/><span key={latido} className={`iv-glosario-marca ${latido?'late':''}`} aria-hidden="true">{listaGlosario.length}</span>
            </button>}
            {(hasCues||hasVimeoSubs)&&<button className="iv-ctrl-btn" onClick={toggleSubs} aria-label="Subtítulos" aria-pressed={subsOn}><SubsIcon on={subsOn}/></button>}
            {/* Transmitir a la TV: sólo con una TV a la vista. A ≤340 px no entra sin
                recortar el de pantalla completa: ahí se esconde por CSS y va como fila
                en Ajustes (salvo transmitiendo, que pantalla completa no está). */}
            {tvBoton&&<button className={`iv-ctrl-btn iv-tv-btn ${tv?'activo':''} ${tvSiempre?'siempre':''}`} onClick={tocarTV} aria-label={etiquetaTV} title={etiquetaTV}>{tv?<CastOnIcon/>:<CastIcon/>}</button>}
            {/* Ajustes (velocidad y calidad) en un solo botón, como YouTube: a 320 px
                la fila no admite uno más, y el de salir de pantalla completa no se
                puede recortar. Ocupa menos que el viejo "1x" / "1.25x". */}
            <button ref={ajustesBtnRef} className={`iv-ctrl-btn iv-ajustes-btn ${menu?'abierto':''}`} onClick={toggleAjustes}
              aria-label="Ajustes" aria-haspopup="dialog" aria-expanded={!!menu} aria-controls="iv-ajustes">
              <GearIcon/>{marcaAjustes&&<span className="iv-ajustes-marca" aria-hidden="true">{marcaAjustes}</span>}
            </button>
            {girarVisible&&<button className={`iv-ctrl-btn ${girar?"iv-girar-on":""}`} onClick={()=>{const g=!girar;setGirar(g);try{localStorage.setItem('iv_girar',g?'1':'0');}catch(e){}}} title={girar?"Volver a vertical":"Ver horizontal"} aria-label={girar?"Volver a vertical":"Ver horizontal"} aria-pressed={girar}><RotateIcon/></button>}
            {fsVisible&&<button className="iv-ctrl-btn iv-fs-btn" onClick={toggleFS} aria-label={isFS?"Salir de pantalla completa":"Pantalla completa"}>{isFS?<ExitFullscreenIcon/>:<FullscreenIcon/>}</button>}
          </div>
        </div>

        {/* Panel de Ajustes. Vive en el contenedor y no en la fila: el reproductor va
            en un iframe y el panel no puede salirse de él. En reproductores angostos
            (≤480 px) o bajos (≤340 px) tapa el video entero y las opciones van de a
            dos por fila: a 320 px el reproductor mide 180 de alto y seis opciones en
            columna no entran. La capa que lo envuelve ocupa el contenedor entero y
            es la que se mide (ver .iv-ajustes-capa en styles.css). Opciones =
            botones con aria-pressed (sin role="menu", que pide manejo de flechas). */}
        {menu&&!activeIA&&<div className="iv-ajustes-capa">
        <div ref={ajustesPanelRef} id="iv-ajustes" className={`iv-ajustes iv-ajustes-${menu}`} role="dialog"
          aria-label={tituloMenu}
          onClick={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}>
          <div className="iv-ajustes-cabecera">
            {menu!=='principal'&&menu!=='destinoTV'
              ? <button className="iv-ajustes-atras" onClick={()=>irAMenu('principal')}><span aria-hidden="true">‹ </span>Atrás</button>
              : null}
            <span className="iv-ajustes-titulo">{tituloMenu}</span>
            <button className="iv-ajustes-cerrar" onClick={()=>cerrarMenu(true)} aria-label="Cerrar ajustes"><CloseIcon/></button>
          </div>
          {menu==='principal'&&<div className="iv-ajustes-filas">
            <button className="iv-ajustes-fila" onClick={()=>irAMenu('velocidad')}>
              <span>Velocidad</span><span className="iv-ajustes-valor">{etiquetaVelocidad(speed)}<span aria-hidden="true"> ›</span></span>
            </button>
            {hayCalidad&&<button className="iv-ajustes-fila" onClick={()=>irAMenu('calidad')}>
              <span>Calidad</span><span className="iv-ajustes-valor">{etiquetaCalidad}<span aria-hidden="true"> ›</span></span>
            </button>}
            {/* El mismo toque abre el selector de la TV: cerrar y transmitir sin await. */}
            {tvEnMenu&&tvBoton&&<button className="iv-ajustes-fila iv-ajustes-tv" onClick={()=>{ cerrarMenu(); tocarTV(); }}>
              <span>{etiquetaTV}</span><span className="iv-ajustes-valor">{tv?<CastOnIcon/>:<CastIcon/>}</span>
            </button>}
            {/* Avisos de las interacciones que frenan: del alumno, en su navegador. La
                vibración, sólo si el equipo puede (no en la compu ni en iPhone). */}
            <button className="iv-ajustes-fila" role="switch" aria-checked={sonidoOn} onClick={()=>cambiarSonido(!sonidoOn)}>
              <span>Sonidos de aviso</span><span className="iv-ajustes-valor" aria-hidden="true">{sonidoOn?'Sí':'No'}</span>
            </button>
            {puedeVibrar&&<button className="iv-ajustes-fila" role="switch" aria-checked={vibraOn} onClick={()=>cambiarVibracion(!vibraOn)}>
              <span>Vibración</span><span className="iv-ajustes-valor" aria-hidden="true">{vibraOn?'Sí':'No'}</span>
            </button>}
          </div>}
          {menu==='velocidad'&&<div className="iv-ajustes-opciones">
            {SPEEDS.map(s=><button key={s} className={`iv-ajustes-opcion ${s===speed?'activa':''}`} aria-pressed={s===speed} onClick={()=>changeSpeed(s)}>
              <CheckIcon/>{etiquetaVelocidad(s)}
            </button>)}
          </div>}
          {/* Calidad de mayor a menor y "Automática" al final, como YouTube. */}
          {menu==='calidad'&&<div className="iv-ajustes-opciones">
            {[...calidades,{id:'auto',label:etiquetaAuto}].map(q=><button key={q.id} className={`iv-ajustes-opcion ${q.id===calidad?'activa':''}`} aria-pressed={q.id===calidad} onClick={()=>elegirCalidad(q.id)}>
              <CheckIcon/>{q.label}
            </button>)}
          </div>}
          {/* iPhone en la app con una TV de AirPlay Y Chromecast posible: que elija. Cada
              fila actúa en el MISMO toque: el selector de AirPlay (prompt) exige el gesto. */}
          {menu==='destinoTV'&&<div className="iv-ajustes-filas">
            <button className="iv-ajustes-fila iv-ajustes-tv" onClick={()=>{ const p=playerRef.current; cerrarMenu(); if(p&&p.transmitir) transmitirAirPlay(p); }}>
              <span>AirPlay</span><span className="iv-ajustes-valor"><CastIcon/></span>
            </button>
            <button className="iv-ajustes-fila iv-ajustes-tv" onClick={()=>{ cerrarMenu(); tocarCast(); }}>
              <span>Chromecast</span><span className="iv-ajustes-valor"><CastIcon/></span>
            </button>
          </div>}
        </div>
        </div>}

        {/* Panel del glosario (ver abrirGlosario). Encima de todo lo del video, también
            del cartel "Reproduciendo en la TV": transmitiendo, el celular es la segunda
            pantalla. Cada término se despliega con su botón (aria-expanded). */}
        {glosarioAbierto&&conGlosario&&!activeIA&&<div className="iv-glosario-capa">
        <div ref={glosarioPanelRef} id="iv-glosario" className="iv-glosario" role="dialog" aria-labelledby={`${idGlosario}-titulo`}
          onClick={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}>
          <div className="iv-glosario-cabecera">
            <GlosarioIcon/>
            <span id={`${idGlosario}-titulo`} className="iv-glosario-titulo">Glosario</span>
            <span className="iv-glosario-cuenta">{listaGlosario.length} de {totalGlosario}</span>
            <button className="iv-glosario-cerrar" onClick={()=>cerrarGlosario(true)} aria-label="Cerrar glosario"><CloseIcon/></button>
          </div>
          {restanCuenta!=null&&<div className={`iv-glosario-se-viene iv-se-viene-${queSeViene(cuenta.ia)}`} aria-hidden="true">
            <span key={restanCuenta} className="iv-cuenta-num">{restanCuenta}</span><span>{textoCuenta(cuenta.ia)}</span>
          </div>}
          {listaGlosario.length===0
            ? <p className="iv-glosario-vacio">Los términos aparecen acá a medida que se nombran en el video. Tocá uno para leer qué significa.</p>
            : <ul className="iv-glosario-lista">
              {listaGlosario.map((e,i)=>{
                const abierto=expandidos.has(e.id);
                const recien=(recienes[e.id]||0)>Date.now();
                const idDef=`${idGlosario}-def-${i}`;
                return <li key={e.id} data-termino={e.id} className={`iv-glosario-termino iv-glosario-${e.tipo} ${recien?'recien':''}`}>
                  <button aria-expanded={abierto} aria-controls={idDef} onClick={()=>alternarTermino(e.id)}>
                    <span className="iv-glosario-icono" aria-hidden="true">{e.tipo==='nota'?<InfoIcon/>:'Aa'}</span>
                    <span className="iv-glosario-nombre">{e.nombre}{e.tipo==='nota'&&<span className="iv-sr"> (nota)</span>}</span>
                    {recien&&<span className="iv-glosario-recien">recién</span>}
                    <span className="iv-glosario-tiempo" aria-hidden="true">{fmt(e.time)}</span>
                  </button>
                  <div id={idDef} className="iv-glosario-def" hidden={!abierto}>
                    {e.texto?<RichText>{e.texto}</RichText>:<p className="iv-glosario-sindef">Sin definición.</p>}
                  </div>
                </li>;
              })}
            </ul>}
        </div>
        </div>}
      </div>
      {!isEmbedded&&<div className="iv-legend">
        <span className="iv-legend-title">Marcadores:</span>
        {Object.entries(TYPE_COLORS).map(([t,c])=><span key={t} className="iv-legend-item">
          <span className="iv-legend-dot" style={{background:c}}/>{t==="multiple-choice"?"MC":t==="true-false"?"V/F":t==="hotspot"?"Hotspot":t==="label"?"Etiqueta":"Nota"}
        </span>)}
      </div>}
    </div>
  );
}
