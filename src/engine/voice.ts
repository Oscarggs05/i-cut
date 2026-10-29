// Voice changer. Pitch is changed by time-stretching the clip's audio
// (WSOLA) and playing it back faster or slower, so the voice gets higher or
// lower without changing its timing; the other effects are Web Audio graphs.
// Both work in AudioContext and OfflineAudioContext, so preview and export
// sound the same.

export const VOICES: { id: string; name: string; icon: string }[] = [
  { id: 'none', name: 'Original', icon: '🙂' },
  { id: 'chipmunk', name: 'Ardilla', icon: '🐿️' },
  { id: 'child', name: 'Niño', icon: '🧒' },
  { id: 'deep', name: 'Grave', icon: '🗿' },
  { id: 'monster', name: 'Monstruo', icon: '👹' },
  { id: 'robot', name: 'Robot', icon: '🤖' },
  { id: 'alien', name: 'Alien', icon: '👽' },
  { id: 'echo', name: 'Eco', icon: '🏔️' },
  { id: 'hall', name: 'Catedral', icon: '⛪' },
  { id: 'phone', name: 'Teléfono', icon: '📞' },
  { id: 'megaphone', name: 'Megáfono', icon: '📢' },
  { id: 'radio', name: 'Radio', icon: '📻' },
  { id: 'underwater', name: 'Bajo el agua', icon: '🌊' },
];

// Pitch-only voices (and "Original") need no graph.
const GRAPHS = new Set(['robot', 'alien', 'monster', 'echo', 'hall', 'phone', 'megaphone', 'radio', 'underwater']);
const PITCH: Record<string, number> = { chipmunk: 1.75, child: 1.3, deep: 0.72, monster: 0.6, alien: 1.15 };
export const voicePitch = (id?: string) => PITCH[id ?? ''] ?? 1;

const stretched = new WeakMap<AudioBuffer, Map<number, AudioBuffer>>();

/** The buffer slowed down (or sped up) by `factor` without changing its pitch. Cached. */
export function pitched(buf: AudioBuffer, factor: number): AudioBuffer {
  if (factor === 1) return buf;
  let m = stretched.get(buf);
  if (!m) { m = new Map(); stretched.set(buf, m); }
  let out = m.get(factor);
  if (!out) { out = stretch(buf, factor); m.set(factor, out); }
  return out;
}

/**
 * WSOLA time stretch: 40 ms windows are overlap-added at a fixed output hop,
 * each taken from near its ideal input position where it best continues the
 * previous window, so the waveform stays smooth. The search is decimated,
 * which is plenty for a voice and keeps a minute of audio well under a second.
 */
function stretch(buf: AudioBuffer, factor: number): AudioBuffer {
  const sr = buf.sampleRate;
  const N = Math.round(sr * 0.04) & ~1;
  const Hs = N / 2;
  const Ha = Hs / factor;
  const tol = Math.round(sr * 0.006);
  const inLen = buf.length;
  const outLen = Math.max(1, Math.round(inLen * factor));
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  let mono = chans[0];
  if (chans.length > 1) {
    mono = new Float32Array(inLen);
    for (const c of chans) for (let i = 0; i < inLen; i++) mono[i] += c[i];
  }
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const out = chans.map(() => new Float32Array(outLen + N));
  const last = Math.max(0, inLen - N);
  let prev = 0;
  for (let k = 0; k * Hs < outLen; k++) {
    const ideal = Math.min(last, Math.round(k * Ha));
    let best = ideal;
    const target = prev + Hs;
    if (k > 0 && target + Hs < inLen) {
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 3) {
        const cand = ideal + d;
        if (cand < 0 || cand > last) continue;
        let s = 0, e = 1e-9;
        for (let j = 0; j < Hs; j += 6) { const x = mono[cand + j]; s += x * mono[target + j]; e += x * x; }
        s /= Math.sqrt(e);
        if (s > bestScore) { bestScore = s; best = cand; }
      }
    }
    const o = k * Hs;
    for (let ch = 0; ch < chans.length; ch++) {
      const src = chans[ch], dst = out[ch];
      const n = Math.min(N, inLen - best);
      for (let j = 0; j < n; j++) dst[o + j] += src[best + j] * win[j];
    }
    prev = best;
  }
  const res = new AudioBuffer({ length: outLen, numberOfChannels: chans.length, sampleRate: sr });
  out.forEach((d, i) => res.copyToChannel(d.subarray(0, outLen), i));
  return res;
}

