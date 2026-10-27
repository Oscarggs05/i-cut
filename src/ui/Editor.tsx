import { useEffect, useState } from 'react';
import { useEditor, getPlayer } from '../store/editor';
import { deleteSelected } from '../store/actions';
import { formatTime, projectDuration } from '../engine/timeline';
import { Icon } from './icons';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import { SheetHost } from './sheets/SheetHost';
import { ExportFlow } from './ExportFlow';

export function Editor({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const sheet = useEditor((s) => s.sheet);
  const busy = useEditor((s) => s.busy);
  const toast = useEditor((s) => s.toast);
  const [exporting, setExporting] = useState(false);

  // Keyboard shortcuts help when testing on a Mac or iPad with a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') return;
      const s = useEditor.getState();
      if (e.key === ' ') { e.preventDefault(); getPlayer()?.toggle(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); }
      if (e.key === 'Backspace' || e.key === 'Delete') deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="editor">
      <div className="topbar">
        <button className="icon-btn" aria-label="Cerrar" onClick={() => { getPlayer()?.pause(); onClose(); }}>
          <Icon name="close" />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name}
        </div>
        <button className="export-btn" disabled={projectDuration(project) <= 0} onClick={() => { getPlayer()?.pause(); setExporting(true); }}>
          <Icon name="export" size={16} />Exportar
        </button>
      </div>
      <Preview />
      <PlayBar />
      <div className="bottom">
        <Timeline />
        <Toolbar />
        {sheet && <SheetHost />}
      </div>
      {exporting && <ExportFlow onClose={() => setExporting(false)} />}
      {busy && <div className="busy"><div><span className="spinner" />{busy}</div></div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function PlayBar() {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const project = useEditor((s) => s.project)!;
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { undo, redo } = useEditor.getState();
  const dur = projectDuration(project);
  return (
    <div className="playbar">
      <div className="time"><b>{formatTime(time)}</b> / {formatTime(dur)}</div>
      <button className="play-btn" aria-label={playing ? 'Pausa' : 'Reproducir'} onClick={() => getPlayer()?.toggle()}>
        <Icon name={playing ? 'pause' : 'play'} size={28} fill />
      </button>
      <div className="right">
        <button className="icon-btn" aria-label="Deshacer" disabled={!canUndo} onClick={undo}><Icon name="undo" size={22} /></button>
        <button className="icon-btn" aria-label="Rehacer" disabled={!canRedo} onClick={redo}><Icon name="redo" size={22} /></button>
      </div>
    </div>
  );
}
