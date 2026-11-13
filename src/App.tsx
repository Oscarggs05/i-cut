import { Home } from './ui/Home';
import { Editor } from './ui/Editor';
import { pickFiles } from './store/actions';
import { useEditor } from './store/editor';
import { closeProject, openProject, useSession } from './store/session';
import { ClaudeLayer } from './claude/ClaudeUI';

export function App() {
  const project = useEditor((s) => s.project);
  const loading = useSession((s) => s.loading);
  return (
    <>
      {loading ? <div className="busy"><div><span className="spinner" />Abriendo proyecto…</div></div>
        : project ? <Editor onClose={closeProject} />
          : <Home onOpen={(p, files, sheet) => void openProject(p, files, sheet)} onPick={() => pickFiles('video/*,image/*')} />}
      <ClaudeLayer />
    </>
  );
}
