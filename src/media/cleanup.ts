// Automatic jump cuts: finds pauses (and filler sounds) in the main track's
// speech and cuts them out of the clips, keeping everything else in sync.

import type { MediaClip, Project, TimedWord } from '../types';
import { clipDuration, findAsset, layoutMain, uid } from '../engine/timeline';
import { shiftKeyframes } from '../engine/keyframes';
import { projectAudio16k, transcribe, type CaptionProgress } from './captions';

export type Range = [number, number];

export interface CleanupOptions {
  /** Shortest pause that gets cut, in seconds. */
  minPause: number;
  /** Silence kept around speech so cuts don't clip words. */
  margin: number;
  fillers: boolean;
  /** Also cut filler words ("o sea", "bueno"…), not just hesitation sounds. */
  fillerWords: boolean;
  model: string;
  language: string;
}

const SR = 16000;
const HOP = SR / 50; // 20 ms

// Hesitation sounds in the languages captions offer. Whisper often leaves
// them out, which is why untranscribed voiced gaps are cut too.
// "e" and "u" alone are Spanish conjunctions, so they need a trailing h/m.
const HESITATION = /^(e+h+m*|ee+|e+m+|m+h*|h+m+|u+h+m*|u+m+|a+h+|a+m+|e+r+m*)$/i;
const FILLER_WORDS = /^(o sea|osea|bueno|pues|vale|este|tipo|like|basically|actually|literally|alors|bon|cioè|allora|né|então)$/i;
const FILLER_PAIRS = ['o sea', 'you know', 'i mean'];

const norm = (w: string) => w.toLowerCase().replace(/[.,!?¿¡…:;"«»()]/g, '').trim();

/** Per-frame loudness of 16 kHz audio and the level above which it is voice. */
function loudness(audio: Float32Array) {
  const n = Math.floor(audio.length / HOP);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * HOP; j < (i + 1) * HOP; j++) s += audio[j] * audio[j];
    rms[i] = Math.sqrt(s / HOP);
  }
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(n * 0.1)] ?? 0;
  const loud = sorted[Math.floor(n * 0.95)] ?? 0;
  return { rms, level: Math.max(floor * 2, loud * 0.08, 1e-4) };
}

/** Pauses at least `minPause` long, shrunk by `margin` on each side. */
export function pauseRanges(audio: Float32Array, minPause: number, margin: number): Range[] {
  const { rms, level } = loudness(audio);
  const voiced = Array.from(rms, (r) => r > level);
  // Clicks and breaths under 60 ms don't count as speech.
  for (let i = 0; i < voiced.length;) {
    if (!voiced[i]) { i++; continue; }
    let j = i;
    while (j < voiced.length && voiced[j]) j++;
    if (j - i < 3) for (let k = i; k < j; k++) voiced[k] = false;
    i = j;
  }
  const out: Range[] = [];
  const total = voiced.length / 50;
  for (let i = 0; i < voiced.length;) {
    if (voiced[i]) { i++; continue; }
    let j = i;
    while (j < voiced.length && !voiced[j]) j++;
    const a = i / 50, b = j / 50;
    if (b - a >= minPause) {
      // No margin needed at the very start or end of the video.
      out.push([a <= 0 ? 0 : a + margin, j >= voiced.length ? total : b - margin]);
    }
    i = j;
  }
  return out.filter(([a, b]) => b - a > 0.05);
}

/** Filler words, and voiced gaps between words where Whisper heard no word (eh, mmm). */
export function fillerRanges(words: TimedWord[], audio: Float32Array, withWords: boolean): Range[] {
  const { rms, level } = loudness(audio);
  const out: Range[] = [];
  const ws = [...words].sort((a, b) => a.start - b.start);
  ws.forEach((w, i) => {
    const prevEnd = ws[i - 1]?.end ?? 0;
    const nextStart = ws[i + 1]?.start ?? w.end + 0.2;
    const t = norm(w.text);
    const pair = i + 1 < ws.length ? `${t} ${norm(ws[i + 1].text)}` : '';
    if (HESITATION.test(t) || (withWords && FILLER_WORDS.test(t))) {
      out.push([Math.max(prevEnd, w.start - 0.04), Math.min(nextStart, w.end + 0.04)]);
    } else if (withWords && FILLER_PAIRS.includes(pair)) {
      const n = ws[i + 1];
      out.push([Math.max(prevEnd, w.start - 0.04), Math.min(ws[i + 2]?.start ?? n.end + 0.2, n.end + 0.04)]);
    }
    const gapA = w.end, gapB = ws[i + 1]?.start;
    if (gapB !== undefined && gapB - gapA >= 0.45) {
      const f0 = Math.floor(gapA * 50), f1 = Math.min(rms.length, Math.floor(gapB * 50));
      let v = 0;
      for (let f = f0; f < f1; f++) if (rms[f] > level) v++;
      if (f1 > f0 && v / (f1 - f0) > 0.5) out.push([gapA + 0.06, gapB - 0.06]);
    }
  });
  return out;
}

