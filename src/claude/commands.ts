// What Claude can do in the editor. Each command is one MCP tool (see
// mcp/tools.mjs for the schemas Claude sees). Commands go through the same
// store actions as the buttons, so every change shows up live on screen, is
// saved automatically and can be undone.

import type { Adjust, Asset, AspectId, AudioClip, Ease, KfProp, MediaClip, Project, Selection, TextClip, Visual } from '../types';
import { getPlayer, useEditor } from '../store/editor';
import {
  addText, deleteSelected, duplicateSelected, extractAudio, freezeFrame, importFiles, moveMain, refreshCover, splitAtPlayhead,
} from '../store/actions';
import { stabilizeSelected, subscribeJob, getJob, toggleReverse } from '../store/clipActions';
import { activeCollage, addCollageAssets, collageClips, collageFromClips, collageStyle, restyleCollage, type CollageStyle } from '../store/collage';
import { bumpProjects, closeProject, openProject } from '../store/session';
import { deleteProject, listProjects, loadCover, loadProject, saveCover, saveProject } from '../store/db';
import {
  ASPECTS, MIN_CLIP, aspectRatio, clampTransition, clipDuration, defaultAdjust, itemDuration, layoutMain, newAudioClip, newMediaClip,
  newProject, projectDuration, sourceOffset, uid,
} from '../engine/timeline';
import {
  ANIMS_IN, ANIMS_LOOP, ANIMS_OUT, EFFECTS, FILTERS, FONTS, STICKERS, TEXT_TEMPLATES, TRANSITIONS, WORD_ANIMS, applyTemplate, templateOf,
} from '../engine/presets';
import { EASES, kfIndexAt, kfProps, removeKeyframe, setProp, shiftKeyframes, upsertKeyframe, valueAt, type KfClip } from '../engine/keyframes';
import { CURVE_PRESETS, MAX_SPEED, MIN_SPEED, presetCurve } from '../engine/speed';
import { COLLAGES } from '../engine/collage';
import { VOICES } from '../engine/voice';
import { exportProject, supportsWebCodecs, type ExportOptions, type Quality } from '../engine/export';
import { library } from '../media/library';
import { SFX, makeSfx } from '../media/sfx';
import { CAPTION_LANGS, captionClips, transcribe, type CaptionProgress } from '../media/captions';
import { applyCuts, findCuts } from '../media/cleanup';
import { SPEECH_MODELS, modelByKey, savedModel } from '../media/models';
import { prepareVoice } from '../ui/sheets/AudioFxSheets';
import { serverBase, useClaude } from './bridge';

export class CommandError extends Error {}

export type CommandResult = { text?: string; data?: unknown; images?: { mime: string; data: string; label?: string }[] } | void;
type A = Record<string, any>;
interface Ctx { progress: (message: string) => void }
interface Command {
  /** What the user sees on screen while it runs (Spanish). */
  label: (a: A) => string;
  run: (a: A, ctx: Ctx) => Promise<CommandResult> | CommandResult;
}

const S = () => useEditor.getState();
const fail = (msg: string): never => { throw new CommandError(msg); };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const has = (a: A, k: string) => a[k] !== undefined && a[k] !== null;

function num(v: unknown, name: string, min = -Infinity, max = Infinity): number {
  const x = Number(v);
  if (!Number.isFinite(x)) fail(`«${name}» debe ser un número`);
  return clamp(x, min, max);
}
function color(v: unknown, name: string): string {
  const s = String(v).trim();
  if (!/^#[0-9a-f]{6}$/i.test(s) && !/^#[0-9a-f]{3}$/i.test(s)) fail(`«${name}» debe ser un color #rrggbb`);
  return s.length === 4 ? '#' + [...s.slice(1)].map((c) => c + c).join('') : s.toLowerCase();
}
function pick<T extends { id: string }>(v: unknown, list: T[], what: string): T {
  const id = String(v);
  const f = list.find((x) => x.id === id) ?? list.find((x) => x.id.toLowerCase() === id.toLowerCase());
  if (!f) fail(`${what} «${id}» no existe. Opciones: ${list.map((x) => x.id).join(', ')}`);
  return f!;
}

function project(): Project {
  const p = S().project;
  if (!p) fail('No hay ningún proyecto abierto. Usa list_projects y open_project, o create_project.');
  return p!;
}

// ── Finding clips ────────────────────────────────────────────────────────
type Kind = 'main' | 'overlay' | 'text' | 'audio';
type AnyClip = MediaClip | TextClip | AudioClip;
interface Located { clip: AnyClip; kind: Kind; start: number; end: number; index: number }

function locate(p: Project, id: string): Located | null {
  const l = layoutMain(p.main).find((x) => x.clip.id === id);
  if (l) return { clip: l.clip, kind: 'main', start: l.start, end: l.end, index: l.index };
  for (const kind of ['overlay', 'text', 'audio'] as const) {
    const list = (kind === 'overlay' ? p.overlays : kind === 'text' ? p.texts : p.audios) as AnyClip[];
    const index = list.findIndex((c) => c.id === id);
    if (index >= 0) {
      const c = list[index] as MediaClip | TextClip | AudioClip;
      return { clip: c, kind, start: c.start, end: c.start + itemDuration(c), index };
    }
  }
  return null;
}

const KIND_NAMES: Record<Kind, string> = { main: 'clip de la pista principal', overlay: 'superposición', text: 'texto', audio: 'audio' };

/** The clip `id` (or the selected one), checking its kind. */
function need(id: unknown, kinds?: Kind[], what = 'Este cambio'): Located {
  const p = project();
  let cid = id ? String(id) : '';
  if (!cid) {
    const sel = S().selection;
    if (!sel || sel.kind === 'transition') fail('Indica clip_id (los ids salen en get_project).');
    cid = sel!.id;
  }
  const l = locate(p, cid);
  if (!l) fail(`No hay ningún clip con id «${cid}». Usa get_project para ver los ids.`);
  if (kinds && !kinds.includes(l!.kind)) fail(`${what} no vale para un ${KIND_NAMES[l!.kind]}.`);
  return l!;
}

const assetOf = (p: Project, c: AnyClip) => ('assetId' in c ? p.assets.find((a) => a.id === c.assetId) : undefined);

/** Applies `fn` to clip `id` inside one undo step. */
function edit<T extends AnyClip>(id: string, fn: (c: T, d: Project) => void, key?: string) {
  S().update((d) => {
    const l = locate(d, id);
    if (l) fn(l.clip as T, d);
  }, key ? `claude:${id}:${key}` : undefined);
}

function seek(t: number) {
  const p = S().project;
  const nt = clamp(t, 0, p ? projectDuration(p) : 0);
  const player = getPlayer();
  player?.pause();
  player?.seek(nt);
  S().setTime(nt, false);
}

/** Shows the clip Claude is working on: selects it and brings the playhead onto it. */
function focus(l: Located | string | null, at?: number) {
  const p = S().project;
  if (!p) return;
  const x = typeof l === 'string' ? locate(p, l) : l;
  if (!x) return;
  const sel = { kind: x.kind, id: x.clip.id } as const;
  const cur = S().selection;
  if (cur?.id !== sel.id || cur?.kind !== sel.kind) S().select(sel as Selection);
  const t = S().time;
  if (at !== undefined) seek(at);
  else if (t < x.start || t >= x.end) seek(x.start + Math.min(0.05, (x.end - x.start) / 2));
}

/** Local time inside the clip for a timeline time (default: playhead), clamped to the clip. */
function localTime(l: Located, time?: unknown): number {
  const t = time === undefined || time === null ? S().time : num(time, 'time');
  return clamp(t - l.start, 0, itemDuration(l.clip));
}

async function waitPlayer() {
  for (let i = 0; i < 60 && !getPlayer(); i++) await new Promise((r) => setTimeout(r, 50));
  const p = getPlayer();
  if (!p) fail('La vista previa no está lista.');
  return p!;
}

const blobToBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, ''));
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(b);
});

/** Renders the timeline at `t` into a JPEG `width` pixels wide. */
async function frameAt(t: number, width: number): Promise<{ mime: string; data: string }> {
  const p = project();
  const player = await waitPlayer();
  seek(t);
  await player.settle();
  const ratio = aspectRatio(p);
  const w = Math.round(width), h = Math.round(width / ratio);
  const { width: pw, height: ph } = player.renderer;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  // Render at the requested size for a sharp image, then restore the preview.
  player.resize(w, h);
  player.renderNow();
  out.getContext('2d')!.drawImage(player.canvas, 0, 0, w, h);
  player.resize(pw, ph);
  player.renderNow();
  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/jpeg', 0.82));
  if (!blob) fail('No se pudo capturar la imagen.');
  return { mime: 'image/jpeg', data: await blobToBase64(blob!) };
}

// ── Describing the project ───────────────────────────────────────────────
function compact<T extends object>(o: T): Partial<T> {
  const out: A = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === false) continue;
    if (Array.isArray(v) && !v.length) continue;
    if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

