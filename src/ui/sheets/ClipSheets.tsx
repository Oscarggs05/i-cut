import { useState } from 'react';
import type { Adjust, AudioClip, MediaClip, TextClip, Visual } from '../../types';
import { useEditor } from '../../store/editor';
import { findSelected, updateSelected } from '../../store/actions';
import { ANIMS_IN, ANIMS_LOOP, ANIMS_OUT, EFFECTS, FILTERS } from '../../engine/presets';
import { aspectRatio, clipDuration, defaultAdjust } from '../../engine/timeline';
import { Chips, Sheet, Slider, Toggle } from '../controls';
import { Icon } from '../icons';

const S = () => useEditor.getState();

function useSelected<T>() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  return findSelected(project, selection) as T | null;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function SpeedSheet() {
  const c = useSelected<MediaClip | AudioClip>();
  if (!c) return null;
  const v = Math.log10(c.speed);
  const set = (speed: number) => updateSelected<MediaClip | AudioClip>((x) => { x.speed = Math.max(0.1, Math.min(10, speed)); }, 'speed');
  return (
    <Sheet title="Velocidad">
      <Slider label="Velocidad" min={-1} max={1} step={0.01} value={v} onChange={(x) => set(Math.round(Math.pow(10, x) * 100) / 100)} format={() => `${c.speed.toFixed(2)}x`} />
      <Chips options={[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5].map((s) => ({ id: s, label: `${s}x` }))} value={c.speed} onChange={set} />
      <p className="hint">Duración: {clipDuration(c).toFixed(1)} s. El audio cambia de tono con la velocidad.</p>
    </Sheet>
  );
}

export function VolumeSheet() {
  const c = useSelected<MediaClip | AudioClip>();
  if (!c) return null;
  const d = clipDuration(c);
  const max = Math.max(0.1, Math.min(10, d / 2));
  return (
    <Sheet title="Volumen">
      <Slider label="Volumen" min={0} max={2} value={c.volume} onChange={(v) => updateSelected<MediaClip>((x) => { x.volume = v; x.muted = false; }, 'vol')} format={pct} />
      <Slider label="Fundido ent." min={0} max={max} step={0.1} value={Math.min(c.fadeIn, max)} onChange={(v) => updateSelected<MediaClip>((x) => { x.fadeIn = v; }, 'fi')} format={(v) => `${v.toFixed(1)}s`} />
      <Slider label="Fundido sal." min={0} max={max} step={0.1} value={Math.min(c.fadeOut, max)} onChange={(v) => updateSelected<MediaClip>((x) => { x.fadeOut = v; }, 'fo')} format={(v) => `${v.toFixed(1)}s`} />
      {c.type === 'media' && <Toggle label="Silenciar clip" on={c.muted} onChange={(m) => updateSelected<MediaClip>((x) => { x.muted = m; })} />}
    </Sheet>
  );
}

export function DurationSheet() {
  const c = useSelected<MediaClip>();
  if (!c) return null;
  return (
    <Sheet title="Duración">
      <Slider label="Duración" min={0.5} max={20} step={0.1} value={Math.min(20, c.out - c.in)} onChange={(v) => updateSelected<MediaClip>((x) => { x.out = x.in + v; }, 'dur')} format={(v) => `${v.toFixed(1)}s`} />
      <Chips options={[1, 2, 3, 5, 8, 10].map((s) => ({ id: s, label: `${s}s` }))} value={Math.round((c.out - c.in) * 10) / 10}
        onChange={(v) => updateSelected<MediaClip>((x) => { x.out = x.in + v; })} />
    </Sheet>
  );
}

function applyToAll(fn: (c: MediaClip) => void) {
  S().update((d) => { for (const c of d.main) fn(c); });
  S().showToast('Aplicado a todos los clips');
}

export function FiltersSheet() {
  const c = useSelected<MediaClip>();
  if (!c) return null;
  return (
    <Sheet title="Filtros">
      <div className="hscroll">
        {FILTERS.map((f) => (
          <button key={f.id} className={`cell ${c.filter.id === f.id ? 'on' : ''}`}
            onClick={() => updateSelected<MediaClip>((x) => { x.filter = { id: f.id, intensity: x.filter.id === f.id ? x.filter.intensity : 1 }; })}>
            <span className="sw" style={{ background: f.id === 'none' ? undefined : `linear-gradient(135deg, ${f.swatch}, #222)` }}>{f.id === 'none' ? '⊘' : ''}</span>
            {f.name}
          </button>
        ))}
      </div>
      {c.filter.id !== 'none' && (
        <Slider label="Intensidad" min={0} max={1} value={c.filter.intensity} onChange={(v) => updateSelected<MediaClip>((x) => { x.filter.intensity = v; }, 'fint')} format={pct} />
      )}
      <button className="btn block" onClick={() => { const f = { ...c.filter }; applyToAll((x) => { x.filter = { ...f }; }); }}>Aplicar a todos</button>
    </Sheet>
  );
}

