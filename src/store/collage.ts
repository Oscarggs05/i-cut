import type { AspectId, Asset, MediaClip, Project, Selection } from '../types';
import { library } from '../media/library';
import { aspectRatio, clipDuration, layoutMain, newMediaClip, uid } from '../engine/timeline';
import { collageById, fitClipToCell } from '../engine/collage';
import { importFiles, mainIndexAt, refreshCover } from './actions';
import { getPlayer, useEditor } from './editor';

const S = () => useEditor.getState();

/** How long a collage made only of photos lasts. */
export const PHOTO_COLLAGE_SECONDS = 5;

export interface CollageStyle {
  template: string;
  aspect: AspectId;
  /** Spacing between cells as a fraction of the shorter side. */
  gap: number;
  /** Corner rounding as a fraction of each cell's shorter side. */
  radius: number;
  /** Color shown in the gaps. */
  color: string;
}

/** The collage the user is working on: the selected clip's, or the one under the playhead. */
export function activeCollage(p: Project, sel: Selection, t: number): string | null {
  if (sel && (sel.kind === 'main' || sel.kind === 'overlay')) {
    const list = sel.kind === 'main' ? p.main : p.overlays;
    const c = list.find((x) => x.id === sel.id);
    if (c?.collage) return c.collage.id;
  }
  if (!p.main.length) return null;
  return p.main[mainIndexAt(p, t)]?.collage?.id ?? null;
}

/** Clips of a collage, the main-track clip first and then by cell. */
export function collageClips(p: Project, id: string): MediaClip[] {
  const main = p.main.filter((c) => c.collage?.id === id);
  const over = p.overlays.filter((c) => c.collage?.id === id).sort((a, b) => a.collage!.cell - b.collage!.cell);
  return [...main.slice(0, 1), ...over];
}

/** Current style of a collage, read back from its clips. */
export function collageStyle(p: Project, id: string): CollageStyle | null {
  const first = collageClips(p, id)[0];
  if (!first?.collage) return null;
  return {
    template: first.collage.template,
    aspect: p.aspect,
    gap: first.collage.gap,
    radius: first.radius ?? 0,
    color: p.background.type === 'color' ? p.background.color : '#ffffff',
  };
}

function collageStart(p: Project, id: string): number {
  return layoutMain(p.main).find((l) => l.clip.collage?.id === id)?.start ?? 0;
}

/**
 * Places every clip of a collage in its cell. Clips beyond the template's
 * cells are removed. Returns how many cells are still empty.
 */
function layout(d: Project, id: string, s: CollageStyle): number {
  const tpl = collageById(s.template);
  d.aspect = s.aspect;
  d.background = { ...d.background, type: 'color', color: s.color };
  const ratio = aspectRatio(d);
  const clips = collageClips(d, id);
  const drop = new Set<string>();
  clips.forEach((c, i) => {
    if (i >= tpl.cells.length) { drop.add(c.id); return; }
    const a = d.assets.find((x) => x.id === c.assetId);
    if (!a) return;
    fitClipToCell(c, a, tpl.cells[i], ratio, s.gap, s.radius);
    c.collage = { id, template: tpl.id, cell: i, gap: s.gap };
  });
  if (drop.size) d.overlays = d.overlays.filter((c) => !drop.has(c.id));
  return Math.max(0, tpl.cells.length - clips.length);
}

/** Changes the template or the look of an existing collage. */
export function restyleCollage(id: string, s: CollageStyle) {
  const before = collageClips(S().project!, id).length;
  S().update((d) => { layout(d, id, s); }, 'collage:' + id);
  const removed = before - collageClips(S().project!, id).length;
  if (removed > 0) S().showToast(`Se quitaron ${removed} clip${removed > 1 ? 's' : ''} que no caben (puedes deshacer)`);
}

/** Trims a clip so it lasts `d` seconds on the timeline (when it is long enough). */
function trimTo(c: MediaClip, d: number, kind: string) {
  if (kind === 'image') { c.out = c.in + d; return; }
  if (c.curve) return;
  c.out = Math.min(c.out, c.in + d * c.speed);
}

/** Every cell lasts as long as the shortest video, so none goes blank early. */
function commonDuration(clips: { kind: string; dur: number }[]): number {
  const v = clips.filter((x) => x.kind === 'video').map((x) => x.dur);
  return v.length ? Math.max(0.5, Math.min(...v)) : PHOTO_COLLAGE_SECONDS;
}

