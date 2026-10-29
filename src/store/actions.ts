import type { Asset, AudioClip, MediaClip, Project, Selection, TextClip } from '../types';
import { library } from '../media/library';
import {
  MIN_CLIP, clipDuration, layoutMain, newAudioClip, newMediaClip, newTextClip, sourceOffset, uid,
} from '../engine/timeline';
import { shiftKeyframes } from '../engine/keyframes';
import { splitCurve } from '../engine/speed';
import { getPlayer, useEditor } from './editor';
import { saveCover } from './db';

const S = () => useEditor.getState();

export function findSelected(p: Project, sel: Selection): MediaClip | TextClip | AudioClip | null {
  if (!sel) return null;
  if (sel.kind === 'main' || sel.kind === 'transition') return p.main.find((c) => c.id === sel.id) ?? null;
  if (sel.kind === 'overlay') return p.overlays.find((c) => c.id === sel.id) ?? null;
  if (sel.kind === 'text') return p.texts.find((c) => c.id === sel.id) ?? null;
  return p.audios.find((c) => c.id === sel.id) ?? null;
}

/** Applies `fn` to the selected clip inside an edit. */
export function updateSelected<T = MediaClip | TextClip | AudioClip>(fn: (c: T) => void, key?: string) {
  const sel = S().selection;
  if (!sel) return;
  S().update((d) => {
    const c = findSelected(d, sel);
    if (c) fn(c as T);
  }, key ? `${sel.id}:${key}` : undefined);
}

export function mainIndexAt(p: Project, t: number): number {
  const l = layoutMain(p.main);
  const i = l.findIndex((x) => t >= x.start && t < x.end);
  return i >= 0 ? i : l.length - 1;
}

async function importFiles(files: File[]): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const [i, f] of files.entries()) {
    S().setBusy(files.length > 1 ? `Importando ${i + 1} de ${files.length}…` : 'Importando…');
    try {
      out.push(await library.import(f));
    } catch (e) {
      S().showToast((e as Error).message);
    }
  }
  S().setBusy(null);
  return out;
}

async function refreshCover() {
  const p = S().project;
  if (!p || !p.main.length) return;
  const a = p.assets.find((x) => x.id === p.main[0].assetId);
  if (!a) return;
  const blob = await library.cover(a);
  if (blob) await saveCover(p.id, blob);
}

export async function addMedia(files: File[], target: 'main' | 'overlay') {
  const assets = await importFiles(files);
  if (!assets.length) return;
  const t = S().time;
  let firstId: string | null = null;
  S().update((d) => {
    d.assets.push(...assets);
    const media = assets.filter((a) => a.kind !== 'audio');
    const audio = assets.filter((a) => a.kind === 'audio');
    if (target === 'main') {
      const layout = layoutMain(d.main);
      // Insert after the clip under the playhead (or at the closest edge).
      let at = d.main.length;
      const i = layout.findIndex((x) => t >= x.start && t < x.end);
      if (i >= 0) at = t - layout[i].start < (layout[i].end - layout[i].start) / 2 ? i : i + 1;
      const clips = media.map(newMediaClip);
      d.main.splice(at, 0, ...clips);
      firstId = clips[0]?.id ?? null;
    } else {
      for (const a of media) {
        const c = newMediaClip(a);
        c.start = t;
        c.transform.scale = 0.5;
        d.overlays.push(c);
        firstId = c.id;
      }
    }
    for (const a of audio) d.audios.push(newAudioClip(a, t));
  });
  for (const a of assets) {
    void library.thumbnails(a);
    void library.audioBuffer(a);
  }
  if (firstId && target === 'overlay') S().select({ kind: 'overlay', id: firstId });
  void refreshCover();
}

export async function addAudioFiles(files: File[]) {
  const assets = await importFiles(files);
  if (!assets.length) return;
  const t = S().time;
  let id = '';
  S().update((d) => {
    for (const a of assets) {
      d.assets.push(a);
      const c = newAudioClip(a, t);
      d.audios.push(c);
      id = c.id;
    }
  });
  for (const a of assets) void library.audioBuffer(a);
  if (id) S().select({ kind: 'audio', id });
}

export async function addRecording(blob: Blob, start: number) {
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('webm') ? 'webm' : 'wav';
  const asset = await library.importBlob(blob, `Voz ${new Date().toLocaleTimeString()}.${ext}`);
  const c = newAudioClip(asset, start);
  c.name = 'Voz en off';
  S().update((d) => { d.assets.push(asset); d.audios.push(c); });
  void library.audioBuffer(asset);
  S().select({ kind: 'audio', id: c.id });
}

