import type { Asset, MediaClip, Project, TextClip, Visual } from '../types';
import { clipDuration, findAsset, layoutMain, packLanes, sourceTime } from './timeline';

export interface MediaLayer {
  kind: 'media';
  role: 'main' | 'overlay';
  clip: MediaClip;
  asset: Asset;
  start: number;
  sourceTime: number;
  localT: number;
  duration: number;
}

export interface TextLayer {
  kind: 'text';
  clip: TextClip;
  localT: number;
  duration: number;
}

export interface Scene {
  t: number;
  main: { a: MediaLayer; b?: MediaLayer; p: number; transition: string } | null;
  overlays: MediaLayer[];
  texts: TextLayer[];
}

function mediaLayer(p: Project, clip: MediaClip, start: number, t: number, role: MediaLayer['role']): MediaLayer | null {
  const asset = findAsset(p, clip.assetId);
  if (!asset) return null;
  const d = clipDuration(clip);
  const localT = Math.min(Math.max(t - start, 0), d);
  const st = Math.min(sourceTime(clip, start, start + localT), Math.max(clip.in, clip.out - 0.001));
  return { kind: 'media', role, clip, asset, start, sourceTime: st, localT, duration: d };
}

export function buildScene(p: Project, t: number): Scene {
  const layout = layoutMain(p.main);
  const active = layout.filter((l) => t >= l.start && t < l.end);
  // Hold the last frame at the very end of the timeline.
  if (!active.length && layout.length && t >= layout[layout.length - 1].end - 1e-6 && t <= layout[layout.length - 1].end + 0.05) {
    active.push(layout[layout.length - 1]);
  }
  let main: Scene['main'] = null;
  if (active.length) {
    const A = active[0];
    const a = mediaLayer(p, A.clip, A.start, t, 'main');
    if (a) {
      if (active.length > 1 && A.transOut > 0) {
        const B = active[1];
        const b = mediaLayer(p, B.clip, B.start, t, 'main') ?? undefined;
        main = { a, b, p: (t - B.start) / A.transOut, transition: A.clip.transition?.id ?? 'fade' };
      } else {
        main = { a, p: 0, transition: 'none' };
      }
    }
  }
  const overlays: MediaLayer[] = [];
  for (const { item } of packLanes(p.overlays).sort((x, y) => x.lane - y.lane)) {
    const d = clipDuration(item);
    if (t >= item.start && t < item.start + d) {
      const l = mediaLayer(p, item, item.start, t, 'overlay');
      if (l) overlays.push(l);
    }
  }
  const texts: TextLayer[] = [];
  for (const { item } of packLanes(p.texts).sort((x, y) => x.lane - y.lane)) {
    if (t >= item.start && t < item.start + item.duration) {
      texts.push({ kind: 'text', clip: item, localT: t - item.start, duration: item.duration });
    }
  }
  return { t, main, overlays, texts };
}

/** Media clips that are visible somewhere in [t0, t1], with their timeline start. */
export function mediaInWindow(p: Project, t0: number, t1: number): { clip: MediaClip; start: number }[] {
  const out: { clip: MediaClip; start: number }[] = [];
  for (const l of layoutMain(p.main)) if (l.end > t0 && l.start < t1) out.push({ clip: l.clip, start: l.start });
  for (const o of p.overlays) {
    const e = o.start + clipDuration(o);
    if (e > t0 && o.start < t1) out.push({ clip: o, start: o.start });
  }
  return out;
}

export interface AnimState {
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  opacity: number;
  /** Fraction of characters shown (typewriter). */
  chars: number;
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

function applyAnim(id: string, p: number, s: AnimState) {
  const e = easeOut(p);
  switch (id) {
    case 'fade': s.opacity *= p; break;
    case 'zoomIn': s.scale *= 0.3 + 0.7 * e; s.opacity *= Math.min(1, p * 2); break;
    case 'zoomOut': s.scale *= 1.6 - 0.6 * e; s.opacity *= Math.min(1, p * 2); break;
    case 'slideLeft': s.dx += (1 - e) * 0.7; s.opacity *= Math.min(1, p * 3); break;
    case 'slideRight': s.dx -= (1 - e) * 0.7; s.opacity *= Math.min(1, p * 3); break;
    case 'slideUp': s.dy += (1 - e) * 0.5; s.opacity *= Math.min(1, p * 3); break;
    case 'slideDown': s.dy -= (1 - e) * 0.5; s.opacity *= Math.min(1, p * 3); break;
    case 'pop': s.scale *= Math.max(0, easeOutBack(p)); break;
    case 'spin': s.rotation += (1 - e) * -180; s.scale *= Math.max(0.01, e); break;
    case 'typewriter': s.chars = p; break;
  }
}

export function animState(v: Visual, localT: number, duration: number, effectId: string, effectAmt: number): AnimState {
  const s: AnimState = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1, chars: 1 };
  if (v.animIn && v.animIn.duration > 0) {
    const p = Math.min(1, Math.max(0, localT / v.animIn.duration));
    if (p < 1) applyAnim(v.animIn.id, p, s);
  }
  if (v.animOut && v.animOut.duration > 0) {
    const p = Math.min(1, Math.max(0, (duration - localT) / v.animOut.duration));
    if (p < 1) applyAnim(v.animOut.id, p, s);
  }
  if (v.animLoop) {
    const period = Math.max(0.2, v.animLoop.duration);
    const w = Math.sin((localT / period) * Math.PI * 2);
    switch (v.animLoop.id) {
      case 'pulse': s.scale *= 1 + 0.07 * w; break;
      case 'float': s.dy += 0.015 * w; break;
      case 'wiggle': s.rotation += 6 * w; break;
      case 'kenburns': s.scale *= 1 + 0.18 * (localT / Math.max(duration, 0.01)); s.dx += 0.03 * (localT / Math.max(duration, 0.01)); break;
      case 'shake': s.dx += Math.sin(localT * 53) * 0.006; s.dy += Math.cos(localT * 47) * 0.006; break;
    }
  }
  if (effectId === 'shake') {
    s.dx += Math.sin(localT * 61) * 0.012 * effectAmt;
    s.dy += Math.cos(localT * 43) * 0.012 * effectAmt;
    s.rotation += Math.sin(localT * 37) * 1.5 * effectAmt;
  } else if (effectId === 'zoom') {
    s.scale *= 1 + 0.12 * effectAmt * Math.pow(Math.max(0, Math.sin(localT * Math.PI * 2)), 4);
  }
  return s;
}
