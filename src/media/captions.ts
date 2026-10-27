import type { Project, TextClip } from '../types';
import { renderMix } from '../engine/audio';
import { newTextClip, projectDuration } from '../engine/timeline';
import { library } from './library';

export const CAPTION_MODELS = [
  { id: 'onnx-community/whisper-base', label: 'Preciso (~80 MB)' },
  { id: 'onnx-community/whisper-tiny', label: 'Rápido (~40 MB)' },
];

export const CAPTION_LANGS = [
  { id: 'spanish', label: 'Español' },
  { id: 'english', label: 'Inglés' },
  { id: 'auto', label: 'Detectar' },
];

export interface CaptionProgress { stage: 'audio' | 'download' | 'transcribing'; fraction: number }

let worker: Worker | null = null;

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

export async function transcribe(p: Project, model: string, language: string, onProgress: (p: CaptionProgress) => void): Promise<{ text: string; start: number; end: number }[]> {
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
        let l = 0, t = 0;
        for (const f of files.values()) { l += f.loaded; t += f.total; }
        onProgress({ stage: 'download', fraction: t ? l / t : 0 });
      } else if (type === 'status') {
        onProgress({ stage: 'transcribing', fraction: 0 });
      } else if (type === 'result') {
        const chunks = (data.chunks ?? []) as { text: string; timestamp: [number, number | null] }[];
        resolve(chunks.map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 2 })).filter((c) => c.text));
      } else if (type === 'error') {
        reject(new Error(data));
      } else if (type === 'log') {
        console.info(data);
      }
    };
    w.onerror = (e) => reject(new Error(e.message || 'Error en el reconocimiento de voz'));
    w.postMessage({ audio, model, language }, [audio.buffer]);
  });
}

/** Splits segments into short, punchy lines (TikTok style). */
export function captionClips(segs: { text: string; start: number; end: number }[], maxWords: number): TextClip[] {
  const out: TextClip[] = [];
  for (const s of segs) {
    const words = s.text.split(/\s+/).filter(Boolean);
    const n = Math.max(1, Math.ceil(words.length / maxWords));
    const len = Math.max(0.2, s.end - s.start);
    for (let i = 0; i < n; i++) {
      const part = words.slice(i * maxWords, (i + 1) * maxWords).join(' ');
      const c = newTextClip(s.start + (len * i) / n, false, part);
      c.duration = Math.max(0.2, len / n);
      Object.assign(c, {
        caption: true, size: 64, font: 'Montserrat', bold: true, color: '#ffffff',
        strokeColor: '#000000', strokeWidth: 7, shadow: false,
      });
      c.transform.y = 0.3;
      c.animIn = { id: 'pop', duration: 0.18 };
      out.push(c);
    }
  }
  return out;
}
