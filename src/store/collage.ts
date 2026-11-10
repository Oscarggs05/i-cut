import type { AspectId, MediaClip } from '../types';
import { library } from '../media/library';
import { aspectRatio, layoutMain, newMediaClip } from '../engine/timeline';
import { collageById, fitClipToCell } from '../engine/collage';
import { importFiles, refreshCover } from './actions';
import { getPlayer, useEditor } from './editor';

const S = () => useEditor.getState();

/** How long a collage made only of photos lasts. */
export const PHOTO_COLLAGE_SECONDS = 5;

export interface CollageOptions {
  template: string;
  aspect: AspectId;
  /** Spacing between cells as a fraction of the shorter side. */
  gap: number;
  /** Corner rounding as a fraction of each cell's shorter side. */
  radius: number;
  /** Color shown in the gaps. */
  color: string;
}

/**
 * Imports `files` and adds a collage at the end of the timeline. The first cell
 * becomes a main-track clip and the others overlays that start and end with it.
 */
export async function addCollage(files: File[], o: CollageOptions) {
  const tpl = collageById(o.template);
  const assets = (await importFiles(files)).filter((a) => a.kind !== 'audio');
  if (!assets.length) return;
  const used = assets.slice(0, tpl.cells.length);
  const videos = used.filter((a) => a.kind === 'video');
  // Every cell lasts as long as the shortest video, so none goes blank early.
  const duration = videos.length ? Math.max(0.5, Math.min(...videos.map((a) => a.duration))) : PHOTO_COLLAGE_SECONDS;
  let start = 0;
  let mainId = '';
  S().update((d) => {
    d.aspect = o.aspect;
    d.background = { ...d.background, type: 'color', color: o.color };
    d.assets.push(...assets);
    const ratio = aspectRatio(d);
    const layout = layoutMain(d.main);
    start = layout.length ? layout[layout.length - 1].end : 0;
    let audible = false;
    used.forEach((a, i) => {
      const c: MediaClip = newMediaClip(a);
      c.out = c.in + (a.kind === 'video' ? Math.min(duration, a.duration) : duration);
      // Only the first video with sound plays it; the rest start muted.
      if (a.kind === 'video' && a.hasAudio) { c.muted = audible; audible = true; }
      fitClipToCell(c, a, tpl.cells[i], ratio, o.gap, o.radius);
      if (i === 0) { d.main.push(c); mainId = c.id; } else { c.start = start; d.overlays.push(c); }
    });
  }, 'collage');
  for (const a of assets) { void library.thumbnails(a); void library.audioBuffer(a); }
  getPlayer()?.seek(start);
  S().setTime(start, false);
  S().select({ kind: 'main', id: mainId });
  const missing = tpl.cells.length - used.length;
  const extra = assets.length - used.length;
  S().showToast(missing > 0 ? `Collage creado. Faltan ${missing} hueco${missing > 1 ? 's' : ''} por llenar` : extra > 0 ? `Collage creado. Se usaron ${used.length} de ${assets.length} archivos` : 'Collage creado');
  void refreshCover();
}
