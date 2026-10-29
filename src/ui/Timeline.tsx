import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Asset, AudioClip, MediaClip, Project, TextClip } from '../types';
import { getPlayer, useEditor } from '../store/editor';
import { addMedia, addText, moveMain, pickFiles } from '../store/actions';
import { library } from '../media/library';
import { MIN_CLIP, clipDuration, formatTime, layoutMain, packLanes, projectDuration, sourceOffset } from '../engine/timeline';
import { shiftKeyframes } from '../engine/keyframes';
import { Icon } from './icons';

const RULER = 26;
const MAIN_H = 56;
const LANE_H = 34;
const S = () => useEditor.getState();

// Scroll position is shared through a tiny bus so strips can virtualize
// themselves without re-rendering the whole timeline on every scroll.
const scrollBus = new EventTarget();
const scrollState = { left: 0, width: 360 };

type ItemKind = 'main' | 'overlay' | 'text' | 'audio';
type Drag =
  | { kind: 'move'; id: string; item: ItemKind; x0: number; start0: number }
  | { kind: 'reorder'; id: string; from: number; x0: number; dx: number; to: number }
  | { kind: 'trim'; id: string; item: ItemKind; side: 'l' | 'r'; x0: number; snapshot: MediaClip | TextClip | AudioClip };

function useViewport(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(360);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return w;
}

function useLibraryVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const f = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setV((x) => x + 1)); };
    library.listeners.add(f);
    return () => { library.listeners.delete(f); cancelAnimationFrame(raf); };
  }, []);
  return v;
}

/** Virtualized canvas strip for thumbnails or waveforms. */
function Strip({ clipLeft, width, height, draw, deps }: {
  clipLeft: number; width: number; height: number;
  draw: (ctx: CanvasRenderingContext2D, a: number, b: number, h: number) => void; deps: unknown[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const win = useRef({ a: 0, b: 0 });
  const redraw = (force: boolean) => {
    const c = ref.current;
    if (!c) return;
    const { left, width: vw } = scrollState;
    const needA = Math.max(0, left - clipLeft), needB = Math.min(width, left + vw - clipLeft);
    if (!force && needA >= win.current.a && needB <= win.current.b) return;
    if (needB <= needA && !force) return;
    const a = Math.max(0, Math.floor(left - vw - clipLeft));
    const b = Math.min(width, Math.ceil(left + vw * 2 - clipLeft));
    win.current = { a, b };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, b - a);
    c.style.left = `${a}px`;
    c.style.width = `${w}px`;
    c.style.height = `${height}px`;
    c.width = Math.min(8192, Math.ceil(w * dpr));
    c.height = Math.ceil(height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(c.width / w, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    if (b > a) draw(ctx, a, b, height);
  };
  useEffect(() => {
    const f = () => redraw(false);
    scrollBus.addEventListener('scroll', f);
    return () => scrollBus.removeEventListener('scroll', f);
  });
  useEffect(() => { redraw(true); }, [clipLeft, width, height, ...deps]);
  return <canvas ref={ref} className="strip" />;
}

function filmstripDraw(asset: Asset, clip: MediaClip, pps: number) {
  return (ctx: CanvasRenderingContext2D, a: number, b: number, h: number) => {
    const th = library.thumbsNow(asset.id);
    if (!th || !th.images.length) return;
    const cw = Math.max(24, Math.min(120, h * th.aspect));
    for (let k = Math.floor(a / cw); k * cw < b; k++) {
      const x = k * cw - a;
      const t = asset.kind === 'image' ? 0 : clip.in + sourceOffset(clip, ((k + 0.5) * cw) / pps);
      let best = 0;
      for (let i = 1; i < th.times.length; i++) if (Math.abs(th.times[i] - t) < Math.abs(th.times[best] - t)) best = i;
      const img = th.images[best];
      const ir = img.width / img.height, cr = cw / h;
      let sw = img.width, sh = img.height, sx = 0, sy = 0;
      if (ir > cr) { sw = img.height * cr; sx = (img.width - sw) / 2; } else { sh = img.width / cr; sy = (img.height - sh) / 2; }
      ctx.drawImage(img as CanvasImageSource, sx, sy, sw, sh, x, 0, cw + 0.5, h);
    }
  };
}

function waveDraw(clip: AudioClip, pps: number, color: string) {
  return (ctx: CanvasRenderingContext2D, a: number, b: number, h: number) => {
    const peaks = library.peaks(clip.assetId);
    ctx.fillStyle = color;
    if (!peaks) { ctx.fillRect(0, h / 2 - 0.5, b - a, 1); return; }
    for (let x = a; x < b; x += 2) {
      const t = clip.in + sourceOffset(clip, x / pps);
      const v = peaks[Math.min(peaks.length - 1, Math.max(0, Math.floor(t * 50)))] ?? 0;
      const bh = Math.max(1, v * (h - 6));
      ctx.fillRect(x - a, (h - bh) / 2, 1.4, bh);
    }
  };
}

function Ruler({ pps, half, width }: { pps: number; half: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = width * dpr; c.height = RULER * dpr;
      c.style.width = `${width}px`; c.style.height = `${RULER}px`;
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr);
      const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
      const step = steps.find((s) => s * pps >= 70) ?? 600;
      const t0 = (scrollState.left - half) / pps, t1 = t0 + width / pps;
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      for (let t = Math.max(0, Math.floor(t0 / step) * step); t <= t1 + step; t += step) {
        const x = half + t * pps - scrollState.left;
        ctx.fillStyle = '#8e8e93';
        ctx.fillText(step < 1 ? `${formatTime(t)}.${Math.round((t % 1) * 10)}` : formatTime(t), x, 13);
        ctx.fillStyle = '#48484a';
        for (let k = 1; k < 2; k++) { const xm = x + (step * pps * k) / 2; ctx.beginPath(); ctx.arc(xm, 10, 1.2, 0, 7); ctx.fill(); }
      }
    };
    draw();
    scrollBus.addEventListener('scroll', draw);
    return () => scrollBus.removeEventListener('scroll', draw);
  }, [pps, half, width]);
  return <canvas ref={ref} style={{ position: 'absolute', top: 0, left: 0, zIndex: 3, pointerEvents: 'none' }} />;
}

