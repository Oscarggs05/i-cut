// Actions for keyframes, reverse and stabilization.

import type { KfProp, MediaClip, Project, Selection } from '../types';
import { KF_SNAP, kfIndexAt, removeKeyframe, setProp, upsertKeyframe, type KfClip } from '../engine/keyframes';
import { itemDuration, layoutMain } from '../engine/timeline';
import { library } from '../media/library';
import { reverseVideo } from '../media/reverse';
import { analyzeShake } from '../media/stabilize';
import { findSelected } from './actions';
import { getPlayer, useEditor } from './editor';

const S = () => useEditor.getState();

/** Timeline start of the selected clip. */
export function clipStart(p: Project, sel: Selection): number {
  if (!sel) return 0;
  if (sel.kind === 'main' || sel.kind === 'transition') return layoutMain(p.main).find((l) => l.clip.id === sel.id)?.start ?? 0;
  const c = findSelected(p, sel);
  return c && 'start' in c ? c.start : 0;
}

/** Selected clip that can hold keyframes, with the playhead's local time. */
export function keyframeTarget(p: Project, sel: Selection, time: number): { clip: KfClip; local: number; inside: boolean } | null {
  if (!sel || sel.kind === 'transition') return null;
  const clip = findSelected(p, sel);
  if (!clip) return null;
  const local = time - clipStart(p, sel);
  return { clip, local, inside: local >= -0.01 && local <= itemDuration(clip) + 0.01 };
}

/** Adds a keyframe at the playhead, or removes the one that is there. */
export function toggleKeyframe() {
  const s = S();
  const p = s.project;
  const t = keyframeTarget(p!, s.selection, s.time);
  if (!p || !t) return;
  if (!t.inside) { s.showToast('Mueve el cursor dentro del clip'); return; }
  const had = kfIndexAt(t.clip, t.local) >= 0;
  const local = Math.max(0, Math.min(itemDuration(t.clip), t.local));
  s.update((d) => {
    const c = findSelected(d, s.selection) as KfClip | null;
    if (!c) return;
    if (had) removeKeyframe(c, t.local); else upsertKeyframe(c, local);
  });
  navigator.vibrate?.(8);
  if (!had && (t.clip.keyframes?.length ?? 0) === 0) s.showToast('Keyframe añadido. Mueve el cursor y cambia la posición, escala, opacidad… para animar');
}

/** Sets properties as seen at the playhead (writes a keyframe when the clip has them). */
export function setSelectedProps(vals: Partial<Record<KfProp, number>>, key?: string) {
  const s = S();
  const sel = s.selection;
  if (!s.project || !sel) return;
  const local = s.time - clipStart(s.project, sel);
  s.update((d) => {
    const c = findSelected(d, sel) as KfClip | null;
    if (!c) return;
    const t = Math.max(0, Math.min(itemDuration(c), local));
    for (const [p, v] of Object.entries(vals)) setProp(c, p as KfProp, v, t);
  }, key ? `${sel.id}:${key}` : undefined);
}

export const setSelectedProp = (p: KfProp, v: number, key?: string) => setSelectedProps({ [p]: v }, key);

export function clearKeyframes() {
  const sel = S().selection;
  S().update((d) => {
    const c = findSelected(d, sel) as KfClip | null;
    if (c) delete c.keyframes;
  });
}

