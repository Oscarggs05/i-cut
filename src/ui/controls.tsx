import type { ReactNode } from 'react';
import { Icon } from './icons';
import { useEditor } from '../store/editor';

export function Sheet({ title, children, onDone }: { title: string; children: ReactNode; onDone?: () => void }) {
  const setSheet = useEditor((s) => s.setSheet);
  return (
    <div className="sheet">
      <div className="sheet-head">
        <h3>{title}</h3>
        <button className="ok-btn" aria-label="Listo" onClick={() => { onDone?.(); setSheet(null); }}>
          <Icon name="check" size={26} />
        </button>
      </div>
      <div className="sheet-body">{children}</div>
    </div>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format, onStart }: {
  label?: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; format?: (v: number) => string; onStart?: () => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="row">
      {label && <span className="lbl">{label}</span>}
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--p' as string]: `${pct}%` }}
        onPointerDown={onStart}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="val">{format ? format(value) : Math.round(value)}</span>
    </div>
  );
}

export function Chips<T extends string | number>({ options, value, onChange }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={String(o.id)} className={`chip ${o.id === value ? 'on' : ''}`} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="row">
      <span className="lbl" style={{ flex: 1, width: 'auto' }}>{label}</span>
      <button className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} aria-label={label} onClick={() => onChange(!on)} />
    </div>
  );
}

export function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button key={c} className={`swatch ${c.toLowerCase() === value.toLowerCase() ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => onChange(c)} />
      ))}
      <label className="swatch" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', position: 'relative', overflow: 'hidden' }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      </label>
    </div>
  );
}
