// Speed curves. A curve gives the playback speed at each position of the
// clip's source range; the timeline length is the integral of 1 / speed.
// Lookup tables are cached so mapping a time is a binary search.

import type { SpeedCurve } from '../types';

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;

export const CURVE_PRESETS: { id: string; name: string; pts: [number, number][] }[] = [
  { id: 'custom', name: 'Personalizado', pts: [[0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1, 1]] },
  { id: 'montage', name: 'Montaje', pts: [[0, 0.8], [0.18, 3.5], [0.38, 0.6], [0.62, 3.5], [0.82, 0.6], [1, 2]] },
  { id: 'hero', name: 'Héroe', pts: [[0, 3], [0.32, 3], [0.5, 0.25], [0.68, 3], [1, 3]] },
  { id: 'bullet', name: 'Bala', pts: [[0, 3.5], [0.28, 0.2], [0.72, 0.2], [1, 3.5]] },
  { id: 'jump', name: 'Salto', pts: [[0, 0.6], [0.42, 0.6], [0.5, 6], [0.58, 0.6], [1, 0.6]] },
  { id: 'flashIn', name: 'Flash entrada', pts: [[0, 6], [0.3, 6], [0.55, 1], [1, 1]] },
  { id: 'flashOut', name: 'Flash salida', pts: [[0, 1], [0.45, 1], [0.7, 6], [1, 6]] },
];

export function presetCurve(id: string): SpeedCurve {
  const p = CURVE_PRESETS.find((x) => x.id === id) ?? CURVE_PRESETS[0];
  return { id: p.id, pts: p.pts.map(([x, v]) => ({ x, v })) };
}

/** Speed at position u (0..1). Interpolates smoothly in log space. */
export function curveSpeed(c: SpeedCurve, u: number): number {
  const p = c.pts;
  if (!p.length) return 1;
  if (u <= p[0].x) return p[0].v;
  for (let i = 1; i < p.length; i++) {
    if (u <= p[i].x) {
      const a = p[i - 1], b = p[i];
      const k = b.x > a.x ? (u - a.x) / (b.x - a.x) : 1;
      const e = (1 - Math.cos(k * Math.PI)) / 2;
      return Math.exp(Math.log(a.v) + (Math.log(b.v) - Math.log(a.v)) * e);
    }
  }
  return p[p.length - 1].v;
}

const N = 256;
interface Table { len: number; srcLen: number; cum: Float64Array }
const cache = new Map<string, Table>();

/** cum[i] = timeline seconds to play source fraction i / N. */
function table(c: SpeedCurve, srcLen: number): Table {
  const key = srcLen.toFixed(5) + c.pts.map((p) => `${p.x.toFixed(4)}:${p.v.toFixed(4)}`).join(',');
  let t = cache.get(key);
  if (t) return t;
  const cum = new Float64Array(N + 1);
  const ds = srcLen / N;
  for (let i = 0; i < N; i++) {
    // Midpoint rule; plenty for 256 steps.
    cum[i + 1] = cum[i] + ds / curveSpeed(c, (i + 0.5) / N);
  }
  t = { len: cum[N], srcLen, cum };
  if (cache.size > 200) cache.clear();
  cache.set(key, t);
  return t;
}

/** Timeline length of a source range played with a curve. */
export function curveDuration(c: SpeedCurve, srcLen: number): number {
  return srcLen > 0 ? table(c, srcLen).len : 0;
}

/** Source offset (seconds from `in`) reached after `local` timeline seconds. */
export function curveSource(c: SpeedCurve, srcLen: number, local: number): number {
  if (srcLen <= 0) return 0;
  const t = table(c, srcLen);
  if (local <= 0) return 0;
  if (local >= t.len) return srcLen;
  let lo = 0, hi = N;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t.cum[m] <= local) lo = m; else hi = m;
  }
  const k = (local - t.cum[lo]) / Math.max(1e-9, t.cum[hi] - t.cum[lo]);
  return ((lo + k) / N) * srcLen;
}

/** Timeline seconds needed to reach a source offset (inverse of curveSource). */
export function curveLocal(c: SpeedCurve, srcLen: number, src: number): number {
  if (srcLen <= 0) return 0;
  const t = table(c, srcLen);
  const f = Math.max(0, Math.min(N, (src / srcLen) * N));
  const i = Math.min(N - 1, Math.floor(f));
  return t.cum[i] + (t.cum[i + 1] - t.cum[i]) * (f - i);
}

/** The two halves of a curve cut at position u, each rescaled to 0..1. */
export function splitCurve(c: SpeedCurve, u: number): [SpeedCurve, SpeedCurve] {
  const prev = [...c.pts].reverse().find((p) => p.x < u - 1e-4)?.x ?? 0;
  const next = c.pts.find((p) => p.x > u + 1e-4)?.x ?? 1;
  // Extra samples in the cut segment keep its shape on both sides.
  const sample = (a: number, b: number) => [1, 2, 3].map((k) => a + ((b - a) * k) / 4).map((x) => ({ x, v: curveSpeed(c, x) }));
  const pts = [...c.pts, ...sample(prev, u), ...sample(u, next), { x: u, v: curveSpeed(c, u) }].sort((a, b) => a.x - b.x);
  const left = pts.filter((p) => p.x <= u + 1e-9).map((p) => ({ x: p.x / u, v: p.v }));
  const right = pts.filter((p) => p.x >= u - 1e-9).map((p) => ({ x: (p.x - u) / (1 - u), v: p.v }));
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const clean = (ps: { x: number; v: number }[]) => ps.map((p) => ({ x: r(p.x), v: r(p.v) }))
    .filter((p, i, a) => i === 0 || p.x - a[i - 1].x > 1e-4);
  return [{ id: c.id, pts: clean(left) }, { id: c.id, pts: clean(right) }];
}
