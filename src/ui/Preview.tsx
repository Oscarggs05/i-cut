import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Player } from '../engine/player';
import type { LayerBounds } from '../engine/renderer';
import { aspectRatio } from '../engine/timeline';
import { getPlayer, setPlayer, useEditor } from '../store/editor';
import { deleteSelected, findSelected } from '../store/actions';
import { clipStart, setSelectedProps } from '../store/clipActions';
import { valueAt } from '../engine/keyframes';
import type { MediaClip, Selection, TextClip } from '../types';

type Mode =
  | { kind: 'none' }
  | { kind: 'move'; id: string; sel: Selection; x0: number; y0: number; tx: number; ty: number }
  | { kind: 'pinch'; sel: Selection; d0: number; a0: number; s0: number; r0: number; cx0: number; cy0: number; tx: number; ty: number }
  | { kind: 'handle'; sel: Selection; cx: number; cy: number; d0: number; a0: number; s0: number; r0: number };

const S = () => useEditor.getState();

function inside(b: LayerBounds, x: number, y: number) {
  const r = (-b.rotation * Math.PI) / 180;
  const dx = x - b.center[0], dy = y - b.center[1];
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  const pad = 12;
  return Math.abs(lx) <= Math.abs(b.width) / 2 + pad && Math.abs(ly) <= Math.abs(b.height) / 2 + pad;
}

function selFor(b: LayerBounds): Selection {
  return { kind: b.kind, id: b.id } as Selection;
}

