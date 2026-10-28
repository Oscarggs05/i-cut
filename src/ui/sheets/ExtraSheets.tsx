import { useState } from 'react';
import type { MediaClip } from '../../types';
import { useEditor } from '../../store/editor';
import { findSelected, updateSelected } from '../../store/actions';
import { CAPTION_LANGS, CAPTION_MODELS, captionClips, transcribe, type CaptionProgress } from '../../media/captions';
import { projectDuration } from '../../engine/timeline';
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

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const remaining = (s: number) => s < 60 ? `~${Math.max(5, Math.ceil(s / 5) * 5)} s` : `~${Math.round(s / 60)} min`;

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
      // Whisper can run a little past the end; don't let captions make the
      // video longer than the footage.
      const p = S().project!;
      const end = projectDuration({ ...p, texts: p.texts.filter((t) => !t.caption) });
      const clips = captionClips(segs, words)
        .filter((c) => c.start < end - 0.05)
        .map((c) => ({ ...c, duration: Math.min(c.duration, end - c.start) }));
      S().update((d) => { d.texts = [...d.texts.filter((t) => !t.caption), ...clips]; });
      S().showToast(`${clips.length} subtítulos añadidos`);
      S().setSheet(null);
    } catch (e) {
      setErr(`${(e as Error).message}. La primera vez hace falta conexión para descargar el modelo.`);
    } finally {
      setProg(null);
    }
  };

  const pct = (f: number) => `${Math.floor(f * 100)} %`;
  const [label, detail] = !prog ? ['', '']
    : prog.stage === 'audio' ? ['Preparando audio…', '']
      : prog.stage === 'download' ? [`Descargando modelo · ${pct(prog.fraction)}`, `${(prog.mb ?? 0).toFixed(0)} de ${(prog.totalMb ?? 0).toFixed(0)} MB · solo la primera vez`]
        : prog.stage === 'loading' ? ['Cargando el modelo…', '']
          : [`Transcribiendo · ${pct(prog.fraction)}`, `${clock(prog.done ?? 0)} de ${clock(prog.total ?? 0)} de voz · ${prog.eta === undefined ? 'calculando tiempo restante…' : `quedan ${remaining(prog.eta)}`}`];
  const bar = !prog ? 0 : prog.stage === 'loading' ? 1 : prog.stage === 'audio' ? 0.02 : prog.fraction;

  return (
    <Sheet title="Subtítulos automáticos">
      <div className="hint">Idioma</div>
      <Chips options={CAPTION_LANGS} value={lang} onChange={setLang} />
      <div className="hint">Modelo</div>
      <Chips options={CAPTION_MODELS.map((m) => ({ id: m.id, label: m.label }))} value={model} onChange={setModel} />
      <Slider label="Palabras/línea" min={1} max={10} step={1} value={words} onChange={setWords} />
      {prog ? (
        <>
          <div className="progress"><div style={{ width: `${Math.min(100, bar * 100)}%` }} /></div>
          <p className="hint" style={{ color: 'var(--text)', marginBottom: 0 }}>{label}</p>
          {detail && <p className="hint" style={{ marginTop: 2 }}>{detail}</p>}
        </>
      ) : (
        <button className="btn primary block" onClick={run}>{hasCaptions ? 'Volver a generar' : 'Generar subtítulos'}</button>
      )}
      {err && <p className="hint" style={{ color: 'var(--danger)' }}>{err}</p>}
      <p className="hint">Usa Whisper directamente en el iPhone: tu audio no sale del dispositivo. El modelo se descarga una vez y queda guardado. «Preciso» comete la mitad de errores que «Rápido» pero tarda unas dos veces más.</p>
    </Sheet>
  );
}
