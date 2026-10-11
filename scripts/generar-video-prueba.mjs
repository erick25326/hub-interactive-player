#!/usr/bin/env node
// Genera el video de prueba del nivel navegador con ffmpeg: un HLS de 78 s con tres
// calidades (240p, 360p y 480p) y audio, en tests/navegador/.video/ (ignorada por git).
//   node scripts/generar-video-prueba.mjs            (no hace nada si ya está bien)
//   node scripts/generar-video-prueba.mjs --forzar
// Por qué existe: las pruebas no pueden depender de un video de Hub Education (el
// repo es público y los videos de los cursos son pagos) ni, en CI, de la red. Se
// genera con los filtros de prueba de ffmpeg (testsrc2 muestra el reloj en pantalla,
// sine es un tono), así que no hay ningún archivo de terceros.
// Forma: la de Bunny. Segmentos .ts con H.264 y el audio AAC MULTIPLEXADO en cada
// variante (sin grupo de audio aparte: así el HLS nativo puede ofrecer calidades, ver
// variantesDelMaster en src/nativePlayer.js) y un master que nombra RESOLUTION.
// Cada variante se codifica por separado y el master se escribe a mano: el
// -var_stream_map de ffmpeg cambia de versión en versión dónde deja el master.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { revisarHls } from '../tests/navegador/apoyo/hls.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR_VIDEO = path.join(RAIZ, 'tests', 'navegador', '.video');
export const DURACION = 78;
// Segmentos de 2 s: un salto o un cambio de calidad baja poco y las pruebas no
// esperan de más. El GOP (50 cuadros a 25 fps) coincide con el segmento.
const SEGMENTO = 2, FPS = 25;
const VARIANTES = [
  { alto: 240, ancho: 426, kbps: 300 },
  { alto: 360, ancho: 640, kbps: 600 },
  { alto: 480, ancho: 854, kbps: 1000 },
];
// Si cambia algo de arriba, el video viejo deja de servir y se regenera.
const VERSION = JSON.stringify({ DURACION, SEGMENTO, FPS, VARIANTES, v: 1 });

export function hayFfmpeg() {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore', windowsHide: true });
  return !r.error && r.status === 0;
}

export async function videoValido(dir = DIR_VIDEO) {
  try {
    if (fs.readFileSync(path.join(dir, '.version'), 'utf8') !== VERSION) return false;
    await revisarHls(async (rel) => fs.readFileSync(path.join(dir, rel || 'playlist.m3u8'), 'utf8'));
    return true;
  } catch { return false; }
}

// `ejecutar(args)` corre ffmpeg con esos argumentos. Se puede inyectar otro: así se
// probó la lógica de este script (master, revisión, versión) en una PC sin ffmpeg.
const ffmpeg = (args, cwd) => spawnSync('ffmpeg', args, { cwd, encoding: 'utf8', windowsHide: true });

export async function generarVideo({ dir = DIR_VIDEO, forzar = false, avisar = console.log, ejecutar = null } = {}) {
  if (!forzar && await videoValido(dir)) return dir;
  if (!ejecutar && !hayFfmpeg()) throw new Error('ffmpeg no está en el PATH');
  ejecutar = ejecutar || ffmpeg;
  fs.rmSync(dir, { recursive: true, force: true });
  const t0 = Date.now();
  for (const v of VARIANTES) {
    const sub = path.join(dir, `${v.alto}p`);
    fs.mkdirSync(sub, { recursive: true });
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=${v.ancho}x${v.alto}:rate=${FPS}:duration=${DURACION}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${DURACION}`,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-level:v', '3.0', '-pix_fmt', 'yuv420p',
      '-b:v', `${v.kbps}k`, '-maxrate:v', `${v.kbps}k`, '-bufsize:v', `${v.kbps * 2}k`,
      '-g', String(FPS * SEGMENTO), '-keyint_min', String(FPS * SEGMENTO), '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '64k', '-ac', '2',
      '-f', 'hls', '-hls_time', String(SEGMENTO), '-hls_playlist_type', 'vod', '-hls_list_size', '0',
      // Rutas relativas y ffmpeg parado en la carpeta de la variante: así la playlist
      // nombra los segmentos sin carpeta (relativos a ella), que es lo que sirve el
      // servidor de pruebas.
      '-hls_segment_filename', 'seg_%03d.ts',
      'video.m3u8',
    ];
    const r = ejecutar(args, sub);
    if (r.error || r.status !== 0) throw new Error(`ffmpeg falló con ${v.alto}p:\n${r.stderr || r.error}`);
  }
  // El master, a mano. CODECS de H.264 Main 3.0 (avc1.4d401e) y AAC-LC (mp4a.40.2),
  // que es lo que pide la línea de arriba. BANDWIDTH con margen sobre el pico.
  const master = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const v of VARIANTES) {
    master.push(`#EXT-X-STREAM-INF:BANDWIDTH=${Math.round((v.kbps + 64) * 1300)},RESOLUTION=${v.ancho}x${v.alto},CODECS="avc1.4d401e,mp4a.40.2"`);
    master.push(`${v.alto}p/video.m3u8`);
  }
  fs.writeFileSync(path.join(dir, 'playlist.m3u8'), master.join('\n') + '\n');
  const { duracion } = await revisarHls(async (rel) => fs.readFileSync(path.join(dir, rel || 'playlist.m3u8'), 'utf8'));
  // Que no falte ningún segmento de los que nombran las playlists.
  for (const v of VARIANTES) {
    const sub = path.join(dir, `${v.alto}p`);
    const segs = fs.readFileSync(path.join(sub, 'video.m3u8'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    for (const s of segs) {
      const tam = fs.existsSync(path.join(sub, s)) ? fs.statSync(path.join(sub, s)).size : -1;
      if (!(tam > 0)) throw new Error(`${tam < 0 ? 'falta' : 'está vacío'} el segmento ${v.alto}p/${s} que nombra la playlist`);
    }
  }
  fs.writeFileSync(path.join(dir, '.version'), VERSION);
  avisar(`video de prueba generado en ${path.relative(RAIZ, dir)} (${duracion.toFixed(1)} s, ${VARIANTES.map((v) => v.alto + 'p').join(' / ')}) en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return dir;
}

// Uso directo desde la línea de comandos.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generarVideo({ forzar: process.argv.includes('--forzar') })
    .then((dir) => { console.log(`listo: ${dir}`); })
    .catch((e) => { console.error(`No se pudo generar el video de prueba: ${e.message}`); process.exit(1); });
}
