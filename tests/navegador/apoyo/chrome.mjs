// Chrome headless PROPIO para las pruebas y un cliente CDP mínimo sobre el WebSocket
// global de Node (22+), sin dependencias.
// 🔴 Reglas de convivencia con el Chrome del usuario (que suele estar abierto):
//  - Siempre con --user-data-dir propio y temporal. Sin él, en Windows chrome.exe le
//    pasa la orden a la sesión abierta (abre una ventana ahí) y sale.
//  - NUNCA `chrome --version` en Windows: no imprime nada y abre una pestaña en el
//    Chrome del usuario ("Se está abriendo en una sesión de navegador existente").
//  - Al terminar se mata SÓLO el árbol del PID que se lanzó (taskkill /PID … /T /F en
//    Windows; el grupo de procesos propio en Linux/macOS). Jamás por nombre de imagen.
//  - El puerto de depuración lo elige el SO (--remote-debugging-port=0) y se lee del
//    archivo DevToolsActivePort del perfil: nada de puertos fijos que choquen.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Dónde está Chrome: CHROME_PATH manda; si no, las rutas de siempre de cada sistema.
export function buscarChrome() {
  const env = process.env.CHROME_PATH;
  if (env) {
    if (!fs.existsSync(env)) throw new Error(`CHROME_PATH apunta a "${env}", que no existe`);
    return env;
  }
  const candidatos = [];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (base) candidatos.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    candidatos.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  } else if (process.platform === 'darwin') {
    candidatos.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    // Linux (CI: ubuntu-latest trae google-chrome en el PATH).
    const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const nombre of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      for (const d of dirs) candidatos.push(path.join(d, nombre));
    }
  }
  return candidatos.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || null;
}

// Mata el árbol de un PID propio. Sincrónica a propósito: también se usa en
// process.on('exit'), donde no se puede esperar nada.
export function matarArbol(pid, grupoPropio) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else if (grupoPropio) process.kill(-pid, 'SIGKILL');
    else process.kill(pid, 'SIGKILL');
  } catch {}
}

export async function borrarConReintentos(dir) {
  // En Windows Chrome tarda un poco en soltar los archivos del perfil.
  for (let i = 0; i < 20; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch { await dormir(150); }
  }
  return false;
}

export async function lanzarChrome({ ejecutable, perfil, ancho = 900, alto = 700 }) {
  fs.rmSync(perfil, { recursive: true, force: true });
  fs.mkdirSync(perfil, { recursive: true });
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`,
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-component-update',
    '--disable-background-networking', `--window-size=${ancho},${alto}`,
  ];
  if (process.platform === 'linux') {
    args.push('--disable-dev-shm-usage');
    // En los runners de CI el sandbox de Chrome puede chocar con AppArmor (Ubuntu 24.04).
    if (process.env.CI) args.push('--no-sandbox');
  }
  args.push('about:blank');
  const grupoPropio = process.platform !== 'win32';
  const hijo = spawn(ejecutable, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: grupoPropio, windowsHide: true });
  let stderr = '';
  hijo.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  let salio = null;
  hijo.on('exit', (code, sig) => { salio = { code, sig }; });
  // Red de seguridad: si el proceso de Node termina de golpe, que no quede Chrome vivo.
  const alSalir = () => { if (!salio) matarArbol(hijo.pid, grupoPropio); };
  process.on('exit', alSalir);

  const archivoPuerto = path.join(perfil, 'DevToolsActivePort');
  let puerto = null, rutaNavegador = null;
  for (let i = 0; i < 200 && !salio; i++) {
    try {
      const [p, ruta] = fs.readFileSync(archivoPuerto, 'utf8').split(/\r?\n/);
      if (Number(p) > 0) { puerto = Number(p); rutaNavegador = ruta; break; }
    } catch {}
    await dormir(100);
  }
  if (!puerto) {
    matarArbol(hijo.pid, grupoPropio);
    throw new Error(`Chrome no abrió el puerto de depuración${salio ? ` (salió con ${JSON.stringify(salio)})` : ''}. stderr:\n${stderr}`);
  }
  let objetivos = [];
  for (let i = 0; i < 100; i++) {
    try { objetivos = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json(); if (objetivos.some((t) => t.type === 'page')) break; } catch {}
    await dormir(100);
  }
  const pagina = objetivos.find((t) => t.type === 'page');
  if (!pagina) { matarArbol(hijo.pid, grupoPropio); throw new Error('Chrome arrancó sin pestaña'); }
  const navegador = await conectarCDP(`ws://127.0.0.1:${puerto}${rutaNavegador}`);
  const cdp = await conectarCDP(pagina.webSocketDebuggerUrl);

  return {
    pid: hijo.pid, cdp,
    async cerrar() {
      try { await Promise.race([navegador.cmd('Browser.close'), dormir(3000)]); } catch {}
      for (let i = 0; i < 30 && !salio; i++) await dormir(100);
      cdp.cerrar(); navegador.cerrar();
      if (!salio) matarArbol(hijo.pid, grupoPropio);
      process.off('exit', alSalir);
      await borrarConReintentos(perfil);
    },
  };
}

// Cliente CDP mínimo: comandos con tope de tiempo (un comando que no vuelve no tiene
// que colgar la suite) y oyentes de eventos.
export async function conectarCDP(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, mal) => {
    const t = setTimeout(() => mal(new Error('CDP: el WebSocket no abrió')), 10000);
    ws.addEventListener('open', () => { clearTimeout(t); ok(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); mal(new Error('CDP: error al abrir el WebSocket')); }, { once: true });
  });
  let id = 0;
  const pendientes = new Map();
  const oyentes = new Set();
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pendientes.has(d.id)) {
      const p = pendientes.get(d.id); pendientes.delete(d.id); clearTimeout(p.t);
      if (d.error) p.mal(new Error(`${p.metodo}: ${d.error.message}`)); else p.ok(d.result);
    } else if (d.method) oyentes.forEach((f) => { try { f(d); } catch {} });
  });
  ws.addEventListener('close', () => {
    for (const p of pendientes.values()) { clearTimeout(p.t); p.mal(new Error(`${p.metodo}: se cerró la conexión con Chrome`)); }
    pendientes.clear();
  });
  const cmd = (metodo, params = {}, tope = 30000) => new Promise((ok, mal) => {
    const i = ++id;
    const t = setTimeout(() => { pendientes.delete(i); mal(new Error(`${metodo}: sin respuesta en ${tope} ms`)); }, tope);
    pendientes.set(i, { ok, mal, t, metodo });
    try { ws.send(JSON.stringify({ id: i, method: metodo, params })); } catch (e) { clearTimeout(t); pendientes.delete(i); mal(e); }
  });
  // Evalúa en la página y devuelve el valor (las promesas se esperan).
  const ev = async (expresion, tope = 30000) => {
    const r = await cmd('Runtime.evaluate', { expression: expresion, returnByValue: true, awaitPromise: true }, tope);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`en la página: ${(d.exception && (d.exception.description || d.exception.value)) || d.text}`);
    }
    return r.result ? r.result.value : undefined;
  };
  return {
    cmd, ev,
    on(f) { oyentes.add(f); return () => oyentes.delete(f); },
    cerrar() { try { ws.close(); } catch {} },
  };
}