export function addText(sticker = false, text?: string) {
  const c = newTextClip(S().time, sticker, text ?? (sticker ? '🔥' : 'Escribe aquí'));
  if (sticker) { c.size = /^[A-Z]+$/.test(c.text) ? 120 : 220; if (/^[A-Z]+$/.test(c.text)) { c.bgOpacity = 1; c.bgColor = '#ff2d55'; c.font = 'Anton'; } }
  S().update((d) => { d.texts.push(c); });
  S().select({ kind: 'text', id: c.id });
  return c;
}

export function splitAtPlayhead() {
  const s = S();
  const p = s.project;
  if (!p) return;
  const t = s.time;
  const sel = s.selection;
  let done = false;
  s.update((d) => {
    if (!sel || sel.kind === 'main' || sel.kind === 'transition') {
      const layout = layoutMain(d.main);
      const l = layout.find((x) => (sel ? x.clip.id === sel.id : true) && t > x.start + MIN_CLIP && t < x.end - MIN_CLIP);
      if (!l) return;
      const c = l.clip;
      const cut = c.in + sourceOffset(c, t - l.start);
      const b: MediaClip = { ...structuredClone(c), id: uid(), in: cut, animIn: null, fadeIn: 0 };
      splitTimeline(c, b, t - l.start, cut);
      c.out = cut;
      c.transition = null;
      c.animOut = null;
      c.fadeOut = 0;
      d.main.splice(l.index + 1, 0, b);
      done = true;
      return;
    }
    if (sel.kind === 'overlay' || sel.kind === 'audio') {
      const list = (sel.kind === 'overlay' ? d.overlays : d.audios) as (MediaClip | AudioClip)[];
      const i = list.findIndex((x) => x.id === sel.id);
      const c = list[i];
      if (!c || t <= c.start + MIN_CLIP || t >= c.start + clipDuration(c) - MIN_CLIP) return;
      const cut = c.in + sourceOffset(c, t - c.start);
      const b = { ...structuredClone(c), id: uid(), in: cut, start: t, fadeIn: 0 };
      splitTimeline(c, b, t - c.start, cut);
      c.out = cut;
      c.fadeOut = 0;
      list.splice(i + 1, 0, b as never);
      done = true;
      return;
    }
    if (sel.kind === 'text') {
      const i = d.texts.findIndex((x) => x.id === sel.id);
      const c = d.texts[i];
      if (!c || t <= c.start + MIN_CLIP || t >= c.start + c.duration - MIN_CLIP) return;
      const b: TextClip = { ...structuredClone(c), id: uid(), start: t, duration: c.start + c.duration - t, animIn: null };
      shiftKeyframes(b, -(t - c.start));
      c.duration = t - c.start;
      // Each half keeps its own words, while the text still matches the timings.
      if (c.words && c.words.length === c.text.split(/\s+/).filter(Boolean).length) {
        const cut = c.duration;
        b.words = c.words.filter((w) => w.start >= cut).map((w) => ({ ...w, start: w.start - cut, end: w.end - cut }));
        c.words = c.words.filter((w) => w.start < cut);
        b.text = b.words.map((w) => w.text).join(' ') || ' ';
        c.text = c.words.map((w) => w.text).join(' ') || ' ';
      }
      c.animOut = null;
      d.texts.splice(i + 1, 0, b);
      done = true;
    }
  });
  if (!done) s.showToast('Mueve el cursor dentro del clip para dividirlo');
}

/** Keeps keyframes and speed curves in place on both halves of a split. */
function splitTimeline(a: MediaClip | AudioClip, b: MediaClip | AudioClip, local: number, cut: number) {
  shiftKeyframes(b, -local);
  if (a.curve) {
    const [ca, cb] = splitCurve(a.curve, (cut - a.in) / Math.max(1e-6, a.out - a.in));
    a.curve = ca;
    b.curve = cb;
  }
}

export function deleteSelected() {
  const s = S();
  const sel = s.selection;
  if (!sel) return;
  s.update((d) => {
    if (sel.kind === 'main' || sel.kind === 'transition') d.main = d.main.filter((c) => c.id !== sel.id);
    if (sel.kind === 'overlay') d.overlays = d.overlays.filter((c) => c.id !== sel.id);
    if (sel.kind === 'text') d.texts = d.texts.filter((c) => c.id !== sel.id);
    if (sel.kind === 'audio') d.audios = d.audios.filter((c) => c.id !== sel.id);
  });
  s.select(null);
}

