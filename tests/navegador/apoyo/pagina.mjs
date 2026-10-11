// La pestaña de las pruebas, del lado de Node: abrir el reproductor con un avance
// dado, esperar condiciones, clics y toques REALES (CDP Input: el navegador los trata
// como de una persona, con activación de usuario) y lectura del ayudante de la página.
// Las condiciones se escriben como expresiones de JS con `A` = window.__ivp (ver
// ayudante-pagina.js), p. ej. esperar(`A.tarjeta()?.id === 'tf25'`).
import fs from 'node:fs';
import path from 'node:path';
import { dormir } from './chrome.mjs';

export class Pagina {
  constructor(cdp, base, dirSalida) {
    this.cdp = cdp;
    this.base = base;
    this.dirSalida = dirSalida;
    this.marco = false;
  }

  // La ventana del reproductor: la página, o el iframe en /marco.html.
  get W() { return this.marco ? `document.querySelector('iframe').contentWindow` : 'window'; }
  ev(expr, tope) { return this.cdp.ev(expr, tope); }
  // Evalúa con A = el ayudante de la página del reproductor y D = su documento (en
  // /marco.html, el del iframe). Sin tirar si todavía no está.
  a(expr) { return this.cdp.ev(`(() => { try { const W = ${this.W}, A = W.__ivp, D = W.document; if (!A) return null; return (${expr}); } catch (e) { return null; } })()`); }
  estado() { return this.a('A.estado()'); }

  // Espera a que la expresión dé algo verdadero; devuelve ese valor o null al vencer.
  async esperar(expr, tope = 15000, paso = 50) {
    const fin = Date.now() + tope;
    for (;;) {
      const v = await this.a(expr);
      if (v) return v;
      if (Date.now() > fin) return null;
      await dormir(paso);
    }
  }
  // Lo mismo en el documento de ARRIBA (en /marco.html, la página que contiene el iframe).
  async esperarArriba(expr, tope = 5000) {
    const fin = Date.now() + tope;
    for (;;) {
      const v = await this.cdp.ev(`(() => { try { return (${expr}); } catch (e) { return null; } })()`);
      if (v || Date.now() > fin) return v || null;
      await dormir(50);
    }
  }
  // Igual, pero si vence es una falla con el estado de la página en el mensaje.
  async debe(expr, tope, que) {
    const v = await this.esperar(expr, tope);
    if (!v) throw new Error(`${que || 'no se cumplió: ' + expr} (esperé ${tope} ms) · estado: ${JSON.stringify(await this.estado())}`);
    return v;
  }

  // Abre una página del servidor de pruebas sin restos de la anterior: primero una en
  // blanco del mismo origen (así la anterior ya no puede escribir nada), después se
  // borra el localStorage y recién ahí se navega. `progreso` es el avance guardado con
  // que arranca (lo escribe el servidor antes del bundle); `esperarEn`, el segundo en
  // que tiene que quedar el componente al restaurarlo. Con `esperarEn`, además, se
  // espera a que el medio termine ese salto (con datos) y se confirma dónde quedó.
  // 🔴 El HLS nativo de CHROME (no el de Safari: en producción Chrome usa hls.js) no
  // es preciso en un salto hecho apenas llega la metadata, que es justo la
  // restauración: a veces aterriza al principio del segmento (medido oct-2026 con el
  // stream de Mux: 10,46 en vez de 15 o 20; con el video ya en caché, casi siempre).
  // Los saltos posteriores sí son precisos. Por eso, con `ubicar` (por defecto) y el
  // motor nativo, si quedó antes se lo lleva al segundo pedido con un salto ya con
  // datos: esas pruebas usan la restauración sólo para ubicarse. La prueba que mide la
  // restauración en sí pasa `ubicar: false` y lo mira ella.
  // `asentar: false` vuelve apenas el componente muestra `esperarEn`, sin esperar al
  // medio (para probar algo DENTRO de la ventana de la restauración).
  async abrir({ pagina = 'player.html', query = {}, progreso = null, esperarEn = null, asentar = true, ubicar = true, tope = 30000 } = {}) {
    this.marco = pagina === 'marco.html';
    await this.cdp.cmd('Page.navigate', { url: `${this.base}/vacio.html` });
    for (let i = 0; i < 100; i++) {
      if (await this.cdp.ev(`location.pathname === '/vacio.html' && document.readyState === 'complete'`).catch(() => false)) break;
      await dormir(50);
    }
    await this.cdp.cmd('Storage.clearDataForOrigin', { origin: this.base, storageTypes: 'local_storage' });
    const q = new URLSearchParams(query);
    if (progreso) q.set('progreso', JSON.stringify({ updatedAt: Date.now(), ...progreso }));
    await this.cdp.cmd('Page.navigate', { url: `${this.base}/${pagina}?${q}` });
    await this.debe('A.listo()', tope, 'el reproductor no quedó listo');
    const e = await this.estado();
    if (e.error) throw new Error(`el reproductor mostró un error: ${e.error}`);
    if (esperarEn == null) return e;
    await this.debe(`Math.abs(A.comp() - ${esperarEn}) < 0.3`, 8000, `no restauró el avance en ${esperarEn}`);
    if (!asentar) return this.estado();
    await this.debe(`!A.video().seeking && A.video().readyState >= 2`, 15000, `el salto de la restauración a ${esperarEn} no terminó`);
    await dormir(150);   // el timeupdate de donde aterrizó
    const quedo = await this.estado();
    if (ubicar && Math.abs(quedo.vt - esperarEn) > 0.3) {
      if (quedo.motor !== 'nativo') throw new Error(`la restauración en ${esperarEn} aterrizó en ${quedo.vt}: ${JSON.stringify(quedo)}`);
      this.reubicaciones = (this.reubicaciones || 0) + 1;
      await this.a(`(A.video().currentTime = ${esperarEn}, true)`);
      await this.debe(`Math.abs(A.comp() - ${esperarEn}) < 0.3 && !A.video().seeking && A.video().readyState >= 2`, 15000, `no se pudo ubicar en ${esperarEn} (el nativo restauró en ${quedo.vt})`);
    }
    return this.estado();
  }

