import type { SheetId } from '../store/editor';
import { useEditor } from '../store/editor';
import {
  addMedia, addText, deleteSelected, duplicateSelected, extractAudio, findSelected, freezeFrame,
  mainIndexAt, pickFiles, splitAtPlayhead, updateSelected,
} from '../store/actions';
import type { MediaClip } from '../types';
import { Icon } from './icons';

interface Tool { id: string; label: string; icon: string; run: () => void; danger?: boolean; hidden?: boolean }

const S = () => useEditor.getState();
const open = (s: SheetId) => () => S().setSheet(s);

/** Selects the main clip under the playhead and opens a sheet for it. */
const onMainAtPlayhead = (s: SheetId) => () => {
  const p = S().project!;
  if (!p.main.length) { S().showToast('Añade un vídeo primero'); return; }
  const i = mainIndexAt(p, S().time);
  S().select({ kind: 'main', id: p.main[i].id });
  S().setSheet(s);
};

export function Toolbar() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const sel = findSelected(project, selection);
  let tools: Tool[];

  if (!sel || selection?.kind === 'transition') {
    tools = [
      { id: 'edit', label: 'Editar', icon: 'scissors', run: () => {
        const p = S().project!;
        if (!p.main.length) return;
        S().select({ kind: 'main', id: p.main[mainIndexAt(p, S().time)].id });
      } },
      { id: 'audio', label: 'Audio', icon: 'music', run: open('audio') },
      { id: 'text', label: 'Texto', icon: 'text', run: () => { addText(); S().setSheet('text'); } },
      { id: 'captions', label: 'Subtítulos', icon: 'wand', run: () => {
        if (!S().project!.main.length) { S().showToast('Añade un vídeo primero'); return; }
        S().setSheet('captions');
      } },
      { id: 'cleanup', label: 'Silencios', icon: 'silence', run: () => {
        if (!S().project!.main.length) { S().showToast('Añade un vídeo primero'); return; }
        S().setSheet('cleanup');
      } },
      { id: 'stickers', label: 'Stickers', icon: 'sticker', run: open('stickers') },
      { id: 'overlay', label: 'Superponer', icon: 'layers', run: async () => addMedia(await pickFiles('video/*,image/*'), 'overlay') },
      { id: 'effects', label: 'Efectos', icon: 'sparkles', run: onMainAtPlayhead('effects') },
      { id: 'filters', label: 'Filtros', icon: 'filter', run: onMainAtPlayhead('filters') },
      { id: 'adjust', label: 'Ajustar', icon: 'sliders', run: onMainAtPlayhead('adjust') },
      { id: 'canvas', label: 'Formato', icon: 'aspect', run: open('canvas') },
      { id: 'bg', label: 'Fondo', icon: 'bg', run: open('background') },
    ];
  } else if (sel.type === 'media') {
    const asset = project.assets.find((a) => a.id === sel.assetId);
    const isVideo = asset?.kind === 'video';
    const isMain = selection?.kind === 'main';
    tools = [
      { id: 'split', label: 'Dividir', icon: 'scissors', run: splitAtPlayhead },
      { id: 'speed', label: 'Velocidad', icon: 'speed', run: open('speed'), hidden: !isVideo },
      { id: 'duration', label: 'Duración', icon: 'clock', run: open('duration'), hidden: isVideo },
      { id: 'volume', label: 'Volumen', icon: 'volume', run: open('volume'), hidden: !isVideo || !asset?.hasAudio },
      { id: 'voice', label: 'Voz', icon: 'voice', run: open('voice'), hidden: !isVideo || !asset?.hasAudio },
      { id: 'anim', label: 'Animación', icon: 'anim', run: open('animation') },
      { id: 'filters', label: 'Filtros', icon: 'filter', run: open('filters') },
      { id: 'adjust', label: 'Ajustar', icon: 'sliders', run: open('adjust') },
      { id: 'effects', label: 'Efectos', icon: 'sparkles', run: open('effects') },
      { id: 'transform', label: 'Transformar', icon: 'crop', run: open('transform') },
      { id: 'opacity', label: 'Opacidad', icon: 'opacity', run: open('opacity') },
      { id: 'chroma', label: 'Croma', icon: 'image', run: open('chroma') },
      { id: 'mute', label: (sel as MediaClip).muted ? 'Activar' : 'Silenciar', icon: (sel as MediaClip).muted ? 'volume' : 'mute', run: () => updateSelected<MediaClip>((c) => { c.muted = !c.muted; }), hidden: !isVideo || !asset?.hasAudio },
      { id: 'extract', label: 'Extraer audio', icon: 'extract', run: extractAudio, hidden: !isVideo || !asset?.hasAudio },
      { id: 'freeze', label: 'Congelar', icon: 'freeze', run: () => void freezeFrame(), hidden: !isVideo || !isMain },
      { id: 'dup', label: 'Duplicar', icon: 'copy', run: duplicateSelected },
      { id: 'del', label: 'Eliminar', icon: 'trash', run: deleteSelected, danger: true },
    ];
  } else if (sel.type === 'text') {
    tools = [
      { id: 'edit', label: 'Editar', icon: 'edit', run: open('text') },
      { id: 'style', label: 'Estilo', icon: 'palette', run: open('textStyle') },
      { id: 'tpl', label: 'Plantillas', icon: 'sparkles', run: open('textTemplates'), hidden: sel.sticker },
      { id: 'anim', label: 'Animación', icon: 'anim', run: open('animation') },
      { id: 'effects', label: 'Efectos', icon: 'sparkles', run: open('effects') },
      { id: 'opacity', label: 'Opacidad', icon: 'opacity', run: open('opacity') },
      { id: 'split', label: 'Dividir', icon: 'scissors', run: splitAtPlayhead },
      { id: 'dup', label: 'Duplicar', icon: 'copy', run: duplicateSelected },
      { id: 'del', label: 'Eliminar', icon: 'trash', run: deleteSelected, danger: true },
    ];
  } else {
    tools = [
      { id: 'volume', label: 'Volumen', icon: 'volume', run: open('volume') },
      { id: 'speed', label: 'Velocidad', icon: 'speed', run: open('speed') },
      { id: 'voice', label: 'Voz', icon: 'voice', run: open('voice') },
      { id: 'split', label: 'Dividir', icon: 'scissors', run: splitAtPlayhead },
      { id: 'dup', label: 'Duplicar', icon: 'copy', run: duplicateSelected },
      { id: 'del', label: 'Eliminar', icon: 'trash', run: deleteSelected, danger: true },
    ];
  }

  return (
    <div className="toolbar">
      <div className="tools">
        {sel && selection?.kind !== 'transition' && (
          <button className="tool back" aria-label="Volver" onClick={() => S().select(null)}><Icon name="back" /></button>
        )}
        {tools.filter((t) => !t.hidden).map((t) => (
          <button key={t.id} className={`tool ${t.danger ? 'danger' : ''}`} onClick={t.run}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
