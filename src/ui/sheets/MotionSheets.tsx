import { useRef, useState, useSyncExternalStore } from 'react';
import type { Ease, MediaClip } from '../../types';
import { useEditor } from '../../store/editor';
import { findSelected, updateSelected } from '../../store/actions';
import {
  cancelJob, clearKeyframes, clipStart, getJob, jumpKeyframe, keyframeTarget, stabilizeSelected, subscribeJob, toggleKeyframe,
} from '../../store/clipActions';
import { EASES, KF_SNAP, kfIndexAt } from '../../engine/keyframes';
import { CURVE_PRESETS, MAX_SPEED, MIN_SPEED, curveLocal, curveSpeed, presetCurve } from '../../engine/speed';
import { STAB_LEVELS } from '../../engine/stabilize';
import { clipDuration } from '../../engine/timeline';
import { Chips, Sheet } from '../controls';
import { Icon } from '../icons';
import './motion.css';

/** Playhead time inside the selected clip. */
export function useLocalTime(): number {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const time = useEditor((s) => s.time);
  return time - clipStart(project, selection);
}

// ---------- Keyframes ----------

/** Diamond next to the play button: adds or removes a keyframe at the playhead. */
export function KeyframeButton() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const time = useEditor((s) => s.time);
  const t = keyframeTarget(project, selection, time);
  if (!t) return null;
  const on = kfIndexAt(t.clip, t.local) >= 0;
  return (
    <button className={`icon-btn kf-btn ${on ? 'on' : ''} ${t.clip.keyframes?.length ? 'has' : ''}`} disabled={!t.inside}
      aria-label={on ? 'Quitar keyframe' : 'Añadir keyframe'} onClick={toggleKeyframe}>
      <Icon name="diamond" size={22} fill={on} />
    </button>
  );
}

export function KeyframesSheet() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const time = useEditor((s) => s.time);
  const t = keyframeTarget(project, selection, time);
  if (!t) return null;
  const list = t.clip.keyframes ?? [];
  const at = kfIndexAt(t.clip, t.local);
  // The easing that applies here: the keyframe at the playhead or the one before it.
  const segIdx = at >= 0 ? at : list.map((k) => k.t).filter((k) => k < t.local).length - 1;
  const seg = segIdx >= 0 && segIdx < list.length - 1 ? list[segIdx] : null;
  const setEase = (e: Ease) => updateSelected((c) => {
    const k = (c as { keyframes?: { t: number; ease: Ease }[] }).keyframes?.find((x) => Math.abs(x.t - seg!.t) < KF_SNAP);
    if (k) k.ease = e;
  });
  const what = t.clip.type === 'audio' ? 'el volumen' : t.clip.type === 'text' ? 'la posición, escala, giro u opacidad' : 'la posición, escala, giro, opacidad, intensidad del filtro o volumen';
  return (
    <Sheet title="Keyframes">
      <div className="kf-row">
        <button className="btn" aria-label="Keyframe anterior" onClick={() => jumpKeyframe(-1)} disabled={!list.some((k) => k.t < t.local - KF_SNAP / 2)}><Icon name="back" size={18} /></button>
        <button className={`btn ${at >= 0 ? '' : 'primary'}`} style={{ flex: 1 }} disabled={!t.inside} onClick={toggleKeyframe}>
          <Icon name="diamond" size={18} fill={at >= 0} />{at >= 0 ? 'Quitar keyframe' : 'Añadir keyframe'}
        </button>
        <button className="btn" aria-label="Keyframe siguiente" onClick={() => jumpKeyframe(1)} disabled={!list.some((k) => k.t > t.local + KF_SNAP / 2)}><Icon name="next" size={18} /></button>
      </div>
      {seg && (
        <>
          <div className="hint">Movimiento hasta el siguiente keyframe</div>
          <Chips options={EASES.map((e) => ({ id: e.id, label: e.name }))} value={seg.ease} onChange={setEase} />
        </>
      )}
      <p className="hint">
        {list.length ? `${list.length} keyframe${list.length > 1 ? 's' : ''}. ` : ''}
        Añade un keyframe, mueve el cursor a otro momento y cambia {what}: se crea otro keyframe y el cambio se anima entre los dos.
      </p>
      {list.length > 0 && <button className="btn block" onClick={clearKeyframes}><Icon name="trash" size={18} />Borrar todos</button>}
    </Sheet>
  );
}

