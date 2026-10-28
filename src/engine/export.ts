// Export: renders every frame on the GPU, encodes with WebCodecs (hardware
// H.264/HEVC on iPhone) and muxes an MP4 with Mediabunny. Falls back to a
// real-time MediaRecorder capture on browsers without WebCodecs encoders.

import {
  AudioBufferSource, BufferTarget, CanvasSink, CanvasSource, Mp4OutputFormat, Output,
  canEncodeAudio, getFirstEncodableVideoCodec, type VideoCodec, type WrappedCanvas,
} from 'mediabunny';
import type { Asset, MediaClip, Project } from '../types';
import { audioContext, library } from '../media/library';
import { audioSegments, renderMix } from './audio';
import { Player } from './player';
import { Renderer, type FrameRef } from './renderer';
import { buildScene, type MediaLayer } from './scene';
import { loadProjectFonts } from './text';
import { aspectRatio, outputSize, projectDuration } from './timeline';

export type Quality = 'low' | 'medium' | 'high';

export interface ExportOptions {
  shortSide: number;
  fps: number;
  quality: Quality;
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  ext: string;
  width: number;
  height: number;
  method: 'webcodecs' | 'realtime';
}

export type Progress = (fraction: number, stage: string) => void;

const BPP: Record<Quality, number> = { low: 0.05, medium: 0.09, high: 0.15 };

export function exportBitrate(w: number, h: number, fps: number, q: Quality) {
  return Math.round(Math.min(60e6, Math.max(1e6, w * h * fps * BPP[q])));
}

export function estimateSize(p: Project, o: ExportOptions): number {
  const { width, height } = outputSize(aspectRatio(p), o.shortSide);
  return ((exportBitrate(width, height, o.fps, o.quality) + 192e3) * projectDuration(p)) / 8;
}

export const supportsWebCodecs = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/** Pulls frames from a clip in increasing time order. */
class DecodedFrames {
  private iter: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private cur: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private done = false;
  private constructor(private sink: CanvasSink, private startAt: number) {}

  static async create(asset: Asset, clip: MediaClip, maxSide: number): Promise<DecodedFrames | null> {
    const track = await library.input(asset.id).getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const dw = await track.getDisplayWidth(), dh = await track.getDisplayHeight();
    const k = Math.min(1, maxSide / Math.max(dw, dh));
    const sink = new CanvasSink(track, { width: Math.max(2, Math.round((dw * k) / 2) * 2), poolSize: 3 });
    return new DecodedFrames(sink, clip.in);
  }

  async at(ts: number): Promise<WrappedCanvas | null> {
    if (!this.iter) {
      this.iter = this.sink.canvases(Math.max(0, this.startAt - 0.001));
      this.cur = (await this.iter.next()).value ?? null;
      const n = await this.iter.next();
      this.next = n.done ? null : n.value;
      this.done = !!n.done;
    }
    while (this.next && this.next.timestamp <= ts + 1e-4) {
      this.cur = this.next;
      if (this.done) { this.next = null; break; }
      const n = await this.iter.next();
      if (n.done) { this.done = true; this.next = null; } else this.next = n.value;
    }
    return this.cur;
  }

  async close() { try { await this.iter?.return(); } catch { /* ignore */ } }
}

/** Seek-based fallback when the decoder can't read a file. */
class ElementFrames {
  private el: HTMLVideoElement;
  private ready: Promise<void>;
  constructor(url: string) {
    this.el = document.createElement('video');
    this.el.muted = true; this.el.playsInline = true; this.el.preload = 'auto'; this.el.src = url;
    this.ready = new Promise((res, rej) => { this.el.onloadeddata = () => res(); this.el.onerror = () => rej(new Error('video')); });
  }
  async at(ts: number): Promise<HTMLVideoElement> {
    await this.ready;
    if (Math.abs(this.el.currentTime - ts) > 0.002) {
      await new Promise<void>((res) => { this.el.onseeked = () => res(); this.el.currentTime = ts; });
    }
    return this.el;
  }
  close() { this.el.removeAttribute('src'); this.el.load(); }
}