function visualInfo(c: Visual, start: number) {
  const t = c.transform;
  const adjust = Object.fromEntries(Object.entries(c.adjust).filter(([, v]) => v));
  return compact({
    transform: t.x || t.y || t.scale !== 1 || t.rotation ? { x: r3(t.x), y: r3(t.y), scale: r3(t.scale), rotation: r3(t.rotation) } : undefined,
    flip_h: c.flipH, flip_v: c.flipV,
    opacity: c.opacity !== 1 ? r3(c.opacity) : undefined,
    filter: c.filter.id !== 'none' ? `${c.filter.id} ${Math.round(c.filter.intensity * 100)}%` : undefined,
    adjust,
    effect: c.effect.id !== 'none' ? `${c.effect.id} ${Math.round(c.effect.intensity * 100)}%` : undefined,
    anim_in: c.animIn ? `${c.animIn.id} ${c.animIn.duration}s` : undefined,
    anim_out: c.animOut ? `${c.animOut.id} ${c.animOut.duration}s` : undefined,
    anim_loop: c.animLoop ? `${c.animLoop.id} ${c.animLoop.duration}s` : undefined,
    chroma: c.chroma ?? undefined,
    keyframes: c.keyframes?.map((k) => ({ time: r3(start + k.t), ease: k.ease, ...Object.fromEntries(Object.entries(k.v).map(([p, v]) => [p, r3(v as number)])) })),
  });
}

function mediaInfo(p: Project, c: MediaClip, start: number, end: number, extra: A = {}) {
  const a = assetOf(p, c);
  return compact({
    id: c.id, ...extra, start: r3(start), end: r3(end),
    media: a ? `${a.kind} «${a.name}»` : 'falta el archivo', asset_id: c.assetId,
    source_in: a?.kind === 'image' ? undefined : r3(c.in), source_out: a?.kind === 'image' ? undefined : r3(c.out),
    speed: c.curve ? `curva ${c.curve.id}` : c.speed !== 1 ? c.speed : undefined,
    volume: c.volume !== 1 ? r3(c.volume) : undefined, muted: c.muted,
    fade_in: c.fadeIn || undefined, fade_out: c.fadeOut || undefined,
    voice: c.voice, reversed: !!c.reversed, stabilized: c.stab?.level || undefined,
    crop: c.crop ? { x: r3(c.crop.x), y: r3(c.crop.y), w: r3(c.crop.w), h: r3(c.crop.h) } : undefined,
    radius: c.radius || undefined, collage: c.collage ? `${c.collage.id} (${c.collage.template}, hueco ${c.collage.cell})` : undefined,
    ...visualInfo(c, start),
  });
}

function textInfo(c: TextClip) {
  return compact({
    id: c.id, start: r3(c.start), end: r3(c.start + c.duration), text: c.text,
    sticker: c.sticker, template: templateOf(c) ?? undefined, font: c.font, size: c.size, color: c.color,
    bold: c.bold, italic: c.italic, align: c.align !== 'center' ? c.align : undefined,
    stroke: c.strokeWidth ? `${c.strokeWidth}px ${c.strokeColor}` : undefined,
    background: c.bgOpacity ? `${c.bgColor} ${Math.round(c.bgOpacity * 100)}%` : undefined,
    shadow: c.shadow, letter_spacing: c.letterSpacing || undefined, uppercase: c.uppercase, glow: c.glow,
    word_anim: c.wordAnim && c.wordAnim !== 'none' ? c.wordAnim : undefined, highlight: c.wordAnim && c.wordAnim !== 'none' ? c.highlight : undefined,
    ...visualInfo(c, c.start),
  });
}

function describe(p: Project) {
  const main = layoutMain(p.main);
  const used = new Set([...p.main, ...p.overlays, ...p.audios].map((c) => c.assetId));
  const caps = p.texts.filter((t) => t.caption);
  const collages = [...new Set([...p.main, ...p.overlays].map((c) => c.collage?.id).filter(Boolean) as string[])];
  const s = S();
  return {
    project: { id: p.id, name: p.name, aspect: p.aspect, canvas_ratio: r3(aspectRatio(p)), duration: r3(projectDuration(p)), background: p.background },
    playhead: r3(s.time),
    selection: s.selection,
    undo_steps: s.past.length, redo_steps: s.future.length,
    assets: p.assets.map((a) => compact({
      id: a.id, kind: a.kind, name: a.name, duration: a.kind === 'image' ? undefined : r3(a.duration), size: `${a.width}x${a.height}`,
      has_audio: a.kind === 'video' ? a.hasAudio : undefined, unused: !used.has(a.id),
    })),
    main: main.map((l) => mediaInfo(p, l.clip, l.start, l.end, {
      index: l.index,
      transition_to_next: l.clip.transition && l.transOut ? `${l.clip.transition.id} ${r3(l.transOut)}s` : undefined,
    })),
    overlays: p.overlays.map((c) => mediaInfo(p, c, c.start, c.start + clipDuration(c))),
    texts: p.texts.filter((t) => !t.caption).map(textInfo),
    captions: caps.length ? {
      count: caps.length,
      style: textInfo(caps[0]),
      lines: caps.map((c) => ({ id: c.id, start: r3(c.start), end: r3(c.start + c.duration), text: c.text })),
    } : undefined,
    audios: p.audios.map((c) => compact({
      id: c.id, name: c.name, start: r3(c.start), end: r3(c.start + clipDuration(c)), asset_id: c.assetId,
      source_in: r3(c.in), source_out: r3(c.out), speed: c.curve ? `curva ${c.curve.id}` : c.speed !== 1 ? c.speed : undefined,
      volume: c.volume !== 1 ? r3(c.volume) : undefined, fade_in: c.fadeIn || undefined, fade_out: c.fadeOut || undefined, voice: c.voice,
      keyframes: c.keyframes?.map((k) => ({ time: r3(c.start + k.t), ease: k.ease, volume: r3(k.v.volume ?? c.volume) })),
    })),
    collages: collages.map((id) => ({ id, template: collageStyle(p, id)?.template, clips: collageClips(p, id).map((c) => c.id) })),
  };
}

// ── Placing media ────────────────────────────────────────────────────────
type Target = 'main' | 'overlay' | 'audio' | 'library';

function placeAssets(assets: Asset[], target: Target | undefined, at?: number, index?: number): string[] {
  const ids: string[] = [];
  const t = at ?? S().time;
  S().update((d) => {
    for (const a of assets) if (!d.assets.some((x) => x.id === a.id)) d.assets.push(a);
    if (target === 'library') return;
    // Claude adds clips one after another, so the default is the end of the main track.
    const at2 = index ?? d.main.length;
    let k = clamp(Math.round(at2), 0, d.main.length);
    for (const a of assets) {
      if (a.kind === 'audio' || target === 'audio') {
        if (a.kind === 'image') continue;
        const c = newAudioClip(a, t);
        if (a.kind === 'video') c.name = 'Audio de ' + a.name.replace(/\.[^.]+$/, '');
        d.audios.push(c);
        ids.push(c.id);
      } else if (target === 'overlay') {
        const c = newMediaClip(a);
        c.start = t;
        c.transform.scale = 0.5;
        d.overlays.push(c);
        ids.push(c.id);
      } else {
        const c = newMediaClip(a);
        d.main.splice(k++, 0, c);
        ids.push(c.id);
      }
    }
  });
  for (const a of assets) { void library.thumbnails(a); void library.audioBuffer(a); }
  void refreshCover();
  if (ids.length) focus(ids[0]);
  return ids;
}

function placedText(assets: Asset[], ids: string[], target?: Target) {
  const p = S().project!;
  return {
    text: `${assets.length === 1 ? 'Importado' : `${assets.length} archivos importados`}${target === 'library' ? ' (solo a la biblioteca del proyecto)' : ''}.`,
    data: {
      assets: assets.map((a) => compact({ id: a.id, kind: a.kind, name: a.name, duration: a.kind === 'image' ? undefined : r3(a.duration), size: `${a.width}x${a.height}`, has_audio: a.hasAudio })),
      clips: ids.map((id) => { const l = locate(p, id); return l ? { id, track: l.kind, start: r3(l.start), end: r3(l.end) } : { id }; }),
    },
  };
}

function targetOf(a: A): Target | undefined {
  const t = a.target as string | undefined;
  if (t && !['main', 'overlay', 'audio', 'library'].includes(t)) fail('target debe ser main, overlay, audio o library');
  return t as Target | undefined;
}

