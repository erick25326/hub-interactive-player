// Ayudante de las pruebas de navegador. El servidor de pruebas lo inyecta en la
// página del reproductor como <script> clásico, ANTES del bundle (que es un módulo y
// corre después). Sólo LEE: el tiempo que muestra el componente (la barra), la
// tarjeta abierta, el <video>, la TV simulada y lo que se guarda como avance. Así las
// pruebas miden lo que ve el alumno y no detalles internos de React.
// No cambia nada del reproductor salvo envolver Storage.setItem para anotar cada
// avance guardado (lo sigue guardando igual).
(() => {
  if (window.__ivp) return;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const A = window.__ivp = { serie: [], muestras: [], guardados: [], marcas: [], errores: [], rechazos: [] };
  A.ms = ms;
  const recortar = (xs, n = 20000) => { if (xs.length > n) xs.splice(0, xs.length - n); };
  const $ = (s) => document.querySelector(s);

  // Cada avance que se escribe, en el momento en que se escribe: así se puede afirmar
  // "nunca se guardó más allá de la pregunta" sin esperar a leer el localStorage.
  const setItem0 = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (String(k).startsWith('iv_progress_')) { try { A.guardados.push({ ms: ms(), ...JSON.parse(v) }); } catch (e) {} }
    return setItem0.apply(this, arguments);
  };
  // Excepciones sin atrapar: una prueba que pasa con el reproductor tirando errores
  // no prueba nada. Los rechazos de promesas se anotan aparte (play() interrumpido
  // por un pause() es normal y no es un error del reproductor).
  addEventListener('error', (e) => A.errores.push({ ms: ms(), txt: String((e && e.message) || e) }));
  addEventListener('unhandledrejection', (e) => A.rechazos.push({ ms: ms(), txt: String(e.reason && (e.reason.message || e.reason)) }));

  A.video = () => $('.iv-vimeo-wrap video');
  // La duración se recuerda: durante un cambio de fuente del HLS nativo el <video>
  // pasa un momento por duration = NaN y el tiempo del componente no se podría leer.
  let durUltima = 0;
  A.duracion = () => {
    const v = A.video();
    if (v && Number.isFinite(v.duration) && v.duration > 0) durUltima = v.duration;
    return durUltima;
  };
  // El tiempo del COMPONENTE: el ancho de la barra por la duración. Es lo que ve el
  // alumno y lo que mira el candado, no el currentTime crudo del <video>.
  A.comp = () => {
    const f = $('.iv-progress-fill'), d = A.duracion();
    if (!f || !d) return null;
    const w = parseFloat(f.style.width);
    return Number.isFinite(w) ? +(w * d / 100).toFixed(3) : null;
  };
  const interacciones = () => (window.PLAYER_CONFIG && window.PLAYER_CONFIG.interactions) || [];
  // La tarjeta abierta y a qué interacción del config corresponde (por su texto).
  A.tarjeta = () => {
    const c = $('.iv-card, .iv-hotspot-container');
    if (!c) return null;
    const tipo = c.classList.contains('iv-note-card') ? 'nota' : c.classList.contains('iv-tf-card') ? 'vf'
      : c.classList.contains('iv-quiz-card') ? 'mc' : 'hotspot';
    const texto = ((c.querySelector('.iv-note-title, .iv-question') || {}).textContent || '').trim();
    const ia = interacciones().find((x) => x.data && [x.data.title, x.data.statement, x.data.question].includes(texto));
    return { tipo, texto, id: ia ? ia.id : null };
  };
  const etiqueta = (sel) => { const b = $(sel); return b ? b.getAttribute('aria-label') : null; };
  A.estado = () => {
    const v = A.video();
    const tv = window.__tv && window.__tv.receptor;
    const t = A.tarjeta();
    const sub = $('.iv-subtitle-text');
    const subsBtn = $('button[aria-label="Subtítulos"]');
    const act = (($('.iv-top-progress') || {}).textContent || '').match(/(\d+)\/(\d+)/);
    const ult = A.guardados[A.guardados.length - 1];
    return {
      ms: ms(), comp: A.comp(),
      vt: v ? +v.currentTime.toFixed(3) : null, pausado: v ? v.paused : null, rs: v ? v.readyState : null,
      motor: v ? (v.dataset.motor || null) : null, nivel: v ? (v.dataset.nivel || null) : null,
      src: v ? String(v.currentSrc || v.src || '').replace(location.origin, '') : null,
      tarjeta: t ? (t.id || t.tipo) : null,
      boton: etiqueta('.iv-controls-row .iv-ctrl-btn'), botonTV: etiqueta('.iv-tv-btn'), botonFS: etiqueta('.iv-fs-btn'),
      subsBtn: subsBtn ? subsBtn.getAttribute('aria-pressed') : null,
      subtitulo: sub ? sub.textContent : null,
      capa: ($('.iv-tv-capa-titulo') || {}).textContent || null,
      aviso: ($('.iv-tv-aviso.visible') || {}).textContent || null,
      actividades: act ? `${act[1]}/${act[2]}` : null,
      guardado: ult ? ult.currentTime : null,
      tv: tv ? tv.foto() : null,
      menu: !!$('.iv-ajustes'),
      error: ($('.iv-error') || {}).textContent || null,
    };
  };
  // Listo para probar: controles a la vista, sin "Cargando video" y con metadata (o
  // con el cartel de error, para que la prueba lo diga en vez de esperar de más).
  A.listo = () => {
    if ($('.iv-error')) return true;
    const v = A.video();
    return !!($('.iv-controls-row') && !$('.iv-loading') && v && v.readyState >= 1);
  };

  // Serie de RENDERS del tiempo del componente (cada cambio del ancho de la barra) y de
  // la tarjeta. Con ella se buscan caídas o saltos que el alumno vería y que el
  // muestreo cada 50 ms podría perderse.
  let wUltimo = null, tarjetaUltima = null;
  const mirar = () => {
    const f = $('.iv-progress-fill');
    const w = f ? f.style.width : null;
    if (w !== wUltimo) {
      wUltimo = w;
      const v = A.video();
      A.serie.push({ ms: ms(), comp: A.comp(), vt: v ? +v.currentTime.toFixed(3) : null });
      recortar(A.serie);
    }
    const t = A.tarjeta();
    const id = t ? (t.id || t.tipo) : null;
    if (id !== tarjetaUltima) { tarjetaUltima = id; A.marcas.push({ ms: ms(), txt: 'tarjeta ' + id, comp: A.comp() }); }
  };
  const arrancar = () => {
    new MutationObserver(mirar).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
    setInterval(() => {
      mirar();
      const v = A.video();
      const t = A.tarjeta();
      const sub = $('.iv-subtitle-text');
      const subsBtn = $('button[aria-label="Subtítulos"]');
      A.muestras.push({ ms: ms(), comp: A.comp(), vt: v ? +v.currentTime.toFixed(3) : null, pausado: v ? v.paused : null,
        tarjeta: t ? (t.id || t.tipo) : null, subtitulo: sub ? sub.textContent : null, subsBtn: subsBtn ? subsBtn.getAttribute('aria-pressed') : null });
      recortar(A.muestras);
    }, 50);
  };
  if (document.body) arrancar(); else document.addEventListener('DOMContentLoaded', arrancar);
  A.marcar = (txt) => { A.marcas.push({ ms: ms(), txt, comp: A.comp() }); return ms(); };

  // Para los clics REALES (CDP Input): el centro del elemento y si en ese punto está él
  // (o algo suyo). Los controles ocultos tienen pointer-events: none, así que hasta que
  // el mouse los muestra, en su lugar "está" la capa de toques.
  A.apuntar = (sel, texto) => {
    const el = [...document.querySelectorAll(sel)].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (!texto || e.textContent.trim().startsWith(texto));
    });
    A._objetivo = el || null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  A.estaEn = (x, y) => {
    const el = A._objetivo, h = document.elementFromPoint(x, y);
    return !!(el && h && (el === h || el.contains(h)));
  };
})();