const ADJ: { id: keyof Adjust; label: string; min: number }[] = [
  { id: 'brightness', label: 'Brillo', min: -100 },
  { id: 'contrast', label: 'Contraste', min: -100 },
  { id: 'saturation', label: 'Saturación', min: -100 },
  { id: 'exposure', label: 'Exposición', min: -100 },
  { id: 'temperature', label: 'Temperatura', min: -100 },
  { id: 'tint', label: 'Matiz', min: -100 },
  { id: 'highlights', label: 'Luces', min: -100 },
  { id: 'shadows', label: 'Sombras', min: -100 },
  { id: 'fade', label: 'Desvanecer', min: 0 },
  { id: 'vignette', label: 'Viñeta', min: 0 },
  { id: 'grain', label: 'Grano', min: 0 },
  { id: 'sharpen', label: 'Nitidez', min: 0 },
];

export function AdjustSheet() {
  const c = useSelected<MediaClip>();
  const [param, setParam] = useState<keyof Adjust>('brightness');
  if (!c) return null;
  const a = ADJ.find((x) => x.id === param)!;
  return (
    <Sheet title="Ajustar">
      <div className="hscroll">
        <button className="cell" onClick={() => updateSelected<MediaClip>((x) => { x.adjust = defaultAdjust(); })}>
          <span className="sw"><Icon name="reset" /></span>Restablecer
        </button>
        {ADJ.map((x) => (
          <button key={x.id} className={`cell ${param === x.id ? 'on' : ''}`} onClick={() => setParam(x.id)}>
            <span className="sw" style={{ fontSize: 13, fontWeight: 700 }}>{c.adjust[x.id] ? Math.round(c.adjust[x.id]) : <Icon name="sliders" />}</span>
            {x.label}
          </button>
        ))}
      </div>
      <Slider label={a.label} min={a.min} max={100} step={1} value={c.adjust[param]} onChange={(v) => updateSelected<MediaClip>((x) => { x.adjust[param] = v; }, 'adj:' + param)} />
      <button className="btn block" onClick={() => { const adj = { ...c.adjust }; applyToAll((x) => { x.adjust = { ...adj }; }); }}>Aplicar a todos</button>
    </Sheet>
  );
}

export function EffectsSheet() {
  const c = useSelected<MediaClip | TextClip>();
  if (!c) return null;
  return (
    <Sheet title="Efectos">
      <div className="grid">
        {EFFECTS.map((f) => (
          <button key={f.id} className={`cell ${c.effect.id === f.id ? 'on' : ''}`} onClick={() => updateSelected<Visual>((x) => { x.effect = { id: f.id, intensity: x.effect.intensity || 0.6 }; })}>
            <span className="sw">{f.icon}</span>{f.name}
          </button>
        ))}
      </div>
      {c.effect.id !== 'none' && (
        <Slider label="Intensidad" min={0.05} max={1} value={c.effect.intensity} onChange={(v) => updateSelected<Visual>((x) => { x.effect.intensity = v; }, 'eff')} format={pct} />
      )}
    </Sheet>
  );
}

