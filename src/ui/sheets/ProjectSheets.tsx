import { useEffect, useRef, useState } from 'react';
import type { AspectId, MediaClip } from '../../types';
import { getPlayer, useEditor } from '../../store/editor';
import { addAudioFiles, addRecording, pickFiles } from '../../store/actions';
import { ASPECTS, clampTransition, formatTime, newAudioClip } from '../../engine/timeline';
import { COLORS, TRANSITIONS } from '../../engine/presets';
import { library } from '../../media/library';
import { SFX, makeSfx } from '../../media/sfx';
import { Chips, Sheet, Slider, Swatches } from '../controls';
import { Icon } from '../icons';

const S = () => useEditor.getState();

export function TransitionSheet() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const i = project.main.findIndex((c) => c.id === selection?.id);
  const c = project.main[i];
  if (!c || i >= project.main.length - 1) return <Sheet title="Transición"><p className="hint">Selecciona la unión entre dos clips.</p></Sheet>;
  const cur = c.transition?.id ?? 'none';
  const dur = c.transition?.duration ?? 0.5;
  const max = Math.max(0.1, Math.min(2, clampTransition({ ...c, transition: { id: 'fade', duration: 99 } } as MediaClip, project.main[i + 1])));
  const set = (fn: (x: MediaClip) => void, key?: string) => S().update((d) => { const x = d.main.find((m) => m.id === c.id); if (x) fn(x); }, key);
  return (
    <Sheet title="Transición">
      <div className="grid">
        {TRANSITIONS.map((t) => (
          <button key={t.id} className={`cell ${cur === t.id ? 'on' : ''}`}
            onClick={() => { set((x) => { x.transition = t.id === 'none' ? null : { id: t.id, duration: x.transition?.duration ?? Math.min(0.5, max) }; }); getPlayer()?.seek(Math.max(0, S().time)); }}>
            <span className="sw">{t.icon}</span>{t.name}
          </button>
        ))}
      </div>
      {cur !== 'none' && (
        <Slider label="Duración" min={0.1} max={max} step={0.05} value={Math.min(dur, max)} onChange={(v) => set((x) => { if (x.transition) x.transition.duration = v; }, c.id + ':tdur')} format={(v) => `${v.toFixed(1)}s`} />
      )}
      <button className="btn block" onClick={() => {
        S().update((d) => { d.main.forEach((m, k) => { if (k < d.main.length - 1) m.transition = cur === 'none' ? null : { id: cur, duration: dur }; }); });
        S().showToast('Aplicada a todas las uniones');
      }}>Aplicar a todas</button>
    </Sheet>
  );
}

export function CanvasSheet() {
  const project = useEditor((s) => s.project)!;
  return (
    <Sheet title="Formato">
      <div className="hscroll">
        {ASPECTS.map((a) => {
          const r = a.ratio ?? 0.8;
          const w = r >= 1 ? 40 : 40 * r, h = r >= 1 ? 40 / r : 40;
          return (
            <button key={a.id} className={`cell ${project.aspect === a.id ? 'on' : ''}`} onClick={() => S().update((d) => { d.aspect = a.id as AspectId; })}>
              <span className="sw"><span style={{ width: w, height: h, border: '2px solid currentColor', borderRadius: 4, borderStyle: a.ratio ? 'solid' : 'dashed' }} /></span>
              {a.label}
            </button>
          );
        })}
      </div>
      <p className="hint">9:16 para TikTok, Reels y Shorts · 16:9 para YouTube · 1:1 y 4:5 para publicaciones.</p>
    </Sheet>
  );
}

export function BackgroundSheet() {
  const project = useEditor((s) => s.project)!;
  const bg = project.background;
  return (
    <Sheet title="Fondo">
      <Chips options={[{ id: 'blur', label: 'Desenfoque' }, { id: 'color', label: 'Color' }]} value={bg.type}
        onChange={(t) => S().update((d) => { d.background.type = t as 'blur' | 'color'; })} />
      {bg.type === 'blur' ? (
        <Slider label="Desenfoque" min={0} max={1} value={bg.blur} onChange={(v) => S().update((d) => { d.background.blur = v; }, 'bgblur')} format={(v) => `${Math.round(v * 100)}`} />
      ) : (
        <Swatches colors={COLORS} value={bg.color} onChange={(c) => S().update((d) => { d.background.color = c; })} />
      )}
      <p className="hint">Se ve cuando el clip no llena todo el lienzo.</p>
    </Sheet>
  );
}

