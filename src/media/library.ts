// Media library: imports files, keeps their bytes in IndexedDB, and hands
// out decoded forms (object URLs, images, audio buffers, thumbnails).

import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Asset, AssetKind } from '../types';
import { uid } from '../engine/timeline';
import { loadMedia, saveMedia } from '../store/db';

let actx: AudioContext | null = null;
export function audioContext(): AudioContext {
  if (!actx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    actx = new AC({ latencyHint: 'interactive' });
  }
  return actx;
}

function kindOf(file: Blob & { name?: string }): AssetKind | null {
  const t = file.type;
  const n = (file.name ?? '').toLowerCase();
  if (t.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|3gp)$/.test(n)) return 'video';
  if (t.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/.test(n)) return 'image';
  if (t.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|caf|aiff?)$/.test(n)) return 'audio';
  return null;
}

function mediaElementInfo(url: string, kind: 'video' | 'audio'): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.muted = true;
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    const done = () => {
      const v = el as HTMLVideoElement;
      resolve({ duration: el.duration, width: v.videoWidth || 0, height: v.videoHeight || 0 });
      el.removeAttribute('src');
      el.load();
    };
    el.onloadedmetadata = () => {
      // Some files report Infinity until they are scanned.
      if (el.duration === Infinity) {
        el.currentTime = 1e9;
        el.ontimeupdate = () => { el.ontimeupdate = null; done(); };
      } else done();
    };
    el.onerror = () => reject(new Error('No se pudo leer el archivo'));
    el.src = url;
  });
}

export interface Thumbs { times: number[]; images: (HTMLCanvasElement | ImageBitmap)[]; aspect: number }

class Library {
  private blobs = new Map<string, Blob>();
  private urls = new Map<string, string>();
  private images = new Map<string, Promise<ImageBitmap | HTMLImageElement>>();
  private imagesReady = new Map<string, ImageBitmap | HTMLImageElement>();
  private audio = new Map<string, Promise<AudioBuffer | null>>();
  private audioReady = new Map<string, AudioBuffer | null>();
  private thumbs = new Map<string, Promise<Thumbs | null>>();
  private thumbsReady = new Map<string, Thumbs>();
  private inputs = new Map<string, Input>();
  private peakCache = new Map<string, Float32Array>();
  listeners = new Set<() => void>();

  private emit() { for (const l of this.listeners) l(); }

  async import(file: File): Promise<Asset> {
    const kind = kindOf(file);
    if (!kind) throw new Error(`Formato no compatible: ${file.name}`);
    const id = uid();
    const url = URL.createObjectURL(file);
    this.blobs.set(id, file);
    this.urls.set(id, url);
    let duration = 0, width = 0, height = 0, hasAudio = kind !== 'image';
    if (kind === 'image') {
      const img = await this.image(id);
      width = img.width;
      height = img.height;
    } else {
      try {
        const info = await mediaElementInfo(url, kind);
        duration = info.duration; width = info.width; height = info.height;
      } catch {
        // Fall back to the demuxer for files the media element refuses.
        const input = this.input(id);
        duration = await input.computeDuration();
        const vt = await input.getPrimaryVideoTrack();
        if (vt) { width = await vt.getDisplayWidth(); height = await vt.getDisplayHeight(); }
      }
      if (kind === 'video') {
        try {
          const at = await this.input(id).getPrimaryAudioTrack();
          hasAudio = !!at;
        } catch { /* assume audio */ }
      }
    }
    if (!isFinite(duration) || duration <= 0) {
      if (kind !== 'image') throw new Error(`No se pudo leer la duración de ${file.name}`);
    }
    await saveMedia(id, file);
    return { id, kind, name: file.name || `${kind}-${id}`, mime: file.type, size: file.size, duration, width, height, hasAudio };
  }

  /** Registers an already-created blob (recordings, frozen frames). */
  async importBlob(blob: Blob, name: string): Promise<Asset> {
    const file = new File([blob], name, { type: blob.type });
    return this.import(file);
  }