function shaper(ctx: BaseAudioContext, k: number) {
  const ws = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, Q = 0.7, gain = 0) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  f.gain.value = gain;
  return f;
}

function gainNode(ctx: BaseAudioContext, v: number) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

/** Decaying stereo noise, used as the impulse of a large room. */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const len = Math.round(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

export interface VoiceChain {
  input: AudioNode;
  /** Disconnecting it silences the effect, tails included. */
  output: AudioNode;
  /** Oscillators that drive the effect, to stop with the clip's sources. */
  sources: AudioScheduledSourceNode[];
}

/**
 * Connects the effect for `id` to `dest` and returns where to feed the clip.
 * `when`/`until` bound the oscillators (plus a tail for echoes).
 */
export function voiceChain(ctx: BaseAudioContext, id: string | undefined, out: AudioNode, when: number, until: number): VoiceChain | null {
  if (!id || !GRAPHS.has(id)) return null;
  const dest = ctx.createGain();
  dest.connect(out);
  const sources: AudioScheduledSourceNode[] = [];
  const osc = (type: OscillatorType, freq: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(when);
    o.stop(until + 4);
    sources.push(o);
    return o;
  };
  /** Delay line whose length wobbles, which bends the pitch back and forth. */
  const vibrato = (rate: number, depth: number) => {
    const d = ctx.createDelay(0.1);
    d.delayTime.value = depth * 2;
    osc('sine', rate).connect(gainNode(ctx, depth)).connect(d.delayTime);
    return d;
  };
  const input = ctx.createGain();
  switch (id) {
    case 'robot': {
      // Ring modulation plus a short metallic comb.
      const ring = ctx.createGain();
      ring.gain.value = 0;
      osc('sine', 50).connect(ring.gain);
      const d = ctx.createDelay(0.1);
      d.delayTime.value = 0.011;
      const fb = gainNode(ctx, 0.45);
      input.connect(ring);
      ring.connect(gainNode(ctx, 1.6)).connect(dest);
      ring.connect(d).connect(fb).connect(d);
      d.connect(gainNode(ctx, 0.8)).connect(dest);
      break;
    }
    case 'alien': {
      const v = vibrato(7, 0.0025);
      input.connect(v).connect(dest);
      const d = ctx.createDelay(0.1);
      d.delayTime.value = 0.018;
      v.connect(d).connect(gainNode(ctx, 0.5)).connect(dest);
      break;
    }
    case 'monster':
      input.connect(shaper(ctx, 12)).connect(filter(ctx, 'lowpass', 2800)).connect(gainNode(ctx, 0.5)).connect(dest);
      break;
    case 'echo': {
      const d = ctx.createDelay(1);
      d.delayTime.value = 0.28;
      const fb = gainNode(ctx, 0.42);
      input.connect(dest);
      input.connect(d).connect(fb).connect(d);
      d.connect(gainNode(ctx, 0.6)).connect(dest);
      break;
    }
    case 'hall': {
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 2.6, 3);
      input.connect(gainNode(ctx, 0.75)).connect(dest);
      input.connect(conv).connect(gainNode(ctx, 0.55)).connect(dest);
      break;
    }
    case 'phone':
      input.connect(filter(ctx, 'highpass', 500)).connect(filter(ctx, 'lowpass', 3200)).connect(shaper(ctx, 6)).connect(gainNode(ctx, 1.1)).connect(dest);
      break;
    case 'megaphone':
      input.connect(filter(ctx, 'highpass', 800)).connect(filter(ctx, 'peaking', 2000, 1, 8)).connect(shaper(ctx, 30))
        .connect(filter(ctx, 'lowpass', 4500)).connect(gainNode(ctx, 0.7)).connect(dest);
      break;
    case 'radio':
      input.connect(filter(ctx, 'bandpass', 1800, 0.8)).connect(shaper(ctx, 14)).connect(gainNode(ctx, 0.9)).connect(dest);
      break;
    case 'underwater':
      input.connect(filter(ctx, 'lowpass', 450, 6)).connect(vibrato(1.5, 0.004)).connect(gainNode(ctx, 0.8)).connect(dest);
      break;
  }
  return { input, output: dest, sources };
}
