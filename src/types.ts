// Project model. Everything is plain JSON so a project can be cloned for
// undo/redo and stored in IndexedDB as-is. Media bytes live separately.

export type AssetKind = 'video' | 'image' | 'audio';

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  mime: string;
  size: number;
  /** Seconds. Images report 0. */
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface Transform {
  /** Center offset as a fraction of the canvas width/height (0 = centered). */
  x: number;
  y: number;
  scale: number;
  /** Degrees. */
  rotation: number;
}

export interface Adjust {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  fade: number;
  vignette: number;
  grain: number;
  sharpen: number;
}

/** Properties that can be animated with keyframes. */
export type KfProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'filter' | 'volume';

export type Ease = 'linear' | 'smooth' | 'in' | 'out';

/**
 * A keyframe stores every animatable value of the clip at a moment.
 * `t` is seconds from the start of the clip on the timeline.
 */
export interface Keyframe {
  t: number;
  ease: Ease;
  v: Partial<Record<KfProp, number>>;
}

/** Speed curve: absolute speed at positions 0..1 of the source range. */
export interface SpeedCurve {
  id: string;
  pts: { x: number; v: number }[];
}

/** Camera shake measured on the source, smoothed when rendering. */
export interface Stabilize {
  /** 1 bajo, 2 recomendado, 3 máximo. */
  level: number;
  /** Changes on every analysis (used as a cache key). */
  key: string;
  /** Source time of the first sample and samples per second. */
  t0: number;
  fps: number;
  /** Camera path as [x, y, rotation] triplets: content offset from the first frame (fractions of the frame, radians). */
  path: number[];
}

export interface Anim {
  id: string;
  duration: number;
}

export interface Visual {
  transform: Transform;
  flipH: boolean;
  flipV: boolean;
  opacity: number;
  filter: { id: string; intensity: number };
  adjust: Adjust;
  effect: { id: string; intensity: number };
  animIn: Anim | null;
  animOut: Anim | null;
  animLoop: Anim | null;
  /** Green-screen keying. */
  chroma?: { color: string; similarity: number; smoothness: number } | null;
  keyframes?: Keyframe[];
}

export interface MediaClip extends Visual {
  id: string;
  type: 'media';
  assetId: string;
  /** Source in/out points in seconds. For images, out - in is the shown duration. */
  in: number;
  out: number;
  speed: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  /** Transition into the next clip on the main track. */
  transition: { id: string; duration: number } | null;
  /** Timeline start, used only by overlay (picture-in-picture) clips. */
  start: number;
  /** Replaces `speed` while set. */
  curve?: SpeedCurve | null;
  /** Set when the clip plays a reversed copy; holds what to restore. */
  reversed?: { assetId: string; in: number; out: number } | null;
  stab?: Stabilize | null;
  /** Voice changer preset (see engine/voice.ts). */
  voice?: string;
}

/** A spoken word, in seconds from the start of its text clip. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface TextClip extends Visual {
  id: string;
  type: 'text';
  sticker: boolean;
  start: number;
  duration: number;
  text: string;
  font: string;
  /** Pixels on a 1080 px wide canvas. */
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  strokeColor: string;
  strokeWidth: number;
  bgColor: string;
  bgOpacity: number;
  shadow: boolean;
  letterSpacing: number;
  /** Created by auto captions (replaced when captions are regenerated). */
  caption?: boolean;
  /** Word timings from speech recognition, one per word of `text`. */
  words?: TimedWord[];
  /** Word-by-word animation (see engine/text.ts), e.g. karaoke. */
  wordAnim?: string;
  /** Color of the word being spoken. */
  highlight?: string;
  uppercase?: boolean;
  /** Neon glow in the highlight (or text) color. */
  glow?: boolean;
}

export interface AudioClip {
  id: string;
  type: 'audio';
  assetId: string;
  start: number;
  in: number;
  out: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  name: string;
  /** Only the volume is animated on audio clips. */
  keyframes?: Keyframe[];
  /** Kept when the audio is extracted from a clip with a speed curve. */
  curve?: SpeedCurve | null;
  voice?: string;
}

export type Clip = MediaClip | TextClip | AudioClip;

export type AspectId = 'original' | '9:16' | '16:9' | '1:1' | '4:5' | '4:3' | '3:4' | '21:9';

export interface Background {
  type: 'color' | 'blur';
  color: string;
  blur: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspect: AspectId;
  background: Background;
  assets: Asset[];
  main: MediaClip[];
  overlays: MediaClip[];
  texts: TextClip[];
  audios: AudioClip[];
}

export type Selection =
  | { kind: 'main'; id: string }
  | { kind: 'overlay'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'audio'; id: string }
  | { kind: 'transition'; id: string }
  | null;