export function AnimationSheet() {
  const c = useSelected<MediaClip | TextClip>();
  const [tab, setTab] = useState<'in' | 'out' | 'loop'>('in');
  if (!c) return null;
  const d = c.type === 'text' ? c.duration : clipDuration(c);
  const list = tab === 'in' ? ANIMS_IN.filter((a) => a.id !== 'typewriter' || c.type === 'text') : tab === 'out' ? ANIMS_OUT : ANIMS_LOOP;
  const key = tab === 'in' ? 'animIn' : tab === 'out' ? 'animOut' : 'animLoop';
  const cur = c[key];
  const defDur = tab === 'loop' ? 1 : Math.min(0.6, d / 2);
  return (
    <Sheet title="Animación">
      <div className="tabs">
        <button className={tab === 'in' ? 'on' : ''} onClick={() => setTab('in')}>Entrada</button>
        <button className={tab === 'out' ? 'on' : ''} onClick={() => setTab('out')}>Salida</button>
        <button className={tab === 'loop' ? 'on' : ''} onClick={() => setTab('loop')}>Bucle</button>
      </div>
      <div className="grid">
        <button className={`cell ${!cur ? 'on' : ''}`} onClick={() => updateSelected<Visual>((x) => { x[key] = null; })}><span className="sw">⊘</span>Ninguna</button>
        {list.map((a) => (
          <button key={a.id} className={`cell ${cur?.id === a.id ? 'on' : ''}`}
            onClick={() => { updateSelected<Visual>((x) => { x[key] = { id: a.id, duration: x[key]?.duration ?? defDur }; }); }}>
            <span className="sw"><Icon name="anim" /></span>{a.name}
          </button>
        ))}
      </div>
      {cur && (
        <Slider label={tab === 'loop' ? 'Ritmo' : 'Duración'} min={0.1} max={tab === 'loop' ? 4 : Math.max(0.2, Math.min(5, d))} step={0.05} value={cur.duration}
          onChange={(v) => updateSelected<Visual>((x) => { if (x[key]) x[key]!.duration = v; }, 'anim:' + key)} format={(v) => `${v.toFixed(1)}s`} />
      )}
    </Sheet>
  );
}

export function TransformSheet() {
  const c = useSelected<MediaClip>();
  const project = useEditor((s) => s.project)!;
  if (!c) return null;
  const asset = project.assets.find((a) => a.id === c.assetId);
  const cover = () => {
    if (!asset) return 1;
    const r = aspectRatio(project);
    const ar = asset.width / asset.height;
    return Math.max(r / ar, ar / r);
  };
  const t = c.transform;
  return (
    <Sheet title="Transformar">
      <div className="hscroll">
        <button className="cell" onClick={() => updateSelected<MediaClip>((x) => { x.transform.rotation = (Math.round(x.transform.rotation / 90) * 90 + 90) % 360; })}><span className="sw"><Icon name="rotate" /></span>Girar 90°</button>
        <button className={`cell ${c.flipH ? 'on' : ''}`} onClick={() => updateSelected<MediaClip>((x) => { x.flipH = !x.flipH; })}><span className="sw"><Icon name="flipH" /></span>Espejo</button>
        <button className={`cell ${c.flipV ? 'on' : ''}`} onClick={() => updateSelected<MediaClip>((x) => { x.flipV = !x.flipV; })}><span className="sw"><Icon name="flipV" /></span>Voltear</button>
        <button className="cell" onClick={() => updateSelected<MediaClip>((x) => { x.transform = { ...x.transform, scale: 1, x: 0, y: 0 }; })}><span className="sw"><Icon name="aspect" /></span>Ajustar</button>
        <button className="cell" onClick={() => updateSelected<MediaClip>((x) => { x.transform = { ...x.transform, scale: cover(), x: 0, y: 0 }; })}><span className="sw"><Icon name="fullscreen" /></span>Rellenar</button>
        <button className="cell" onClick={() => updateSelected<MediaClip>((x) => { x.transform = { x: 0, y: 0, scale: 1, rotation: 0 }; x.flipH = false; x.flipV = false; })}><span className="sw"><Icon name="reset" /></span>Restablecer</button>
      </div>
      <Slider label="Escala" min={0.1} max={5} value={t.scale} onChange={(v) => updateSelected<MediaClip>((x) => { x.transform.scale = v; }, 'sc')} format={pct} />
      <Slider label="Rotación" min={-180} max={180} step={1} value={t.rotation} onChange={(v) => updateSelected<MediaClip>((x) => { x.transform.rotation = v; }, 'rot')} format={(v) => `${Math.round(v)}°`} />
      <p className="hint">También puedes mover, pellizcar y girar con dos dedos directamente sobre la vista previa.</p>
    </Sheet>
  );
}

export function OpacitySheet() {
  const c = useSelected<MediaClip | TextClip>();
  if (!c) return null;
  return (
    <Sheet title="Opacidad">
      <Slider label="Opacidad" min={0} max={1} value={c.opacity} onChange={(v) => updateSelected<Visual>((x) => { x.opacity = v; }, 'op')} format={pct} />
    </Sheet>
  );
}
