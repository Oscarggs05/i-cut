// Measures camera shake on small decoded frames, on the device. The result
// is a camera path the renderer smooths (see engine/stabilize.ts).

import { CanvasSink } from 'mediabunny';
import type { Asset, Stabilize } from '../types';
import { uid } from '../engine/timeline';
import { library } from './library';
import { estimateMotion, half, toGray, type Gray } from './motion';

const LONG_SIDE = 256;
const FPS = 30;

type Progress = (fraction: number) => void;

class Reader {
  private ctx: CanvasRenderingContext2D;
  constructor(readonly w: number, readonly h: number) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    this.ctx = c.getContext('2d', { willReadFrequently: true })!;
  }
  gray(src: CanvasImageSource): Gray {
    this.ctx.drawImage(src, 0, 0, this.w, this.h);
    return toGray(this.ctx.getImageData(0, 0, this.w, this.h).data, this.w, this.h);
  }
}

/** Frames as (timestamp, gray) in time order, from the decoder or a <video> fallback. */
async function* frames(asset: Asset, t0: number, t1: number, w: number, h: number): AsyncGenerator<{ t: number; g: Gray }> {
  const reader = new Reader(w, h);
  let track = null;
  try { track = await library.input(asset.id).getPrimaryVideoTrack(); } catch { /* use <video> */ }
  if (track && (await track.canDecode())) {
    const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
    for await (const wc of sink.canvases(t0, t1)) {
      yield { t: wc.timestamp, g: reader.gray(wc.canvas as CanvasImageSource) };
    }
    return;
  }
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = library.url(asset.id)!;
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('No se pudo leer el vídeo')); });
  try {
    // Seeking is slow, so the fallback samples fewer frames.
    for (let t = t0; t < t1; t += 1 / 15) {
      await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = t; });
      yield { t, g: reader.gray(v) };
    }
  } finally {
    v.removeAttribute('src'); v.load();
  }
}

export async function analyzeShake(asset: Asset, t0: number, t1: number, onProgress: Progress, signal?: AbortSignal): Promise<Omit<Stabilize, 'level'>> {
  const k = LONG_SIDE / Math.max(asset.width || 1, asset.height || 1);
  const w = Math.max(32, Math.round((asset.width || 144) * k / 2) * 2);
  const h = Math.max(32, Math.round((asset.height || 256) * k / 2) * 2);
  const ts: number[] = [];
  const raw: number[] = [];
  let prev: Gray | null = null, prevHalf: Gray | null = null;
  let x = 0, y = 0, a = 0;
  for await (const f of frames(asset, t0, t1, w, h)) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const fh = half(f.g);
    if (prev && prevHalf) {
      const m = estimateMotion(prev, f.g, prevHalf, fh);
      x += m.dx / w; y += m.dy / h; a += m.da;
    }
    ts.push(f.t); raw.push(x, y, a);
    prev = f.g; prevHalf = fh;
    onProgress(Math.min(1, (f.t - t0) / Math.max(0.01, t1 - t0)));
    // Let the UI breathe.
    if (ts.length % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  if (ts.length < 2) throw new Error('El clip es demasiado corto para estabilizarlo');
  // Resample to a fixed rate so variable frame rate videos map cleanly.
  const n = Math.max(2, Math.ceil((ts[ts.length - 1] - ts[0]) * FPS) + 1);
  const path: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = ts[0] + i / FPS;
    while (j < ts.length - 2 && ts[j + 1] < t) j++;
    const q = Math.max(0, Math.min(1, (t - ts[j]) / Math.max(1e-6, ts[j + 1] - ts[j])));
    for (let c = 0; c < 3; c++) {
      const v = raw[j * 3 + c] + (raw[(j + 1) * 3 + c] - raw[j * 3 + c]) * q;
      path.push(Math.round(v * 1e5) / 1e5);
    }
  }
  return { key: uid(), t0: ts[0], fps: FPS, path };
}
