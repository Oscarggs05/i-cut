// Built-in sound effects, synthesized on the device so they are free and
// need no downloads.

export const SFX = [
  { id: 'pop', name: 'Pop', icon: '🫧' },
  { id: 'ding', name: 'Ding', icon: '🔔' },
  { id: 'whoosh', name: 'Whoosh', icon: '💨' },
  { id: 'boom', name: 'Boom', icon: '💥' },
  { id: 'click', name: 'Clic', icon: '🖱️' },
  { id: 'rise', name: 'Subida', icon: '📈' },
  { id: 'laser', name: 'Láser', icon: '🔫' },
  { id: 'coin', name: 'Moneda', icon: '🪙' },
];

function noise(ctx: BaseAudioContext, seconds: number) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource();
  s.buffer = b;
  return s;
}

export async function makeSfx(id: string): Promise<Blob> {
  const sr = 44100;
  const len = id === 'boom' || id === 'rise' ? 1.6 : id === 'ding' ? 1.4 : 0.8;
  const ctx = new OfflineAudioContext(1, Math.ceil(sr * len), sr);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const env = (g: GainNode, a: number, peak: number, d: number) => {
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(peak, a);
    g.gain.exponentialRampToValueAtTime(0.0001, a + d);
  };
  const osc = (type: OscillatorType, f0: number, f1: number, t: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, 0);
    o.frequency.exponentialRampToValueAtTime(f1, t);
    return o;
  };
  const g = ctx.createGain();
  g.connect(out);
  switch (id) {
    case 'pop': { const o = osc('sine', 900, 200, 0.08); o.connect(g); env(g, 0.005, 0.9, 0.12); o.start(); break; }
    case 'ding': {
      for (const [f, v] of [[1318, 0.5], [2637, 0.2], [3951, 0.08]] as const) {
        const o = osc('sine', f, f, 1); const gg = ctx.createGain(); o.connect(gg).connect(out); env(gg, 0.005, v, 1.3); o.start();
      }
      break;
    }
    case 'whoosh': {
      const n = noise(ctx, len); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(300, 0); f.frequency.exponentialRampToValueAtTime(4000, 0.35); f.frequency.exponentialRampToValueAtTime(600, 0.7);
      n.connect(f).connect(g); g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.8, 0.3); g.gain.exponentialRampToValueAtTime(0.0001, 0.75); n.start();
      break;
    }
    case 'boom': {
      const o = osc('sine', 120, 35, 0.9); o.connect(g); env(g, 0.01, 1, 1.4); o.start();
      const n = noise(ctx, len); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
      const gn = ctx.createGain(); n.connect(f).connect(gn).connect(out); env(gn, 0.005, 0.7, 0.9); n.start();
      break;
    }
    case 'click': { const n = noise(ctx, 0.05); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000; n.connect(f).connect(g); env(g, 0.001, 0.8, 0.04); n.start(); break; }
    case 'rise': {
      const o = osc('sawtooth', 150, 1500, 1.4); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2500;
      o.connect(f).connect(g); g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.35, 1.3); g.gain.exponentialRampToValueAtTime(0.0001, 1.55); o.start();
      break;
    }
    case 'laser': { const o = osc('square', 1800, 120, 0.35); o.connect(g); env(g, 0.005, 0.35, 0.4); o.start(); break; }
    case 'coin': {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(988, 0); o.frequency.setValueAtTime(1319, 0.08);
      o.connect(g); env(g, 0.005, 0.3, 0.5); o.start();
      break;
    }
  }
  const buf = await ctx.startRendering();
  return wav(buf);
}

export function wav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true); str(36, 'data'); data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v * 0x7fff, true); o += 2; }
  return new Blob([data.buffer], { type: 'audio/wav' });
}
