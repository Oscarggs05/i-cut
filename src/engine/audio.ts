// One audio mixing graph for both live preview (AudioContext) and export
// (OfflineAudioContext), so what you hear is what you export.

import type { Asset, Project } from '../types';
import { clipDuration, findAsset, layoutMain } from './timeline';
import { pitched, voiceChain, voicePitch } from './voice';

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
  voice?: string;
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
    segs.push({ asset: a, start, duration: clipDuration(c), offset: c.in, speed: c.speed, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, voice: c.voice });
  }
  for (const c of p.audios) {
    const a = findAsset(p, c.assetId);
    if (!a || c.volume <= 0) continue;
    segs.push({ asset: a, start: c.start, duration: clipDuration(c), offset: c.in, speed: c.speed, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, voice: c.voice });
  }
  return segs;
}

/**
 * Schedules every segment that is audible after timeline time `from`,
 * starting at context time `when`. Returns the nodes so they can be stopped
 * (sources) and disconnected.
 */
export function scheduleMix(
  ctx: BaseAudioContext,
  dest: AudioNode,
  segs: AudioSegment[],
  getBuffer: (a: Asset) => AudioBuffer | null | undefined,
  from: number,
  when: number,
): AudioNode[] {
  // Sources to stop plus effect outputs to disconnect.
  const nodes: AudioNode[] = [];
  for (const s of segs) {
    const end = s.start + s.duration;
    if (end <= from + 0.01) continue;
    const raw = getBuffer(s.asset);
    if (!raw) continue;
    // Pitch voices play a time-stretched copy faster or slower.
    const ratio = voicePitch(s.voice);
    const buf = pitched(raw, ratio);
    const segFrom = Math.max(from, s.start);
    const into = segFrom - s.start;
    const at = when + (segFrom - from);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = s.speed * ratio;
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
    const offset = (s.offset + into * s.speed) * ratio;
    const dur = (s.duration - into) * s.speed * ratio;
    if (offset >= buf.duration) continue;
    const fx = voiceChain(ctx, s.voice, dest, at, ctxTime(end));
    src.connect(g).connect(fx ? fx.input : dest);
    src.start(at, offset, Math.min(dur, buf.duration - offset));
    nodes.push(src);
    if (fx) nodes.push(...fx.sources, fx.output);
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
