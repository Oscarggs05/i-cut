import { useState } from 'react';
import type { MediaClip } from '../../types';
import { useEditor } from '../../store/editor';
import { findSelected, updateSelected } from '../../store/actions';
import { CAPTION_LANGS, CAPTION_MODELS, captionClips, transcribe, type CaptionProgress } from '../../media/captions';
import { Chips, Sheet, Slider, Swatches, Toggle } from '../controls';

const S = () => useEditor.getState();

export function ChromaSheet() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const c = findSelected(project, selection) as MediaClip | null;
  if (!c || c.type !== 'media') return null;
  const ck = c.chroma;
  return (
    <Sheet title="Croma (pantalla verde)">
      <Toggle label="Quitar fondo de color" on={!!ck} onChange={(on) => updateSelected<MediaClip>((x) => { x.chroma = on ? { color: '#00ff00', similarity: 0.12, smoothness: 0.08 } : null; })} />
      {ck && (
        <>
          <Swatches colors={['#00ff00', '#00b140', '#0047bb', '#0000ff', '#ffffff', '#000000']} value={ck.color} onChange={(col) => updateSelected<MediaClip>((x) => { if (x.chroma) x.chroma.color = col; })} />
          <Slider label="Intensidad" min={0} max={0.5} value={ck.similarity} onChange={(v) => updateSelected<MediaClip>((x) => { if (x.chroma) x.chroma.similarity = v; }, 'cks')} format={(v) => `${Math.round(v * 200)}`} />
          <Slider label="Suavizado" min={0} max={0.3} value={ck.smoothness} onChange={(v) => updateSelected<MediaClip>((x) => { if (x.chroma) x.chroma.smoothness = v; }, 'ckm')} format={(v) => `${Math.round(v * 333)}`} />
        </>
      )}
      <p className="hint">Úsalo en una superposición grabada con fondo verde o azul para poner a la persona sobre tu vídeo.</p>
    </Sheet>
  );
}

export function CaptionsSheet() {
  const [model, setModel] = useState(CAPTION_MODELS[0].id);
  const [lang, setLang] = useState('spanish');
  const [words, setWords] = useState(4);
  const [prog, setProg] = useState<CaptionProgress | null>(null);
  const [err, setErr] = useState('');
  const hasCaptions = useEditor((s) => s.project!.texts.some((t) => t.caption));

  const run = async () => {
    setErr('');
    setProg({ stage: 'audio', fraction: 0 });
    try {
      const segs = await transcribe(S().project!, model, lang, setProg);
      if (!segs.length) { setErr('No se ha detectado voz en el audio.'); return; }
      const clips = captionClips(segs, words);
      S().update((d) => { d.texts = [...d.texts.filter((t) => !t.caption), ...clips]; });
      S().showToast(`${clips.length} subtítulos añadidos`);
      S().setSheet(null);
    } catch (e) {
      setErr(`${(e as Error).message}. La primera vez hace falta conexión para descargar el modelo.`);
    } finally {
      setProg(null);
    }
  };

  const label = prog
    ? prog.stage === 'audio' ? 'Preparando audio…'
      : prog.stage === 'download' ? `Descargando modelo… ${Math.round(prog.fraction * 100)}%`
        : 'Transcribiendo en tu iPhone…'
    : '';

  return (
    <Sheet title="Subtítulos automáticos">
      <div className="hint">Idioma</div>
      <Chips options={CAPTION_LANGS} value={lang} onChange={setLang} />
      <div className="hint">Modelo</div>
      <Chips options={CAPTION_MODELS.map((m) => ({ id: m.id, label: m.label }))} value={model} onChange={setModel} />
      <Slider label="Palabras/línea" min={1} max={10} step={1} value={words} onChange={setWords} />
      {prog ? (
        <>
          <div className="progress"><div style={{ width: `${prog.stage === 'download' ? Math.round(prog.fraction * 100) : prog.stage === 'transcribing' ? 100 : 5}%` }} /></div>
          <p className="hint">{label}</p>
        </>
      ) : (
        <button className="btn primary block" onClick={run}>{hasCaptions ? 'Volver a generar' : 'Generar subtítulos'}</button>
      )}
      {err && <p className="hint" style={{ color: 'var(--danger)' }}>{err}</p>}
      <p className="hint">Beta. Usa Whisper directamente en el iPhone: tu audio no sale del dispositivo. El modelo se descarga una vez y queda guardado.</p>
    </Sheet>
  );
}