// ---------- Speed curves ----------

const GW = 320, GH = 140, PAD = 12;
const yOf = (v: number) => GH / 2 - (Math.log10(v) / 1) * (GH / 2 - PAD);
const vOf = (y: number) => Math.pow(10, ((GH / 2 - y) / (GH / 2 - PAD)));

export function SpeedCurvePanel({ c }: { c: MediaClip }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selPt, setSelPt] = useState(-1);
  const drag = useRef<number>(-1);
  const local = useLocalTime();
  const cur = c.curve;
  const setCurve = (fn: (x: MediaClip) => void, key?: string) => updateSelected<MediaClip>(fn, key);

  const toSvg = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * GW, y: ((e.clientY - r.top) / r.height) * GH };
  };
  const onDown = (e: React.PointerEvent, i: number) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = i;
    setSelPt(i);
  };
  const onMove = (e: React.PointerEvent) => {
    const i = drag.current;
    if (i < 0 || !cur) return;
    const p = toSvg(e);
    setCurve((x) => {
      const pts = x.curve!.pts;
      const v = Math.max(MIN_SPEED, Math.min(MAX_SPEED, vOf(p.y)));
      pts[i].v = Math.abs(v - 1) < 0.06 ? 1 : Math.round(v * 100) / 100;
      // Ends stay at the edges; inner points stay between their neighbours.
      if (i > 0 && i < pts.length - 1) pts[i].x = Math.max(pts[i - 1].x + 0.03, Math.min(pts[i + 1].x - 0.03, p.x / GW));
    }, 'curve');
  };
  const onUp = () => { drag.current = -1; };
  const onAdd = (e: React.PointerEvent) => {
    if (!cur) return;
    const p = toSvg(e);
    const u = Math.max(0.02, Math.min(0.98, p.x / GW));
    let idx = -1;
    setCurve((x) => {
      const pts = x.curve!.pts;
      if (pts.some((q) => Math.abs(q.x - u) < 0.04)) return;
      pts.push({ x: u, v: Math.round(curveSpeed(x.curve!, u) * 100) / 100 });
      pts.sort((a, b) => a.x - b.x);
      idx = pts.findIndex((q) => q.x === u);
    });
    if (idx >= 0) setSelPt(idx);
  };

  const len = c.out - c.in;
  const dur = clipDuration(c);
  // Playhead on the graph (the graph's x axis is the source).
  let playX = -1;
  if (cur && local >= 0 && local <= dur) {
    let lo = 0, hi = len;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (curveLocal(cur, len, m) < local) lo = m; else hi = m; }
    playX = (lo / Math.max(1e-6, len)) * GW;
  }
  const path = cur ? Array.from({ length: 81 }, (_, i) => `${i ? 'L' : 'M'}${(i / 80) * GW},${yOf(curveSpeed(cur, i / 80)).toFixed(1)}`).join('') : '';

  return (
    <>
      <div className="hscroll">
        <button className={`cell ${!cur ? 'on' : ''}`} onClick={() => setCurve((x) => { x.curve = null; })}><span className="sw">⊘</span>Ninguna</button>
        {CURVE_PRESETS.map((p) => (
          <button key={p.id} className={`cell ${cur?.id === p.id ? 'on' : ''}`} onClick={() => { setSelPt(-1); setCurve((x) => { x.curve = presetCurve(p.id); }); }}>
            <span className="sw"><CurveIcon pts={p.pts} /></span>{p.name}
          </button>
        ))}
      </div>
      {cur && (
        <>
          <svg ref={svgRef} className="curve-graph" viewBox={`0 0 ${GW} ${GH}`} onPointerDown={onAdd} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {[10, 1, 0.1].map((v) => (
              <g key={v}>
                <line x1={0} x2={GW} y1={yOf(v)} y2={yOf(v)} className={v === 1 ? 'mid' : 'grid'} />
                <text x={4} y={yOf(v) + (v === 10 ? 11 : -3)}>{v}x</text>
              </g>
            ))}
            {playX >= 0 && <line x1={playX} x2={playX} y1={0} y2={GH} className="play" />}
            <path d={path} className="line" />
            {cur.pts.map((p, i) => (
              <circle key={i} cx={p.x * GW} cy={yOf(p.v)} r={i === selPt ? 9 : 7} className={i === selPt ? 'pt on' : 'pt'}
                onPointerDown={(e) => onDown(e, i)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
            ))}
          </svg>
          <div className="btn-row">
            <button className="btn" disabled={selPt <= 0 || selPt >= cur.pts.length - 1}
              onClick={() => { const i = selPt; setSelPt(-1); setCurve((x) => { x.curve!.pts.splice(i, 1); }); }}>Quitar punto</button>
            <button className="btn" onClick={() => { setSelPt(-1); setCurve((x) => { x.curve = presetCurve(x.curve!.id); }); }}><Icon name="reset" size={18} />Restablecer</button>
          </div>
          <p className="hint">
            Duración: {dur.toFixed(1)} s (original {len.toFixed(1)} s). Arrastra los puntos para cambiar la velocidad y toca la gráfica para añadir uno.
            {selPt >= 0 && cur.pts[selPt] ? ` Punto: ${cur.pts[selPt].v.toFixed(2)}x.` : ''}
          </p>
        </>
      )}
    </>
  );
}