  // Coordenadas del centro de un elemento en la ventana de la pestaña (suma el iframe).
  async apuntar(sel, texto) {
    const p = await this.a(`A.apuntar(${JSON.stringify(sel)}, ${JSON.stringify(texto || null)})`);
    if (!p) return null;
    let ox = 0, oy = 0;
    if (this.marco) {
      const r = await this.ev(`(() => { const b = document.querySelector('iframe').getBoundingClientRect(); return { x: b.left, y: b.top }; })()`);
      ox = r.x; oy = r.y;
    }
    return { x: p.x + ox, y: p.y + oy, lx: p.x, ly: p.y };
  }

  // Clic REAL con el mouse. Antes de apretar, pasa el mouse por encima (eso muestra los
  // controles ocultos) y confirma que en ese punto está el elemento y no otra cosa.
  async clic(sel, { texto } = {}) {
    for (let intento = 0; intento < 6; intento++) {
      const p = await this.apuntar(sel, texto);
      if (!p) { await dormir(150); continue; }
      await this.cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
      await dormir(120);
      if (!(await this.a(`A.estaEn(${p.lx}, ${p.ly})`))) { await dormir(150); continue; }
      await this.cdp.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await this.cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      return;
    }
    throw new Error(`no se pudo hacer clic en ${sel}${texto ? ` "${texto}"` : ''}: no está o está tapado · estado: ${JSON.stringify(await this.estado())}`);
  }

  // Toque REAL (pantalla táctil emulada; ver vista()). El navegador sintetiza el click.
  async toque(sel, { texto } = {}) {
    for (let intento = 0; intento < 6; intento++) {
      const p = await this.apuntar(sel, texto);
      if (!p || !(await this.a(`A.estaEn(${p.lx}, ${p.ly})`))) { await dormir(150); continue; }
      await this.cdp.cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await dormir(40);
      await this.cdp.cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return;
    }
    throw new Error(`no se pudo tocar ${sel}: no está o está tapado · estado: ${JSON.stringify(await this.estado())}`);
  }

  // Responde la tarjeta abierta con clics reales, como una persona.
  async responder() {
    const t = await this.a('A.tarjeta()');
    if (!t) throw new Error('no hay tarjeta para responder');
    if (t.tipo === 'nota') return this.clic('.iv-note-card .iv-btn-primary');
    if (t.tipo === 'vf') {
      await this.clic('.iv-tf-btn', { texto: 'Verdadero' });
      await this.clic('.iv-tf-card .iv-btn-primary', { texto: 'Confirmar' });
      return this.clic('.iv-tf-card .iv-btn-primary', { texto: 'Continuar' });
    }
    throw new Error(`tipo de tarjeta sin respuesta automática: ${t.tipo}`);
  }

  // Botón de reproducir de la fila (el grande dice "Reproducir video").
  reproducir() { return this.clic('.iv-controls-row button[aria-label="Reproducir"]'); }

  // Tamaño de la pestaña. Sin argumentos vuelve al de la ventana (900×700).
  async vista({ ancho, alto, movil = false, escala = 1, tactil = false } = {}) {
    if (!ancho) await this.cdp.cmd('Emulation.clearDeviceMetricsOverride');
    else await this.cdp.cmd('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: escala, mobile: movil });
    await this.cdp.cmd('Emulation.setTouchEmulationEnabled', tactil ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  }

  // Captura para mirar una falla (la sube el workflow como artefacto).
  async capturar(nombre) {
    try {
      fs.mkdirSync(this.dirSalida, { recursive: true });
      const r = await this.cdp.cmd('Page.captureScreenshot', { format: 'png' }, 10000);
      const archivo = path.join(this.dirSalida, nombre.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 90) + '.png');
      fs.writeFileSync(archivo, Buffer.from(r.data, 'base64'));
      return archivo;
    } catch { return null; }
  }
}

// Caídas (hacia atrás) o saltos (hacia adelante) del tiempo del COMPONENTE entre dos
// renders seguidos, desde `desdeMs`. Es lo que el alumno vería como "el video saltó".
// A 2× los renders llegan cada ~0,5 s de video: 1,2 s de salto ya no es normal.
export function anomalias(serie, { desdeMs = 0, hastaMs = Infinity, caida = 0.05, salto = 1.2 } = {}) {
  const out = [];
  let prev = null;
  for (const m of serie) {
    if (m.ms < desdeMs || m.ms > hastaMs || m.comp == null) continue;
    if (prev) {
      const d = m.comp - prev.comp;
      if (d < -caida || d > salto) out.push({ ms: m.ms, de: prev.comp, a: m.comp });
    }
    prev = m;
  }
  return out;
}

export const cerca = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;
