import type { Project, TextClip } from '../types';
import { renderMix } from '../engine/audio';
import { newTextClip, projectDuration } from '../engine/timeline';
import { library } from './library';

export const CAPTION_MODELS = [
  { id: 'onnx-community/whisper-base_timestamped', label: 'Preciso (~80 MB)' },
  { id: 'onnx-community/whisper-tiny_timestamped', label: 'Rápido (~40 MB)' },
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

export interface CaptionProgress { stage: 'audio' | 'download' | 'transcribing'; fraction: number; mb?: number }

/** Mixes the project audio at 16 kHz mono, which is what Whisper expects. */
async function projectAudio16k(p: Project): Promise<Float32Array> {
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

type Segment = { text: string; start: number; end: number };

export async function transcribe(p: Project, model: string, language: string, onProgress: (p: CaptionProgress) => void): Promise<Segment[]> {
  onProgress({ stage: 'audio', fraction: 0 });
  const audio = await projectAudio16k(p);
  if (!worker) worker = new Worker(new URL('./captions.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const files = new Map<string, { loaded: number; total: number }>();
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ type: string; data: any }>) => {
      const { type, data } = e.data;
      if (type === 'progress' && data?.status === 'progress' && data.file) {
        files.set(data.file, { loaded: data.loaded ?? 0, total: data.total ?? 0 });
        // Only the model weights matter for the bar; config files are tiny
        // and would make it jump to 100 % straight away.
        let l = 0, t = 0;
        for (const [name, f] of files) if (name.endsWith('.onnx')) { l += f.loaded; t += f.total; }
        onProgress({ stage: 'download', fraction: t ? l / t : 0, mb: l / 1e6 });
      } else if (type === 'status') {
        onProgress({ stage: 'transcribing', fraction: 0 });
      } else if (type === 'result') {
        const chunks = (data.chunks ?? []) as { text: string; timestamp: [number, number | null] }[];
        resolve(chunks.map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.5 })).filter((c) => c.text));
      } else if (type === 'error') {
        reject(new Error(data));
      }
    };
    w.onerror = (e) => {
      // A crashed worker can't be reused.
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || 'Error en el reconocimiento de voz'));
    };
    w.postMessage({ audio, model, language }, [audio.buffer]);
  });
}

/** Groups timed words into short, punchy lines (TikTok style). */
export function captionClips(words: Segment[], maxWords: number): TextClip[] {
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
    Object.assign(c, {
      caption: true, size: 76, font: 'Montserrat', bold: true, color: '#ffffff',
      strokeColor: '#000000', strokeWidth: 8, shadow: false,
    });
    c.transform.y = 0.28;
    c.animIn = { id: 'pop', duration: 0.15 };
    return c;
  });
}
