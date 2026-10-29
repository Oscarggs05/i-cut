// Live preview: muted <video> elements feed the WebGL compositor and the
// sound is mixed with Web Audio. iOS allows many muted inline videos at
// once, and Web Audio is the only way to control volume there.

import type { MediaClip, Project } from '../types';
import { audioContext, library } from '../media/library';
import { audioSegments, scheduleMix } from './audio';
import { Renderer, type FrameProvider, type LayerBounds } from './renderer';
import { buildScene, mediaInWindow, type MediaLayer } from './scene';
import { clearTextCache } from './text';
import { clipDuration, findAsset, projectDuration, sourceTime, speedAt } from './timeline';

interface VideoState { el: HTMLVideoElement; frames: number; pending: number | null; assetId: string; lastUse: number }

export class Player {
  renderer: Renderer;
  project: Project;
  time = 0;
  playing = false;
  duration = 0;
  private videos = new Map<string, VideoState>();
  private raf = 0;
  private dirty = true;
  private playT0 = 0;
  private playPerf0 = 0;
  private nodes: AudioBufferSourceNode[] = [];
  private master: GainNode | null = null;
  private audioDest: AudioNode | null = null;
  private tick = 0;
  onTime: ((t: number, playing: boolean) => void) | null = null;
  onBounds: ((b: LayerBounds[]) => void) | null = null;
  onEnded: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement, project: Project) {
    this.renderer = new Renderer(canvas);
    this.project = project;
    this.duration = projectDuration(project);
    library.listeners.add(this.invalidate);
    document.fonts?.addEventListener?.('loadingdone', this.onFonts);
    this.loop();
  }

  invalidate = () => { this.dirty = true; };
  private onFonts = () => { clearTextCache(); this.dirty = true; };

  setProject(p: Project) {
    const wasPlaying = this.playing;
    this.project = p;
    this.duration = projectDuration(p);
    if (this.time > this.duration) this.time = this.duration;
    // Keep sound in step with edits made while playing.
    if (wasPlaying) this.restartAudio();
    this.dirty = true;
  }

  resize(w: number, h: number) {
    this.renderer.resize(w, h);
    this.dirty = true;
  }

  seek(t: number) {
    this.time = Math.max(0, Math.min(t, this.duration));
    if (this.playing) {
      this.playT0 = this.time;
      this.playPerf0 = performance.now();
      this.restartAudio();
    }
    this.dirty = true;
  }

  /** Must be called from a user gesture on iOS so audio can start. */
  play(dest?: AudioNode) {
    if (this.playing) return;
    if (this.time >= this.duration - 0.02) this.time = 0;
    const ctx = audioContext();
    void ctx.resume();
    try { (navigator as unknown as { audioSession?: { type: string } }).audioSession!.type = 'playback'; } catch { /* not supported */ }
    this.audioDest = dest ?? null;
    this.playing = true;
    this.playT0 = this.time;
    this.playPerf0 = performance.now();
    this.restartAudio();
    // Start the videos inside the tap: iOS Low Power Mode blocks play()
    // calls that don't come from a user gesture.
    this.syncVideos();
    this.dirty = true;
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.stopAudio();
    for (const v of this.videos.values()) if (!v.el.paused) v.el.pause();
    this.dirty = true;
    this.onTime?.(this.time, false);
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  /** Silences the preview (used while recording a voice-over). */
  setMuted(m: boolean) {
    const ctx = audioContext();
    if (!this.master) { this.master = ctx.createGain(); this.master.connect(ctx.destination); }
    this.master.gain.value = m ? 0 : 1;
  }

  private stopAudio() {
    for (const n of this.nodes) { try { n.stop(); } catch { /* already stopped */ } n.disconnect(); }
    this.nodes = [];
  }

  private restartAudio() {
    this.stopAudio();
    const ctx = audioContext();
    if (!this.master) { this.master = ctx.createGain(); this.master.connect(ctx.destination); }
    const dest = this.audioDest ?? this.master;
    const segs = audioSegments(this.project);
    for (const s of segs) if (!library.audioNow(s.asset.id)) void library.audioBuffer(s.asset);
    this.nodes = scheduleMix(ctx, dest, segs, (a) => library.audioNow(a.id), this.time, ctx.currentTime + 0.03);
  }

  private videoFor(clip: MediaClip): VideoState | null {
    let v = this.videos.get(clip.id);
    if (v && v.assetId !== clip.assetId) { this.dropVideo(clip.id); v = undefined; }
    if (!v) {
      const url = library.url(clip.assetId);
      if (!url) return null;
      const el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.src = url;
      const st: VideoState = { el, frames: 0, pending: null, assetId: clip.assetId, lastUse: this.tick };
      const bump = () => { st.frames++; this.dirty = true; };
      if ('requestVideoFrameCallback' in el) {
        const onFrame = () => { bump(); if (this.videos.get(clip.id) === st) el.requestVideoFrameCallback(onFrame); };
        el.requestVideoFrameCallback(onFrame);
      }
      el.addEventListener('seeked', () => {
        bump();
        if (st.pending !== null) { const p = st.pending; st.pending = null; el.currentTime = p; }
      });
      el.addEventListener('loadeddata', bump);
      el.load();
      v = st;
      this.videos.set(clip.id, v);
    }
    v.lastUse = this.tick;
    return v;
  }

  private dropVideo(id: string) {
    const v = this.videos.get(id);
    if (!v) return;
    v.el.pause();
    v.el.removeAttribute('src');
    v.el.load();
    this.videos.delete(id);
  }

  private setVideoTime(v: VideoState, t: number) {
    if (v.el.seeking) { v.pending = t; return; }
    if (Math.abs(v.el.currentTime - t) > 0.015) v.el.currentTime = t;
  }

  private syncVideos() {
    const t = this.time;
    const win = mediaInWindow(this.project, t - 0.25, t + (this.playing ? 2.5 : 0.75));
    for (const { clip, start } of win) {
      const asset = findAsset(this.project, clip.assetId);
      if (!asset || asset.kind !== 'video') continue;
      const v = this.videoFor(clip);
      if (!v) continue;
      const d = clipDuration(clip);
      const active = t >= start && t < start + d;
      const target = active ? Math.min(sourceTime(clip, start, t), clip.out - 0.01) : clip.in;
      if (this.playing && active) {
        // Speed curves change the rate as the clip plays; small steps are skipped to keep iOS smooth.
        const rate = Math.max(0.0625, Math.min(16, speedAt(clip, t - start)));
        if (Math.abs(v.el.playbackRate - rate) > rate * 0.03) v.el.playbackRate = rate;
        if (v.el.paused) {
          this.setVideoTime(v, target);
          v.el.play().catch(() => { /* will retry next frame */ });
        } else if (Math.abs(v.el.currentTime - target) > 0.25) {
          this.setVideoTime(v, target);
        }
      } else {
        if (!v.el.paused) v.el.pause();
        this.setVideoTime(v, target);
      }
    }
    // Release elements that are far from the playhead.
    const keep = new Set(win.map((w) => w.clip.id));
    for (const [id, v] of this.videos) {
      if (!keep.has(id) && this.tick - v.lastUse > 90) this.dropVideo(id);
    }
  }

  provider: FrameProvider = (layer: MediaLayer) => {
    const a = layer.asset;
    if (a.kind === 'image') {
      const img = library.imageNow(a.id);
      if (!img) { void library.image(a.id); return { key: 'img:' + a.id, src: null, width: 1, height: 1, version: 0 }; }
      return { key: 'img:' + a.id, src: img, width: img.width, height: img.height, version: 1 };
    }
    const v = this.videos.get(layer.clip.id) ?? this.videoFor(layer.clip);
    if (!v) return null;
    const ready = v.el.readyState >= 2 && v.el.videoWidth > 0;
    const hasRVFC = 'requestVideoFrameCallback' in v.el;
    return {
      key: 'clip:' + layer.clip.id,
      src: ready ? v.el : null,
      width: v.el.videoWidth || a.width,
      height: v.el.videoHeight || a.height,
      version: hasRVFC && !this.playing ? v.frames : -1,
    };
  };

  /** Draws the current time immediately. */
  renderNow(): LayerBounds[] {
    const scene = buildScene(this.project, this.time);
    const b = this.renderer.render(this.project, scene, this.provider);
    this.onBounds?.(b);
    return b;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.tick++;
    if (this.playing) {
      this.time = this.playT0 + (performance.now() - this.playPerf0) / 1000;
      if (this.time >= this.duration) {
        this.time = this.duration;
        this.pause();
        this.onEnded?.();
      }
      this.dirty = true;
    }
    this.syncVideos();
    if (this.dirty) {
      this.dirty = false;
      this.renderNow();
      this.onTime?.(this.time, this.playing);
    }
  };

  /** Grabs the frame of a clip at the current time as a PNG. */
  async snapshot(): Promise<Blob | null> {
    this.renderNow();
    return new Promise((res) => this.canvas.toBlob((b) => res(b), 'image/png'));
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    for (const id of [...this.videos.keys()]) this.dropVideo(id);
    library.listeners.delete(this.invalidate);
    document.fonts?.removeEventListener?.('loadingdone', this.onFonts);
    this.renderer.dispose();
  }
}
