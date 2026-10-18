// Sin video configurado (plan de migración a Bunny, 0.3: config por defecto neutra).
// Hasta la 1.4.0 la config por defecto traía una clase real del campus, así que un
// reproductor sin PLAYER_CONFIG (o con uno sin video) la reproducía. Ahora no trae video,
// y sin video el reproductor tiene que DECIRLO: ni "Cargando video..." para siempre, ni
// la pantalla en blanco (el SDK de Vimeo tira con un id vacío o NaN y React desmontaba
// todo), ni un pedido a Vimeo, ni nada guardado como avance.
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { paso } from '../apoyo/entorno.mjs';
import { dormir } from '../apoyo/chrome.mjs';

export function registrar(entorno) {
  const p = entorno.pagina;
  const cartel = `D.querySelector('.iv-sin-video')?.textContent`;
  describe('sin video configurado', () => {
    for (const [titulo, query, tituloEsperado] of [
      ['sin PLAYER_CONFIG (la config por defecto del bundle)', { config: 'ninguna' }, 'Hub Education — Video Interactivo'],
      ['con PLAYER_CONFIG sin video (vimeoId vacío y sin videoUrl)', { video: 'ninguno' }, 'Prueba del reproductor'],
      ['con un vimeoId que no es un ID (el de config.example.js)', { video: 'texto' }, 'Prueba del reproductor'],
    ]) {
      paso(entorno, `${titulo}: muestra "No hay video para mostrar" y no crea ningún reproductor`, async () => {
        await p.abrir({ query, listo: cartel, tope: 15000 });
        // Lo que podría llegar tarde (un efecto, un SDK que tira): que tenga tiempo.
        await dormir(1500);
        const r = await p.a(`({
          cartel: ${cartel},
          titulo: D.querySelector('.iv-top-title')?.textContent,
          rol: D.querySelector('.iv-sin-video')?.getAttribute('role'),
          cargando: !!D.querySelector('.iv-loading'),
          error: !!D.querySelector('.iv-error'),
          marcos: D.querySelectorAll('iframe').length,
          videos: D.querySelectorAll('video').length,
          controles: !!D.querySelector('.iv-controls'),
          vimeo: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /vimeo/i.test(n)),
          guardados: A.guardados.length,
          avance: Object.keys(localStorage).filter((k) => k.startsWith('iv_progress_')),
        })`);
        assert.ok(r, 'no se pudo leer la página');
        assert.match(r.cartel || '', /No hay video para mostrar/);
        assert.match(r.cartel, /le falta el video/);
        assert.equal(r.rol, 'status');
        assert.equal(r.titulo, tituloEsperado);
        assert.equal(r.cargando, false, 'quedó "Cargando video..."');
        assert.equal(r.error, false, 'mostró el cartel de error del video, con Reintentar: no hay nada que reintentar');
        assert.equal(r.marcos, 0, 'creó el iframe de Vimeo');
        assert.equal(r.videos, 0, 'creó un <video>');
        assert.equal(r.controles, false, 'dibujó los controles de un video que no existe');
        assert.deepEqual(r.vimeo, [], 'pidió algo a Vimeo');
        assert.equal(r.guardados, 0, 'guardó avance de un video que no existe');
        assert.deepEqual(r.avance, []);
        // Las excepciones sin atrapar (el SDK de Vimeo tirando) las mira paso() al final.
      }, { timeout: 30000 });
    }
  });
}