/** Moves the playhead to the previous (-1) or next (+1) keyframe. */
export function jumpKeyframe(dir: -1 | 1) {
  const s = S();
  const p = s.project;
  const t = p && keyframeTarget(p, s.selection, s.time);
  if (!p || !t || !t.clip.keyframes?.length) return;
  const ks = t.clip.keyframes.map((k) => k.t);
  const next = dir > 0 ? ks.find((k) => k > t.local + KF_SNAP / 2) : [...ks].reverse().find((k) => k < t.local - KF_SNAP / 2);
  if (next === undefined) return;
  const time = clipStart(p, s.selection) + next + 0.001;
  getPlayer()?.pause();
  getPlayer()?.seek(time);
  s.setTime(time, false);
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

// A long on-device job (reverse, stabilize) shown with a progress card.
export type Job = { label: string; fraction: number } | null;
let job: AbortController | null = null;
let jobState: Job = null;
const jobListeners = new Set<() => void>();
const setJob = (j: Job) => { jobState = j; for (const l of jobListeners) l(); };
export const getJob = () => jobState;
export const subscribeJob = (l: () => void) => { jobListeners.add(l); return () => { jobListeners.delete(l); }; };
export const cancelJob = () => job?.abort();

/** Plays the clip backwards (or back forwards). Renders a reversed copy on the device. */
export async function toggleReverse() {
  const s = S();
  const p = s.project;
  const sel = s.selection;
  const c = p && (findSelected(p, sel) as MediaClip | null);
  if (!p || !sel || !c || c.type !== 'media') return;
  if (c.reversed) {
    const r = c.reversed;
    s.update((d) => {
      const x = findSelected(d, sel) as MediaClip;
      // Map the part of the reversed copy in use back onto the original.
      const len = r.out - r.in;
      const nin = r.in + Math.max(0, len - x.out), nout = r.in + Math.min(len, len - x.in);
      Object.assign(x, { assetId: r.assetId, in: nin, out: Math.max(nin + 0.05, nout), reversed: null });
      if (x.stab) x.stab = null;
    });
    s.showToast('Clip en su sentido original');
    return;
  }
  const asset = p.assets.find((a) => a.id === c.assetId);
  if (!asset || asset.kind !== 'video') { s.showToast('Solo se pueden invertir vídeos'); return; }
  if (job) return;
  job = new AbortController();
  getPlayer()?.pause();
  setJob({ label: 'Invirtiendo el clip…', fraction: 0 });
  try {
    const rev = await reverseVideo(asset, c.in, c.out, (f) => setJob({ label: 'Invirtiendo el clip…', fraction: f }), job.signal);
    const a = await library.importBlob(rev, asset.name.replace(/\.[^.]+$/, '') + ' (invertido).mp4');
    S().update((d) => {
      d.assets.push(a);
      const x = findSelected(d, sel) as MediaClip | null;
      if (!x) return;
      const len = Math.min(a.duration, x.out - x.in);
      Object.assign(x, { assetId: a.id, reversed: { assetId: asset.id, in: x.in, out: x.out }, in: 0, out: len, stab: null });
    });
    void library.thumbnails(a);
    void library.audioBuffer(a);
    S().showToast('Clip invertido');
  } catch (e) {
    if (!isAbort(e)) S().showToast((e as Error).message || 'No se pudo invertir el clip');
  } finally {
    job = null;
    setJob(null);
  }
}

/** Measures the camera shake of the selected clip and stabilizes it. */
export async function stabilizeSelected(level: number) {
  const s = S();
  const p = s.project;
  const sel = s.selection;
  const c = p && (findSelected(p, sel) as MediaClip | null);
  if (!p || !sel || !c || c.type !== 'media') return;
  const set = (fn: (x: MediaClip) => void) => S().update((d) => { const x = findSelected(d, sel) as MediaClip | null; if (x) fn(x); });
  if (level <= 0) { set((x) => { if (x.stab) x.stab.level = 0; }); return; }
  // Reuse the measurement while it covers the clip.
  const st = c.stab;
  if (st && st.t0 <= c.in + 0.1 && st.t0 + st.path.length / 3 / st.fps >= c.out - 0.1) {
    set((x) => { x.stab!.level = level; });
    return;
  }
  const asset = p.assets.find((a) => a.id === c.assetId);
  if (!asset || asset.kind !== 'video') { s.showToast('Solo se pueden estabilizar vídeos'); return; }
  if (job) return;
  job = new AbortController();
  getPlayer()?.pause();
  setJob({ label: 'Analizando el movimiento…', fraction: 0 });
  try {
    const r = await analyzeShake(asset, c.in, c.out, (f) => setJob({ label: 'Analizando el movimiento…', fraction: f }), job.signal);
    set((x) => { x.stab = { ...r, level }; });
  } catch (e) {
    if (!isAbort(e)) S().showToast((e as Error).message || 'No se pudo estabilizar');
  } finally {
    job = null;
    setJob(null);
  }
}
