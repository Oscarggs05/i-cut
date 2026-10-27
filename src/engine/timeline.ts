import type {
  Adjust, AspectId, Asset, AudioClip, MediaClip, Project, TextClip, Visual,
} from '../types';

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const IMAGE_DEFAULT_DURATION = 3;
export const MIN_CLIP = 0.1;

export const defaultAdjust = (): Adjust => ({
  brightness: 0, contrast: 0, saturation: 0, exposure: 0, temperature: 0, tint: 0,
  highlights: 0, shadows: 0, fade: 0, vignette: 0, grain: 0, sharpen: 0,
});

export const defaultVisual = (): Visual => ({
  transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  flipH: false,
  flipV: false,
  opacity: 1,
  filter: { id: 'none', intensity: 1 },
  adjust: defaultAdjust(),
  effect: { id: 'none', intensity: 0.6 },
  animIn: null,
  animOut: null,
  animLoop: null,
});

export function newProject(name: string): Project {
  const now = Date.now();
  return {
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    aspect: '9:16',
    background: { type: 'blur', color: '#000000', blur: 0.6 },
    assets: [],
    main: [],
    overlays: [],
    texts: [],
    audios: [],
  };
}

export function newMediaClip(asset: Asset): MediaClip {
  const dur = asset.kind === 'image' ? IMAGE_DEFAULT_DURATION : asset.duration;
  return {
    ...defaultVisual(),
    id: uid(),
    type: 'media',
    assetId: asset.id,
    in: 0,
    out: dur,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transition: null,
    start: 0,
  };
}

export function newTextClip(start: number, sticker = false, text = 'Texto'): TextClip {
  return {
    ...defaultVisual(),
    id: uid(),
    type: 'text',
    sticker,
    start,
    duration: 3,
    text,
    font: 'Montserrat',
    size: sticker ? 200 : 84,
    color: '#ffffff',
    bold: true,
    italic: false,
    align: 'center',
    strokeColor: '#000000',
    strokeWidth: sticker ? 0 : 0,
    bgColor: '#000000',
    bgOpacity: 0,
    shadow: !sticker,
    letterSpacing: 0,
  };
}

export function newAudioClip(asset: Asset, start: number): AudioClip {
  return {
    id: uid(),
    type: 'audio',
    assetId: asset.id,
    start,
    in: 0,
    out: asset.duration,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    name: asset.name.replace(/\.[^.]+$/, ''),
  };
}

/** Duration of a media clip on the timeline (speed applied). */
export const clipDuration = (c: MediaClip | AudioClip) => (c.out - c.in) / c.speed;

export interface MainLayout {
  clip: MediaClip;
  index: number;
  start: number;
  end: number;
  /** Duration of the transition into the next clip, already clamped. */
  transOut: number;
  transIn: number;
}

/** Transition length allowed between two clips. */
export function clampTransition(a: MediaClip, b: MediaClip | undefined): number {
  if (!a.transition || a.transition.id === 'none' || !b) return 0;
  return Math.max(0, Math.min(a.transition.duration, clipDuration(a) / 2, clipDuration(b) / 2));
}

/** Main track clips sit back to back; a transition overlaps the next clip into this one. */
export function layoutMain(main: MediaClip[]): MainLayout[] {
  const out: MainLayout[] = [];
  let t = 0;
  let prevTrans = 0;
  main.forEach((clip, index) => {
    const d = clipDuration(clip);
    const start = t - prevTrans;
    const transOut = clampTransition(clip, main[index + 1]);
    out.push({ clip, index, start, end: start + d, transOut, transIn: prevTrans });
    t = start + d;
    prevTrans = transOut;
  });
  return out;
}

export function projectDuration(p: Project): number {
  const main = layoutMain(p.main);
  let d = main.length ? main[main.length - 1].end : 0;
  for (const o of p.overlays) d = Math.max(d, o.start + clipDuration(o));
  for (const t of p.texts) d = Math.max(d, t.start + t.duration);
  for (const a of p.audios) d = Math.max(d, a.start + clipDuration(a));
  return d;
}

export const itemStart = (c: MediaClip | TextClip | AudioClip) => c.start;
export const itemDuration = (c: MediaClip | TextClip | AudioClip) =>
  c.type === 'text' ? c.duration : clipDuration(c);

/** Greedy lane packing so overlapping items get their own row. */
export function packLanes<T extends MediaClip | TextClip | AudioClip>(items: T[]): { item: T; lane: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const laneEnds: number[] = [];
  return sorted.map((item) => {
    const s = item.start;
    const e = s + itemDuration(item);
    let lane = laneEnds.findIndex((end) => end <= s + 1e-6);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    return { item, lane };
  });
}

export const ASPECTS: { id: AspectId; label: string; ratio: number | null }[] = [
  { id: 'original', label: 'Original', ratio: null },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '21:9', label: '21:9', ratio: 21 / 9 },
];

/** Width / height of the project canvas. */
export function aspectRatio(p: Project): number {
  const a = ASPECTS.find((x) => x.id === p.aspect);
  if (a?.ratio) return a.ratio;
  const first = p.main[0] && p.assets.find((x) => x.id === p.main[0].assetId);
  if (first && first.width && first.height) return first.width / first.height;
  return 9 / 16;
}

/** Output size for a resolution label (the short side), rounded to even numbers. */
export function outputSize(ratio: number, shortSide: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (ratio < 1) return { width: even(shortSide), height: even(shortSide / ratio) };
  return { width: even(shortSide * ratio), height: even(shortSide) };
}

/** Source time inside a clip for a timeline time. */
export function sourceTime(c: MediaClip | AudioClip, start: number, t: number): number {
  return c.in + (t - start) * c.speed;
}

export function findAsset(p: Project, id: string): Asset | undefined {
  return p.assets.find((a) => a.id === id);
}

export function formatTime(t: number, withFrac = false): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (!withFrac) return base;
  return `${base}.${Math.floor((t % 1) * 10)}`;
}
