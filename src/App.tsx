import { useEffect, useRef, useState } from 'react';
import type { Project } from './types';
import { Home } from './ui/Home';
import { Editor } from './ui/Editor';
import { library } from './media/library';
import { addMedia, pickFiles } from './store/actions';
import { useEditor } from './store/editor';
import { loadProject, requestPersistence } from './store/db';
import { endSession, initAutosave, lastSession, startSession } from './store/autosave';

initAutosave({ time: () => useEditor.getState().time, error: (m) => useEditor.getState().showToast(m) });

export function App() {
  const project = useEditor((s) => s.project);
  // Start on the loading screen when there is a project to resume, so Home
  // does not flash before the editor.
  const [loading, setLoading] = useState(() => !!lastSession());

  const open = async (p: Project, files?: File[], time = 0) => {
    setLoading(true);
    library.reset();
    await library.load(p.assets);
    for (const a of p.assets) { void library.thumbnails(a); void library.audioBuffer(a); }
    useEditor.getState().open(p, time);
    startSession(p, time);
    setLoading(false);
    void requestPersistence();
    if (files?.length) await addMedia(files, 'main');
  };

  // Reopen the project that was being edited when iOS closed the app.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const s = lastSession();
    if (!s) return;
    loadProject(s.id)
      .then((p) => (p ? open(p, undefined, s.t) : endSession()))
      .catch(() => endSession())
      .finally(() => setLoading(false));
  }, []);

  const close = async () => {
    await endSession();
    useEditor.getState().close();
    library.reset();
  };

  if (loading) return <div className="busy"><div><span className="spinner" />Abriendo proyecto…</div></div>;
  if (project) return <Editor onClose={close} />;
  return <Home onOpen={open} onPick={() => pickFiles('video/*,image/*')} />;
}