// ── Text style ───────────────────────────────────────────────────────────
function applyTextProps(c: TextClip, a: A, local: number) {
  if (has(a, 'font')) c.font = pick(a.font, FONTS, 'La fuente').id;
  if (has(a, 'size')) c.size = num(a.size, 'size', 20, 400);
  if (has(a, 'color')) c.color = color(a.color, 'color');
  if (has(a, 'bold')) c.bold = !!a.bold;
  if (has(a, 'italic')) c.italic = !!a.italic;
  if (has(a, 'align')) c.align = pick(a.align, [{ id: 'left' }, { id: 'center' }, { id: 'right' }], 'La alineación').id as TextClip['align'];
  if (has(a, 'stroke_color')) { c.strokeColor = color(a.stroke_color, 'stroke_color'); if (!c.strokeWidth && !has(a, 'stroke_width')) c.strokeWidth = 6; }
  if (has(a, 'stroke_width')) c.strokeWidth = num(a.stroke_width, 'stroke_width', 0, 30);
  if (has(a, 'bg_color')) { c.bgColor = color(a.bg_color, 'bg_color'); if (!c.bgOpacity && !has(a, 'bg_opacity')) c.bgOpacity = 1; }
  if (has(a, 'bg_opacity')) c.bgOpacity = num(a.bg_opacity, 'bg_opacity', 0, 1);
  if (has(a, 'shadow')) c.shadow = !!a.shadow;
  if (has(a, 'letter_spacing')) c.letterSpacing = num(a.letter_spacing, 'letter_spacing', -10, 60);
  if (has(a, 'uppercase')) c.uppercase = !!a.uppercase;
  if (has(a, 'glow')) c.glow = !!a.glow;
  if (has(a, 'word_anim')) c.wordAnim = pick(a.word_anim, WORD_ANIMS, 'La animación por palabra').id;
  if (has(a, 'highlight')) c.highlight = color(a.highlight, 'highlight');
  for (const p of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) {
    if (!has(a, p)) continue;
    const range = { x: [-1.5, 1.5], y: [-1.5, 1.5], scale: [0.05, 10], rotation: [-3600, 3600], opacity: [0, 1] }[p];
    setProp(c, p, num(a[p], p, range[0], range[1]), local);
  }
}

// ── Long jobs (reverse, stabilize) report their progress ──────────────────
async function withJobProgress<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  let last = -1;
  const off = subscribeJob(() => {
    const j = getJob();
    if (!j) return;
    const pct = Math.floor(j.fraction * 100);
    if (pct >= last + 5) { last = pct; ctx.progress(`${j.label} ${pct} %`); }
  });
  try { return await fn(); } finally { off(); }
}

function captionProgress(ctx: Ctx) {
  let last = '';
  return (p: CaptionProgress) => {
    const pct = `${Math.floor(p.fraction * 100)} %`;
    const msg = p.stage === 'audio' ? 'Preparando audio' : p.stage === 'download' ? `Descargando el modelo de voz ${pct}` : p.stage === 'loading' ? 'Cargando el modelo' : `Transcribiendo ${pct}`;
    if (msg !== last) { last = msg; ctx.progress(msg); }
  };
}

