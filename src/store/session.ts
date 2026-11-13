// Opening and closing projects, shared by the home screen, the editor and
// Claude (which can open, create and close projects too).

import { create } from 'zustand';
import type { Project } from '../types';
import { library } from '../media/library';
import { addMedia } from './actions';
import { useEditor, type SheetId } from './editor';
import { requestPersistence } from './db';

interface SessionState {
  loading: boolean;
  /** Bumped whenever the saved project list changes outside the home screen. */
  projectsVersion: number;
}

export const useSession = create<SessionState>(() => ({ loading: false, projectsVersion: 0 }));

export const bumpProjects = () => useSession.setState((s) => ({ projectsVersion: s.projectsVersion + 1 }));

export async function openProject(p: Project, files?: File[], sheet?: SheetId) {
  if (useEditor.getState().project) closeProject();
  useSession.setState({ loading: true });
  try {
    library.reset();
    await library.load(p.assets);
    for (const a of p.assets) { void library.thumbnails(a); void library.audioBuffer(a); }
    useEditor.getState().open(p);
  } finally {
    useSession.setState({ loading: false });
  }
  void requestPersistence();
  if (files?.length) await addMedia(files, 'main');
  if (sheet) useEditor.getState().setSheet(sheet);
}

export function closeProject() {
  useEditor.getState().close();
  library.reset();
  bumpProjects();
}
