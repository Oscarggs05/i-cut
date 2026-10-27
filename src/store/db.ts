// Tiny IndexedDB wrapper. Projects are JSON, media files are Blobs, and
// covers are small JPEG blobs for the project list.

import type { Project } from '../types';

const DB_NAME = 'i-cut';
const STORES = ['projects', 'media', 'covers'] as const;
type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store: StoreName, mode: IDBTransactionMode) {
  const db = await open();
  return db.transaction(store, mode).objectStore(store);
}

export async function put(store: StoreName, key: string, value: unknown) {
  await wrap((await tx(store, 'readwrite')).put(value, key));
}
export async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
  return wrap((await tx(store, 'readonly')).get(key)) as Promise<T | undefined>;
}
export async function del(store: StoreName, key: string) {
  await wrap((await tx(store, 'readwrite')).delete(key));
}
export async function all<T>(store: StoreName): Promise<T[]> {
  return wrap((await tx(store, 'readonly')).getAll()) as Promise<T[]>;
}

export const saveProject = (p: Project) => put('projects', p.id, p);
export const loadProject = (id: string) => get<Project>('projects', id);
export const listProjects = async () => (await all<Project>('projects')).sort((a, b) => b.updatedAt - a.updatedAt);

export async function deleteProject(p: Project) {
  await del('projects', p.id);
  await del('covers', p.id);
  // Media can be shared by duplicated projects; only drop unreferenced files.
  const others = await all<Project>('projects');
  const used = new Set(others.flatMap((o) => o.assets.map((a) => a.id)));
  for (const a of p.assets) if (!used.has(a.id)) await del('media', a.id);
}

export const saveMedia = (id: string, blob: Blob) => put('media', id, blob);
export const loadMedia = (id: string) => get<Blob>('media', id);
export const saveCover = (id: string, blob: Blob) => put('covers', id, blob);
export const loadCover = (id: string) => get<Blob>('covers', id);

/** Ask the browser not to evict our data (honoured for home-screen apps on iOS). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* ignore */ }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
