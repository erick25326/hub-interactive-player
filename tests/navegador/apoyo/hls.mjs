// Revisión de un HLS de prueba (local o remoto) antes de gastar una corrida entera en
// él: que sea un master, que tenga al menos dos calidades con RESOLUTION (las pruebas
// de calidad las necesitan) y que dure más de 70 s (hay una pregunta en el 60).
// `leer(ruta)` devuelve el texto de la playlist relativa al master ('' = el master).

export const DURACION_MINIMA = 70;

export function variantesDe(master) {
  const lineas = String(master).split(/\r?\n/).map((l) => l.trim());
  const out = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!lineas[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(lineas[i]);
    const uri = lineas.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (uri) out.push({ uri, alto: res ? Math.min(Number(res[1]), Number(res[2])) : 0 });
  }
  return out;
}

export function duracionDe(playlist) {
  return [...String(playlist).matchAll(/#EXTINF:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
}

// Devuelve { variantes, duracion } o tira un Error que dice qué falta.
export async function revisarHls(leer) {
  const master = await leer('');
  if (!/^#EXTM3U/.test(master.trim())) throw new Error('no es una playlist HLS (falta #EXTM3U)');
  const variantes = variantesDe(master);
  const altos = new Set(variantes.map((v) => v.alto).filter(Boolean));
  if (altos.size < 2) throw new Error(`hacen falta al menos dos calidades con RESOLUTION en el master (hay ${altos.size})`);
  if (/^#EXT-X-MEDIA:.*TYPE=AUDIO/im.test(master)) throw new Error('el audio va en un grupo aparte: con el HLS nativo no habría menú de calidad');
  const variante = await leer(variantes[0].uri);
  const duracion = duracionDe(variante);
  if (!(duracion >= DURACION_MINIMA)) throw new Error(`dura ${duracion.toFixed(1)} s; hacen falta ${DURACION_MINIMA} o más (hay una pregunta en el 60)`);
  // El segmento más largo: hasta ahí puede errarle el HLS nativo de Chrome a un salto
  // hecho apenas llega la metadata (ver Pagina.abrir).
  const segmento = Math.max(...[...String(variante).matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1])));
  return { variantes, duracion, segmento };
}