function CurveIcon({ pts }: { pts: [number, number][] }) {
  const c = { id: '', pts: pts.map(([x, v]) => ({ x, v })) };
  const d = Array.from({ length: 25 }, (_, i) => `${i ? 'L' : 'M'}${4 + (i / 24) * 48},${(30 - Math.log10(curveSpeed(c, i / 24)) * 22).toFixed(1)}`).join('');
  return <svg width="56" height="60" viewBox="0 0 56 60"><path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>;
}

// ---------- Stabilize ----------

export function StabilizeSheet() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const c = findSelected(project, selection) as MediaClip | null;
  const busy = useSyncExternalStore(subscribeJob, getJob);
  if (!c || c.type !== 'media') return null;
  const level = c.stab?.level ?? 0;
  return (
    <Sheet title="Estabilizar">
      <Chips options={STAB_LEVELS.map((l) => ({ id: l.level, label: l.name }))} value={level} onChange={(l) => { if (!busy) void stabilizeSelected(l); }} />
      <p className="hint">
        Mide el temblor de la cámara en el propio iPhone y lo compensa recortando un poco los bordes
        ({Math.round((STAB_LEVELS[Math.max(1, level)].zoom - 1) * 100)} % de zoom{level ? '' : ' en «Recomendado»'}).
        «Máximo» deja la imagen casi fija, ideal para planos grabados a pulso. El análisis se hace una vez por clip.
      </p>
    </Sheet>
  );
}

// ---------- Progress of long jobs ----------

export function JobOverlay() {
  const job = useSyncExternalStore(subscribeJob, getJob);
  if (!job) return null;
  return (
    <div className="busy">
      <div className="job-card">
        <b>{job.label}</b>
        <div className="progress"><div style={{ width: `${Math.round(job.fraction * 100)}%` }} /></div>
        <div className="job-foot">
          <span>{Math.floor(job.fraction * 100)} %</span>
          <button className="btn" onClick={cancelJob}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
