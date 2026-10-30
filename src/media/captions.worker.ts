// Speech recognition (Whisper) running on the device, in a worker so the
// editor stays responsive. The model downloads once and is then cached.
import { isHallucination, speechWindows } from './speech';
import type { SpeechModel } from './models';

// Loaded from the CDN only when captions are used, so the 25 MB ONNX
// runtime is not part of the app download.
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
let lib: Promise<{ pipeline: unknown; env: { allowLocalModels: boolean } }> | null = null;
const load = () => {
  if (!lib) {
    lib = import(/* @vite-ignore */ TRANSFORMERS).then((m) => { m.env.allowLocalModels = false; return m; });
  }
  return lib;
};

type Chunk = { text: string; timestamp: [number, number | null] };
type Asr = ((audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: Chunk[] }>) & { dispose(): Promise<void> };
let asr: Asr | null = null;
let loaded = '';
let backend = '';

const SR = 16000;

async function webgpu() {
  try {
    const g = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(g && await g.requestAdapter());
  } catch {
    return false;
  }
}

self.onmessage = async (e: MessageEvent<{ audio: Float32Array; model: SpeechModel; language: string }>) => {
  const { audio, model, language } = e.data;
  const post = (type: string, data?: unknown) => (self as unknown as Worker).postMessage({ type, data });
  try {
    if (!asr || loaded !== model.key) {
      // Two models don't fit in an iPhone's memory at once.
      await asr?.dispose();
      asr = null;
      const progress_callback = (p: unknown) => post('progress', p);
      const { pipeline } = await load();
      const make = pipeline as unknown as (task: string, model: string, opts: Record<string, unknown>) => Promise<Asr>;
      // Phone models: WASM with 8-bit weights, the same download and the
      // same result on every iPhone (8-bit loses no accuracy here). PC
      // models run on the graphics card when there is WebGPU, with the same
      // weights as on WASM, so falling back downloads nothing new.
      const opts = { progress_callback, dtype: model.dtype };
      if (model.gpu && await webgpu()) {
        try {
          asr = await make('automatic-speech-recognition', model.repo, { ...opts, device: 'webgpu' });
          backend = 'webgpu';
        } catch (err) {
          console.warn('WebGPU failed, using WASM', err);
        }
      }
      if (!asr) {
        asr = await make('automatic-speech-recognition', model.repo, { ...opts, device: 'wasm' });
        backend = 'wasm';
      }
      loaded = model.key;
    }
    post('backend', backend);
    // Our own windows, cut at pauses, instead of the pipeline's overlapping
    // 30 s chunks: no words duplicated or lost at the seams, silence is
    // skipped, and the progress can be reported window by window.
    const windows = speechWindows(audio, SR).filter((w) => w.speech);
    const total = windows.reduce((s, w) => s + w.end - w.start, 0) / SR;
    const words: { text: string; start: number; end: number }[] = [];
    let done = 0;
    for (const w of windows) {
      const len = (w.end - w.start) / SR;
      post('window', { done, total, len });
      const out = await asr(audio.subarray(w.start, w.end), {
        // Word timestamps (needs the *_timestamped models) give exact sync.
        return_timestamps: 'word',
        task: 'transcribe',
        language,
      });
      if (!isHallucination(out.text.trim())) {
        const t0 = w.start / SR;
        for (const c of out.chunks ?? []) {
          const start = t0 + c.timestamp[0];
          words.push({ text: c.text, start, end: c.timestamp[1] == null ? start + 0.5 : t0 + c.timestamp[1] });
        }
      }
      done += len;
    }
    post('result', words);
  } catch (err) {
    post('error', (err as Error)?.message ?? String(err));
  }
};
