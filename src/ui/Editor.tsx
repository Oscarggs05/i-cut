import { useEffect, useState } from 'react';
import { useEditor, getPlayer } from '../store/editor';
import { deleteSelected, duplicateSelected, splitAtPlayhead } from '../store/actions';
import { formatTime, projectDuration } from '../engine/timeline';
import { Icon } from './icons';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import { SheetHost } from './sheets/SheetHost';
import { ExportFlow } from './ExportFlow';
import { JobOverlay, KeyframeButton } from './sheets/MotionSheets';

export function Editor({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const sheet = useEditor((s) => s.sheet);
  const busy = useEditor((s) => s.busy);
  const toast = useEditor((s) => s.toast);
  const [exporting, setExporting] = useState(false);

  // Keyboard shortcuts for a Mac, a PC, or an iPad with a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable) return;
      const s = useEditor.getState();
      if (s.busy || document.querySelector('.modal-back')) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const seek = (t: number) => {
        const player = getPlayer();
        const dur = projectDuration(s.project!);
        const nt = Math.max(0, Math.min(dur, t));
        player?.pause();
        player?.seek(nt);
        s.setTime(nt, false);
      };
      const frame = 1 / 30;
      if (e.key === ' ') { e.preventDefault(); getPlayer()?.toggle(); }
      else if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); }
      else if (mod && key === 'y') { e.preventDefault(); s.redo(); }
      else if (mod && key === 'd') { e.preventDefault(); if (s.selection) duplicateSelected(); }
      else if (mod && key === 'b') { e.preventDefault(); splitAtPlayhead(); }
      else if (mod || e.altKey) return;
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelected(); }
      else if (key === 's') splitAtPlayhead();
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(s.time - (e.shiftKey ? 1 : frame)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(s.time + (e.shiftKey ? 1 : frame)); }
      else if (e.key === 'Home') { e.preventDefault(); seek(0); }
      else if (e.key === 'End') { e.preventDefault(); seek(projectDuration(s.project!)); }
      else if (e.key === '+' || e.key === '=') s.setZoom(s.pxPerSec * 1.25);
      else if (e.key === '-' || e.key === '_') s.setZoom(s.pxPerSec / 1.25);
      else if (e.key === 'Escape') { if (s.sheet) s.setSheet(null); else s.select(null); }
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
        {sheet ? <SheetHost /> : <SideHint />}
      </div>
      {exporting && <ExportFlow onClose={() => setExporting(false)} />}
      <JobOverlay />
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
      <button className="play-btn" aria-label={playing ? 'Pausa' : 'Reproducir'} title={playing ? 'Pausa (Espacio)' : 'Reproducir (Espacio)'} onClick={() => getPlayer()?.toggle()}>
        <Icon name={playing ? 'pause' : 'play'} size={28} fill />
      </button>
      <div className="right">
        <KeyframeButton />
        <button className="icon-btn" aria-label="Deshacer" title="Deshacer (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Icon name="undo" size={22} /></button>
        <button className="icon-btn" aria-label="Rehacer" title="Rehacer (Ctrl+Y)" disabled={!canRedo} onClick={redo}><Icon name="redo" size={22} /></button>
      </div>
    </div>
  );
}

/** Fills the properties panel on desktop while no sheet is open; hidden on phones. */
function SideHint() {
  return (
    <div className="side-empty">
      <h4>Propiedades</h4>
      <div>Elige una herramienta de la izquierda o un clip de la línea de tiempo para editarlo aquí.</div>
      <div className="keys">
        <kbd>Espacio</kbd><span>Reproducir o pausar</span>
        <kbd>← →</kbd><span>Fotograma a fotograma (Mayús: 1 s)</span>
        <kbd>S</kbd><span>Dividir en el cabezal</span>
        <kbd>Supr</kbd><span>Eliminar selección</span>
        <kbd>Ctrl+D</kbd><span>Duplicar</span>
        <kbd>Ctrl+Z</kbd><span>Deshacer (Ctrl+Y rehacer)</span>
        <kbd>+ −</kbd><span>Zoom de la línea de tiempo</span>
        <kbd>Esc</kbd><span>Cerrar panel o deseleccionar</span>
      </div>
      <div>En la línea de tiempo: arrastra un clip para moverlo, la rueda desplaza y Ctrl + rueda hace zoom.</div>
    </div>
  );
}