  /** Makes sure the bytes of these assets are in memory. */
  async load(assets: Asset[]) {
    await Promise.all(assets.map(async (a) => {
      if (this.blobs.has(a.id)) return;
      const blob = await loadMedia(a.id);
      if (!blob) return;
      this.blobs.set(a.id, blob);
      this.urls.set(a.id, URL.createObjectURL(blob));
    }));
  }

  has(id: string) { return this.blobs.has(id); }
  blob(id: string) { return this.blobs.get(id); }
  url(id: string) { return this.urls.get(id); }

  input(id: string): Input {
    let i = this.inputs.get(id);
    if (!i) {
      const blob = this.blobs.get(id);
      if (!blob) throw new Error('Archivo no cargado');
      i = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      this.inputs.set(id, i);
    }
    return i;
  }

  image(id: string): Promise<ImageBitmap | HTMLImageElement> {
    let p = this.images.get(id);
    if (!p) {
      const blob = this.blobs.get(id)!;
      p = (async () => {
        try {
          return await createImageBitmap(blob, { imageOrientation: 'from-image' });
        } catch {
          const img = new Image();
          img.src = this.urls.get(id)!;
          await img.decode();
          return img;
        }
      })();
      p.then((img) => { this.imagesReady.set(id, img); this.emit(); });
      this.images.set(id, p);
    }
    return p;
  }
  imageNow(id: string) { return this.imagesReady.get(id); }

  /** Decoded audio of a video or audio asset (null when it has none). */
  audioBuffer(asset: Asset): Promise<AudioBuffer | null> {
    let p = this.audio.get(asset.id);
    if (!p) {
      p = this.decodeAudio(asset).catch((e) => { console.warn('audio decode', e); return null; });
      p.then((b) => { this.audioReady.set(asset.id, b); this.emit(); });
      this.audio.set(asset.id, p);
    }
    return p;
  }
  audioNow(id: string) { return this.audioReady.get(id); }

  private async decodeAudio(asset: Asset): Promise<AudioBuffer | null> {
    if (asset.kind === 'image' || !asset.hasAudio) return null;
    const blob = this.blobs.get(asset.id);
    if (!blob) return null;
    // The demuxer path only reads the audio packets, which matters for big
    // videos on iPhone where loading the whole file into memory can crash.
    if (typeof AudioDecoder !== 'undefined') {
      try {
        const track = await this.input(asset.id).getPrimaryAudioTrack();
        if (!track) return null;
        if (await track.canDecode()) {
          const sink = new AudioBufferSink(track);
          const sr = track.sampleRate;
          const ch = Math.min(2, track.numberOfChannels);
          const first = await track.getFirstTimestamp();
          const length = Math.ceil((asset.duration + 0.5) * sr);
          const out = new AudioBuffer({ length, numberOfChannels: ch, sampleRate: sr });
          for await (const { buffer, timestamp } of sink.buffers()) {
            const off = Math.round((timestamp - first) * sr);
            for (let c = 0; c < ch; c++) {
              const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
              const room = length - off;
              if (room <= 0 || off < 0) continue;
              out.copyToChannel(src.length > room ? src.subarray(0, room) : src, c, off);
            }
          }
          return out;
        }
      } catch (e) {
        console.warn('mediabunny audio decode failed, falling back', e);
      }
    }
    if (blob.size > 600 * 1024 * 1024) return null;
    const ab = await blob.arrayBuffer();
    return await new Promise<AudioBuffer>((resolve, reject) => audioContext().decodeAudioData(ab, resolve, reject));
  }

  /** Peak envelope at 50 values per second, for waveforms. */
  peaks(id: string): Float32Array | null {
    const hit = this.peakCache.get(id);
    if (hit) return hit;
    const buf = this.audioReady.get(id);
    if (!buf) return null;
    const per = Math.max(1, Math.floor(buf.sampleRate / 50));
    const n = Math.ceil(buf.length / per);
    const out = new Float32Array(n);
    const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    for (let i = 0; i < n; i++) {
      let m = 0;
      const s = i * per, e = Math.min(buf.length, s + per);
      for (const d of chans) for (let j = s; j < e; j += 8) { const v = Math.abs(d[j]); if (v > m) m = v; }
      out[i] = m;
    }
    let max = 0;
    for (const v of out) max = Math.max(max, v);
    if (max > 0) for (let i = 0; i < n; i++) out[i] = Math.min(1, out[i] / max);
    this.peakCache.set(id, out);
    return out;
  }

