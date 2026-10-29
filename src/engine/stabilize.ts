// Render-time stabilization: the measured camera path is smoothed and the
// difference is applied to the frame as a small shift + rotation, with a
// zoom that hides the moving edges. Nothing is re-encoded.

import type { MediaClip, Stabilize } from '../types';

export const STAB_LEVELS = [
  { level: 0, name: 'No', sigma: 0, zoom: 1 },
  { level: 1, name: 'Bajo', sigma: 0.35, zoom: 1.05 },
  { level: 2, name: 'Recomendado', sigma: 0.9, zoom: 1.09 },
  { level: 3, name: 'Máximo', sigma: 2.4, zoom: 1.15 },
];

export interface StabCorr { dx: number; dy: number; da: number; zoom: number }

interface Corr { dx: Float32Array; dy: Float32Array; da: Float32Array; zoom: number }
const cache = new Map<string, Corr>();

function gaussian(src: Float32Array, sigma: number): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  const r = Math.max(1, Math.ceil(sigma * 3));
  const w = new Float32Array(r + 1);
  for (let i = 0; i <= r; i++) w[i] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < n; i++) {
    let s = 0, ws = 0;
    for (let j = -r; j <= r; j++) {
      const k = i + j;
      if (k < 0 || k >= n) continue;
      s += src[k] * w[Math.abs(j)];
      ws += w[Math.abs(j)];
    }
    out[i] = s / ws;
  }
  return out;
}

function corrections(s: Stabilize): Corr {
  const key = `${s.key}:${s.level}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const L = STAB_LEVELS[Math.max(0, Math.min(3, s.level))];
  const n = Math.floor(s.path.length / 3);
  const px = new Float32Array(n), py = new Float32Array(n), pa = new Float32Array(n);
  for (let i = 0; i < n; i++) { px[i] = s.path[i * 3]; py[i] = s.path[i * 3 + 1]; pa[i] = s.path[i * 3 + 2]; }
  const sig = Math.max(1, L.sigma * s.fps);
  const sx = gaussian(px, sig), sy = gaussian(py, sig), sa = gaussian(pa, sig);
  // Shifts beyond the zoom margin would show the frame edge.
  const margin = (L.zoom - 1) / (2 * L.zoom);
  const maxA = (L.zoom - 1) * 0.6;
  const dx = new Float32Array(n), dy = new Float32Array(n), da = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    da[i] = Math.max(-maxA, Math.min(maxA, sa[i] - pa[i]));
    const m = Math.max(0, margin - Math.abs(da[i]) * 0.5);
    dx[i] = Math.max(-m, Math.min(m, sx[i] - px[i]));
    dy[i] = Math.max(-m, Math.min(m, sy[i] - py[i]));
  }
  const c = { dx, dy, da, zoom: L.zoom };
  if (cache.size > 30) cache.clear();
  cache.set(key, c);
  return c;
}

/** Correction for a source time, or null when the clip isn't stabilized. */
export function stabAt(clip: MediaClip, sourceTime: number): StabCorr | null {
  const s = clip.stab;
  if (!s || s.level <= 0 || s.path.length < 6) return null;
  const c = corrections(s);
  const n = c.dx.length;
  const f = Math.max(0, Math.min(n - 1, (sourceTime - s.t0) * s.fps));
  const i = Math.min(n - 2, Math.floor(f)), k = f - i;
  const lerp = (a: Float32Array) => a[i] + (a[i + 1] - a[i]) * k;
  return { dx: lerp(c.dx), dy: lerp(c.dy), da: lerp(c.da), zoom: c.zoom };
}
