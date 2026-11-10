// Collage templates. Each cell is [x, y, w, h] as fractions of the canvas.
// A collage is built from ordinary clips: the first cell is a clip on the main
// track and the rest are overlays, each cropped to fill its cell. So every cell
// can still be edited (filters, crop, speed, animation…) like any other clip.

import type { Asset, Crop, MediaClip } from '../types';

export type Cell = [number, number, number, number];

export interface CollageTemplate {
  id: string;
  name: string;
  cells: Cell[];
}

const T = 1 / 3, TT = 2 / 3;

export const COLLAGES: CollageTemplate[] = [
  { id: 'v2', name: '2 en columna', cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: 'h2', name: '2 en fila', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: 'v3', name: '3 en columna', cells: [[0, 0, 1, T], [0, T, 1, T], [0, TT, 1, T]] },
  { id: 'h3', name: '3 en fila', cells: [[0, 0, T, 1], [T, 0, T, 1], [TT, 0, T, 1]] },
  { id: 'top1b2', name: '1 + 2', cells: [[0, 0, 1, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: 'left1r2', name: '1 + 2 lateral', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: 'g4', name: 'Cuadrícula 4', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { id: 'top1b3', name: '1 + 3', cells: [[0, 0, 1, TT], [0, TT, T, T], [T, TT, T, T], [TT, TT, T, T]] },
  { id: 'v4', name: '4 en columna', cells: [[0, 0, 1, 0.25], [0, 0.25, 1, 0.25], [0, 0.5, 1, 0.25], [0, 0.75, 1, 0.25]] },
  { id: 'mosaic5', name: 'Mosaico 5', cells: [[0, 0, 0.5, TT], [0.5, 0, 0.5, T], [0.5, T, 0.5, T], [0, TT, 0.5, T], [0.5, TT, 0.5, T]] },
  { id: 'g6', name: 'Cuadrícula 6', cells: [[0, 0, 0.5, T], [0.5, 0, 0.5, T], [0, T, 0.5, T], [0.5, T, 0.5, T], [0, TT, 0.5, T], [0.5, TT, 0.5, T]] },
  { id: 'g9', name: 'Cuadrícula 9', cells: [0, 1, 2].flatMap((r) => [0, 1, 2].map((c): Cell => [c * T, r * T, T, T])) },
  { id: 'pip', name: 'Imagen en imagen', cells: [[0, 0, 1, 1], [0.56, 0.06, 0.38, 0.3]] },
];

export const collageById = (id: string) => COLLAGES.find((c) => c.id === id) ?? COLLAGES[0];

const EPS = 1e-4;

/**
 * Cell rectangle after spacing, in canvas units where the height is 1 and the
 * width is `ratio`. `gap` is a fraction of the canvas' shorter side.
 */
export function cellBox(cell: Cell, ratio: number, gap: number): { x: number; y: number; w: number; h: number } {
  const g = gap * Math.min(ratio, 1);
  const [cx, cy, cw, ch] = cell;
  // Inner edges get half a gap on each side; canvas edges get a full gap.
  const l = cx * ratio + (cx < EPS ? g : g / 2);
  const r = (cx + cw) * ratio - (cx + cw > 1 - EPS ? g : g / 2);
  const t = cy + (cy < EPS ? g : g / 2);
  const b = cy + ch - (cy + ch > 1 - EPS ? g : g / 2);
  return { x: l, y: t, w: Math.max(0.01, r - l), h: Math.max(0.01, b - t) };
}

/** Centered crop of a `srcAspect` source that fills a `cellAspect` box. */
export function coverCrop(srcAspect: number, cellAspect: number): Crop {
  if (srcAspect > cellAspect) {
    const w = cellAspect / srcAspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = srcAspect / cellAspect;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/** Places a clip so that it fills a cell (crop + scale + position). */
export function fitClipToCell(c: MediaClip, asset: Asset, cell: Cell, ratio: number, gap: number, radius: number) {
  const box = cellBox(cell, ratio, gap);
  const cellAspect = box.w / box.h;
  const srcAspect = asset.width && asset.height ? asset.width / asset.height : cellAspect;
  c.crop = coverCrop(srcAspect, cellAspect);
  c.radius = radius;
  // The renderer fits the cropped source inside the canvas, then scales it.
  const fitW = Math.min(ratio, cellAspect);
  c.transform = {
    x: (box.x + box.w / 2) / ratio - 0.5,
    y: box.y + box.h / 2 - 0.5,
    scale: box.w / fitW,
    rotation: 0,
  };
  delete c.keyframes;
}
