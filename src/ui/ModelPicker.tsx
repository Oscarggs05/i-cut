import { useEffect, useState } from 'react';
import { SPEECH_MODELS, cachedModels, deleteModel, hasWebGpu, isMobile, saveModel, type CachedModel, type SpeechModel } from '../media/models';
import './ModelPicker.css';

const size = (mb: number) => mb >= 1000 ? `${(mb / 1000).toFixed(1).replace('.', ',')} GB` : `${Math.round(mb)} MB`;

const GROUPS = [
  { id: 'mobile', title: 'Para móvil' },
  { id: 'pc', title: 'Para PC' },
] as const;

/**
 * Speech model choice for captions and filler removal, grouped by the device
 * they suit, with their download size. Downloaded models can be deleted.
 * `busy` changes when a transcription ends, so the cache list is refreshed.
 */
export function ModelPicker({ value, onChange, busy }: { value: SpeechModel; onChange: (m: SpeechModel) => void; busy?: boolean }) {
  const [cached, setCached] = useState<CachedModel[]>([]);
  const [gpu, setGpu] = useState<boolean | null>(null);
  const mobile = isMobile();
  const refresh = () => { cachedModels().then(setCached).catch(() => setCached([])); };
  useEffect(() => { if (!busy) refresh(); }, [busy]);
  useEffect(() => { hasWebGpu().then(setGpu); }, []);

  const pick = (m: SpeechModel) => { saveModel(m.key); onChange(m); };
  const remove = async (m: SpeechModel, mb: number) => {
    if (!confirm(`¿Borrar ${m.name} (${size(mb)})? Tendrás que volver a descargarlo para usarlo.`)) return;
    await deleteModel(m);
    refresh();
  };

  return (
    <div className="model-picker">
      {GROUPS.map((g) => (
        <div key={g.id} className="mp-group">
          <div className="mp-head">{g.title}</div>
          {g.id === 'pc' && (
            <p className="hint mp-sub">
              {mobile ? 'Necesitan mucha memoria: en un móvil la app puede cerrarse. Úsalos en un ordenador.'
                : gpu === null ? '' : gpu ? 'Usan la tarjeta gráfica de tu ordenador (WebGPU).'
                  : 'Tu navegador no tiene WebGPU: irán por CPU y tardarán mucho. Usa Chrome o Edge actualizados.'}
            </p>
          )}
          {SPEECH_MODELS.filter((m) => m.group === g.id).map((m) => {
            const c = cached.find((x) => x.key === m.key);
            const on = m.key === value.key;
            return (
              <div key={m.key} className={`mp-item ${on ? 'on' : ''}`}>
                <button className="mp-main" onClick={() => pick(m)} disabled={busy} aria-pressed={on}>
                  <span className="mp-radio" />
                  <span className="mp-text">
                    <span className="mp-name">{m.name}</span>
                    <span className="mp-meta">
                      {c?.complete ? `Descargado · ${size(c.mb)}` : `Descarga de ${size(m.mb)}`}
                    </span>
                    {m.note && <span className="mp-note">{m.note}</span>}
                  </span>
                </button>
                {c && !busy && (
                  <button className="mp-del" onClick={() => remove(m, c.mb)} aria-label={`Borrar ${m.name}`} title="Borrar del dispositivo">Borrar</button>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {mobile && value.group === 'pc' && (
        <p className="hint mp-warn">Has elegido un modelo para PC. En el móvil puede tardar mucho o cerrarse por falta de memoria.</p>
      )}
    </div>
  );
}
