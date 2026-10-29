// Reverse: renders a backwards copy of part of a video on the device.
// Frames are decoded in short windows from the end towards the start, each
// window is played back to front into the encoder, and the audio is simply
// flipped. The copy then behaves like any other imported video.

import {
  AudioBufferSource, BufferTarget, CanvasSink, CanvasSource, Mp4OutputFormat, Output,
  canEncodeAudio, getFirstEncodableVideoCodec, type VideoCodec,
} from 'mediabunny';
import type { Asset } from '../types';
import { library } from './library';

const abort = () => new DOMException('Cancelado', 'AbortError');

function reversedAudio(buf: AudioBuffer, t0: number, t1: number): AudioBuffer | null {
  const a = Math.max(0, Math.floor(t0 * buf.sampleRate));
  const b = Math.min(buf.length, Math.ceil(t1 * buf.sampleRate));
  if (b - a < 2) return null;
  const out = new AudioBuffer({ length: b - a, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c).subarray(a, b);
    const dst = new Float32Array(src.length);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
    out.copyToChannel(dst, c);
  }
  return out;
}

export async function reverseVideo(asset: Asset, t0: number, t1: number, onProgress: (f: number) => void, signal: AbortSignal): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') throw new Error('Para invertir clips hace falta iOS 16.4 o posterior.');
  const track = await library.input(asset.id).getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) throw new Error('Este navegador no puede leer el vídeo para invertirlo.');
  const dw = await track.getDisplayWidth(), dh = await track.getDisplayHeight();
  const k = Math.min(1, 1080 / Math.min(dw, dh), 1920 / Math.max(dw, dh));
  const width = Math.max(2, Math.round((dw * k) / 2) * 2), height = Math.max(2, Math.round((dh * k) / 2) * 2);
  let fps = 30;
  try { fps = (await track.computePacketStats(60)).averagePacketRate || 30; } catch { /* keep 30 */ }
  fps = Math.max(15, Math.min(60, fps));
  const bitrate = Math.round(Math.min(25e6, Math.max(2e6, width * height * fps * 0.12)));

  const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
  const order: VideoCodec[] = ['avc', 'hevc', 'vp9', 'av1'];
  const codec = await getFirstEncodableVideoCodec(order.filter((c) => format.getSupportedVideoCodecs().includes(c)), { width, height, bitrate });
  if (!codec) throw new Error('Este dispositivo no puede codificar el vídeo invertido.');

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const output = new Output({ format, target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 1, sizeChangeBehavior: 'deny' });
  output.addVideoTrack(video, { frameRate: Math.round(fps) });

  let audio: AudioBufferSource | null = null;
  let rev: AudioBuffer | null = null;
  if (asset.hasAudio) {
    const buf = await library.audioBuffer(asset);
    rev = buf && reversedAudio(buf, t0, t1);
    if (rev) {
      if (!(await canEncodeAudio('aac'))) {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
        registerAacEncoder();
      }
      audio = new AudioBufferSource({ codec: 'aac', bitrate: 192e3 });
      output.addAudioTrack(audio);
    }
  }

  // Keep roughly 100 MB of decoded frames in memory at a time.
  const win = Math.max(0.25, Math.min(2, 100e6 / (width * height * 4 * fps)));
  const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 0 });
  try {
    await output.start();
    if (audio && rev) {
      const slice = rev.sampleRate * 10;
      for (let off = 0; off < rev.length; off += slice) {
        const len = Math.min(slice, rev.length - off);
        const part = new AudioBuffer({ length: len, numberOfChannels: rev.numberOfChannels, sampleRate: rev.sampleRate });
        for (let c = 0; c < rev.numberOfChannels; c++) part.copyToChannel(rev.getChannelData(c).subarray(off, off + len), c);
        await audio.add(part);
        if (signal.aborted) throw abort();
      }
      audio.close();
    }

    const seen = new Set<number>();
    let last = -1;
    let frames = 0;
    for (let end = t1; end > t0 + 1e-4; end -= win) {
      const start = Math.max(t0, end - win);
      const batch: { t: number; d: number; c: CanvasImageSource }[] = [];
      for await (const wc of sink.canvases(start, end)) {
        if (signal.aborted) throw abort();
        const key = Math.round(wc.timestamp * 1e5);
        if (seen.has(key) || wc.timestamp >= t1 - 1e-4 || wc.timestamp + wc.duration <= t0 + 1e-4) continue;
        seen.add(key);
        batch.push({ t: wc.timestamp, d: wc.duration || 1 / fps, c: wc.canvas as CanvasImageSource });
      }
      batch.sort((a, b) => b.t - a.t);
      for (const f of batch) {
        let at = Math.max(0, t1 - (f.t + f.d));
        if (at <= last) at = last + 1e-3;
        ctx.drawImage(f.c, 0, 0, width, height);
        await video.add(at, f.d);
        last = at;
        frames++;
        if (signal.aborted) throw abort();
      }
      onProgress(Math.min(0.99, (t1 - start) / Math.max(0.01, t1 - t0)));
    }
    if (!frames) throw new Error('No se pudo leer ningún fotograma del clip.');
    video.close();
    await output.finalize();
    onProgress(1);
    return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
  } catch (e) {
    try { await output.cancel(); } catch { /* ignore */ }
    throw e;
  }
}
