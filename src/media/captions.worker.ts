// Speech recognition (Whisper) running on the device, in a worker so the
// editor stays responsive. The model downloads once and is then cached.

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

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
let asr: Asr | null = null;
let loaded = '';

self.onmessage = async (e: MessageEvent<{ audio: Float32Array; model: string; language: string }>) => {
  const { audio, model, language } = e.data;
  const post = (type: string, data?: unknown) => (self as unknown as Worker).postMessage({ type, data });
  try {
    if (!asr || loaded !== model) {
      const progress_callback = (p: unknown) => post('progress', p);
      const { pipeline } = await load();
      const make = pipeline as unknown as (task: string, model: string, opts: Record<string, unknown>) => Promise<Asr>;
      // WASM with 8-bit weights: the same ~80 MB download and the same
      // result on every iPhone. WebGPU needs float weights (2-3x larger)
      // and is still new in Safari.
      asr = await make('automatic-speech-recognition', model, { progress_callback, device: 'wasm', dtype: 'q8' });
      loaded = model;
    }
    post('status', 'transcribing');
    const out = await asr(audio, {
      // Word timestamps (needs the *_timestamped models) give exact sync.
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
      language,
    });
    post('result', out);
  } catch (err) {
    post('error', (err as Error)?.message ?? String(err));
  }
};
