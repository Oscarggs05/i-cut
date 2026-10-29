import type { Project, TextClip, TimedWord } from '../types';
import { renderMix } from '../engine/audio';
import { applyTemplate } from '../engine/presets';
import { newTextClip, projectDuration } from '../engine/timeline';
import { library } from './library';

// Measured on 3 min of Spanish speech (word error rate, lower is better):
// small 11 %, base 19 %, tiny 45 %. Tiny is too inaccurate to offer.
export const CAPTION_MODELS = [
  { id: 'onnx-community/whisper-small_timestamped', label: 'Preciso (~250 MB)' },
  { id: 'onnx-community/whisper-base_timestamped', label: 'Rápido (~80 MB)' },
];

// Whisper in Transformers.js doesn't detect the language (it falls back to
// English), so the language is always chosen explicitly.
export const CAPTION_LANGS = [
  { id: 'spanish', label: 'Español' },
  { id: 'english', label: 'Inglés' },
  { id: 'catalan', label: 'Catalán' },
  { id: 'portuguese', label: 'Portugués' },
  { id: 'french', label: 'Francés' },
  { id: 'italian', label: 'Italiano' },
  { id: 'german', label: 'Alemán' },
]

export interface CaptionProgress {
  stage: 'audio' | 'download' | 'loading' | 'transcribing';
  fraction: number;
  /** Download: MB received and expected. */
  mb?: number;
  totalMb?: number;
  /** Transcription: seconds of speech processed and in total. */
  done?: number;
  total?: number;
  /** Estimated seconds left, once there is enough to estimate it. */
  eta?: number;
}

/**
 * Mixes the project audio at 16 kHz mono, which is what Whisper expects.
 * Voice effects are left out: a chipmunk voice can't be transcribed.
 */
export async function projectAudio16k(p: Project): Promise<Float32Array> {
  p = {
    ...p,
    main: p.main.map((c) => ({ ...c, voice: undefined })),
    overlays: p.overlays.map((c) => ({ ...c, voice: undefined })),
    audios: p.audios.map((c) => ({ ...c, voice: undefined })),
  };
  const assets = p.assets.filter((a) => a.kind !== 'image');
  for (const a of assets) await library.audioBuffer(a);
  const dur = projectDuration(p);
  const mix = await renderMix(p, dur, (a) => library.audioNow(a.id), 16000);
  const out = new Float32Array(mix.length);
  const chans = Array.from({ length: mix.numberOfChannels }, (_, i) => mix.getChannelData(i));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (const c of chans) s += c[i];
    out[i] = s / chans.length;
  }
  return out;
}

let worker: Worker | null = null;

type Segment = TimedWord;

/** Transcribes the project (or `audio`, already mixed by projectAudio16k) into timed words. */
export async function transcribe(p: Project, model: string, language: string, onProgress: (p: CaptionProgress) => void, mixed?: Float32Array): Promise<Segment[]> {
  onProgress({ stage: 'audio', fraction: 0 });
  // The buffer is handed over to the worker, so a caller's copy is cloned.
  const audio = mixed ? mixed.slice() : await projectAudio16k(p);
  if (!worker) worker = new Worker(new URL('./captions.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const files = new Map<string, { loaded: number; total: number; done: boolean }>();
  // Transcription progress arrives once per window (~20 s of audio), which
  // can take a while on a phone, so the bar is moved smoothly in between
  // using the speed measured on the windows already done.
  let tick = 0;
  let win = { done: 0, total: 0, len: 0, at: 0 };
  let began = 0;
  const report = () => {
    const now = performance.now();
    const rate = win.done > 0 ? (win.at - began) / 1000 / win.done : 0; // s of work per s of audio
    const inWin = rate ? Math.min(win.len * 0.95, (now - win.at) / 1000 / rate) : 0;
    const done = win.done + inWin;
    onProgress({
      stage: 'transcribing', fraction: win.total ? done / win.total : 0, done, total: win.total,
      eta: rate ? (win.total - done) * rate : undefined,
    });
  };
  const stop = () => clearInterval(tick);
  return new Promise<Segment[]>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ type: string; data: any }>) => {
      const { type, data } = e.data;
      if (type === 'progress' && data?.file && (data.status === 'progress' || data.status === 'done')) {
        const f = files.get(data.file) ?? { loaded: 0, total: 0, done: false };
        if (data.status === 'progress') Object.assign(f, { loaded: data.loaded ?? 0, total: data.total ?? 0 });
        else f.done = true;
        files.set(data.file, f);
        // Only the model weights matter for the bar; config files are tiny
        // and would make it jump to 100 % straight away.
        const weights = [...files].filter(([name]) => name.endsWith('.onnx')).map(([, x]) => x);
        const l = weights.reduce((s, x) => s + x.loaded, 0);
        const t = weights.reduce((s, x) => s + x.total, 0);
        if (weights.length && weights.every((x) => x.done)) onProgress({ stage: 'loading', fraction: 1 });
        else onProgress({ stage: 'download', fraction: t ? l / t : 0, mb: l / 1e6, totalMb: t / 1e6 });
      } else if (type === 'window') {
        const now = performance.now();
        if (!began) { began = now; tick = window.setInterval(report, 250); }
        win = { ...data, at: now };
        report();
      } else if (type === 'result') {
        stop();
        resolve((data as Segment[]).map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text));
      } else if (type === 'error') {
        stop();
        reject(new Error(data));
      }
    };
    w.onerror = (e) => {
      stop();
      // A crashed worker can't be reused.
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || 'Error en el reconocimiento de voz'));
    };
    w.postMessage({ audio, model, language }, [audio.buffer]);
  });
}

/** Groups timed words into short, punchy lines (TikTok style) in the given template's look. */
export function captionClips(input: Segment[], maxWords: number, template = 'karaoke'): TextClip[] {
  // One entry per word of the caption text, so karaoke timing lines up.
  const words = input.flatMap((w) => w.text.split(/\s+/).filter(Boolean).map((text) => ({ ...w, text })));
  const lines: Segment[][] = [];
  let cur: Segment[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const sentenceEnd = /[.?!…]$/.test(w.text);
    const pause = next ? next.start - w.end > 0.6 : true;
    if (cur.length >= maxWords || sentenceEnd || pause) { lines.push(cur); cur = []; }
  });
  if (cur.length) lines.push(cur);
  return lines.map((ws, i) => {
    const start = ws[0].start;
    let end = ws[ws.length - 1].end;
    // Close small gaps so captions don't flicker between lines.
    const nextStart = lines[i + 1]?.[0].start;
    if (nextStart !== undefined && nextStart - end < 0.35) end = nextStart;
    const c = newTextClip(start, false, ws.map((w) => w.text).join(' '));
    c.duration = Math.max(0.25, end - start);
    applyTemplate(c, template);
    c.caption = true;
    c.size = 76;
    c.words = ws.map((w) => ({ text: w.text, start: w.start - start, end: w.end - start }));
    c.transform.y = 0.28;
    return c;
  });
}