function report(id: string, extra: number) {
  const p = S().project!;
  const s = collageStyle(p, id);
  const missing = s ? collageById(s.template).cells.length - collageClips(p, id).length : 0;
  S().showToast(missing > 0 ? `Collage listo. Faltan ${missing} hueco${missing > 1 ? 's' : ''} por llenar`
    : extra > 0 ? `Collage listo. ${extra} archivo${extra > 1 ? 's' : ''} no cabía${extra > 1 ? 'n' : ''}` : 'Collage listo');
}

/**
 * Imports `files` into a collage. With `into`, they fill that collage's empty
 * cells; otherwise a new collage is added at the end of the timeline.
 */
export async function addCollageFiles(files: File[], s: CollageStyle, into: string | null) {
  const assets = (await importFiles(files)).filter((a) => a.kind !== 'audio');
  if (assets.length) addCollageAssets(assets, s, into);
}

/** Same as addCollageFiles for media already imported (assets may already be in the project). */
export function addCollageAssets(assets: Asset[], s: CollageStyle, into: string | null): string | null {
  if (!assets.length) return null;
  const p0 = S().project!;
  const existing = into ? collageClips(p0, into) : [];
  const free = collageById(s.template).cells.length - existing.length;
  const used = assets.slice(0, Math.max(0, free));
  if (!used.length) { S().showToast('Esta plantilla ya está llena: elige una con más huecos'); return null; }
  const id = into ?? uid();
  let start = 0;
  let mainId = existing[0]?.id ?? '';
  S().update((d) => {
    d.assets.push(...assets.filter((a) => !d.assets.some((x) => x.id === a.id)));
    const firstMain = existing.length ? d.main.find((c) => c.id === existing[0].id)! : null;
    start = firstMain ? collageStart(d, id) : (layoutMain(d.main).at(-1)?.end ?? 0);
    const duration = firstMain ? clipDuration(firstMain) : commonDuration(used.map((a) => ({ kind: a.kind, dur: a.duration })));
    let audible = collageClips(d, id).some((c) => !c.muted && d.assets.find((a) => a.id === c.assetId)?.hasAudio);
    used.forEach((a, i) => {
      const c: MediaClip = newMediaClip(a);
      trimTo(c, duration, a.kind);
      if (a.kind === 'video' && a.hasAudio) { c.muted = audible; audible = true; }
      c.collage = { id, template: s.template, cell: existing.length + i, gap: s.gap };
      if (!firstMain && i === 0) { d.main.push(c); mainId = c.id; } else { c.start = start; d.overlays.push(c); }
    });
    layout(d, id, s);
  }, 'collage-add');
  for (const a of assets) { void library.thumbnails(a); void library.audioBuffer(a); }
  getPlayer()?.seek(start);
  S().setTime(start, false);
  S().select({ kind: 'main', id: mainId });
  S().setSheet('collage');
  report(id, assets.length - used.length);
  void refreshCover();
  return id;
}

/**
 * Turns the clips already on the main track (from the one under the playhead)
 * into a collage: they play at the same time, each in its cell.
 */
export function collageFromClips(s: CollageStyle): boolean {
  const p = S().project!;
  const cells = collageById(s.template).cells.length;
  const i0 = mainIndexAt(p, S().time);
  const picked = p.main.slice(i0, i0 + cells).filter((c) => !c.collage);
  if (picked.length < 2) {
    S().showToast('Necesitas al menos 2 clips en la pista principal (desde el cursor)');
    return false;
  }
  const id = uid();
  const ids = new Set(picked.map((c) => c.id));
  let start = 0;
  S().update((d) => {
    const clips = d.main.filter((c) => ids.has(c.id));
    const kinds = clips.map((c) => ({ kind: d.assets.find((a) => a.id === c.assetId)?.kind ?? 'video', dur: clipDuration(c) }));
    const duration = commonDuration(kinds);
    start = layoutMain(d.main).find((l) => l.clip.id === clips[0].id)?.start ?? 0;
    let audible = false;
    clips.forEach((c, i) => {
      const a = d.assets.find((x) => x.id === c.assetId);
      trimTo(c, duration, a?.kind ?? 'video');
      if (a?.kind === 'video' && a.hasAudio && !c.muted) { c.muted = audible; audible = true; }
      c.animIn = null; c.animOut = null;
      c.collage = { id, template: s.template, cell: i, gap: s.gap };
      if (i > 0) c.start = start;
    });
    clips[0].transition = null;
    d.main = d.main.filter((c) => c === clips[0] || !ids.has(c.id));
    d.overlays.push(...clips.slice(1));
    layout(d, id, s);
  }, 'collage-clips');
  getPlayer()?.seek(start);
  S().setTime(start, false);
  S().select({ kind: 'main', id: picked[0].id });
  S().setSheet('collage');
  report(id, 0);
  return true;
}
