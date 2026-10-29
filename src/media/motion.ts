// Global motion between two small grayscale frames: a coarse translation
// search on a half-size copy, then block matching on a 3x3 grid refined to
// sub-pixel, and a least-squares fit of translation + rotation.

export interface Gray { w: number; h: number; d: Float32Array }
export interface Motion { dx: number; dy: number; da: number }

export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const d = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114;
  return { w, h, d };
}

export function half(g: Gray): Gray {
  const w = g.w >> 1, h = g.h >> 1;
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * 2 * g.w + x * 2;
      d[y * w + x] = (g.d[i] + g.d[i + 1] + g.d[i + g.w] + g.d[i + g.w + 1]) / 4;
    }
  }
  return { w, h, d };
}

/** Mean absolute difference of a block of `a` at (x, y) against `b` shifted by (u, v). */
function sad(a: Gray, b: Gray, x0: number, y0: number, bw: number, bh: number, u: number, v: number, step: number): number {
  let s = 0, n = 0;
  for (let y = y0; y < y0 + bh; y += step) {
    const ra = y * a.w, rb = (y + v) * b.w + u;
    for (let x = x0; x < x0 + bw; x += step) { s += Math.abs(a.d[ra + x] - b.d[rb + x]); n++; }
  }
  return n ? s / n : Infinity;
}

/** Best shift of a block within ±r around (cu, cv), with sub-pixel refinement. */
function search(a: Gray, b: Gray, x0: number, y0: number, bw: number, bh: number, cu: number, cv: number, r: number, step: number) {
  let best = Infinity, bu = cu, bv = cv;
  const costs = new Map<number, number>();
  for (let v = cv - r; v <= cv + r; v++) {
    if (y0 + v < 0 || y0 + bh + v > b.h) continue;
    for (let u = cu - r; u <= cu + r; u++) {
      if (x0 + u < 0 || x0 + bw + u > b.w) continue;
      const c = sad(a, b, x0, y0, bw, bh, u, v, step);
      costs.set(v * 4096 + u, c);
      if (c < best) { best = c; bu = u; bv = v; }
    }
  }
  const at = (u: number, v: number) => costs.get(v * 4096 + u);
  const para = (m: number | undefined, c: number, p: number | undefined) => {
    if (m === undefined || p === undefined) return 0;
    const den = m - 2 * c + p;
    return den > 1e-6 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * den))) : 0;
  };
  return {
    u: bu + para(at(bu - 1, bv), best, at(bu + 1, bv)),
    v: bv + para(at(bu, bv - 1), best, at(bu, bv + 1)),
    cost: best,
  };
}

function texture(g: Gray, x0: number, y0: number, bw: number, bh: number): number {
  let s = 0, n = 0;
  for (let y = y0; y < y0 + bh - 1; y += 2) {
    for (let x = x0; x < x0 + bw - 1; x += 2) {
      const i = y * g.w + x;
      s += Math.abs(g.d[i + 1] - g.d[i]) + Math.abs(g.d[i + g.w] - g.d[i]);
      n++;
    }
  }
  return n ? s / n : 0;
}

/** Motion of the content from frame `a` to frame `b`, in pixels and radians. */
export function estimateMotion(a: Gray, b: Gray, ha?: Gray, hb?: Gray): Motion {
  ha ??= half(a); hb ??= half(b);
  // Coarse global shift on the half-size frames.
  const R1 = Math.max(4, Math.round(Math.min(ha.w, ha.h) * 0.07));
  const g = search(ha, hb, R1, R1, ha.w - 2 * R1, ha.h - 2 * R1, 0, 0, R1, 2);
  const gu = Math.round(g.u * 2), gv = Math.round(g.v * 2);

  const R2 = 3;
  const mx = Math.round(a.w * 0.08) + Math.abs(gu) + R2, my = Math.round(a.h * 0.08) + Math.abs(gv) + R2;
  const bw = Math.floor((a.w - 2 * mx) / 3), bh = Math.floor((a.h - 2 * my) / 3);
  const pts: { x: number; y: number; u: number; v: number }[] = [];
  if (bw >= 8 && bh >= 8) {
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const x0 = mx + i * bw, y0 = my + j * bh;
        if (texture(a, x0, y0, bw, bh) < 2) continue;
        const r = search(a, b, x0, y0, bw, bh, gu, gv, R2, 1);
        pts.push({ x: x0 + bw / 2 - a.w / 2, y: y0 + bh / 2 - a.h / 2, u: r.u, v: r.v });
      }
    }
  }
  if (pts.length < 3) return { dx: gu, dy: gv, da: 0 };

  const fit = (ps: typeof pts) => {
    let mx = 0, my = 0, qx = 0, qy = 0;
    for (const p of ps) { mx += p.x; my += p.y; qx += p.x + p.u; qy += p.y + p.v; }
    mx /= ps.length; my /= ps.length; qx /= ps.length; qy /= ps.length;
    let dot = 0, cross = 0;
    for (const p of ps) {
      const ax = p.x - mx, ay = p.y - my, bx = p.x + p.u - qx, by = p.y + p.v - qy;
      dot += ax * bx + ay * by;
      cross += ax * by - ay * bx;
    }
    const da = Math.atan2(cross, dot);
    // Translation of the frame center (the origin).
    const c = Math.cos(da), s = Math.sin(da);
    return { dx: qx - (c * mx - s * my), dy: qy - (s * mx + c * my), da };
  };
  let m = fit(pts);
  // Drop blocks that disagree (something moving in the scene) and refit.
  const res = pts.map((p) => {
    const c = Math.cos(m.da), s = Math.sin(m.da);
    return Math.hypot(c * p.x - s * p.y + m.dx - (p.x + p.u), s * p.x + c * p.y + m.dy - (p.y + p.v));
  });
  const med = [...res].sort((x, y) => x - y)[res.length >> 1];
  const keep = pts.filter((_, i) => res[i] <= med * 2 + 0.5);
  if (keep.length >= 3 && keep.length < pts.length) m = fit(keep);
  return m;
}
