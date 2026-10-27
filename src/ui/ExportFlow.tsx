import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editor';
import { estimateSize, exportProject, supportsWebCodecs, type ExportOptions, type ExportResult, type Quality } from '../engine/export';
import { aspectRatio, formatTime, outputSize, projectDuration } from '../engine/timeline';
import { Chips } from './controls';
import { Icon } from './icons';

const KEY = 'i-cut:export';

function loadOpts(): ExportOptions {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '');
    if (o && o.shortSide && o.fps && o.quality) return o;
  } catch { /* defaults */ }
  return { shortSide: 1080, fps: 30, quality: 'high' };
}

function fmtSize(b: number) {
  return b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.max(0.1, b / 1e6).toFixed(1)} MB`;
}

type WakeLock = { release: () => Promise<void> };

export function ExportFlow({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const [opts, setOpts] = useState<ExportOptions>(loadOpts);
  const [phase, setPhase] = useState<'setup' | 'running' | 'done' | 'error'>('setup');
  const [progress, setProgress] = useState({ f: 0, stage: '' });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const wake = useRef<WakeLock | null>(null);
  const startedAt = useRef(0);

  useEffect(() => () => { abort.current?.abort(); if (url) URL.revokeObjectURL(url); void wake.current?.release(); }, [url]);

  const ratio = aspectRatio(project);
  const size = outputSize(ratio, opts.shortSide);
  const dur = projectDuration(project);
  const set = (o: Partial<ExportOptions>) => {
    const n = { ...opts, ...o };
    setOpts(n);
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ }
  };

  const run = async () => {
    setPhase('running');
    startedAt.current = performance.now();
    abort.current = new AbortController();
    try {
      wake.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<WakeLock> } }).wakeLock?.request('screen') ?? null;
    } catch { /* not available */ }
    try {
      const r = await exportProject(project, opts, (f, stage) => setProgress({ f, stage }), abort.current.signal);
      setResult(r);
      setUrl(URL.createObjectURL(r.blob));
      setPhase('done');
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') { onClose(); return; }
      console.error(e);
      setError((e as Error).message || String(e));
      setPhase('error');
    } finally {
      void wake.current?.release();
      wake.current = null;
    }
  };

  const fileName = () => `${project.name.replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'i-cut'}.${result?.ext ?? 'mp4'}`;

  const share = async () => {
    if (!result) return;
    const file = new File([result.blob], fileName(), { type: result.mime });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], title: project.name }); } catch { /* cancelled */ }
    } else download();
  };

  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const eta = () => {
    if (progress.f < 0.03) return '';
    const el = (performance.now() - startedAt.current) / 1000;
    return `· quedan ~${formatTime((el / progress.f) * (1 - progress.f))}`;
  };

  return (
    <div className="modal-back" onClick={() => phase === 'setup' && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {phase === 'setup' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Exportar</h3>
              <button className="icon-btn" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button>
            </div>
            <div className="hint">Resolución</div>
            <Chips options={[480, 720, 1080, 1440, 2160].map((r) => ({ id: r, label: r === 1440 ? '2K' : r === 2160 ? '4K' : `${r}p` }))} value={opts.shortSide} onChange={(r) => set({ shortSide: r })} />
            <div className="hint">Fotogramas por segundo</div>
            <Chips options={[24, 25, 30, 50, 60].map((r) => ({ id: r, label: `${r}` }))} value={opts.fps} onChange={(r) => set({ fps: r })} />
            <div className="hint">Calidad</div>
            <Chips options={[{ id: 'low', label: 'Ligera' }, { id: 'medium', label: 'Recomendada' }, { id: 'high', label: 'Alta' }] as { id: Quality; label: string }[]} value={opts.quality} onChange={(q) => set({ quality: q })} />
            <p className="hint" style={{ marginTop: 14 }}>
              {size.width}×{size.height} · {formatTime(dur)} · ≈ {fmtSize(estimateSize(project, opts))}<br />
              {supportsWebCodecs()
                ? 'Codificación por hardware del iPhone (H.264). Sin marca de agua.'
                : 'Tu navegador no tiene WebCodecs: se grabará en tiempo real (máx. 1080p). Actualiza a iOS 16.4+ para exportar más rápido.'}
            </p>
            <button className="btn primary block" style={{ marginTop: 8 }} onClick={run}><Icon name="export" size={18} />Exportar vídeo</button>
          </>
        )}
        {phase === 'running' && (
          <>
            <h3>Exportando…</h3>
            <div className="progress"><div style={{ width: `${Math.round(progress.f * 100)}%` }} /></div>
            <p className="hint">{Math.round(progress.f * 100)}% · {progress.stage} {eta()}</p>
            <p className="hint">Mantén la app abierta y la pantalla encendida hasta que termine.</p>
            <button className="btn block" onClick={() => abort.current?.abort()}>Cancelar</button>
          </>
        )}
        {phase === 'done' && result && url && (
          <>
            <h3>¡Listo! 🎉</h3>
            <video className="result-video" src={url} controls playsInline loop />
            <p className="hint">{result.width}×{result.height} · {fmtSize(result.blob.size)}</p>
            <button className="btn primary block" onClick={share}><Icon name="share" size={18} />Guardar en Fotos / Compartir</button>
            <div className="btn-row">
              <button className="btn" onClick={download}><Icon name="download" size={18} />Descargar</button>
              <button className="btn" onClick={onClose}>Hecho</button>
            </div>
            <p className="hint">En el menú de compartir elige «Guardar vídeo» para tenerlo en tu carrete.</p>
          </>
        )}
        {phase === 'error' && (
          <>
            <h3>No se pudo exportar</h3>
            <p className="hint">{error}</p>
            <p className="hint">Prueba con una resolución menor o menos fotogramas por segundo. En iPhone, los vídeos muy largos en 4K pueden agotar la memoria.</p>
            <div className="btn-row">
              <button className="btn" onClick={() => setPhase('setup')}>Volver</button>
              <button className="btn" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
