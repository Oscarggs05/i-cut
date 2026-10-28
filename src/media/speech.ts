export interface Window { start: number; end: number; speech: boolean }

/**
 * Splits 16 kHz audio into windows of at most `maxS` seconds (Whisper sees 30 s
 * at a time), cutting at the quietest pause so no word is split between two
 * windows. Windows with no voice are flagged so they can be skipped: Whisper
 * makes up text on silence and music.
 */
export function speechWindows(audio: Float32Array, sr = 16000, maxS = 28, minS = 15): Window[] {
  const hop = sr / 50; // 20 ms frames
  const n = Math.floor(audio.length / hop);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += audio[j] * audio[j];
    rms[i] = Math.sqrt(s / hop);
  }
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(n * 0.1)] ?? 0;
  const loud = sorted[Math.floor(n * 0.95)] ?? 0;
  const voiceLevel = Math.max(floor * 2, loud * 0.1, 1e-4);
  // A 300 ms average finds real pauses rather than a single quiet frame.
  const k = 15;
  const smooth = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += rms[i];
    if (i >= k) acc -= rms[i - k];
    smooth[i] = acc / Math.min(i + 1, k);
  }
  const out: Window[] = [];
  const maxF = maxS * 50, minF = minS * 50;
  let start = 0;
  while (start < n) {
    let end = n;
    if (n - start > maxF) {
      let best = start + maxF, bestV = Infinity;
      for (let i = start + minF; i < start + maxF; i++) {
        if (smooth[i] <= bestV) { bestV = smooth[i]; best = i - (k >> 1); }
      }
      end = best;
    }
    let voiced = 0;
    for (let i = start; i < end; i++) if (rms[i] > voiceLevel) voiced++;
    out.push({ start: start * hop, end: end >= n ? audio.length : end * hop, speech: voiced >= 10 });
    start = end;
  }
  return out;
}

// Phrases Whisper is known to invent on music or noise (from the subtitles
// it was trained on).
const HALLUCINATION = /amara\.org|subt[ií]tulos (realizados |creados )?por|suscr[ií]bete|gracias por ver|thanks for watching/i;
export const isHallucination = (text: string) => text.length < 90 && HALLUCINATION.test(text);