const shortText = (s: unknown, n = 28) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// ── Commands ─────────────────────────────────────────────────────────────
export const COMMANDS: Record<string, Command> = {
  get_project: {
    label: () => 'Revisando el proyecto',
    run: (a) => {
      const p = project();
      return { data: a.raw ? { ...describe(p), raw: p } : describe(p) };
    },
  },

  list_catalog: {
    label: () => 'Consultando opciones',
    run: () => ({
      data: {
        filters: FILTERS.map((f) => `${f.id} (${f.name})`),
        effects: EFFECTS.map((f) => `${f.id} (${f.name})`),
        transitions: TRANSITIONS.map((f) => `${f.id} (${f.name})`),
        animations_in: ANIMS_IN.map((f) => `${f.id} (${f.name})`),
        animations_out: ANIMS_OUT.map((f) => `${f.id} (${f.name})`),
        animations_loop: ANIMS_LOOP.map((f) => `${f.id} (${f.name})`),
        fonts: FONTS.map((f) => f.id),
        text_templates: TEXT_TEMPLATES.map((t) => `${t.id} (${t.name}${t.caption ? ', válida para subtítulos' : ''})`),
        word_animations: WORD_ANIMS.map((w) => `${w.id} (${w.label})`),
        stickers: STICKERS,
        voices: VOICES.map((v) => `${v.id} (${v.name})`),
        sound_effects: SFX.map((s) => `${s.id} (${s.name})`),
        speed_curves: CURVE_PRESETS.filter((c) => c.id !== 'custom').map((c) => `${c.id} (${c.name})`),
        collage_templates: COLLAGES.map((c) => `${c.id} (${c.name}, ${c.cells.length} huecos)`),
        formats: ASPECTS.map((a) => a.id),
        eases: EASES.map((e) => e.id),
        speech_models: SPEECH_MODELS.map((m) => `${m.key} (${m.name}, ${m.mb} MB, ${m.group === 'pc' ? 'ordenador' : 'móvil'})`),
        caption_languages: CAPTION_LANGS.map((l) => l.id),
      },
    }),
  },

  get_frame: {
    label: (a) => `Mirando el fotograma${has(a, 'time') ? ` en ${num(a.time, 'time').toFixed(1)} s` : ''}`,
    run: async (a) => {
      const p = project();
      if (!p.main.length && !p.overlays.length && !p.texts.length) fail('El proyecto está vacío.');
      const t = has(a, 'time') ? num(a.time, 'time', 0) : S().time;
      const img = await frameAt(t, has(a, 'width') ? num(a.width, 'width', 160, 1080) : 540);
      return { text: `Fotograma en ${t.toFixed(2)} s`, images: [img] };
    },
  },

  get_frames: {
    label: () => 'Repasando el vídeo',
    run: async (a) => {
      const p = project();
      const dur = projectDuration(p);
      if (dur <= 0) fail('El proyecto está vacío.');
      let times: number[] = Array.isArray(a.times) ? a.times.slice(0, 16).map((t: unknown) => num(t, 'times', 0, dur)) : [];
      if (!times.length) {
        const n = has(a, 'count') ? Math.round(num(a.count, 'count', 1, 12)) : 6;
        times = Array.from({ length: n }, (_, i) => r3(((i + 0.5) / n) * dur));
      }
      const width = has(a, 'width') ? num(a.width, 'width', 120, 720) : 320;
      const keep = S().time;
      const images = [];
      for (const t of times) images.push({ ...(await frameAt(t, width)), label: `${t.toFixed(2)} s` });
      seek(keep);
      return { text: `${images.length} fotogramas de ${dur.toFixed(1)} s`, images };
    },
  },

  // ── Projects
  list_projects: {
    label: () => 'Mirando tus proyectos',
    run: async () => {
      const cur = S().project;
      const list = await listProjects();
      return {
        data: list.map((x) => {
          const p = cur && cur.id === x.id ? cur : x;
          return { id: p.id, name: p.name, duration: r3(projectDuration(p)), clips: p.main.length + p.overlays.length, updated: new Date(p.updatedAt).toISOString(), open: cur?.id === p.id };
        }),
      };
    },
  },

  create_project: {
    label: (a) => `Creando el proyecto «${shortText(a.name || 'nuevo')}»`,
    run: async (a) => {
      const n = (await listProjects()).length + 1;
      const p = newProject(a.name ? String(a.name) : `Proyecto ${n}`);
      if (has(a, 'aspect')) p.aspect = pick(a.aspect, ASPECTS, 'El formato').id;
      await saveProject(p);
      await openProject(p);
      bumpProjects();
      return { text: `Proyecto «${p.name}» creado y abierto.`, data: { project_id: p.id } };
    },
  },

  open_project: {
    label: () => 'Abriendo un proyecto',
    run: async (a) => {
      const p = await loadProject(String(a.project_id));
      if (!p) fail(`No existe el proyecto ${a.project_id}. Usa list_projects.`);
      await openProject(p!);
      return { text: `Proyecto «${p!.name}» abierto.`, data: describe(S().project!) };
    },
  },

  close_project: {
    label: () => 'Cerrando el proyecto',
    run: () => {
      if (!S().project) return { text: 'No había ningún proyecto abierto.' };
      getPlayer()?.pause();
      closeProject();
      return { text: 'Proyecto guardado y cerrado.' };
    },
  },

  rename_project: {
    label: (a) => `Renombrando a «${shortText(a.name)}»`,
    run: async (a) => {
      const name = String(a.name ?? '').trim();
      if (!name) fail('Falta el nombre.');
      const cur = S().project;
      if (!a.project_id || a.project_id === cur?.id) {
        if (!cur) fail('No hay ningún proyecto abierto; indica project_id.');
        S().update((d) => { d.name = name; });
      } else {
        const p = await loadProject(String(a.project_id));
        if (!p) fail(`No existe el proyecto ${a.project_id}.`);
        await saveProject({ ...p!, name, updatedAt: Date.now() });
      }
      bumpProjects();
      return { text: `Proyecto renombrado a «${name}».` };
    },
  },

  duplicate_project: {
    label: () => 'Duplicando el proyecto',
    run: async (a) => {
      const cur = S().project;
      const src = !a.project_id || a.project_id === cur?.id ? cur : await loadProject(String(a.project_id));
      if (!src) fail('Indica project_id (o abre un proyecto).');
      const copy = { ...structuredClone(src!), id: uid(), name: a.name ? String(a.name) : src!.name + ' (copia)', updatedAt: Date.now(), createdAt: Date.now() };
      await saveProject(copy);
      const cover = await loadCover(src!.id);
      if (cover) await saveCover(copy.id, cover);
      bumpProjects();
      return { text: `Copia creada: «${copy.name}».`, data: { project_id: copy.id } };
    },
  },

  delete_project: {
    label: () => 'Eliminando un proyecto',
    run: async (a) => {
      if (a.confirm !== true) fail('Pon confirm: true (y hazlo solo si el usuario lo ha pedido).');
      const id = String(a.project_id);
      if (S().project?.id === id) closeProject();
      const p = await loadProject(id);
      if (!p) fail(`No existe el proyecto ${id}.`);
      await deleteProject(p!);
      bumpProjects();
      return { text: `Proyecto «${p!.name}» eliminado.` };
    },
  },

  undo: {
    label: () => 'Deshaciendo',
    run: (a) => {
      project();
      const n = has(a, 'steps') ? Math.round(num(a.steps, 'steps', 1, 80)) : 1;
      let done = 0;
      for (; done < n && S().past.length; done++) S().undo();
      return { text: done ? `Deshechos ${done} paso${done > 1 ? 's' : ''}.` : 'No hay nada que deshacer.' };
    },
  },

  redo: {
    label: () => 'Rehaciendo',
    run: (a) => {
      project();
      const n = has(a, 'steps') ? Math.round(num(a.steps, 'steps', 1, 80)) : 1;
      let done = 0;
      for (; done < n && S().future.length; done++) S().redo();
      return { text: done ? `Rehechos ${done} paso${done > 1 ? 's' : ''}.` : 'No hay nada que rehacer.' };
    },
  },

  // ── Media
  import_media: {
    label: (a) => `Importando ${shortText(a.__file?.name ?? a.filename ?? 'un archivo')}`,
    run: async (a, ctx) => {
      project();
      const f = a.__file as { url: string; name: string; mime: string; size: number } | undefined;
      if (!f) fail('Falta el archivo.');
      ctx.progress(`Recibiendo ${f!.name} (${(f!.size / 1e6).toFixed(1)} MB)`);
      const res = await fetch(serverBase() + f!.url);
      if (!res.ok) fail(`No se pudo recibir el archivo (HTTP ${res.status}).`);
      const file = new File([await res.blob()], f!.name, { type: f!.mime });
      const assets = await importFiles([file]);
      if (!assets.length) fail(S().toast || `No se pudo importar ${f!.name}.`);
      const target = targetOf(a);
      const ids = placeAssets(assets, target, has(a, 'at') ? num(a.at, 'at', 0) : undefined, has(a, 'index') ? num(a.index, 'index', 0) : undefined);
      return placedText(assets, ids, target);
    },
  },

  request_files_from_user: {
    label: () => 'Esperando a que elijas archivos',
    run: async (a) => {
      project();
      const accept = { video: 'video/*', image: 'image/*', audio: 'audio/*,.mp3,.m4a,.wav,.aac', any: 'video/*,image/*,audio/*' }[String(a.accept ?? 'any')] ?? 'video/*,image/*,audio/*';
      const files = await new Promise<File[]>((resolve) => {
        useClaude.getState().fileRequest?.resolve([]);
        useClaude.setState({ fileRequest: { message: String(a.message || 'Claude necesita archivos para seguir editando.'), accept, multiple: a.multiple !== false, resolve } });
      });
      useClaude.setState({ fileRequest: null });
      if (!files.length) fail('El usuario no eligió ningún archivo.');
      const assets = await importFiles(files);
      if (!assets.length) fail(S().toast || 'No se pudo importar ningún archivo.');
      const target = targetOf(a);
      const ids = placeAssets(assets, target, has(a, 'at') ? num(a.at, 'at', 0) : undefined);
      return placedText(assets, ids, target);
    },
  },

  add_clip: {
    label: () => 'Añadiendo un clip',
    run: (a) => {
      const p = project();
      const asset = p.assets.find((x) => x.id === a.asset_id);
      if (!asset) fail(`No hay ningún archivo con id ${a.asset_id} en el proyecto.`);
      const track = String(a.track) as Target;
      if (!['main', 'overlay', 'audio'].includes(track)) fail('track debe ser main, overlay o audio.');
      if (track !== 'audio' && asset!.kind === 'audio') fail('Un archivo de audio solo puede ir a la pista de audio.');
      if (track === 'audio' && asset!.kind === 'image') fail('Una foto no tiene audio.');
      const ids = placeAssets([asset!], track, has(a, 'at') ? num(a.at, 'at', 0) : undefined, has(a, 'index') ? num(a.index, 'index', 0) : p.main.length);
      const id = ids[0];
      if (has(a, 'in') || has(a, 'out')) {
        edit<MediaClip | AudioClip>(id, (c) => {
          const max = asset!.kind === 'image' ? 3600 : asset!.duration;
          if (has(a, 'in')) c.in = num(a.in, 'in', 0, max - MIN_CLIP);
          if (has(a, 'out')) c.out = num(a.out, 'out', c.in + MIN_CLIP, asset!.kind === 'image' ? c.in + 3600 : max);
          if (c.out <= c.in) c.out = Math.min(max, c.in + MIN_CLIP);
        });
      }
      return placedText([asset!], ids, track);
    },
  },

  add_sound_effect: {
    label: (a) => `Añadiendo el efecto de sonido ${shortText(a.effect)}`,
    run: async (a) => {
      project();
      const fx = pick(a.effect, SFX, 'El efecto de sonido');
      const blob = await makeSfx(fx.id);
      const asset = await library.importBlob(blob, `${fx.name}.wav`);
      const c = newAudioClip(asset, has(a, 'at') ? num(a.at, 'at', 0) : S().time);
      c.name = fx.name;
      if (has(a, 'volume')) c.volume = num(a.volume, 'volume', 0, 2);
      S().update((d) => { d.assets.push(asset); d.audios.push(c); });
      void library.audioBuffer(asset);
      focus(c.id);
      return { text: `Efecto «${fx.name}» añadido en ${c.start.toFixed(2)} s.`, data: { clip_id: c.id } };
    },
  },

  // ── Timeline
  playback: {
    label: (a) => (a.action === 'play' ? 'Reproduciendo' : a.action === 'pause' ? 'Pausando' : 'Moviendo el cursor'),
    run: async (a) => {
      project();
      const player = await waitPlayer();
      if (has(a, 'time')) seek(num(a.time, 'time', 0));
      if (a.action === 'play') player.play();
      else if (a.action === 'pause') player.pause();
      else if (a.action !== 'seek') fail('action debe ser seek, play o pause.');
      return { text: `${a.action === 'play' ? 'Reproduciendo desde' : 'Cursor en'} ${S().time.toFixed(2)} s.` };
    },
  },

  select_clip: {
    label: () => 'Seleccionando',
    run: (a) => {
      project();
      if (!a.clip_id) { S().select(null); return { text: 'Selección quitada.' }; }
      const l = need(a.clip_id);
      focus(l);
      return { text: `Seleccionado ${KIND_NAMES[l.kind]} ${l.clip.id}.` };
    },
  },

  split_clip: {
    label: () => 'Dividiendo un clip',
    run: (a) => {
      const l = need(a.clip_id);
      const t = has(a, 'time') ? num(a.time, 'time', 0) : S().time;
      if (t <= l.start + MIN_CLIP || t >= l.end - MIN_CLIP) fail(`El corte debe caer dentro del clip (${l.start.toFixed(2)}–${l.end.toFixed(2)} s).`);
      const before = new Set(allIds(project()));
      focus(l, t);
      splitAtPlayhead();
      const fresh = allIds(project()).filter((id) => !before.has(id));
      if (!fresh.length) fail('No se pudo dividir el clip en ese punto.');
      return { text: `Clip dividido en ${t.toFixed(2)} s.`, data: { first: l.clip.id, second: fresh[0] } };
    },
  },

  cut_range: {
    label: (a) => `Cortando de ${Number(a.start).toFixed(1)} a ${Number(a.end).toFixed(1)} s`,
    run: (a) => {
      const p = project();
      const start = num(a.start, 'start', 0), end = num(a.end, 'end', 0);
      if (end - start < 0.05) fail('end debe ser mayor que start.');
      const test = applyCuts(structuredClone(p), [[start, end]], true);
      if (!test.cuts) fail('No hay nada que cortar en ese tramo de la pista principal (los clips con curva de velocidad y las transiciones no se cortan).');
      let r = test;
      S().update((d) => { r = applyCuts(d, [[start, end]], true); });
      seek(start);
      return { text: `Quitados ${r.seconds.toFixed(2)} s. Lo que venía después se ha adelantado.`, data: { duration: r3(projectDuration(S().project!)) } };
    },
  },

  delete_clip: {
    label: () => 'Eliminando un clip',
    run: (a) => {
      const l = need(a.clip_id);
      S().select({ kind: l.kind, id: l.clip.id });
      deleteSelected();
      return { text: `${KIND_NAMES[l.kind]} eliminado.` };
    },
  },

  duplicate_clip: {
    label: () => 'Duplicando un clip',
    run: (a) => {
      const l = need(a.clip_id);
      S().select({ kind: l.kind, id: l.clip.id });
      duplicateSelected();
      const id = S().selection?.id;
      if (!id || id === l.clip.id) fail('No se pudo duplicar.');
      focus(id!);
      return { text: 'Clip duplicado.', data: { clip_id: id } };
    },
  },

  move_clip: {
    label: () => 'Moviendo un clip',
    run: (a) => {
      const l = need(a.clip_id);
      if (l.kind === 'main') {
        if (!has(a, 'index')) fail('Para la pista principal indica index (posición).');
        const to = Math.round(num(a.index, 'index', 0, project().main.length - 1));
        moveMain(l.index, to);
      } else {
        if (!has(a, 'start')) fail('Indica start (segundos).');
        const start = num(a.start, 'start', 0);
        edit<MediaClip | TextClip | AudioClip>(l.clip.id, (c) => { c.start = start; });
      }
      focus(l.clip.id);
      const n = locate(project(), l.clip.id)!;
      return { text: `Clip movido a ${n.start.toFixed(2)} s.`, data: { start: r3(n.start), end: r3(n.end), index: n.kind === 'main' ? n.index : undefined } };
    },
  },

  trim_clip: {
    label: () => 'Recortando un clip',
    run: (a) => {
      const p = project();
      const l = need(a.clip_id);
      const c = l.clip;
      if (c.type === 'text') {
        edit<TextClip>(c.id, (x) => {
          if (has(a, 'start')) x.start = num(a.start, 'start', 0);
          if (has(a, 'duration')) x.duration = num(a.duration, 'duration', MIN_CLIP, 3600);
        });
      } else {
        const asset = assetOf(p, c);
        const image = asset?.kind === 'image';
        const max = image ? Infinity : asset?.duration ?? c.out;
        let nin = c.in, nout = c.out, nstart = 'start' in c ? c.start : 0;
        if (has(a, 'timeline_start') || has(a, 'timeline_end')) {
          const ts = has(a, 'timeline_start') ? num(a.timeline_start, 'timeline_start', l.start, l.end) : l.start;
          const te = has(a, 'timeline_end') ? num(a.timeline_end, 'timeline_end', l.start, l.end) : l.end;
          if (te - ts < MIN_CLIP) fail('El tramo es demasiado corto.');
          nin = c.in + sourceOffset(c, ts - l.start);
          nout = c.in + sourceOffset(c, te - l.start);
          if (l.kind !== 'main') nstart = ts;
        }
        if (has(a, 'in')) nin = num(a.in, 'in', 0, max);
        if (has(a, 'out')) nout = num(a.out, 'out', 0, max);
        if (has(a, 'duration')) {
          if (!image) fail('duration solo vale para fotos (y textos); para vídeos usa in/out.');
          nout = nin + num(a.duration, 'duration', MIN_CLIP, 3600);
        }
        if (has(a, 'start')) {
          if (l.kind === 'main') fail('En la pista principal los clips van seguidos: usa move_clip con index.');
          nstart = num(a.start, 'start', 0);
        }
        if (nout - nin < MIN_CLIP) fail(`El clip quedaría demasiado corto (in ${nin.toFixed(2)}, out ${nout.toFixed(2)}).`);
        edit<MediaClip | AudioClip>(c.id, (x) => {
          // Keyframes stay on the same content when the start is trimmed.
          shiftKeyframes(x, -(nin - x.in) / (x.curve ? 1 : x.speed));
          x.in = nin; x.out = nout;
          if (l.kind !== 'main') x.start = nstart;
        });
      }
      const n = locate(project(), c.id)!;
      focus(n);
      return { text: 'Clip recortado.', data: { start: r3(n.start), end: r3(n.end), duration: r3(n.end - n.start) } };
    },
  },

  // ── Clip settings
  set_speed: {
    label: (a) => (has(a, 'speed') ? `Velocidad ${a.speed}x` : 'Curva de velocidad'),
    run: (a) => {
      const l = need(a.clip_id, ['main', 'overlay', 'audio'], 'La velocidad');
      if (l.kind !== 'audio' && assetOf(project(), l.clip)?.kind !== 'video') fail('La velocidad solo se cambia en vídeos y audios (para fotos usa trim_clip con duration).');
      edit<MediaClip | AudioClip>(l.clip.id, (x) => {
        if (has(a, 'speed')) { x.speed = num(a.speed, 'speed', MIN_SPEED, MAX_SPEED); x.curve = null; }
        if (has(a, 'curve')) x.curve = a.curve === 'none' ? null : presetCurve(pick(a.curve, CURVE_PRESETS, 'La curva').id);
        if (Array.isArray(a.curve_points)) {
          if (l.kind === 'audio') fail('Las curvas de velocidad son para vídeos.');
          const pts = a.curve_points.map((p: A) => ({ x: num(p.x, 'x', 0, 1), v: num(p.v, 'v', MIN_SPEED, MAX_SPEED) })).sort((p: A, q: A) => p.x - q.x);
          if (pts.length < 2) fail('Hacen falta al menos 2 puntos.');
          pts[0].x = 0; pts[pts.length - 1].x = 1;
          x.curve = { id: 'custom', pts };
        }
      });
      focus(l.clip.id);
      const n = locate(project(), l.clip.id)!;
      return { text: `Ahora dura ${(n.end - n.start).toFixed(2)} s.`, data: { start: r3(n.start), end: r3(n.end) } };
    },
  },

  set_volume: {
    label: (a) => (a.muted ? 'Silenciando' : has(a, 'volume') ? `Volumen ${Math.round(Number(a.volume) * 100)} %` : 'Ajustando el sonido'),
    run: (a) => {
      const l = need(a.clip_id, ['main', 'overlay', 'audio'], 'El volumen');
      const local = localTime(l, a.time);
      const max = Math.max(0.1, Math.min(10, (l.end - l.start) / 2));
      edit<MediaClip | AudioClip>(l.clip.id, (x) => {
        if (has(a, 'volume')) { setProp(x, 'volume', num(a.volume, 'volume', 0, 2), local); if (x.type === 'media' && !has(a, 'muted')) x.muted = false; }
        if (has(a, 'fade_in')) x.fadeIn = num(a.fade_in, 'fade_in', 0, max);
        if (has(a, 'fade_out')) x.fadeOut = num(a.fade_out, 'fade_out', 0, max);
        if (has(a, 'muted') && x.type === 'media') x.muted = !!a.muted;
      });
      focus(l.clip.id);
      return { text: 'Sonido ajustado.' };
    },
  },

  set_transform: {
    label: () => 'Colocando el clip',
    run: (a) => {
      const p = project();
      const l = need(a.clip_id, ['main', 'overlay', 'text'], 'Transformar');
      const local = localTime(l, a.time);
      edit<MediaClip | TextClip>(l.clip.id, (x) => {
        if (a.reset) { x.transform = { x: 0, y: 0, scale: 1, rotation: 0 }; x.flipH = false; x.flipV = false; delete x.keyframes; }
        if (has(a, 'fit')) {
          if (x.type !== 'media') fail('fit solo vale para vídeos y fotos.');
          const asset = assetOf(p, x);
          let scale = 1;
          if (a.fit === 'fill' && asset?.width && asset.height) {
            const r = aspectRatio(p);
            const crop = (x as MediaClip).crop;
            const ar = (asset.width * (crop?.w ?? 1)) / (asset.height * (crop?.h ?? 1));
            scale = Math.max(r / ar, ar / r);
          }
          setProp(x, 'scale', scale, local); setProp(x, 'x', 0, local); setProp(x, 'y', 0, local);
        }
        const ranges = { x: [-1.5, 1.5], y: [-1.5, 1.5], scale: [0.05, 10], rotation: [-3600, 3600], opacity: [0, 1] } as const;
        for (const k of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) {
          if (has(a, k)) setProp(x, k, num(a[k], k, ranges[k][0], ranges[k][1]), local);
        }
        if (has(a, 'flip_h')) x.flipH = !!a.flip_h;
        if (has(a, 'flip_v')) x.flipV = !!a.flip_v;
      });
      focus(l.clip.id);
      return { text: 'Hecho.' };
    },
  },

  set_filter: {
    label: (a) => `Filtro ${shortText(a.filter)}${a.apply_to_all ? ' en todos los clips' : ''}`,
    run: (a) => {
      const f = pick(a.filter, FILTERS, 'El filtro');
      const intensity = has(a, 'intensity') ? num(a.intensity, 'intensity', 0, 1) : 1;
      if (a.apply_to_all) {
        project();
        S().update((d) => { for (const c of d.main) c.filter = { id: f.id, intensity }; });
        return { text: `Filtro «${f.name}» en todos los clips de la pista principal.` };
      }
      const l = need(a.clip_id, ['main', 'overlay'], 'Los filtros');
      const local = localTime(l);
      edit<MediaClip>(l.clip.id, (x) => {
        const same = x.filter.id === f.id;
        x.filter = { id: f.id, intensity: same ? x.filter.intensity : 1 };
        if (has(a, 'intensity') || !same) setProp(x, 'filter', intensity, local);
      });
      focus(l.clip.id);
      return { text: `Filtro «${f.name}» aplicado.` };
    },
  },

  set_adjust: {
    label: () => 'Ajustando el color',
    run: (a) => {
      const l = need(a.clip_id, ['main', 'overlay'], 'Los ajustes');
      const keys = Object.keys(defaultAdjust()) as (keyof Adjust)[];
      edit<MediaClip>(l.clip.id, (x) => {
        if (a.reset) x.adjust = defaultAdjust();
        for (const k of keys) if (has(a, k)) x.adjust[k] = num(a[k], k, ['fade', 'vignette', 'grain', 'sharpen'].includes(k) ? 0 : -100, 100);
      });
      if (a.apply_to_all) {
        const adj = { ...(locate(project(), l.clip.id)!.clip as MediaClip).adjust };
        S().update((d) => { for (const c of d.main) c.adjust = { ...adj }; }, `claude:${l.clip.id}:adjall`);
      }
      focus(l.clip.id);
      return { text: 'Ajustes aplicados.', data: (locate(project(), l.clip.id)!.clip as MediaClip).adjust };
    },
  },

  set_effect: {
    label: (a) => `Efecto ${shortText(a.effect)}`,
    run: (a) => {
      const l = need(a.clip_id, ['main', 'overlay', 'text'], 'Los efectos');
      const e = pick(a.effect, EFFECTS, 'El efecto');
      edit<MediaClip | TextClip>(l.clip.id, (x) => {
        x.effect = { id: e.id, intensity: has(a, 'intensity') ? num(a.intensity, 'intensity', 0.05, 1) : x.effect.intensity || 0.6 };
      });
      focus(l.clip.id);
      return { text: `Efecto «${e.name}».` };
    },
  },

  set_animation: {
    label: () => 'Animando',
    run: (a) => {
      const l = need(a.clip_id, ['main', 'overlay', 'text'], 'Las animaciones');
      const d = l.end - l.start;
      const text = l.kind === 'text';
      edit<MediaClip | TextClip>(l.clip.id, (x) => {
        const set = (key: 'animIn' | 'animOut' | 'animLoop', v: unknown, list: { id: string }[], def: number, maxDur: number) => {
          if (v === undefined) return;
          if (v === null || (v as A).id === 'none') { x[key] = null; return; }
          const an = pick((v as A).id, list, 'La animación');
          x[key] = { id: an.id, duration: has(v as A, 'duration') ? num((v as A).duration, 'duration', 0.1, maxDur) : x[key]?.duration ?? def };
        };
        set('animIn', a.in, ANIMS_IN.filter((x2) => x2.id !== 'typewriter' || text), Math.min(0.6, d / 2), Math.max(0.2, Math.min(5, d)));
        set('animOut', a.out, ANIMS_OUT, Math.min(0.6, d / 2), Math.max(0.2, Math.min(5, d)));
        set('animLoop', a.loop, ANIMS_LOOP, 1, 4);
      });
      focus(l.clip.id);
      return { text: 'Animación aplicada.' };
    },
  },

  set_transition: {
    label: (a) => `Transición ${shortText(a.transition)}`,
    run: (a) => {
      const p = project();
      const tr = pick(a.transition, TRANSITIONS, 'La transición');
      const dur = has(a, 'duration') ? num(a.duration, 'duration', 0.1, 2) : 0.5;
      if (a.apply_to_all) {
        S().update((d) => { d.main.forEach((m, k) => { if (k < d.main.length - 1) m.transition = tr.id === 'none' ? null : { id: tr.id, duration: dur }; }); });
        return { text: `Transición «${tr.name}» en todas las uniones.` };
      }
      const l = need(a.clip_id, ['main'], 'Las transiciones');
      if (l.index >= p.main.length - 1) fail('Es el último clip: la transición va en el clip ANTES de la unión.');
      edit<MediaClip>(l.clip.id, (x) => { x.transition = tr.id === 'none' ? null : { id: tr.id, duration: dur }; });
      const q = project();
      const real = clampTransition(q.main[l.index], q.main[l.index + 1]);
      S().select({ kind: 'transition', id: l.clip.id });
      seek(Math.max(0, l.end - real - 0.3));
      return { text: tr.id === 'none' ? 'Transición quitada.' : `Transición «${tr.name}» de ${real.toFixed(2)} s${real < dur - 0.01 ? ' (limitada por la duración de los clips)' : ''}.` };
    },
  },

  set_chroma: {
    label: () => 'Quitando el fondo verde',
    run: (a) => {
      const l = need(a.clip_id, ['main', 'overlay'], 'El croma');
      edit<MediaClip>(l.clip.id, (x) => {
        if (a.enabled === false) { x.chroma = null; return; }
        const ck = x.chroma ?? { color: '#00ff00', similarity: 0.12, smoothness: 0.08 };
        if (has(a, 'color')) ck.color = color(a.color, 'color');
        if (has(a, 'similarity')) ck.similarity = num(a.similarity, 'similarity', 0, 0.5);
        if (has(a, 'smoothness')) ck.smoothness = num(a.smoothness, 'smoothness', 0, 0.3);
        x.chroma = ck;
      });
      focus(l.clip.id);
      return { text: a.enabled === false ? 'Croma quitado.' : 'Croma aplicado.' };
    },
  },

  crop_clip: {
    label: () => 'Recortando la imagen',
    run: (a) => {
      const p = project();
      const l = need(a.clip_id, ['main', 'overlay'], 'Recortar');
      const asset = assetOf(p, l.clip);
      const src = asset?.width && asset.height ? asset.width / asset.height : 1;
      edit<MediaClip>(l.clip.id, (x) => {
        if (a.reset) x.crop = null;
        if (has(a, 'aspect')) {
          const m = String(a.aspect).match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/);
          if (!m) fail('aspect debe ser como "1:1" o "9:16".');
          const r = Number(m![1]) / Number(m![2]);
          x.crop = src > r ? { x: (1 - r / src) / 2, y: 0, w: r / src, h: 1 } : { x: 0, y: (1 - src / r) / 2, w: 1, h: src / r };
        }
        if (['x', 'y', 'w', 'h'].some((k) => has(a, k))) {
          const k0 = x.crop ?? { x: 0, y: 0, w: 1, h: 1 };
          const w = has(a, 'w') ? num(a.w, 'w', 0.05, 1) : k0.w, h = has(a, 'h') ? num(a.h, 'h', 0.05, 1) : k0.h;
          const cx = has(a, 'x') ? num(a.x, 'x', 0, 1 - w) : clamp(k0.x, 0, 1 - w), cy = has(a, 'y') ? num(a.y, 'y', 0, 1 - h) : clamp(k0.y, 0, 1 - h);
          x.crop = w > 0.999 && h > 0.999 ? null : { x: cx, y: cy, w, h };
        }
        if (has(a, 'radius')) x.radius = num(a.radius, 'radius', 0, 0.5) || undefined;
      });
      focus(l.clip.id);
      return { text: 'Recorte aplicado.', data: { crop: (locate(project(), l.clip.id)!.clip as MediaClip).crop ?? 'sin recorte' } };
    },
  },

  reverse_clip: {
    label: (a) => (a.reversed === false ? 'Devolviendo el clip a su sentido' : 'Invirtiendo el clip'),
    run: async (a, ctx) => {
      const l = need(a.clip_id, ['main', 'overlay'], 'Invertir');
      const want = a.reversed !== false;
      const c = l.clip as MediaClip;
      if (!!c.reversed === want) return { text: want ? 'El clip ya estaba invertido.' : 'El clip ya va en su sentido original.' };
      focus(l);
      await withJobProgress(ctx, () => toggleReverse());
      const n = locate(project(), c.id);
      if (!n || !!(n.clip as MediaClip).reversed !== want) fail(S().toast || 'No se pudo invertir el clip.');
      return { text: want ? 'Clip invertido: ahora se reproduce hacia atrás.' : 'Clip en su sentido original.' };
    },
  },

  stabilize_clip: {
    label: () => 'Estabilizando el vídeo',
    run: async (a, ctx) => {
      const l = need(a.clip_id, ['main', 'overlay'], 'Estabilizar');
      if (assetOf(project(), l.clip)?.kind !== 'video') fail('Solo se pueden estabilizar vídeos.');
      const level = has(a, 'level') ? Math.round(num(a.level, 'level', 0, 3)) : 2;
      focus(l);
      await withJobProgress(ctx, () => stabilizeSelected(level));
      const n = locate(project(), l.clip.id)!.clip as MediaClip;
      if (level > 0 && !n.stab?.level) fail(S().toast || 'No se pudo estabilizar.');
      return { text: level ? `Estabilizado (nivel ${level}).` : 'Estabilización quitada.' };
    },
  },

  set_voice: {
    label: (a) => `Voz ${shortText(a.voice)}`,
    run: async (a) => {
      const p = project();
      const v = pick(a.voice, VOICES, 'La voz');
      const id = v.id === 'none' ? undefined : v.id;
      if (a.apply_to_all) {
        const withSound = p.main.filter((m) => p.assets.find((x) => x.id === m.assetId)?.hasAudio);
        await prepareVoice(withSound.map((m) => m.assetId), v.id);
        S().update((d) => { for (const m of d.main) m.voice = id; });
        return { text: `Voz «${v.name}» en todos los clips.` };
      }
      const l = need(a.clip_id, ['main', 'overlay', 'audio'], 'El cambiador de voz');
      const c = l.clip as MediaClip | AudioClip;
      if (!assetOf(p, c)?.hasAudio) fail('Ese clip no tiene sonido.');
      focus(l);
      await prepareVoice([c.assetId], v.id);
      edit<MediaClip | AudioClip>(c.id, (x) => { x.voice = id; });
      return { text: `Voz «${v.name}».` };
    },
  },

  extract_audio: {
    label: () => 'Extrayendo el audio',
    run: (a) => {
      const l = need(a.clip_id, ['main', 'overlay'], 'Extraer audio');
      const before = new Set(project().audios.map((x) => x.id));
      S().select({ kind: l.kind, id: l.clip.id });
      extractAudio();
      const fresh = project().audios.find((x) => !before.has(x.id));
      if (!fresh) fail(S().toast || 'No se pudo extraer el audio.');
      return { text: 'Audio extraído a su propia pista; el vídeo queda en silencio.', data: { audio_clip_id: fresh!.id } };
    },
  },

  freeze_frame: {
    label: () => 'Congelando un fotograma',
    run: async (a) => {
      const p = project();
      const t = has(a, 'time') ? num(a.time, 'time', 0) : S().time;
      const before = new Set(p.main.map((c) => c.id));
      seek(t);
      await freezeFrame();
      const added = project().main.filter((c) => !before.has(c.id));
      if (!added.length) fail(S().toast || 'No se pudo congelar el fotograma (tiene que haber un vídeo en la pista principal en ese momento).');
      const still = added.find((c) => project().assets.find((x) => x.id === c.assetId)?.kind === 'image');
      return { text: `Fotograma congelado de 3 s insertado en ${t.toFixed(2)} s.`, data: { still_clip_id: still?.id } };
    },
  },

  add_keyframe: {
    label: () => 'Añadiendo un keyframe',
    run: (a) => {
      const l = need(a.clip_id);
      const t = num(a.time, 'time', 0);
      const local = t - l.start;
      if (local < -0.01 || local > l.end - l.start + 0.01) fail(`time debe estar dentro del clip (${l.start.toFixed(2)}–${l.end.toFixed(2)} s).`);
      const allowed = kfProps(l.clip as KfClip);
      const vals: Partial<Record<KfProp, number>> = {};
      for (const [k, v] of Object.entries((a.values ?? {}) as A)) {
        if (v === undefined || v === null) continue;
        if (!allowed.includes(k as KfProp)) fail(`«${k}» no se puede animar en este clip. Se puede: ${allowed.join(', ')}.`);
        vals[k as KfProp] = num(v, k);
      }
      const ease = has(a, 'ease') ? pick(a.ease, EASES, 'La curva').id as Ease : undefined;
      const lt = clamp(local, 0, l.end - l.start);
      edit<KfClip>(l.clip.id, (x) => {
        const kf = upsertKeyframe(x, lt, vals);
        if (ease) kf.ease = ease;
      });
      focus(l, t);
      const c = locate(project(), l.clip.id)!.clip as KfClip;
      return { text: `Keyframe en ${t.toFixed(2)} s (${c.keyframes?.length ?? 0} en total).`, data: Object.fromEntries(allowed.map((p) => [p, r3(valueAt(c, p, lt))])) };
    },
  },

  remove_keyframes: {
    label: () => 'Quitando keyframes',
    run: (a) => {
      const l = need(a.clip_id);
      if (!l.clip.keyframes?.length) return { text: 'El clip no tiene keyframes.' };
      if (has(a, 'time')) {
        const local = num(a.time, 'time') - l.start;
        if (kfIndexAt(l.clip as KfClip, local) < 0) fail('No hay ningún keyframe en ese momento.');
        edit<KfClip>(l.clip.id, (x) => removeKeyframe(x, local));
      } else {
        edit<KfClip>(l.clip.id, (x) => { delete x.keyframes; });
      }
      focus(l);
      return { text: 'Keyframes quitados.' };
    },
  },

  // ── Text
  add_text: {
    label: (a) => `Escribiendo «${shortText(a.text)}»`,
    run: (a) => {
      project();
      const start = has(a, 'start') ? num(a.start, 'start', 0) : S().time;
      const text = String(a.text ?? '').trim() || 'Texto';
      const c = addText(false, text);
      edit<TextClip>(c.id, (x) => {
        x.start = start;
        if (has(a, 'duration')) x.duration = num(a.duration, 'duration', MIN_CLIP, 3600);
        if (has(a, 'template')) applyTemplate(x, pick(a.template, TEXT_TEMPLATES, 'La plantilla').id);
        applyTextProps(x, a, 0);
      });
      focus(c.id);
      return { text: `Texto añadido de ${start.toFixed(2)} a ${(start + (has(a, 'duration') ? Number(a.duration) : 3)).toFixed(2)} s.`, data: { clip_id: c.id } };
    },
  },

  add_sticker: {
    label: (a) => `Añadiendo el sticker ${shortText(a.sticker, 8)}`,
    run: (a) => {
      project();
      const s = String(a.sticker ?? '').trim();
      if (!s) fail('Falta el sticker.');
      const c = addText(true, s);
      const start = has(a, 'start') ? num(a.start, 'start', 0) : S().time;
      edit<TextClip>(c.id, (x) => {
        x.start = start;
        if (has(a, 'duration')) x.duration = num(a.duration, 'duration', MIN_CLIP, 3600);
        applyTextProps(x, { x: a.x, y: a.y, scale: a.scale, rotation: a.rotation }, 0);
      });
      focus(c.id);
      return { text: 'Sticker añadido.', data: { clip_id: c.id } };
    },
  },

  update_text: {
    label: (a) => (has(a, 'text') ? `Cambiando el texto a «${shortText(a.text)}»` : 'Cambiando el estilo del texto'),
    run: (a) => {
      const l = need(a.clip_id, ['text'], 'update_text');
      const local = localTime(l);
      edit<TextClip>(l.clip.id, (x) => {
        if (has(a, 'text')) {
          const t = String(a.text) || ' ';
          // Word timings only survive if the words still line up.
          const count = (s: string) => s.split(/\s+/).filter(Boolean).length;
          if (x.words && count(t) !== count(x.text)) delete x.words;
          x.text = t;
        }
        if (has(a, 'start')) x.start = num(a.start, 'start', 0);
        if (has(a, 'duration')) x.duration = num(a.duration, 'duration', MIN_CLIP, 3600);
        if (has(a, 'template')) applyTemplate(x, pick(a.template, TEXT_TEMPLATES, 'La plantilla').id);
        applyTextProps(x, a, local);
      });
      focus(l.clip.id);
      return { text: 'Texto actualizado.' };
    },
  },

  // ── Automatic tools
  generate_captions: {
    label: () => 'Generando subtítulos',
    run: async (a, ctx) => {
      const p0 = project();
      if (!p0.main.length && !p0.audios.length) fail('No hay audio que transcribir.');
      const lang = has(a, 'language') ? pick(a.language, CAPTION_LANGS, 'El idioma').id : 'spanish';
      const model = has(a, 'model') ? modelByKey(pick(a.model, SPEECH_MODELS.map((m) => ({ ...m, id: m.key })), 'El modelo').key) : savedModel();
      const words = has(a, 'words_per_line') ? Math.round(num(a.words_per_line, 'words_per_line', 1, 10)) : 4;
      const style = has(a, 'template') ? pick(a.template, TEXT_TEMPLATES.filter((t) => t.caption), 'La plantilla de subtítulos').id : 'karaoke';
      getPlayer()?.pause();
      S().setBusy('Claude está generando subtítulos…');
      try {
        const segs = await transcribe(project(), model, lang, captionProgress(ctx));
        if (!segs.length) fail('No se ha detectado voz en el audio.');
        const p = project();
        const end = projectDuration({ ...p, texts: p.texts.filter((t) => !t.caption) });
        const clips = captionClips(segs, words, style)
          .filter((c) => c.start < end - 0.05)
          .map((c) => ({ ...c, duration: Math.min(c.duration, end - c.start) }));
        S().update((d) => { d.texts = [...d.texts.filter((t) => !t.caption), ...clips]; });
        return {
          text: `${clips.length} subtítulos añadidos (${lang}, modelo ${model.name}).`,
          data: clips.map((c) => ({ id: c.id, start: r3(c.start), end: r3(c.start + c.duration), text: c.text })),
        };
      } finally {
        S().setBusy(null);
      }
    },
  },

  style_captions: {
    label: () => 'Cambiando el estilo de los subtítulos',
    run: (a) => {
      const p = project();
      if (!p.texts.some((t) => t.caption)) fail('No hay subtítulos automáticos. Usa generate_captions.');
      const tpl = has(a, 'template') ? pick(a.template, TEXT_TEMPLATES, 'La plantilla').id : null;
      S().update((d) => {
        for (const t of d.texts) {
          if (!t.caption) continue;
          if (tpl) applyTemplate(t, tpl);
          applyTextProps(t, a, 0);
        }
      });
      const first = project().texts.find((t) => t.caption)!;
      focus(first.id);
      return { text: 'Estilo aplicado a todos los subtítulos.' };
    },
  },

  remove_silences: {
    label: () => 'Quitando silencios',
    run: async (a, ctx) => {
      project();
      const lang = has(a, 'language') ? pick(a.language, CAPTION_LANGS, 'El idioma').id : 'spanish';
      const model = has(a, 'model') ? modelByKey(String(a.model)) : savedModel();
      getPlayer()?.pause();
      S().setBusy('Claude está buscando silencios…');
      try {
        const ranges = await findCuts(project(), {
          minPause: has(a, 'min_pause') ? num(a.min_pause, 'min_pause', 0.2, 2) : 0.5,
          margin: has(a, 'margin') ? num(a.margin, 'margin', 0, 0.4) : 0.12,
          fillers: !!a.fillers, fillerWords: !!a.filler_words, model, language: lang,
        }, captionProgress(ctx));
        const test = applyCuts(structuredClone(project()), ranges);
        if (!test.cuts) return { text: a.fillers ? 'No se han encontrado pausas ni muletillas.' : 'No se han encontrado pausas. Prueba con un min_pause más corto.' };
        let r = test;
        S().update((d) => { r = applyCuts(d, ranges); });
        return { text: `${r.cuts} corte${r.cuts === 1 ? '' : 's'}, ${r.seconds.toFixed(1)} s menos. Se puede deshacer.`, data: { duration: r3(projectDuration(project())) } };
      } finally {
        S().setBusy(null);
      }
    },
  },

  // ── Canvas and layout
  set_canvas: {
    label: (a) => (has(a, 'aspect') ? `Formato ${a.aspect}` : 'Cambiando el fondo'),
    run: (a) => {
      project();
      S().update((d) => {
        if (has(a, 'aspect')) d.aspect = pick(a.aspect, ASPECTS, 'El formato').id as AspectId;
        if (has(a, 'background')) d.background.type = a.background === 'color' ? 'color' : 'blur';
        if (has(a, 'color')) { d.background.color = color(a.color, 'color'); if (!has(a, 'background')) d.background.type = 'color'; }
        if (has(a, 'blur')) d.background.blur = num(a.blur, 'blur', 0, 1);
      });
      const p = project();
      return { text: `Formato ${p.aspect}, fondo ${p.background.type === 'color' ? p.background.color : 'desenfocado'}.` };
    },
  },

  create_collage: {
    label: (a) => `Montando un collage ${shortText(a.template, 12)}`,
    run: (a) => {
      const p = project();
      const tpl = pick(a.template, COLLAGES, 'La plantilla de collage');
      const style: CollageStyle = {
        template: tpl.id,
        aspect: has(a, 'aspect') ? pick(a.aspect, ASPECTS.filter((x) => x.id !== 'original'), 'El formato').id as AspectId : p.aspect === 'original' ? '9:16' : p.aspect,
        gap: has(a, 'gap') ? num(a.gap, 'gap', 0, 0.08) : 0.012,
        radius: has(a, 'radius') ? num(a.radius, 'radius', 0, 0.5) : 0,
        color: has(a, 'color') ? color(a.color, 'color') : '#ffffff',
      };
      let id: string | null = null;
      if (Array.isArray(a.asset_ids) && a.asset_ids.length) {
        const assets = a.asset_ids.map((x: string) => p.assets.find((y) => y.id === x) ?? fail(`No hay ningún archivo con id ${x}.`)) as Asset[];
        if (assets.some((x) => x.kind === 'audio')) fail('Un collage solo admite vídeos y fotos.');
        id = addCollageAssets(assets, style, null);
      } else {
        seek(has(a, 'from_time') ? num(a.from_time, 'from_time', 0) : S().time);
        if (collageFromClips(style)) id = activeCollage(project(), S().selection, S().time);
      }
      if (!id) fail(S().toast || 'No se pudo crear el collage.');
      S().setSheet(null);
      const q = project();
      return { text: S().toast || 'Collage listo.', data: { collage_id: id, template: tpl.id, cells: tpl.cells.length, clips: collageClips(q, id!).map((c) => c.id) } };
    },
  },

  update_collage: {
    label: () => 'Ajustando el collage',
    run: (a) => {
      const p = project();
      const cur = collageStyle(p, String(a.collage_id));
      if (!cur) fail(`No hay ningún collage con id ${a.collage_id}. Mira get_project › collages.`);
      const s: CollageStyle = {
        template: has(a, 'template') ? pick(a.template, COLLAGES, 'La plantilla de collage').id : cur!.template,
        aspect: has(a, 'aspect') ? pick(a.aspect, ASPECTS.filter((x) => x.id !== 'original'), 'El formato').id as AspectId : cur!.aspect,
        gap: has(a, 'gap') ? num(a.gap, 'gap', 0, 0.08) : cur!.gap,
        radius: has(a, 'radius') ? num(a.radius, 'radius', 0, 0.5) : cur!.radius,
        color: has(a, 'color') ? color(a.color, 'color') : cur!.color,
      };
      restyleCollage(String(a.collage_id), s);
      focus(collageClips(project(), String(a.collage_id))[0]?.id ?? null);
      return { text: 'Collage actualizado.' };
    },
  },

  // ── Export
  export_video: {
    label: () => 'Exportando el vídeo',
    run: async (a, ctx) => {
      const p = project();
      if (projectDuration(p) <= 0) fail('El proyecto está vacío.');
      const res = has(a, 'resolution') ? Number(a.resolution) : 1080;
      const fps = has(a, 'fps') ? Number(a.fps) : 30;
      if (![480, 720, 1080, 1440, 2160].includes(res)) fail('resolution debe ser 480, 720, 1080, 1440 o 2160.');
      if (![24, 25, 30, 50, 60].includes(fps)) fail('fps debe ser 24, 25, 30, 50 o 60.');
      const quality = (has(a, 'quality') ? pick(a.quality, [{ id: 'low' }, { id: 'medium' }, { id: 'high' }], 'La calidad').id : 'high') as Quality;
      const o: ExportOptions = { shortSide: res, fps, quality };
      getPlayer()?.pause();
      type WakeLock = { release: () => Promise<void> };
      let wake: WakeLock | null = null;
      try { wake = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<WakeLock> } }).wakeLock?.request('screen') ?? null; } catch { /* not available */ }
      let lastPct = -1;
      S().setBusy('Claude está exportando el vídeo…');
      try {
        const r = await exportProject(p, o, (f, stage) => {
          const pct = Math.floor(f * 100);
          if (pct === lastPct) return;
          lastPct = pct;
          S().setBusy(`Claude está exportando el vídeo… ${pct} %`);
          if (pct % 5 === 0) ctx.progress(`${stage} ${pct} %`);
        }, new AbortController().signal);
        const name = `${p.name.replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'i-cut'}.${r.ext}`;
        const prev = useClaude.getState().exported;
        if (prev) URL.revokeObjectURL(prev.url);
        useClaude.setState({ exported: { url: URL.createObjectURL(r.blob), blob: r.blob, name, mime: r.mime, width: r.width, height: r.height } });
        let saved = false;
        if (a.__upload) {
          S().setBusy('Enviando el vídeo a tu ordenador…');
          const up = await fetch(serverBase() + a.__upload, { method: 'PUT', body: r.blob }).catch(() => null);
          saved = !!up?.ok;
        }
        return {
          text: `Vídeo exportado: ${r.width}×${r.height}, ${(r.blob.size / 1e6).toFixed(1)} MB${supportsWebCodecs() ? '' : ' (grabado en tiempo real)'}. El usuario tiene en pantalla los botones para guardarlo o compartirlo.`,
          data: { saved, width: r.width, height: r.height, mb: r3(r.blob.size / 1e6), file: name },
        };
      } finally {
        S().setBusy(null);
        void wake?.release();
      }
    },
  },
};

function allIds(p: Project): string[] {
  return [...p.main, ...p.overlays, ...p.texts, ...p.audios].map((c) => c.id);
}
