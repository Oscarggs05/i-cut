// One audio mixing graph for both live preview (AudioContext) and export
// (OfflineAudioContext), so what you hear is what you export.

import type { Asset, Project } from '../types';
import { clipDuration, findAsset, layoutMain } from './timeline';

export interface AudioSegment {
  asset: Asset;
  /** Timeline start and duration. */
  start: number;
  duration: number;
  /** Source offset in seconds. */
  offset: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export function audioSegments(p: Project): AudioSegment[] {
  const segs: AudioSegment[] = [];
  const media = [
    ...layoutMain(p.main).map((l) => ({ c: l.clip, start: l.start })),
    ...p.overlays.map((c) => ({ c, start: c.start })),
  ];
  for (const { c, start } of media) {
    const a = findAsset(p, c.assetId);
    if (!a || a.kind !== 'video' || !a.hasAudio || c.muted || c.volume <= 0) continue;
    segs.push({ asset: a, start, duration: clipDuration(c), offset: c.in, speed: c.speed, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut });
  }
  for (const c of p.audios) {
    const a = findAsset(p, c.assetId);
    if (!a || c.volume <= 0) continue;
    segs.push({ asset: a, start: c.start, duration: clipDuration(c), offset: c.in, speed: c.speed, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut });
  }
  return segs;
}

/**
 * Schedules every segment that is audible after timeline time `from`,
 * starting at context time `when`. Returns the nodes so they can be stopped.
 */
export function scheduleMix(
  ctx: BaseAudioContext,
  dest: AudioNode,
  segs: AudioSegment[],
  getBuffer: (a: Asset) => AudioBuffer | null | undefined,
  from: number,
  when: number,
): AudioBufferSourceNode[] {
  const nodes: AudioBufferSourceNode[] = [];
  for (const s of segs) {
    const end = s.start + s.duration;
    if (end <= from + 0.01) continue;
    const buf = getBuffer(s.asset);
    if (!buf) continue;
    const segFrom = Math.max(from, s.start);
    const into = segFrom - s.start;
    const at = when + (segFrom - from);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = s.speed;
    const g = ctx.createGain();
    const env = (t: number) => {
      let k = 1;
      if (s.fadeIn > 0) k = Math.min(k, (t - s.start) / s.fadeIn);
      if (s.fadeOut > 0) k = Math.min(k, (end - t) / s.fadeOut);
      return Math.max(0, Math.min(1, k)) * s.volume;
    };
    const ctxTime = (t: number) => when + (t - from);
    g.gain.setValueAtTime(env(segFrom), at);
    if (s.fadeIn > 0 && segFrom < s.start + s.fadeIn) g.gain.linearRampToValueAtTime(s.volume, ctxTime(s.start + s.fadeIn));
    if (s.fadeOut > 0) {
      const fo = Math.max(segFrom, end - s.fadeOut, s.start + s.fadeIn);
      g.gain.setValueAtTime(env(fo), ctxTime(fo));
      g.gain.linearRampToValueAtTime(0, ctxTime(end));
    }
    src.connect(g).connect(dest);
    const offset = s.offset + into * s.speed;
    const dur = (s.duration - into) * s.speed;
    if (offset >= buf.duration) continue;
    src.start(at, offset, Math.min(dur, buf.duration - offset));
    nodes.push(src);
  }
  return nodes;
}

/** Renders the whole project mix offline. */
export async function renderMix(p: Project, duration: number, getBuffer: (a: Asset) => AudioBuffer | null | undefined, sampleRate = 48000): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(duration * sampleRate));
  const OAC = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OAC({ numberOfChannels: 2, length, sampleRate });
  scheduleMix(ctx, ctx.destination, audioSegments(p), getBuffer, 0, 0);
  return ctx.startRendering();
}
