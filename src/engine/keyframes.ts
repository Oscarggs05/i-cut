// Keyframes: each one stores every animatable value of a clip at a time
// (seconds from the clip start). Between two keyframes the values are
// interpolated with the easing of the first one.

import type { AudioClip, Ease, Keyframe, KfProp, MediaClip, TextClip, Visual } from '../types';

export type KfClip = MediaClip | TextClip | AudioClip;

/** Two keyframes closer than this count as the same one. */
export const KF_SNAP = 1 / 30;

export const EASES: { id: Ease; name: string }[] = [
  { id: 'linear', name: 'Lineal' },
  { id: 'smooth', name: 'Suave' },
  { id: 'in', name: 'Acelerar' },
  { id: 'out', name: 'Frenar' },
];

export function kfProps(c: KfClip): KfProp[] {
  if (c.type === 'audio') return ['volume'];
  if (c.type === 'text') return ['x', 'y', 'scale', 'rotation', 'opacity'];
  return ['x', 'y', 'scale', 'rotation', 'opacity', 'filter', 'volume'];
}

export function baseValue(c: KfClip, p: KfProp): number {
  if (c.type === 'audio') return c.volume;
  switch (p) {
    case 'x': return c.transform.x;
    case 'y': return c.transform.y;
    case 'scale': return c.transform.scale;
    case 'rotation': return c.transform.rotation;
    case 'opacity': return c.opacity;
    case 'filter': return c.filter.intensity;
    case 'volume': return c.type === 'media' ? c.volume : 1;
  }
}

function setBase(c: KfClip, p: KfProp, v: number) {
  if (c.type === 'audio') { c.volume = v; return; }
  switch (p) {
    case 'x': c.transform.x = v; break;
    case 'y': c.transform.y = v; break;
    case 'scale': c.transform.scale = v; break;
    case 'rotation': c.transform.rotation = v; break;
    case 'opacity': c.opacity = v; break;
    case 'filter': c.filter.intensity = v; break;
    case 'volume': if (c.type === 'media') c.volume = v; break;
  }
}

function ease(e: Ease, k: number) {
  switch (e) {
    case 'smooth': return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    case 'in': return k * k * k;
    case 'out': return 1 - Math.pow(1 - k, 3);
    default: return k;
  }
}

/** Value of a property at a local time, or `base` when no keyframe sets it. */
export function kfValue(list: Keyframe[] | undefined, p: KfProp, t: number, base: number): number {
  if (!list || !list.length) return base;
  let prev: Keyframe | null = null;
  for (const k of list) {
    const v = k.v[p];
    if (v === undefined) continue;
    if (k.t >= t) {
      if (!prev) return v;
      const pv = prev.v[p]!;
      const span = k.t - prev.t;
      const f = span > 0 ? ease(prev.ease, (t - prev.t) / span) : 1;
      return pv + (v - pv) * f;
    }
    prev = k;
  }
  return prev ? prev.v[p]! : base;
}

export const hasKeyframes = (c: KfClip | null | undefined) => !!c?.keyframes?.length;

/** Value shown at a local time (keyframes applied). */
export const valueAt = (c: KfClip, p: KfProp, t: number) => kfValue(c.keyframes, p, t, baseValue(c, p));

/** The clip's visual with keyframed values for this moment. */
export function resolveVisual<T extends Visual>(c: T, t: number): T {
  const k = c.keyframes;
  if (!k || !k.length) return c;
  return {
    ...c,
    transform: {
      x: kfValue(k, 'x', t, c.transform.x),
      y: kfValue(k, 'y', t, c.transform.y),
      scale: kfValue(k, 'scale', t, c.transform.scale),
      rotation: kfValue(k, 'rotation', t, c.transform.rotation),
    },
    opacity: kfValue(k, 'opacity', t, c.opacity),
    filter: { ...c.filter, intensity: kfValue(k, 'filter', t, c.filter.intensity) },
  };
}

export function kfIndexAt(c: KfClip, t: number): number {
  return c.keyframes?.findIndex((k) => Math.abs(k.t - t) < KF_SNAP) ?? -1;
}

/** Adds a keyframe holding the current values (or updates the one at `t`). */
export function upsertKeyframe(c: KfClip, t: number, changes: Partial<Record<KfProp, number>> = {}): Keyframe {
  const list = (c.keyframes ??= []);
  const i = kfIndexAt(c, t);
  if (i >= 0) {
    Object.assign(list[i].v, changes);
    return list[i];
  }
  const v: Partial<Record<KfProp, number>> = {};
  for (const p of kfProps(c)) v[p] = valueAt(c, p, t);
  Object.assign(v, changes);
  // Keyframes added between two others keep their easing.
  const before = [...list].reverse().find((k) => k.t < t);
  const kf: Keyframe = { t, ease: before?.ease ?? 'smooth', v };
  list.push(kf);
  list.sort((a, b) => a.t - b.t);
  return kf;
}

export function removeKeyframe(c: KfClip, t: number) {
  const i = kfIndexAt(c, t);
  if (i >= 0) c.keyframes!.splice(i, 1);
  if (c.keyframes && !c.keyframes.length) delete c.keyframes;
}

/**
 * Sets a property as seen at local time `t`: with keyframes it is written
 * into the keyframe at `t` (CapCut-style auto key), otherwise into the clip.
 */
export function setProp(c: KfClip, p: KfProp, v: number, t: number) {
  if (hasKeyframes(c)) upsertKeyframe(c, t, { [p]: v });
  else setBase(c, p, v);
}

/** Moves keyframes when the clip start moves over the content (trims and splits). */
export function shiftKeyframes(c: KfClip, dt: number) {
  if (!c.keyframes || !dt) return;
  for (const k of c.keyframes) k.t += dt;
}
