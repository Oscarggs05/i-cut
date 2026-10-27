import { useState } from 'react';
import type { Project } from './types';
import { Home } from './ui/Home';
import { Editor } from './ui/Editor';
import { library } from './media/library';
import { addMedia, pickFiles } from './store/actions';
import { useEditor } from './store/editor';
import { requestPersistence } from './store/db';

export function App() {
  const project = useEditor((s) => s.project);
  const [loading, setLoading] = useState(false);

  const open = async (p: Project, files?: File[]) => {
    setLoading(true);
    library.reset();
    await library.load(p.assets);
    for (const a of p.assets) { void library.thumbnails(a); void library.audioBuffer(a); }
    useEditor.getState().open(p);
    setLoading(false);
    void requestPersistence();
    if (files?.length) await addMedia(files, 'main');
  };

  const close = () => {
    useEditor.getState().close();
    library.reset();
  };

  if (loading) return <div className="busy"><div><span className="spinner" />Abriendo proyecto…</div></div>;
  if (project) return <Editor onClose={close} />;
  return <Home onOpen={open} onPick={() => pickFiles('video/*,image/*')} />;
}