export async function exportProject(p: Project, o: ExportOptions, onProgress: Progress, signal: AbortSignal): Promise<ExportResult> {
  if (!supportsWebCodecs()) return exportRealtime(p, o, onProgress, signal);

  const duration = projectDuration(p);
  if (duration <= 0) throw new Error('El proyecto está vacío.');
  const { width, height } = outputSize(aspectRatio(p), o.shortSide);
  const bitrate = exportBitrate(width, height, o.fps, o.quality);

  const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
  const order: VideoCodec[] = ['avc', 'hevc', 'vp9', 'av1'];
  const codec = await getFirstEncodableVideoCodec(order.filter((c) => format.getSupportedVideoCodecs().includes(c)), { width, height, bitrate });
  if (!codec) return exportRealtime(p, o, onProgress, signal);

  onProgress(0, 'Preparando audio…');
  await loadProjectFonts(p);
  const segs = audioSegments(p);
  const buffers = new Map<string, AudioBuffer | null>();
  for (const s of segs) if (!buffers.has(s.asset.id)) buffers.set(s.asset.id, await library.audioBuffer(s.asset));
  const hasAudio = segs.some((s) => buffers.get(s.asset.id));
  let mix: AudioBuffer | null = null;
  if (hasAudio) {
    mix = await renderMix(p, duration, (a) => buffers.get(a.id));
    if (!(await canEncodeAudio('aac'))) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
    }
  }
  if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');

  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas, { preserve: true });
  renderer.resize(width, height);

  const output = new Output({ format, target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2, sizeChangeBehavior: 'deny' });
  output.addVideoTrack(video, { frameRate: o.fps });
  let audio: AudioBufferSource | null = null;
  if (mix) {
    audio = new AudioBufferSource({ codec: 'aac', bitrate: 192e3 });
    output.addAudioTrack(audio);
  }

  const decoders = new Map<string, DecodedFrames | ElementFrames>();
  const maxSide = Math.max(width, height);
  const frameFor = async (l: MediaLayer): Promise<FrameRef | null> => {
    const a = l.asset;
    if (a.kind === 'image') {
      const img = await library.image(a.id);
      return { key: 'img:' + a.id, src: img, width: img.width, height: img.height, version: 1 };
    }
    let d = decoders.get(l.clip.id);
    if (!d) {
      d = (await DecodedFrames.create(a, l.clip, maxSide).catch(() => null)) ?? new ElementFrames(library.url(a.id)!);
      decoders.set(l.clip.id, d);
    }
    if (d instanceof DecodedFrames) {
      const wc = await d.at(l.sourceTime);
      if (!wc) return null;
      return { key: 'clip:' + l.clip.id, src: wc.canvas as TexImageSource, width: wc.canvas.width, height: wc.canvas.height, version: -1 };
    }
    const el = await d.at(l.sourceTime);
    return { key: 'clip:' + l.clip.id, src: el, width: el.videoWidth, height: el.videoHeight, version: -1 };
  };

  try {
    await output.start();
    if (audio && mix) {
      onProgress(0, 'Codificando audio…');
      // Feed in slices so the encoder never holds the whole track at once.
      const slice = 48000 * 10;
      for (let off = 0; off < mix.length; off += slice) {
        const len = Math.min(slice, mix.length - off);
        const part = new AudioBuffer({ length: len, numberOfChannels: mix.numberOfChannels, sampleRate: mix.sampleRate });
        for (let c = 0; c < mix.numberOfChannels; c++) part.copyToChannel(mix.getChannelData(c).subarray(off, off + len), c);
        await audio.add(part);
        if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      }
      audio.close();
    }

    const frames = Math.max(1, Math.round(duration * o.fps));
    const live = new Set<string>();
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      const t = Math.min(i / o.fps, duration - 0.0005);
      const scene = buildScene(p, t);
      const layers: MediaLayer[] = [];
      if (scene.main) { layers.push(scene.main.a); if (scene.main.b) layers.push(scene.main.b); }
      layers.push(...scene.overlays);
      const refs = new Map<string, FrameRef | null>();
      for (const l of layers) refs.set(l.clip.id, await frameFor(l));
      renderer.render(p, scene, (l) => refs.get(l.clip.id) ?? null);
      await video.add(i / o.fps, 1 / o.fps);
      // Close decoders of clips that are over.
      for (const l of layers) live.add(l.clip.id);
      for (const id of live) {
        if (!refs.has(id)) {
          const d = decoders.get(id);
          if (d) { void d.close(); decoders.delete(id); }
          live.delete(id);
        }
      }
      if (i % 5 === 0) onProgress(i / frames, 'Renderizando vídeo…');
    }
    video.close();
    onProgress(1, 'Finalizando…');
    await output.finalize();
    const buf = (output.target as BufferTarget).buffer!;
    return { blob: new Blob([buf], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4', width, height, method: 'webcodecs' };
  } catch (e) {
    try { await output.cancel(); } catch { /* ignore */ }
    throw e;
  } finally {
    for (const d of decoders.values()) void d.close();
    renderer.dispose();
  }
}

/** Plays the project in real time and records the canvas + mix. */
export async function exportRealtime(p: Project, o: ExportOptions, onProgress: Progress, signal: AbortSignal): Promise<ExportResult> {
  if (typeof MediaRecorder === 'undefined') throw new Error('Este navegador no puede exportar vídeo. Actualiza iOS a la versión 16.4 o superior.');
  const duration = projectDuration(p);
  const { width, height } = outputSize(aspectRatio(p), Math.min(o.shortSide, 1080));
  const canvas = document.createElement('canvas');
  const player = new Player(canvas, p);
  player.resize(width, height);
  onProgress(0, 'Preparando…');
  await loadProjectFonts(p);
  for (const s of audioSegments(p)) await library.audioBuffer(s.asset);
  player.seek(0);
  await new Promise((r) => setTimeout(r, 800));
  const ctx = audioContext();
  const dest = ctx.createMediaStreamDestination();
  const stream = new MediaStream([
    ...(canvas as HTMLCanvasElement).captureStream(o.fps).getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);
  const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: exportBitrate(width, height, o.fps, o.quality) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
  rec.start(1000);
  player.onTime = (t) => onProgress(t / duration, 'Grabando en tiempo real…');
  await new Promise<void>((res, rej) => {
    player.onEnded = () => res();
    signal.addEventListener('abort', () => rej(new DOMException('Cancelado', 'AbortError')));
    player.play(dest);
  }).finally(() => {
    player.pause();
    rec.stop();
  });
  await stopped;
  player.dispose();
  const type = rec.mimeType || mime || 'video/mp4';
  return { blob: new Blob(chunks, { type }), mime: type, ext: type.includes('webm') ? 'webm' : 'mp4', width, height, method: 'realtime' };
}