export function Preview() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const guideV = useRef<HTMLDivElement>(null);
  const guideH = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<LayerBounds[]>([]);
  const playerRef = useRef<Player | null>(null);
  const [stage, setStage] = useState({ w: 200, h: 356 });
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const ratio = aspectRatio(project);
  const selRef = useRef(selection);
  selRef.current = selection;
  const stageRef = useRef(stage);
  stageRef.current = stage;

  // Player lifetime follows the editor.
  useEffect(() => {
    const player = new Player(canvasRef.current!, S().project!);
    playerRef.current = player;
    setPlayer(player);
    let last = -1;
    player.onTime = (t, playing) => {
      if (Math.abs(t - last) > 1 / 120 || playing !== S().playing) { last = t; S().setTime(t, playing); }
    };
    player.onBounds = (b) => { boundsRef.current = b; placeBox(); };
    return () => { player.dispose(); setPlayer(null); playerRef.current = null; };
  }, []);

  const placeBox = () => {
    const box = boxRef.current;
    const player = playerRef.current;
    if (!box || !player) return;
    const sel = selRef.current;
    const b = sel ? boundsRef.current.find((x) => x.id === sel.id) : null;
    if (!b || sel?.kind === 'audio' || sel?.kind === 'transition') { box.style.display = 'none'; return; }
    const k = stageRef.current.w / player.renderer.width;
    box.style.display = 'block';
    box.style.width = `${Math.abs(b.width) * k}px`;
    box.style.height = `${Math.abs(b.height) * k}px`;
    box.style.transform = `translate(${b.center[0] * k - (Math.abs(b.width) * k) / 2}px, ${b.center[1] * k - (Math.abs(b.height) * k) / 2}px) rotate(${b.rotation}deg)`;
    const edit = box.querySelector<HTMLElement>('.h.edit');
    if (edit) edit.style.display = sel?.kind === 'text' ? 'grid' : 'none';
  };

  useEffect(() => { placeBox(); playerRef.current?.invalidate(); }, [selection]);

  // Fit the canvas to the available space with the project's aspect ratio.
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const fit = () => {
      const W = el.clientWidth - 8, H = el.clientHeight - 4;
      let w = W, h = W / ratio;
      if (h > H) { h = H; w = H * ratio; }
      setStage({ w: Math.floor(w), h: Math.floor(h) });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      playerRef.current?.resize(w * dpr, h * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);

  // ---- Gestures ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const mode = useRef<Mode>({ kind: 'none' });
  const tap = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; id: string | null }>({ t: 0, id: null });

  const toCanvas = (x: number, y: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const k = (playerRef.current?.renderer.width ?? rect.width) / rect.width;
    return { x: (x - rect.left) * k, y: (y - rect.top) * k };
  };

  const hit = (x: number, y: number): LayerBounds | null => {
    const p = toCanvas(x, y);
    const b = boundsRef.current;
    const order = [...b.filter((l) => l.kind === 'text').reverse(), ...b.filter((l) => l.kind === 'overlay').reverse(), ...b.filter((l) => l.kind === 'main')];
    return order.find((l) => inside(l, p.x, p.y)) ?? null;
  };

  // Transforms as seen at the playhead, so gestures also work on keyframed clips.
  const transformOf = (sel: Selection) => {
    const p = S().project!;
    const c = findSelected(p, sel) as MediaClip | TextClip | null;
    if (!c || !('transform' in c)) return null;
    const t = S().time - clipStart(p, sel);
    return { x: valueAt(c, 'x', t), y: valueAt(c, 'y', t), scale: valueAt(c, 'scale', t), rotation: valueAt(c, 'rotation', t) };
  };

  const setTransform = (sel: Selection, t: Partial<MediaClip['transform']>) => {
    if (!sel || sel.id !== S().selection?.id) return;
    setSelectedProps(t, 'gesture');
  };

  const startPinch = (sel: Selection) => {
    const tr = transformOf(sel);
    if (!tr) return;
    const [a, b] = [...pointers.current.values()];
    mode.current = {
      kind: 'pinch', sel,
      d0: Math.hypot(b.x - a.x, b.y - a.y), a0: Math.atan2(b.y - a.y, b.x - a.x),
      s0: tr.scale, r0: tr.rotation, cx0: (a.x + b.x) / 2, cy0: (a.y + b.y) / 2, tx: tr.x, ty: tr.y,
    };
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    getPlayer()?.pause();
    if (pointers.current.size === 1) {
      tap.current = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      const h = hit(e.clientX, e.clientY);
      const sel = selRef.current;
      if (h && (h.id === sel?.id || h.kind !== 'main')) {
        const s = selFor(h);
        if (h.id !== sel?.id) S().select(s);
        const tr = transformOf(s);
        if (tr) mode.current = { kind: 'move', id: h.id, sel: s, x0: e.clientX, y0: e.clientY, tx: tr.x, ty: tr.y };
      } else {
        mode.current = { kind: 'none' };
      }
    } else if (pointers.current.size === 2) {
      tap.current = null;
      const sel = selRef.current;
      if (sel && sel.kind !== 'audio' && sel.kind !== 'transition') startPinch(sel);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 6) tap.current.moved = true;
    const m = mode.current;
    const st = stageRef.current;
    if (m.kind === 'move' && pointers.current.size === 1) {
      let x = m.tx + (e.clientX - m.x0) / st.w;
      let y = m.ty + (e.clientY - m.y0) / st.h;
      const snapX = Math.abs(x) < 0.015, snapY = Math.abs(y) < 0.015;
      if (snapX) x = 0;
      if (snapY) y = 0;
      guideV.current?.classList.toggle('on', snapX);
      guideH.current?.classList.toggle('on', snapY);
      setTransform(m.sel, { x, y });
    } else if (m.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      let rot = m.r0 + ((ang - m.a0) * 180) / Math.PI;
      const snapped = Math.round(rot / 90) * 90;
      if (Math.abs(rot - snapped) < 4) rot = snapped;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      setTransform(m.sel, {
        scale: Math.max(0.05, Math.min(12, m.s0 * (d / Math.max(1, m.d0)))),
        rotation: rot,
        x: m.tx + (cx - m.cx0) / st.w,
        y: m.ty + (cy - m.cy0) / st.h,
      });
    } else if (m.kind === 'handle') {
      const d = Math.hypot(e.clientX - m.cx, e.clientY - m.cy);
      const ang = Math.atan2(e.clientY - m.cy, e.clientX - m.cx);
      let rot = m.r0 + ((ang - m.a0) * 180) / Math.PI;
      const snapped = Math.round(rot / 90) * 90;
      if (Math.abs(rot - snapped) < 4) rot = snapped;
      setTransform(m.sel, { scale: Math.max(0.05, Math.min(12, m.s0 * (d / Math.max(1, m.d0)))), rotation: rot });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    guideV.current?.classList.remove('on');
    guideH.current?.classList.remove('on');
    if (pointers.current.size === 1 && mode.current.kind === 'pinch') {
      // Continue as a move with the remaining finger.
      const [rest] = [...pointers.current.values()];
      const sel = mode.current.sel;
      const tr = transformOf(sel);
      if (tr && sel) mode.current = { kind: 'move', id: sel.id, sel, x0: rest.x, y0: rest.y, tx: tr.x, ty: tr.y };
      return;
    }
    if (pointers.current.size > 0) return;
    const t = tap.current;
    if (t && !t.moved && performance.now() - t.t < 400) {
      const h = hit(e.clientX, e.clientY);
      const now = performance.now();
      if (h) {
        if (h.kind === 'text' && lastTap.current.id === h.id && now - lastTap.current.t < 350) S().setSheet('text');
        else if (selRef.current?.id !== h.id) S().select(selFor(h));
        lastTap.current = { t: now, id: h.id };
      } else {
        S().select(null);
        lastTap.current = { t: now, id: null };
      }
    }
    tap.current = null;
    mode.current = { kind: 'none' };
  };

  // With a mouse there is no pinch: the wheel scales the selected layer and
  // Shift + wheel rotates it.
  useEffect(() => {
    const el = gestureRef.current!;
    const wheel = (e: WheelEvent) => {
      const sel = selRef.current;
      const tr = sel && sel.kind !== 'audio' && sel.kind !== 'transition' ? transformOf(sel) : null;
      if (!tr) return;
      e.preventDefault();
      getPlayer()?.pause();
      const d = e.deltaY || e.deltaX;
      if (e.shiftKey) setTransform(sel, { rotation: tr.rotation + Math.sign(d) * 2 });
      else setTransform(sel, { scale: Math.max(0.05, Math.min(12, tr.scale * Math.exp(-d * 0.0015))) });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const onHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const sel = selRef.current;
    const b = sel && boundsRef.current.find((x) => x.id === sel.id);
    const tr = transformOf(sel);
    if (!b || !tr) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const k = rect.width / (playerRef.current?.renderer.width ?? rect.width);
    const cx = rect.left + b.center[0] * k, cy = rect.top + b.center[1] * k;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mode.current = { kind: 'handle', sel, cx, cy, d0: Math.hypot(e.clientX - cx, e.clientY - cy), a0: Math.atan2(e.clientY - cy, e.clientX - cx), s0: tr.scale, r0: tr.rotation };
  };

  return (
    <div className="preview-wrap" ref={wrapRef}>
      <div className="preview-stage" style={{ width: stage.w, height: stage.h }}>
        <canvas ref={canvasRef} />
        <div className="guide v" ref={guideV} />
        <div className="guide h" ref={guideH} />
        <div className="gesture" ref={gestureRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        <div className="sel-box" ref={boxRef}>
          <button className="h" style={{ left: -11, top: -11, pointerEvents: 'auto' }} aria-label="Eliminar"
            onPointerDown={(e) => e.stopPropagation()} onClick={() => deleteSelected()}>✕</button>
          <button className="h edit" style={{ right: -11, top: -11, pointerEvents: 'auto' }} aria-label="Editar texto"
            onPointerDown={(e) => e.stopPropagation()} onClick={() => S().setSheet('text')}>✎</button>
          <div className="h" style={{ right: -11, bottom: -11, pointerEvents: 'auto', touchAction: 'none' }} aria-label="Escalar y girar"
            onPointerDown={onHandleDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>⤡</div>
        </div>
      </div>
    </div>
  );
}