function merge(ranges: Range[]): Range[] {
  const s = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 0.02) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

/** Speech of the main track only: music on other tracks would hide the pauses. */
const mainOnly = (p: Project): Project => ({ ...p, overlays: [], audios: [], texts: [] });

/** Timed words already known from captions, so filler removal needn't transcribe again. */
export function captionWords(p: Project): TimedWord[] | null {
  const caps = p.texts.filter((t) => t.caption);
  if (!caps.length || caps.some((c) => !c.words)) return null;
  return caps.flatMap((c) => c.words!.map((w) => ({ text: w.text, start: c.start + w.start, end: c.start + w.end })));
}

export async function findCuts(p: Project, o: CleanupOptions, onProgress: (p: CaptionProgress) => void): Promise<Range[]> {
  onProgress({ stage: 'audio', fraction: 0 });
  const audio = await projectAudio16k(mainOnly(p));
  let ranges = pauseRanges(audio, o.minPause, o.margin);
  if (o.fillers) {
    const words = captionWords(p) ?? await transcribe(mainOnly(p), o.model, o.language, onProgress, audio);
    ranges = ranges.concat(fillerRanges(words, audio, o.fillerWords));
  }
  return merge(ranges);
}

/**
 * Cuts the timeline ranges out of the main clips that have sound (silent
 * clips, like photos or muted b-roll, are left whole), then moves texts,
 * overlays and audio so they stay on the same moment. Returns the seconds
 * removed and the number of cuts.
 */
export function applyCuts(d: Project, ranges: Range[]): { seconds: number; cuts: number } {
  const applied: Range[] = [];
  const main: MediaClip[] = [];
  for (const l of layoutMain(d.main)) {
    const c = l.clip;
    const a = findAsset(d, c.assetId);
    // Clips with a speed curve are left whole: cutting them would change the curve's shape.
    const audible = a?.kind === 'video' && a.hasAudio && !c.muted && c.volume > 0 && !c.curve;
    // Transitions overlap neighbours; leave those stretches alone.
    const lo = l.start + l.transIn, hi = l.end - l.transOut;
    const mine = audible ? ranges.map(([x, y]): Range => [Math.max(x, lo), Math.min(y, hi)]).filter(([x, y]) => y - x > 0.05) : [];
    if (!mine.length) { main.push(c); continue; }
    const src = (t: number) => c.in + (t - l.start) * c.speed;
    const keep: Range[] = [];
    let from = c.in;
    for (const [x, y] of mine) { keep.push([from, src(x)]); from = src(y); }
    keep.push([from, c.out]);
    const pieces = keep.filter(([x, y]) => (y - x) / c.speed >= 0.08);
    if (!pieces.length) { main.push(c); continue; }
    applied.push(...mine);
    pieces.forEach(([x, y], i) => {
      const firstPiece = i === 0, lastPiece = i === pieces.length - 1;
      const piece: MediaClip = {
        ...structuredClone(c), id: firstPiece ? c.id : uid(), in: x, out: y,
        animIn: firstPiece ? c.animIn : null, fadeIn: firstPiece ? c.fadeIn : 0,
        animOut: lastPiece ? c.animOut : null, fadeOut: lastPiece ? c.fadeOut : 0,
        transition: lastPiece ? c.transition : null,
      };
      // Keyframes stay on the same content.
      shiftKeyframes(piece, -(x - c.in) / c.speed);
      main.push(piece);
    });
  }
  if (!applied.length) return { seconds: 0, cuts: 0 };
  d.main = main;
  const cuts = merge(applied);
  /** Where a moment of the old timeline ends up. */
  const map = (t: number) => {
    let out = t;
    for (const [x, y] of cuts) {
      if (t >= y) out -= y - x;
      else if (t > x) out -= t - x;
    }
    return out;
  };
  d.texts = d.texts.flatMap((c) => {
    const s = map(c.start), e = map(c.start + c.duration);
    if (e - s < 0.1) return [];
    const words = c.words?.map((w) => ({ ...w, start: map(c.start + w.start) - s, end: map(c.start + w.end) - s }));
    return [{ ...c, start: s, duration: e - s, words }];
  });
  for (const c of d.overlays) c.start = map(c.start);
  for (const c of d.audios) c.start = map(c.start);
  const seconds = cuts.reduce((s, [x, y]) => s + y - x, 0);
  // Keep clip durations sane for clips the cuts reached into.
  d.main = d.main.filter((c) => clipDuration(c) > 0.05);
  return { seconds, cuts: cuts.length };
}