export function AudioSheet() {
  const [loading, setLoading] = useState<string | null>(null);
  const addSfx = async (id: string, name: string) => {
    setLoading(id);
    try {
      const blob = await makeSfx(id);
      const asset = await library.importBlob(blob, `${name}.wav`);
      const c = newAudioClip(asset, S().time);
      c.name = name;
      S().update((d) => { d.assets.push(asset); d.audios.push(c); });
      void library.audioBuffer(asset);
      S().select({ kind: 'audio', id: c.id });
    } finally {
      setLoading(null);
    }
  };
  const fromVideo = async () => {
    const files = await pickFiles('video/*', false);
    if (!files.length) return;
    S().setBusy('Extrayendo audio…');
    try {
      const asset = await library.import(files[0]);
      if (!asset.hasAudio) { S().showToast('Ese vídeo no tiene audio'); return; }
      const c = newAudioClip(asset, S().time);
      c.name = 'Audio de ' + asset.name;
      S().update((d) => { d.assets.push(asset); d.audios.push(c); });
      void library.audioBuffer(asset);
      S().select({ kind: 'audio', id: c.id });
    } catch (e) {
      S().showToast((e as Error).message);
    } finally {
      S().setBusy(null);
    }
  };
  return (
    <Sheet title="Audio">
      <div className="grid">
        <button className="cell" onClick={async () => { const f = await pickFiles('audio/*,.mp3,.m4a,.wav,.aac'); if (f.length) await addAudioFiles(f); }}>
          <span className="sw"><Icon name="music" /></span>Música
        </button>
        <button className="cell" onClick={() => S().setSheet('record')}><span className="sw"><Icon name="mic" /></span>Grabar voz</button>
        <button className="cell" onClick={fromVideo}><span className="sw"><Icon name="extract" /></span>De un vídeo</button>
      </div>
      <h4 style={{ margin: '14px 0 8px', fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Efectos de sonido</h4>
      <div className="grid">
        {SFX.map((s) => (
          <button key={s.id} className="cell" disabled={loading === s.id} onClick={() => addSfx(s.id, s.name)}>
            <span className="sw">{s.icon}</span>{s.name}
          </button>
        ))}
      </div>
      <p className="hint">«Música» abre la app Archivos: guarda allí tus MP3/M4A. Las canciones de Apple Music están protegidas y no se pueden importar.</p>
    </Sheet>
  );
}

export function RecordSheet() {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const start = useRef(0);
  const t0 = useRef(0);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => () => { rec?.stream.getTracks().forEach((t) => t.stop()); getPlayer()?.setMuted(false); }, [rec]);

  const begin = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType || mime || 'audio/mp4' });
        getPlayer()?.pause();
        getPlayer()?.setMuted(false);
        if (blob.size > 0) await addRecording(blob, start.current);
      };
      start.current = S().time;
      t0.current = performance.now();
      r.start(250);
      const p = getPlayer();
      p?.setMuted(true);
      p?.play();
      setRec(r);
      const tick = () => { if (r.state === 'recording') { setElapsed((performance.now() - t0.current) / 1000); requestAnimationFrame(tick); } };
      tick();
    } catch {
      S().showToast('Permite el acceso al micrófono en Ajustes › Safari');
    }
  };

  const stop = () => { rec?.stop(); setRec(null); };

  return (
    <Sheet title="Grabar voz" onDone={() => rec && stop()}>
      <p className="hint" style={{ textAlign: 'center' }}>{rec ? `Grabando… ${formatTime(elapsed, true)}` : `Empieza en ${formatTime(S().time)}. El vídeo se reproducirá en silencio mientras grabas.`}</p>
      <button className={`rec-btn ${rec ? 'on' : ''}`} aria-label={rec ? 'Detener' : 'Grabar'} onClick={rec ? stop : begin} />
    </Sheet>
  );
}
