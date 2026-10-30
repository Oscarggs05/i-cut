// Speech recognition models offered for captions and filler removal, the
// device they suit, and the downloaded copies kept in the browser cache.

export type Dtype = 'q8' | 'q4' | 'fp16' | 'fp32';

export interface SpeechModel {
  /** Key stored in preferences; stays the same if the repo or weights change. */
  key: string;
  name: string;
  group: 'mobile' | 'pc';
  repo: string;
  dtype: { encoder_model: Dtype; decoder_model_merged: Dtype };
  /** WebGPU is tried first and WASM used if it isn't available. */
  gpu: boolean;
  /** Download in MB (the two weight files). */
  mb: number;
  note: string;
}

// Word error rate on 3 min of read Spanish (MLS), measured 2026-10-30 with
// the app's own windows: base 11 %, small 5 %, medium q4 2.1 % (q8 1.9 %),
// large-v3-turbo q8 0.7 %. Turbo's 4-bit decoder made it loop (6.9 %), so it
// keeps 8-bit weights. distil-large-v3 only knows English.
export const SPEECH_MODELS: SpeechModel[] = [
  {
    key: 'base', name: 'Rápido', group: 'mobile', repo: 'onnx-community/whisper-base_timestamped',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, gpu: false, mb: 77,
    note: 'El más ligero y rápido, pero comete más errores.',
  },
  {
    key: 'small', name: 'Preciso', group: 'mobile', repo: 'onnx-community/whisper-small_timestamped',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, gpu: false, mb: 249,
    note: 'La mitad de errores que «Rápido». El mejor que cabe en un iPhone.',
  },
  {
    key: 'medium', name: 'Whisper Medium', group: 'pc', repo: 'onnx-community/whisper-medium_timestamped',
    dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, gpu: true, mb: 679,
    note: 'Bastante más preciso que «Preciso». Necesita un ordenador.',
  },
  {
    key: 'turbo', name: 'Whisper Large v3 Turbo', group: 'pc', repo: 'onnx-community/whisper-large-v3-turbo_timestamped',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, gpu: true, mb: 1085,
    note: 'El más preciso. Mejor con una tarjeta gráfica.',
  },
];

export const modelByKey = (key: string) => SPEECH_MODELS.find((m) => m.key === key) ?? SPEECH_MODELS[1];

/** Phones and tablets, where big models run out of memory. */
export const isMobile = () => {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

let gpu: Promise<boolean> | null = null;
/** Whether this browser can run models on the graphics card (WebGPU). */
export const hasWebGpu = () => gpu ??= (async () => {
  try {
    const g = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(g && await g.requestAdapter());
  } catch {
    return false;
  }
})();

const PREF = 'i-cut.speechModel';
export function savedModel(): SpeechModel {
  let key: string | null = null;
  try { key = localStorage.getItem(PREF); } catch { /* private mode */ }
  if (key) return modelByKey(key);
  return modelByKey('small');
}
export function saveModel(key: string) {
  try { localStorage.setItem(PREF, key); } catch { /* private mode */ }
}

// Transformers.js keeps every downloaded file in this Cache Storage bucket,
// keyed by its Hugging Face URL.
const CACHE = 'transformers-cache';
const SUFFIX: Record<Dtype, string> = { q8: '_quantized', q4: '_q4', fp16: '_fp16', fp32: '' };
const inRepo = (url: string, m: SpeechModel) => url.includes(`/${m.repo}/resolve/`);
const weightFiles = (m: SpeechModel) => Object.entries(m.dtype).map(([f, d]) => `/onnx/${f}${SUFFIX[d]}.onnx`);

export interface CachedModel { key: string; mb: number; complete: boolean }

/** Models with files in the cache, and how much space they take. */
export async function cachedModels(): Promise<CachedModel[]> {
  if (typeof caches === 'undefined') return [];
  const cache = await caches.open(CACHE);
  const reqs = await cache.keys();
  const out: CachedModel[] = [];
  for (const m of SPEECH_MODELS) {
    const mine = reqs.filter((r) => inRepo(r.url, m));
    if (!mine.length) continue;
    let bytes = 0;
    for (const r of mine) {
      const res = await cache.match(r);
      const len = Number(res?.headers.get('content-length'));
      bytes += len > 0 ? len : (await res?.blob())?.size ?? 0;
    }
    const complete = weightFiles(m).every((f) => mine.some((r) => r.url.endsWith(f)));
    out.push({ key: m.key, mb: bytes / 1e6, complete });
  }
  return out;
}

/** Deletes a model's downloaded files. */
export async function deleteModel(m: SpeechModel) {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(CACHE);
  for (const r of await cache.keys()) if (inRepo(r.url, m)) await cache.delete(r);
}

/**
 * Before a big download: asks the browser not to evict the cache, and
 * returns the free space in MB when the browser tells it.
 */
export async function prepareStorage(): Promise<number | undefined> {
  try {
    await navigator.storage?.persist?.();
    const e = await navigator.storage?.estimate?.();
    if (e?.quota !== undefined && e.usage !== undefined) return (e.quota - e.usage) / 1e6;
  } catch { /* not supported */ }
  return undefined;
}
