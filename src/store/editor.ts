import { create } from 'zustand';
import type { Project, Selection } from '../types';
import type { Player } from '../engine/player';
import { scheduleSave } from './autosave';

const HISTORY = 80;

export type SheetId =
  | 'speed' | 'volume' | 'filters' | 'adjust' | 'effects' | 'animation' | 'transform' | 'opacity'
  | 'text' | 'textStyle' | 'textTemplates' | 'stickers' | 'transition' | 'canvas' | 'background' | 'audio' | 'export'
  | 'duration' | 'record' | 'overlayAdd' | 'chroma' | 'captions' | 'voice' | 'cleanup' | 'keyframes' | 'stabilize' | null;

interface EditorState {
  project: Project | null;
  past: Project[];
  future: Project[];
  lastKey: string | null;
  lastAt: number;
  selection: Selection;
  sheet: SheetId;
  time: number;
  playing: boolean;
  pxPerSec: number;
  toast: string | null;
  busy: string | null;
  open: (p: Project, time?: number) => void;
  close: () => void;
  /** Applies an edit. Edits with the same `key` within a second merge into one undo step. */
  update: (fn: (draft: Project) => void, key?: string) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setSheet: (s: SheetId) => void;
  setTime: (t: number, playing: boolean) => void;
  setZoom: (pps: number) => void;
  showToast: (msg: string) => void;
  setBusy: (msg: string | null) => void;
}

let player: Player | null = null;
export const setPlayer = (p: Player | null) => { player = p; };
export const getPlayer = () => player;

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
  selection: null,
  sheet: null,
  time: 0,
  playing: false,
  pxPerSec: 60,
  toast: null,
  busy: null,
  open: (p, time = 0) => set({ project: p, past: [], future: [], selection: null, sheet: null, time, playing: false, lastKey: null }),
  close: () => {
    set({ project: null, past: [], future: [], selection: null, sheet: null });
  },
  update: (fn, key) => {
    const s = get();
    if (!s.project) return;
    const draft = structuredClone(s.project);
    fn(draft);
    draft.updatedAt = Date.now();
    const now = performance.now();
    const merge = key && key === s.lastKey && now - s.lastAt < 1200;
    const past = merge ? s.past : [...s.past, s.project].slice(-HISTORY);
    set({ project: draft, past, future: [], lastKey: key ?? null, lastAt: now });
    player?.setProject(draft);
    scheduleSave(draft);
  },
  undo: () => {
    const s = get();
    if (!s.project || !s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], lastKey: null });
    player?.setProject(prev);
    scheduleSave(prev);
  },
  redo: () => {
    const s = get();
    if (!s.project || !s.future.length) return;
    const next = s.future[0];
    set({ project: next, past: [...s.past, s.project], future: s.future.slice(1), lastKey: null });
    player?.setProject(next);
    scheduleSave(next);
  },
  select: (selection) => set({ selection, sheet: null }),
  setSheet: (sheet) => set({ sheet }),
  setTime: (time, playing) => set({ time, playing }),
  setZoom: (pxPerSec) => set({ pxPerSec: Math.max(8, Math.min(600, pxPerSec)) }),
  showToast: (toast) => {
    set({ toast });
    setTimeout(() => { if (get().toast === toast) set({ toast: null }); }, 2200);
  },
  setBusy: (busy) => set({ busy }),
}));