export function Timeline() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const pps = useEditor((s) => s.pxPerSec);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fixedRef = useRef<HTMLDivElement>(null);
  const vw = useViewport(wrapRef);
  const half = vw / 2;
  const libV = useLibraryVersion();
  const lastSet = useRef(-1);
  const drag = useRef<Drag | null>(null);
  const [dragView, setDragView] = useState<Drag | null>(null);
  const press = useRef<{ id: string; item: ItemKind; x0: number; y0: number; timer: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d0: number; pps0: number } | null>(null);

  const duration = projectDuration(project);
  const layout = layoutMain(project.main);
  const contentW = duration * pps + vw;

  // Keep the scroll position following the playhead.
  const syncScroll = (t: number, p = S().pxPerSec) => {
    const el = scrollRef.current;
    if (!el) return;
    const x = Math.round(t * p);
    lastSet.current = x;
    el.scrollLeft = x;
    scrollState.left = el.scrollLeft;
    scrollBus.dispatchEvent(new Event('scroll'));
  };
  useEffect(() => useEditor.subscribe((s, prev) => {
    if (s.time !== prev.time && (s.playing || !press.current)) {
      const el = scrollRef.current;
      if (el && Math.abs(el.scrollLeft - s.time * s.pxPerSec) > 1) syncScroll(s.time);
    }
  }), []);
  useLayoutEffect(() => { scrollState.width = vw; syncScroll(S().time, pps); }, [pps, vw, contentW]);

  // Fit the whole project the first time it has content.
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && duration > 0 && vw > 0) {
      fitted.current = true;
      S().setZoom(Math.max(10, Math.min(120, (vw * 0.75) / duration)));
    }
  }, [duration, vw]);

  const onScroll = () => {
    const el = scrollRef.current!;
    scrollState.left = el.scrollLeft;
    scrollBus.dispatchEvent(new Event('scroll'));
    if (fixedRef.current) fixedRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    if (Math.abs(el.scrollLeft - lastSet.current) < 1) return;
    lastSet.current = -1;
    const player = getPlayer();
    if (player?.playing) player.pause();
    const t = Math.max(0, Math.min(duration, el.scrollLeft / S().pxPerSec));
    player?.seek(t);
    S().setTime(t, false);
  };

  // Pinch to zoom, and blocking scroll while dragging a clip.
  useEffect(() => {
    const el = scrollRef.current!;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) { pinch.current = { d0: dist(e), pps0: S().pxPerSec }; cancelPress(); }
    };
    const tm = (e: TouchEvent) => {
      if (drag.current) { e.preventDefault(); return; }
      if (e.touches.length === 2 && pinch.current) {
        e.preventDefault();
        S().setZoom(pinch.current.pps0 * (dist(e) / pinch.current.d0));
      }
    };
    const te = (e: TouchEvent) => { if (e.touches.length < 2) pinch.current = null; };
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); S().setZoom(S().pxPerSec * Math.exp(-e.deltaY * 0.01)); }
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('wheel', wheel);
    };
  }, []);

  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };

  const selectItem = (item: ItemKind, id: string) => S().select({ kind: item, id } as never);

  const findItem = (p: Project, item: ItemKind, id: string) =>
    (item === 'main' ? p.main : item === 'overlay' ? p.overlays : item === 'text' ? p.texts : p.audios).find((c) => c.id === id);

  const onClipDown = (e: React.PointerEvent, item: ItemKind, id: string) => {
    if (pinch.current) return;
    const x0 = e.clientX, y0 = e.clientY;
    const target = e.currentTarget as HTMLElement;
    const pid = e.pointerId;
    press.current = {
      id, item, x0, y0, moved: false,
      timer: window.setTimeout(() => {
        // Long press: pick the clip up.
        const p = S().project!;
        try { target.setPointerCapture(pid); } catch { /* ignore */ }
        getPlayer()?.pause();
        navigator.vibrate?.(10);
        if (item === 'main') {
          const from = p.main.findIndex((c) => c.id === id);
          drag.current = { kind: 'reorder', id, from, x0, dx: 0, to: from };
        } else {
          const c = findItem(p, item, id)!;
          drag.current = { kind: 'move', id, item, x0, start0: c.start };
        }
        selectItem(item, id);
        setDragView({ ...drag.current });
      }, 380),
    };
  };

  const onClipMove = (e: React.PointerEvent) => {
    const pr = press.current;
    if (pr && !drag.current && Math.hypot(e.clientX - pr.x0, e.clientY - pr.y0) > 8) { pr.moved = true; clearTimeout(pr.timer); }
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'reorder') {
      const dx = e.clientX - d.x0;
      const lay = layoutMain(S().project!.main);
      const self = lay[d.from];
      const cx = self.start * pps + (self.end - self.start) * pps / 2 + dx;
      let to = 0;
      lay.forEach((l, i) => { if (i !== d.from && cx > (l.start + (l.end - l.start) / 2) * pps) to++; });
      d.dx = dx; d.to = to;
      setDragView({ ...d });
    } else if (d.kind === 'move') {
      let start = Math.max(0, d.start0 + (e.clientX - d.x0) / pps);
      const p = S().project!;
      const c = findItem(p, d.item, d.id)!;
      const len = c.type === 'text' ? c.duration : clipDuration(c);
      // Snap to the playhead, the start, and clip edges.
      const snaps = [0, S().time, ...layoutMain(p.main).flatMap((l) => [l.start, l.end])];
      for (const s of snaps) {
        if (Math.abs(start - s) * pps < 10) { start = s; break; }
        if (Math.abs(start + len - s) * pps < 10) { start = s - len; break; }
      }
      S().update((dr) => { const x = findItem(dr, d.item, d.id); if (x) x.start = Math.max(0, start); }, `${d.id}:drag`);
    }
  };

  const onClipUp = (e: React.PointerEvent, item: ItemKind, id: string) => {
    const pr = press.current;
    const d = drag.current;
    cancelPress();
    if (d) {
      if (d.kind === 'reorder' && d.to !== d.from) moveMain(d.from, d.to);
      drag.current = null;
      setDragView(null);
      return;
    }
    if (pr && !pr.moved && e.type === 'pointerup') {
      const sel = S().selection;
      if (sel?.id === id) { S().setSheet(null); } else selectItem(item, id);
    }
  };

  const onClipCancel = () => {
    cancelPress();
    if (drag.current) { drag.current = null; setDragView(null); }
  };

  // ---- Trimming ----
  const onTrimDown = (e: React.PointerEvent, item: ItemKind, id: string, side: 'l' | 'r') => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    getPlayer()?.pause();
    const c = findItem(S().project!, item, id)!;
    drag.current = { kind: 'trim', id, item, side, x0: e.clientX, snapshot: structuredClone(c) };
  };

  const onTrimMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== 'trim') return;
    e.stopPropagation();
    const dt = (e.clientX - d.x0) / pps;
    const p = S().project!;
    const o = d.snapshot;
    let seekTo = -1;
    S().update((dr) => {
      const c = findItem(dr, d.item, d.id);
      if (!c) return;
      if (c.type === 'text' && o.type === 'text') {
        if (d.side === 'l') {
          const ns = Math.max(0, Math.min(o.start + o.duration - MIN_CLIP, o.start + dt));
          c.start = ns; c.duration = o.start + o.duration - ns; seekTo = ns;
          c.keyframes = structuredClone(o.keyframes);
          shiftKeyframes(c, c.duration - o.duration);
        } else { c.duration = Math.max(MIN_CLIP, o.duration + dt); seekTo = c.start + c.duration - 0.01; }
        return;
      }
      if (c.type === 'text' || o.type === 'text') return;
      // With a speed curve, trims use the clip's average speed.
      const sp = (o.out - o.in) / Math.max(1e-6, clipDuration(o));
      const asset = p.assets.find((a) => a.id === c.assetId);
      const isImage = asset?.kind === 'image';
      const maxOut = isImage ? 3600 : asset?.duration ?? o.out;
      if (d.side === 'l') {
        if (isImage && d.item === 'main') {
          c.out = Math.max(MIN_CLIP, Math.min(3600, o.out - dt));
        } else {
          let nin = o.in + dt * sp;
          nin = Math.max(isImage ? -1e9 : 0, Math.min(o.out - MIN_CLIP * sp, nin));
          if (d.item !== 'main') {
            const shift = (nin - o.in) / sp;
            const ns = o.start + shift;
            if (ns < 0) nin = o.in - o.start * sp;
            c.start = Math.max(0, o.start + (nin - o.in) / sp);
          }
          if (isImage) { c.out = o.out - (nin - o.in); c.in = 0; } else c.in = nin;
        }
        // Keyframes stay on the same content when the left edge moves.
        c.keyframes = structuredClone(o.keyframes);
        shiftKeyframes(c, clipDuration(c) - clipDuration(o));
        const lay = d.item === 'main' ? layoutMain(dr.main).find((l) => l.clip.id === c.id) : null;
        seekTo = lay ? lay.start : c.start;
      } else {
        c.out = Math.max(c.in + MIN_CLIP * sp, Math.min(maxOut, o.out + dt * sp));
        const lay = d.item === 'main' ? layoutMain(dr.main).find((l) => l.clip.id === c.id) : null;
        seekTo = (lay ? lay.end : c.start + clipDuration(c)) - 0.02;
      }
    }, `${d.id}:trim`);
    // Preview the trim edge without moving the timeline under the finger.
    if (seekTo >= 0) getPlayer()?.seek(seekTo);
  };

  const onTrimUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = null;
    getPlayer()?.seek(S().time);
  };

  const seekTo = (t: number) => {
    const player = getPlayer();
    player?.pause();
    player?.seek(t);
    S().setTime(Math.max(0, t), false);
  };

  // Keyframe diamonds on the selected clip; a tap jumps to the keyframe.
  const kfMarks = (c: MediaClip | TextClip | AudioClip, start: number, w: number) => c.keyframes?.length ? (
    <div className="kf-marks">
      {c.keyframes.filter((k) => k.t >= -0.01 && k.t * pps <= w + 1).map((k) => (
        <button key={k.t} className="kf-mark" style={{ left: k.t * pps }} aria-label="Ir al keyframe"
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); seekTo(start + k.t + 0.001); }} />
      ))}
    </div>
  ) : null;

  const handles = (item: ItemKind, id: string) => (
    <>
      <div className="handle l" onPointerDown={(e) => onTrimDown(e, item, id, 'l')} onPointerMove={onTrimMove} onPointerUp={onTrimUp} onPointerCancel={onTrimUp} />
      <div className="handle r" onPointerDown={(e) => onTrimDown(e, item, id, 'r')} onPointerMove={onTrimMove} onPointerUp={onTrimUp} onPointerCancel={onTrimUp} />
    </>
  );

  const clipEvents = (item: ItemKind, id: string) => ({
    onPointerDown: (e: React.PointerEvent) => onClipDown(e, item, id),
    onPointerMove: onClipMove,
    onPointerUp: (e: React.PointerEvent) => onClipUp(e, item, id),
    onPointerCancel: onClipCancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const overlayLanes = packLanes(project.overlays);
  const textLanes = packLanes(project.texts);
  const audioLanes = packLanes(project.audios);
  const nOverlay = overlayLanes.reduce((m, x) => Math.max(m, x.lane + 1), 0);
  const nText = textLanes.reduce((m, x) => Math.max(m, x.lane + 1), 0);
  const nAudio = audioLanes.reduce((m, x) => Math.max(m, x.lane + 1), 0);
  const allMuted = project.main.length > 0 && project.main.every((c) => c.muted);
  const assetOf = (id: string) => project.assets.find((a) => a.id === id);

  return (
    <div className="timeline" ref={wrapRef}>
      <Ruler pps={pps} half={half} width={vw} />
      <div className="tl-scroll" ref={scrollRef} onScroll={onScroll} style={{ top: RULER }}>
        <div className="tl-content" style={{ width: contentW }} onClick={(e) => { if (e.target === e.currentTarget) S().select(null); }}>
          {/* Main track */}
          <div className="tl-row tl-main" style={{ height: MAIN_H }} onClick={(e) => { if (e.target === e.currentTarget) S().select(null); }}>
            {!project.main.length && (
              <button className="add-row" style={{ left: half, height: MAIN_H, position: 'absolute' }} onClick={async () => addMedia(await pickFiles('video/*,image/*'), 'main')}>
                <Icon name="plus" size={18} /> Añadir vídeos o fotos
              </button>
            )}
            {layout.map((l) => {
              const c = l.clip;
              const a = assetOf(c.assetId);
              const left = half + l.start * pps;
              const w = Math.max(4, (l.end - l.start) * pps);
              const sel = selection?.id === c.id && selection.kind === 'main';
              const dv = dragView?.kind === 'reorder' && dragView.id === c.id ? dragView : null;
              return (
                <div key={c.id} className={`clip media ${sel ? 'sel' : ''} ${dv ? 'dragging' : ''}`}
                  style={{ left, width: w, transform: dv ? `translateX(${dv.dx}px) scale(1.03)` : undefined }} {...clipEvents('main', c.id)}>
                  <div className="body" style={{ boxShadow: sel ? undefined : 'inset 0 0 0 1px #000' }}>
                    {a && <Strip clipLeft={left} width={w} height={MAIN_H} draw={filmstripDraw(a, c, pps)} deps={[libV, c.in, c.out, c.speed, c.curve, pps, a.id]} />}
                    <span className="badge">
                      {c.curve ? '〰 ' : c.speed !== 1 ? `${+c.speed.toFixed(2)}x · ` : ''}{c.reversed ? '⇆ ' : ''}{c.stab?.level ? '✋ ' : ''}{c.muted ? '🔇 ' : ''}{(l.end - l.start).toFixed(1)}s
                    </span>
                  </div>
                  {sel && !dragView && kfMarks(c, l.start, w)}
                  {sel && !dragView && handles('main', c.id)}
                </div>
              );
            })}
            {/* Junction buttons get out of the way of trim handles. */}
            {selection?.kind !== 'main' && layout.slice(0, -1).map((l) => {
              const x = half + (l.end - l.transOut / 2) * pps;
              const on = !!l.clip.transition && l.clip.transition.id !== 'none';
              const isSel = selection?.kind === 'transition' && selection.id === l.clip.id;
              return (
                <button key={'t' + l.clip.id} className={`trans-btn ${on || isSel ? 'on' : ''}`} style={{ left: x }} aria-label="Transición"
                  onClick={() => { S().select({ kind: 'transition', id: l.clip.id }); S().setSheet('transition'); }}>
                  {on ? '⧓' : <Icon name="transition" size={14} />}
                </button>
              );
            })}
            {dragView?.kind === 'reorder' && (() => {
              const lay = layout.filter((_, i) => i !== dragView.from);
              const t = dragView.to === 0 ? 0 : lay[Math.min(lay.length, dragView.to) - 1]?.end ?? 0;
              return <div className="drop-marker" style={{ left: half + t * pps - 1 }} />;
            })()}
          </div>

          {/* Overlay lanes */}
          {Array.from({ length: nOverlay }, (_, lane) => (
            <div key={'o' + lane} className="tl-row tl-lane">
              {overlayLanes.filter((x) => x.lane === lane).map(({ item: c }) => {
                const a = assetOf(c.assetId);
                const left = half + c.start * pps, w = Math.max(4, clipDuration(c) * pps);
                const sel = selection?.id === c.id;
                return (
                  <div key={c.id} className={`clip overlay ${sel ? 'sel' : ''}`} style={{ left, width: w }} {...clipEvents('overlay', c.id)}>
                    <div className="body">
                      {a && <Strip clipLeft={left} width={w} height={LANE_H} draw={filmstripDraw(a, c, pps)} deps={[libV, c.in, c.out, c.speed, c.curve, pps]} />}
                    </div>
                    {sel && kfMarks(c, c.start, w)}
                    {sel && handles('overlay', c.id)}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Text lanes */}
          {Array.from({ length: nText }, (_, lane) => (
            <div key={'x' + lane} className="tl-row tl-lane">
              {textLanes.filter((x) => x.lane === lane).map(({ item: c }) => {
                const left = half + c.start * pps, w = Math.max(4, c.duration * pps);
                const sel = selection?.id === c.id;
                return (
                  <div key={c.id} className={`clip text ${sel ? 'sel' : ''}`} style={{ left, width: w, ...(c.sticker ? { ['--text-clip' as string]: '#b8487a' } : {}) }} {...clipEvents('text', c.id)}>
                    <div className="body"><span className="label">{c.sticker ? '' : 'T  '}{c.text}</span></div>
                    {sel && kfMarks(c, c.start, w)}
                    {sel && handles('text', c.id)}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Audio lanes */}
          {Array.from({ length: nAudio }, (_, lane) => (
            <div key={'a' + lane} className="tl-row tl-lane">
              {audioLanes.filter((x) => x.lane === lane).map(({ item: c }) => {
                const left = half + c.start * pps, w = Math.max(4, clipDuration(c) * pps);
                const sel = selection?.id === c.id;
                return (
                  <div key={c.id} className={`clip audio ${sel ? 'sel' : ''}`} style={{ left, width: w }} {...clipEvents('audio', c.id)}>
                    <div className="body">
                      <Strip clipLeft={left} width={w} height={LANE_H} draw={waveDraw(c, pps, 'rgba(160,255,215,0.75)')} deps={[libV, c.in, c.speed, c.curve, pps]} />
                      <span className="label" style={{ fontWeight: 500, fontSize: 11 }}>♪ {c.name}</span>
                    </div>
                    {sel && kfMarks(c, c.start, w)}
                    {sel && handles('audio', c.id)}
                  </div>
                );
              })}
            </div>
          ))}

          {project.main.length > 0 && (
            <>
              {!nText && <AddRow half={half} label="Añadir texto" icon="text" onClick={() => { addText(); S().setSheet('text'); }} />}
              {!nAudio && <AddRow half={half} label="Añadir audio" icon="music" onClick={() => S().setSheet('audio')} />}
            </>
          )}
          <div style={{ height: 16 }} />
        </div>
      </div>
      <div className="playhead" style={{ top: 0 }} />
      <div ref={fixedRef} style={{ position: 'absolute', top: RULER + 8, left: 0, right: 0, height: MAIN_H, pointerEvents: 'none' }}>
        {project.main.length > 0 && (
          <>
            <button className="tl-fixed-mute" style={{ top: 4, pointerEvents: 'auto' }} aria-label="Silenciar audio original"
              onClick={() => S().update((d) => { for (const c of d.main) c.muted = !allMuted; })}>
              <Icon name={allMuted ? 'mute' : 'volume'} size={18} />
              {allMuted ? 'Activar' : 'Silenciar'}
            </button>
            <button className="tl-fixed-add" style={{ top: 8, pointerEvents: 'auto' }} aria-label="Añadir clips"
              onClick={async () => addMedia(await pickFiles('video/*,image/*'), 'main')}>
              <Icon name="plus" size={24} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const AddRow = memo(function AddRow({ half, label, icon, onClick }: { half: number; label: string; icon: string; onClick: () => void }) {
  return (
    <div className="tl-row tl-lane" style={{ height: LANE_H }}>
      <button className="add-row" style={{ position: 'sticky', left: half + 4, display: 'inline-flex' }} onClick={onClick}>
        <Icon name={icon} size={16} /> {label}
      </button>
    </div>
  );
});

