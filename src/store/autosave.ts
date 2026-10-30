// Background autosave. Edits are written to IndexedDB a moment after the
// user stops touching the project (and at least every few seconds while they
// keep editing), plus right away when the app goes to the background, which
// is the last chance before iOS may discard the tab. The open project and
// playhead are remembered so a relaunch drops the user back where they were.

import type { Project } from '../types';
import { saveProject } from './db';

const IDLE_MS = 1000;
const MAX_WAIT_MS = 4000;
const SESSION_KEY = 'i-cut:session';

let pending: Project | null = null;
let lastSaved: Project | null = null;
let idleTimer = 0;
let maxTimer = 0;
let writing: Promise<void> = Promise.resolve();
let warned = false;
let getTime: () => number = () => 0;
let onError: (msg: string) => void = () => {};

// Media files are written once, when imported. A project is only saved after
// the files it points to are stored, so a restored project never references
// a video that is not on disk.
const mediaWrites = new Set<Promise<unknown>>();
export function trackMediaWrite(p: Promise<unknown>) {
  mediaWrites.add(p);
  void p.catch((e) => { console.warn('media save', e); warn(); }).finally(() => mediaWrites.delete(p));
}

function warn() {
  if (warned) return;
  warned = true;
  onError('No se pudieron guardar los cambios. Revisa el espacio libre.');
}

function clearTimers() {
  clearTimeout(idleTimer);
  clearTimeout(maxTimer);
  idleTimer = maxTimer = 0;
}

/** Queues `p` to be saved soon. Cheap enough to call on every edit. */
export function scheduleSave(p: Project) {
  pending = p;
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => void flush(), IDLE_MS);
  if (!maxTimer) maxTimer = window.setTimeout(() => void flush(), MAX_WAIT_MS);
}

/** Writes the queued project now. Writes never overlap and unchanged projects are skipped. */
export function flush(): Promise<void> {
  clearTimers();
  const p = pending;
  pending = null;
  rememberTime();
  if (!p || p === lastSaved) return writing;
  writing = writing.then(async () => {
    try {
      if (mediaWrites.size) await Promise.allSettled([...mediaWrites]);
      await saveProject(p);
      lastSaved = p;
    } catch (e) {
      console.warn('autosave', e);
      // Keep it queued unless a newer edit already replaced it.
      if (!pending) pending = p;
      warn();
    }
  });
  return writing;
}

interface Session { id: string; t: number }

function readSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    return s && typeof s.id === 'string' ? { id: s.id, t: Number(s.t) || 0 } : null;
  } catch {
    return null;
  }
}

let session: Session | null = null;

function rememberTime() {
  if (!session) return;
  session.t = getTime();
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignore */ }
}

/** The project that was open when the app was last closed or discarded. */
export const lastSession = readSession;

/** Marks `p` as the open project. `p` is already on disk, so it counts as saved. */
export function startSession(p: Project, time = 0) {
  session = { id: p.id, t: time };
  lastSaved = p;
  pending = null;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignore */ }
}

/** Saves what is left and forgets the open project (the user went back home). */
export async function endSession() {
  await flush();
  session = null;
  lastSaved = null;
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export function initAutosave(opts: { time: () => number; error: (msg: string) => void }) {
  getTime = opts.time;
  onError = opts.error;
  // iOS may freeze or discard a hidden page without any further events.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(); });
  window.addEventListener('pagehide', () => void flush());
}
