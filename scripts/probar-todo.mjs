#!/usr/bin/env node
// `npm test`: las tres capas de pruebas, en orden, y un resumen al final.
//   1. unitarias (siempre; sin navegador)          → npm run test:unit
//   2. PHP con lib.php real (si hay php en el PATH) → npm run test:php
//   3. navegador (Chrome headless; si no hay Chrome o video de prueba se saltea solo,
//      con el motivo)                               → npm run test:navegador
// Corre las tres aunque una falle (para ver todo de una vez) y sale con 1 si alguna
// falló. Los archivos de las unitarias se listan acá y no con un glob: así anda con
// cualquier Node 20+ y cualquier shell (cmd.exe no expande globs).
//
// 🔴 Una capa que se salteó NO es una capa que anduvo. El nivel navegador se saltea
// adentro de node:test (sale con 0), así que el código de salida no alcanza: el resumen
// decía "navegador bien" sin haber abierto Chrome, y sin ese nivel el cableado del
// candado en el componente queda sin ninguna prueba. La capa avisa por un archivo
// (IVP_AVISOS) si se salteó entera o en parte, y acá se muestra.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unitarias = fs.readdirSync(path.join(RAIZ, 'tests', 'unit')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join('tests', 'unit', f));

const hayPhp = () => { const r = spawnSync('php', ['-v'], { stdio: 'ignore', windowsHide: true }); return !r.error && r.status === 0; };

const capas = [
  { nombre: 'unitarias', cmd: process.execPath, args: ['--test', ...unitarias] },
  { nombre: 'php', cmd: 'php', args: [path.join('tests', 'php', 'correr.php')], omitir: () => (hayPhp() ? null : 'no hay PHP en el PATH (corre en CI)') },
  { nombre: 'navegador', cmd: process.execPath, args: ['--test', path.join('tests', 'navegador', 'navegador.test.mjs')] },
];

// Lo que la capa dejó dicho en IVP_AVISOS: { salteada: motivo } o { parcial: [motivos] }.
function leerAvisos(archivo) {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { return {}; } finally { try { fs.rmSync(archivo, { force: true }); } catch {} }
}

const resumen = [];
for (const c of capas) {
  const motivo = c.omitir && c.omitir();
  if (motivo) { console.log(`\n── ${c.nombre}: se saltea (${motivo})`); resumen.push({ ...c, estado: 'salteada', motivo }); continue; }
  console.log(`\n── ${c.nombre}`);
  const avisos = path.join(os.tmpdir(), `ivp-avisos-${process.pid}-${c.nombre}.json`);
  fs.rmSync(avisos, { force: true });
  const t0 = Date.now();
  const r = spawnSync(c.cmd, c.args, { cwd: RAIZ, stdio: 'inherit', windowsHide: true, env: { ...process.env, IVP_AVISOS: avisos } });
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  const a = leerAvisos(avisos);
  let estado = r.status === 0 ? 'bien' : `FALLÓ (código ${r.status ?? r.error?.code})`;
  let nota = null;
  if (r.status === 0 && a.salteada) { estado = 'salteada'; nota = a.salteada; }
  else if (a.parcial && a.parcial.length) nota = `en parte salteada: ${a.parcial.join(' · ')}`;
  resumen.push({ ...c, estado, s, motivo: nota });
}

console.log('\n── resumen');
for (const r of resumen) console.log(`  ${r.nombre.padEnd(10)} ${r.estado}${r.s ? ` · ${r.s} s` : ''}${r.motivo ? ` · ${r.motivo}` : ''}`);
process.exit(resumen.some((r) => r.estado.startsWith('FALLÓ')) ? 1 : 0);