export function duplicateSelected() {
  const s = S();
  const sel = s.selection;
  if (!sel) return;
  let newId = '';
  s.update((d) => {
    newId = uid();
    if (sel.kind === 'main') {
      const i = d.main.findIndex((c) => c.id === sel.id);
      if (i >= 0) d.main.splice(i + 1, 0, { ...structuredClone(d.main[i]), id: newId });
    } else if (sel.kind === 'overlay') {
      const c = d.overlays.find((x) => x.id === sel.id);
      if (c) d.overlays.push({ ...structuredClone(c), id: newId, start: c.start + clipDuration(c) });
    } else if (sel.kind === 'text') {
      const c = d.texts.find((x) => x.id === sel.id);
      if (c) d.texts.push({ ...structuredClone(c), id: newId, start: c.start + c.duration });
    } else if (sel.kind === 'audio') {
      const c = d.audios.find((x) => x.id === sel.id);
      if (c) d.audios.push({ ...structuredClone(c), id: newId, start: c.start + clipDuration(c) });
    }
  });
  if (newId && sel.kind !== 'transition') s.select({ kind: sel.kind, id: newId });
}

export function moveMain(from: number, to: number) {
  S().update((d) => {
    const [c] = d.main.splice(from, 1);
    d.main.splice(Math.max(0, Math.min(d.main.length, to)), 0, c);
  });
}

/** Moves the clip's audio to its own audio clip and mutes the video. */
export function extractAudio() {
  const s = S();
  const sel = s.selection;
  const p = s.project;
  if (!p || !sel || (sel.kind !== 'main' && sel.kind !== 'overlay')) return;
  const c = findSelected(p, sel) as MediaClip;
  const asset = p.assets.find((a) => a.id === c.assetId);
  if (!asset || asset.kind !== 'video' || !asset.hasAudio) { s.showToast('Este clip no tiene audio'); return; }
  const start = sel.kind === 'main' ? layoutMain(p.main).find((l) => l.clip.id === c.id)!.start : c.start;
  s.update((d) => {
    const m = findSelected(d, sel) as MediaClip;
    m.muted = true;
    const a = newAudioClip(asset, start);
    Object.assign(a, { in: m.in, out: m.out, speed: m.speed, volume: m.volume, name: 'Audio extraído' });
    if (m.curve) a.curve = structuredClone(m.curve);
    if (m.keyframes) a.keyframes = m.keyframes.map((k) => ({ t: k.t, ease: k.ease, v: { volume: k.v.volume ?? m.volume } }));
    d.audios.push(a);
  });
  s.showToast('Audio extraído a una pista');
}

/** Inserts a 3 s still of the current frame after splitting the clip. */
export async function freezeFrame() {
  const s = S();
  const p = s.project;
  const player = getPlayer();
  if (!p || !player) return;
  const t = s.time;
  const layout = layoutMain(p.main);
  const l = layout.find((x) => t >= x.start && t < x.end);
  if (!l) return;
  const asset = p.assets.find((a) => a.id === l.clip.assetId);
  if (!asset || asset.kind !== 'video') { s.showToast('Solo funciona con vídeos'); return; }
  s.setBusy('Congelando fotograma…');
  try {
    const st = l.clip.in + sourceOffset(l.clip, t - l.start);
    const blob = await captureFrame(asset, st);
    if (!blob) throw new Error('No se pudo capturar el fotograma');
    const img = await library.importBlob(blob, 'Congelado.png');
    s.select({ kind: 'main', id: l.clip.id });
    splitAtPlayhead();
    S().update((d) => {
      d.assets.push(img);
      const i = d.main.findIndex((c) => c.id === l.clip.id);
      const c = newMediaClip(img);
      const src = d.main[i];
      Object.assign(c, { filter: src.filter, adjust: src.adjust, transform: src.transform, flipH: src.flipH, flipV: src.flipV });
      d.main.splice(i + 1, 0, c);
    });
    void library.thumbnails(img);
  } catch (e) {
    s.showToast((e as Error).message);
  } finally {
    S().setBusy(null);
  }
}

async function captureFrame(asset: Asset, t: number): Promise<Blob | null> {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = library.url(asset.id)!;
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('video')); });
  await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = Math.min(t, asset.duration - 0.03); });
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d')!.drawImage(v, 0, 0);
  v.removeAttribute('src'); v.load();
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.92));
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    input.click();
  });
}