  thumbnails(asset: Asset): Promise<Thumbs | null> {
    let p = this.thumbs.get(asset.id);
    if (!p) {
      p = this.makeThumbs(asset).catch((e) => { console.warn('thumbs', e); return null; });
      p.then((t) => { if (t) { this.thumbsReady.set(asset.id, t); this.emit(); } });
      this.thumbs.set(asset.id, p);
    }
    return p;
  }
  thumbsNow(id: string) { return this.thumbsReady.get(id); }

  private async makeThumbs(asset: Asset): Promise<Thumbs | null> {
    if (asset.kind === 'audio') return null;
    const h = 96;
    if (asset.kind === 'image') {
      const img = await this.image(asset.id);
      const c = document.createElement('canvas');
      c.height = h;
      c.width = Math.max(1, Math.round((img.width / img.height) * h));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      return { times: [0], images: [c], aspect: img.width / img.height };
    }
    const count = Math.min(60, Math.max(2, Math.ceil(asset.duration)));
    const times = Array.from({ length: count }, (_, i) => (i / count) * asset.duration);
    try {
      const track = await this.input(asset.id).getPrimaryVideoTrack();
      if (track && (await track.canDecode())) {
        const sink = new CanvasSink(track, { height: h, poolSize: 0 });
        const images: HTMLCanvasElement[] = [];
        const okTimes: number[] = [];
        let i = 0;
        for await (const wc of sink.canvasesAtTimestamps(times)) {
          if (wc) {
            const c = document.createElement('canvas');
            c.width = wc.canvas.width; c.height = wc.canvas.height;
            c.getContext('2d')!.drawImage(wc.canvas as CanvasImageSource, 0, 0);
            images.push(c);
            okTimes.push(times[i]);
            // Show the first frames as soon as they are ready.
            if (images.length === 1 || images.length % 10 === 0) {
              this.thumbsReady.set(asset.id, { times: [...okTimes], images: [...images], aspect: c.width / c.height });
              this.emit();
            }
          }
          i++;
        }
        if (images.length) return { times: okTimes, images, aspect: images[0].width / images[0].height };
      }
    } catch (e) {
      console.warn('decoder thumbnails failed, using <video>', e);
    }
    return this.thumbsFromElement(asset, times.slice(0, 20), h);
  }

  private async thumbsFromElement(asset: Asset, times: number[], h: number): Promise<Thumbs | null> {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = this.urls.get(asset.id)!;
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('video')); });
    const images: HTMLCanvasElement[] = [];
    for (const t of times) {
      await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = Math.min(t + 0.01, asset.duration - 0.05); });
      const c = document.createElement('canvas');
      c.height = h;
      c.width = Math.max(1, Math.round((v.videoWidth / v.videoHeight) * h));
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      images.push(c);
    }
    v.removeAttribute('src'); v.load();
    return images.length ? { times, images, aspect: images[0].width / images[0].height } : null;
  }

  /** JPEG cover for the project list. */
  async cover(asset: Asset): Promise<Blob | null> {
    const t = await this.thumbnails(asset);
    const src = t?.images[0];
    if (!src) return null;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d')!.drawImage(src, 0, 0);
    return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.8));
  }

  /** Free everything (when leaving a project). */
  reset() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    for (const i of this.inputs.values()) { try { i.dispose(); } catch { /* ignore */ } }
    this.blobs.clear(); this.urls.clear(); this.images.clear(); this.imagesReady.clear();
    this.audio.clear(); this.audioReady.clear(); this.thumbs.clear(); this.thumbsReady.clear();
    this.inputs.clear(); this.peakCache.clear();
  }
}

export const library = new Library();
