import { useState } from 'react';
import type { AudioClip, MediaClip } from '../../types';
import { useEditor } from '../../store/editor';
import { findSelected, updateSelected } from '../../store/actions';
import { library } from '../../media/library';
import { VOICES, pitched, voicePitch } from '../../engine/voice';
import { applyCuts, captionWords, findCuts } from '../../media/cleanup';
import { CAPTION_LANGS, CAPTION_MODELS, type CaptionProgress } from '../../media/captions';
import { Chips, Sheet, Slider, Toggle } from '../controls';
import { TranscribeProgress } from './ExtraSheets';

const S = () => useEditor.getState();

/** Prepares the stretched audio a pitch voice plays, so the preview doesn't stall on it. */
async function prepareVoice(assetIds: string[], id: string) {
  const r = voicePitch(id);
  if (r === 1) return;
  const p = S().project!;
  S().setBusy('Aplicando voz…');
  try {
    for (const aid of new Set(assetIds)) {
      const a = p.assets.find((x) => x.id === aid);
      const buf = a ? await library.audioBuffer(a) : null;
      // Let the busy overlay paint before the work blocks the page.
      await new Promise((res) => setTimeout(res, 30));
      if (buf) pitched(buf, r);
    }
  } finally {
    S().setBusy(null);
  }
}

export function VoiceSheet() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const c = findSelected(project, selection);
  if (!c || c.type === 'text') return null;
  const cur = c.voice ?? 'none';
  const pick = async (id: string) => {
    await prepareVoice([c.assetId], id);
    updateSelected<MediaClip | AudioClip>((x) => { x.voice = id === 'none' ? undefined : id; });
  };
  const all = async () => {
    const withSound = (m: MediaClip) => project.assets.find((a) => a.id === m.assetId)?.hasAudio;
    await prepareVoice(project.main.filter(withSound).map((m) => m.assetId), cur);
    S().update((d) => { for (const m of d.main) m.voice = cur === 'none' ? undefined : cur; });
    S().showToast('Voz aplicada a todos los clips');
  };
  return (
    <Sheet title="Cambiador de voz">
      <div className="grid">
        {VOICES.map((v) => (
          <button key={v.id} className={`cell ${cur === v.id ? 'on' : ''}`} onClick={() => void pick(v.id)}>
            <span className="sw">{v.icon}</span>{v.name}
          </button>
        ))}
      </div>
      {c.type === 'media' && <button className="btn block" style={{ marginTop: 12 }} onClick={() => void all()}>Aplicar a todos los clips</button>}
      <p className="hint">Cambia el tono sin cambiar la duración. Se oye igual en la vista previa y en el vídeo exportado, y los subtítulos automáticos siguen usando la voz original.</p>
    </Sheet>
  );
}

export function CleanupSheet() {
  const project = useEditor((s) => s.project)!;
  const [fillers, setFillers] = useState(false);
  const [minPause, setMinPause] = useState(0.5);
  const [margin, setMargin] = useState(0.12);
  const [fillerWords, setFillerWords] = useState(false);
  const [model, setModel] = useState(CAPTION_MODELS[0].id);
  const [lang, setLang] = useState('spanish');
  const [prog, setProg] = useState<CaptionProgress | null>(null);
  const [err, setErr] = useState('');
  const known = !!captionWords(project);

  const run = async () => {
    setErr('');
    setProg({ stage: 'audio', fraction: 0 });
    try {
      const ranges = await findCuts(S().project!, { minPause, margin, fillers, fillerWords, model, language: lang }, setProg);
      // Try on a copy first so "nothing found" doesn't leave an empty undo step.
      const r = applyCuts(structuredClone(S().project!), ranges);
      if (!r.cuts) { setErr(fillers ? 'No se han encontrado pausas ni muletillas.' : 'No se han encontrado pausas. Prueba con una pausa mínima más corta.'); return; }
      S().update((d) => { applyCuts(d, ranges); });
      S().showToast(`${r.cuts === 1 ? '1 corte' : `${r.cuts} cortes`} · ${r.seconds.toFixed(1)} s menos. Puedes deshacerlo.`);
      S().setSheet(null);
    } catch (e) {
      setErr(`${(e as Error).message}. La primera vez hace falta conexión para descargar el modelo.`);
    } finally {
      setProg(null);
    }
  };

  return (
    <Sheet title="Quitar silencios">
      <Chips options={[{ id: 'pauses', label: 'Silencios' }, { id: 'fillers', label: 'Silencios y muletillas' }]} value={fillers ? 'fillers' : 'pauses'} onChange={(v) => setFillers(v === 'fillers')} />
      <Slider label="Pausa mínima" min={0.2} max={2} step={0.05} value={minPause} onChange={setMinPause} format={(v) => `${v.toFixed(2)} s`} />
      <Slider label="Margen" min={0} max={0.4} step={0.01} value={margin} onChange={setMargin} format={(v) => `${v.toFixed(2)} s`} />
      {fillers && (
        <>
          <Toggle label="También «o sea», «bueno», «pues»…" on={fillerWords} onChange={setFillerWords} />
          {known ? <p className="hint">Se usarán las palabras de tus subtítulos, sin volver a transcribir.</p> : (
            <>
              <div className="hint">Idioma</div>
              <Chips options={CAPTION_LANGS} value={lang} onChange={setLang} />
              <div className="hint">Modelo</div>
              <Chips options={CAPTION_MODELS.map((m) => ({ id: m.id, label: m.label }))} value={model} onChange={setModel} />
            </>
          )}
        </>
      )}
      {prog ? <TranscribeProgress prog={prog} /> : <button className="btn primary block" onClick={run}>Quitar</button>}
      {err && <p className="hint" style={{ color: 'var(--danger)' }}>{err}</p>}
      <p className="hint">Corta las pausas de la voz en los clips de la pista principal. Los textos, subtítulos, superposiciones y la música se recolocan para seguir sincronizados. Las muletillas (eh, mmm, ehm…) se detectan con el reconocimiento de voz en el iPhone.</p>
    </Sheet>
  );
}
