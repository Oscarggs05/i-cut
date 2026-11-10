import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AspectId, Crop, MediaClip } from '../../types';
import { useEditor } from '../../store/editor';
import { findSelected, mainIndexAt, pickFiles } from '../../store/actions';
import {
  type CollageStyle, activeCollage, addCollageFiles, collageClips, collageFromClips, collageStyle, restyleCollage,
} from '../../store/collage';
import { COLLAGES, cellBox, collageById } from '../../engine/collage';
import { ASPECTS, aspectRatio, clipDuration, layoutMain, sourceTime } from '../../engine/timeline';
import { COLORS } from '../../engine/presets';
import { library } from '../../media/library';
import { Chips, Sheet, Slider, Swatches } from '../controls';
import { Icon } from '../icons';

const S = () => useEditor.getState();
const pct = (v: number) => `${Math.round(v * 100)}%`;

// ---------------------------------------------------------------------------
// Collage templates

const COLLAGE_ASPECTS: AspectId[] = ['9:16', '1:1', '4:5', '3:4', '16:9'];
const ratioOf = (id: AspectId) => ASPECTS.find((a) => a.id === id)?.ratio ?? 9 / 16;

function CollagePreview({ id, ratio, gap, radius, color }: { id: string; ratio: number; gap: number; radius: number; color: string }) {
  const tpl = collageById(id);
  const W = ratio * 100;
  return (
    <svg viewBox={`0 0 ${W} 100`} style={ratio >= 1 ? { width: 54, height: 54 / ratio } : { width: 54 * ratio, height: 54 }} aria-hidden="true">
      <rect width={W} height={100} fill={color} />
      {tpl.cells.map((cell, i) => {
        const b = cellBox(cell, ratio, gap);
        const r = radius * Math.min(b.w, b.h) * 100;
        return <rect key={i} x={b.x * 100} y={b.y * 100} width={b.w * 100} height={b.h * 100} rx={r} fill={i === 0 ? '#8e8e93' : '#5a5a5f'} />;
      })}
    </svg>
  );
}

export function CollageSheet() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const time = useEditor((s) => s.time);
  const active = activeCollage(project, selection, time);
  const [draft, setDraft] = useState<CollageStyle>(() => (active && collageStyle(project, active)) || {
    template: COLLAGES[0].id,
    aspect: COLLAGE_ASPECTS.includes(project.aspect) ? project.aspect : '9:16',
    gap: 0.012,
    radius: 0,
    color: project.background.type === 'color' ? project.background.color : '#ffffff',
  });
  // Follow the collage the user moves to.
  useEffect(() => {
    const cur = active ? collageStyle(S().project!, active) : null;
    if (cur) setDraft(cur);
  }, [active]);

  const ratio = ratioOf(draft.aspect);
  const cells = collageById(draft.template).cells.length;
  const filled = active ? collageClips(project, active).length : 0;
  const missing = Math.max(0, cells - filled);
  const looseClips = project.main.length ? project.main.slice(mainIndexAt(project, time)).filter((c) => !c.collage).length : 0;

  const set = (patch: Partial<CollageStyle>) => {
    const s = { ...draft, ...patch };
    setDraft(s);
    if (active) restyleCollage(active, s);
  };
  /** Tapping a design does something right away: edit the collage, build one from the project's clips, or ask for files. */
  const chooseTemplate = async (template: string) => {
    const s = { ...draft, template };
    setDraft(s);
    if (active) { restyleCollage(active, s); return; }
    if (looseClips >= 2) { collageFromClips(s); return; }
    const files = await pickFiles('video/*,image/*');
    if (files.length) await addCollageFiles(files, s, null);
  };
  const pick = async (into: string | null) => {
    const files = await pickFiles('video/*,image/*');
    if (files.length) await addCollageFiles(files, draft, into);
  };

  return (
    <Sheet title={active ? 'Editar collage' : 'Plantillas de collage'}>
      <Chips options={COLLAGE_ASPECTS.map((a) => ({ id: a, label: a }))} value={draft.aspect} onChange={(aspect) => set({ aspect })} />
      <div className="grid collage-grid">
        {COLLAGES.map((t) => (
          <button key={t.id} className={`cell ${draft.template === t.id ? 'on' : ''}`} onClick={() => void chooseTemplate(t.id)}>
            <span className="sw"><CollagePreview id={t.id} ratio={ratio} gap={draft.gap} radius={draft.radius} color={draft.color} /></span>
            {t.name}
          </button>
        ))}
      </div>
      <Slider label="Separación" min={0} max={0.06} step={0.002} value={draft.gap} onChange={(gap) => set({ gap })} format={(v) => `${Math.round(v * 1000) / 10}`} />
      <Slider label="Esquinas" min={0} max={0.5} step={0.01} value={draft.radius} onChange={(radius) => set({ radius })} format={pct} />
      <Swatches colors={COLORS} value={draft.color} onChange={(color) => set({ color })} />
      {active ? (
        <>
          {missing > 0 && (
            <button className="btn primary block" style={{ marginTop: 10 }} onClick={() => void pick(active)}>
              <Icon name="image" size={18} />Rellenar {missing} hueco{missing > 1 ? 's' : ''}
            </button>
          )}
          <p className="hint">
            Los cambios se aplican al momento a este collage ({filled} de {cells} huecos). Toca un clip del collage en la línea de tiempo para recortarlo y elegir qué parte se ve.
          </p>
        </>
      ) : (
        <>
          <button className="btn primary block" style={{ marginTop: 10 }} onClick={() => void pick(null)}>
            <Icon name="image" size={18} />Elegir {cells} fotos o vídeos
          </button>
          {looseClips >= 2 && (
            <button className="btn block" style={{ marginTop: 8 }} onClick={() => collageFromClips(draft)}>
              <Icon name="layers" size={18} />Usar los clips de mi proyecto
            </button>
          )}
          <p className="hint">
            Toca un diseño: {looseClips >= 2 ? 'se aplica a los clips de tu pista principal (desde el cursor)' : 'te pedirá las fotos o vídeos'}. Se reproducen a la vez, cada uno en su hueco, y luego puedes cambiar el diseño cuando quieras.
          </p>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Crop

type RatioId = 'free' | 'cell' | 'source' | 'canvas' | '1:1' | '5:4' | '4:3' | '3:2' | '16:9' | '21:9';
type Orient = 'h' | 'v';
type Mode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

const NUMERIC: RatioId[] = ['1:1', '5:4', '4:3', '3:2', '16:9', '21:9'];
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.04;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Mirrors a crop for display when the clip is flipped (the same call converts back). */
const mirror = (k: Crop, fh: boolean, fv: boolean): Crop => ({ x: fh ? 1 - k.x - k.w : k.x, y: fv ? 1 - k.y - k.h : k.y, w: k.w, h: k.h });

/** Largest crop with pixel aspect `r` on a source of aspect `src`, centered on `around`. */
function centered(r: number, src: number, around: Crop = FULL): Crop {
  let w = 1, h = (w * src) / r;
  if (h > 1) { h = 1; w = (h * r) / src; }
  const cx = around.x + around.w / 2, cy = around.y + around.h / 2;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

const orientOf = (r: number): Orient => (r < 1 ? 'v' : 'h');
const orientTo = (r: number, o: Orient) => (o === 'h' ? Math.max(r, 1 / r) : Math.min(r, 1 / r));

function clipStart(c: MediaClip, kind: string) {
  const p = S().project!;
  if (kind !== 'main') return c.start;
  return layoutMain(p.main).find((l) => l.clip.id === c.id)?.start ?? 0;
}

/** Full-screen crop editor for the selected photo or video. */
export function CropSheet() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const c = findSelected(project, selection) as MediaClip | null;
  const asset = c && c.type === 'media' ? project.assets.find((a) => a.id === c.assetId) : undefined;
  const srcAspect = asset && asset.width && asset.height ? asset.width / asset.height : 1;
  const cellAspect = c?.collage && c.crop ? (c.crop.w * srcAspect) / c.crop.h : null;
  const [ratio, setRatio] = useState<RatioId>(cellAspect ? 'cell' : 'free');
  const [orient, setOrient] = useState<Orient>(() => orientOf(cellAspect ?? aspectRatio(project)));
  const [original] = useState(() => ({ crop: c?.crop ?? null, radius: c?.radius }));
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; x0: number; y0: number; k0: Crop } | null>(null);

  // Biggest stage with the source's shape that fits the free space.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const fit = () => {
      const pad = 28;
      const w = Math.max(40, el.clientWidth - pad * 2), h = Math.max(40, el.clientHeight - pad * 2);
      const sw = Math.min(w, h * srcAspect);
      setStage({ w: sw, h: sw / srcAspect });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [srcAspect]);

  // Draws the source frame under the playhead (or the photo).
  const assetId = asset?.id;
  useEffect(() => {
    if (!asset || !c) return;
    let alive = true;
    const local = clamp(S().time - clipStart(c, selection!.kind), 0, clipDuration(c));
    const t = asset.kind === 'video' ? sourceTime(c, 0, local) : 0;
    void library.still(asset, t, 1080).then((img) => {
      const cv = canvasRef.current;
      if (!alive || !img || !cv) return;
      const iw = (img as { width: number }).width, ih = (img as { height: number }).height;
      const k = Math.min(1, 1600 / Math.max(iw, ih));
      cv.width = Math.max(1, Math.round(iw * k));
      cv.height = Math.max(1, Math.round(ih * k));
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    });
    return () => { alive = false; };
    // Only reload when the clip's media changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, c?.id]);

  if (!c || !asset) return null;

  const view = mirror(c.crop ?? FULL, c.flipH, c.flipV);
  const ratioValue = (id: RatioId, o: Orient): number | null => {
    switch (id) {
      case 'free': return null;
      case 'cell': return cellAspect;
      case 'source': return orientTo(srcAspect, o);
      case 'canvas': return orientTo(aspectRatio(project), o);
      default: { const [a, b] = id.split(':').map(Number); return orientTo(a / b, o); }
    }
  };
  const lock = ratioValue(ratio, orient);
  const canTurn = ratio !== 'free' && ratio !== 'cell' && ratio !== '1:1';
  const label = (id: RatioId) => {
    if (!NUMERIC.includes(id)) return { free: 'Libre', cell: 'Hueco', source: 'Original', canvas: 'Lienzo' }[id as string] ?? id;
    const [a, b] = id.split(':');
    return orient === 'v' && a !== b ? `${b}:${a}` : id;
  };

  const commitView = (v: Crop) => {
    const k = mirror(v, c.flipH, c.flipV);
    const full = k.w > 0.999 && k.h > 0.999;
    S().update((d) => {
      const x = [...d.main, ...d.overlays].find((m) => m.id === c.id);
      if (x) x.crop = full ? null : { x: k.x, y: k.y, w: k.w, h: k.h };
    }, c.id + ':crop');
  };

  const apply = (id: RatioId, o: Orient) => {
    setRatio(id);
    setOrient(o);
    const r = ratioValue(id, o);
    if (r) commitView(centered(r, srcAspect, view));
  };
  const chooseRatio = (id: RatioId) => {
    // Original and Lienzo start in their own orientation.
    const o = id === 'source' ? orientOf(srcAspect) : id === 'canvas' ? orientOf(aspectRatio(project)) : orient;
    apply(id, o);
  };
  const turn = () => apply(ratio, orient === 'h' ? 'v' : 'h');

  const close = () => S().setSheet(null);
  const cancel = () => {
    S().update((d) => {
      const x = [...d.main, ...d.overlays].find((m) => m.id === c.id);
      if (x) { x.crop = original.crop; x.radius = original.radius; }
    });
    close();
  };
  const reset = () => {
    setRatio('free');
    S().update((d) => {
      const x = [...d.main, ...d.overlays].find((m) => m.id === c.id);
      if (x) x.crop = null;
    });
  };

  const down = (mode: Mode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    stageRef.current?.setPointerCapture(e.pointerId);
    drag.current = { mode, x0: e.clientX, y0: e.clientY, k0: view };
    setDragging(true);
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !stage.w) return;
    const dx = (e.clientX - d.x0) / stage.w, dy = (e.clientY - d.y0) / stage.h;
    const k = d.k0;
    if (d.mode === 'move') {
      commitView({ ...k, x: clamp(k.x + dx, 0, 1 - k.w), y: clamp(k.y + dy, 0, 1 - k.h) });
      return;
    }
    if (d.mode.length === 1) {
      // Edges (only without a fixed proportion).
      let { x, y, w, h } = k;
      if (d.mode === 'e') w = clamp(k.w + dx, MIN, 1 - k.x);
      if (d.mode === 's') h = clamp(k.h + dy, MIN, 1 - k.y);
      if (d.mode === 'w') { x = clamp(k.x + dx, 0, k.x + k.w - MIN); w = k.x + k.w - x; }
      if (d.mode === 'n') { y = clamp(k.y + dy, 0, k.y + k.h - MIN); h = k.y + k.h - y; }
      commitView({ x, y, w, h });
      return;
    }
    // Corners: the opposite corner stays put.
    const east = d.mode === 'ne' || d.mode === 'se';
    const south = d.mode === 'sw' || d.mode === 'se';
    const ax = east ? k.x : k.x + k.w;
    const ay = south ? k.y : k.y + k.h;
    const maxW = east ? 1 - ax : ax;
    const maxH = south ? 1 - ay : ay;
    let w = clamp(east ? k.x + k.w + dx - ax : ax - (k.x + dx), MIN, maxW);
    let h = clamp(south ? k.y + k.h + dy - ay : ay - (k.y + dy), MIN, maxH);
    if (lock) {
      // Keep the proportion in source pixels: (w * srcAspect) / h = lock.
      const hFromW = (w * srcAspect) / lock;
      if (hFromW <= maxH) h = Math.max(hFromW, MIN);
      else { h = maxH; w = (h * lock) / srcAspect; }
      w = Math.min(w, maxW);
    }
    commitView({ x: east ? ax : ax - w, y: south ? ay : ay - h, w, h });
  };

  const up = () => { drag.current = null; setDragging(false); };
  const flip = `scale(${c.flipH ? -1 : 1}, ${c.flipV ? -1 : 1})`;
  const handles: Mode[] = lock ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'];
  const ratios: RatioId[] = [...(cellAspect ? ['cell' as RatioId] : []), 'free', 'source', 'canvas', ...NUMERIC];
  const pxW = Math.round(asset.width * view.w), pxH = Math.round(asset.height * view.h);

  return (
    <div className="crop-full" role="dialog" aria-label="Recortar">
      <div className="crop-top">
        <button className="crop-txt" onClick={cancel}>Cancelar</button>
        <h3>Recortar</h3>
        <button className="crop-txt done" onClick={close}>Listo</button>
      </div>
      <div className="crop-area" ref={areaRef}>
        <div ref={stageRef} className={`crop-stage ${dragging ? 'dragging' : ''}`} style={{ width: stage.w, height: stage.h }}
          onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <canvas ref={canvasRef} className="crop-img" style={{ transform: flip }} />
          <div className="crop-box" style={{ left: `${view.x * 100}%`, top: `${view.y * 100}%`, width: `${view.w * 100}%`, height: `${view.h * 100}%` }}
            onPointerDown={down('move')}>
            <span className="crop-grid" />
            {handles.map((h) => <span key={h} className={`crop-handle ${h}`} onPointerDown={down(h)} />)}
          </div>
        </div>
        {asset.width > 0 && <div className="crop-size">{pxW} × {pxH}</div>}
      </div>
      <div className="crop-controls">
        <div className="crop-ratios">
          <button className={`crop-turn ${canTurn ? '' : 'off'}`} disabled={!canTurn} onClick={turn} aria-label="Girar proporción">
            <Icon name="rotate" size={18} /><span>{orient === 'h' ? 'Horizontal' : 'Vertical'}</span>
          </button>
          <div className="chips">
            {ratios.map((id) => (
              <button key={id} className={`chip ${ratio === id ? 'on' : ''}`} onClick={() => chooseRatio(id)}>{label(id)}</button>
            ))}
          </div>
        </div>
        <Slider label="Esquinas" min={0} max={0.5} step={0.01} value={c.radius ?? 0}
          onChange={(v) => S().update((d) => { const x = [...d.main, ...d.overlays].find((m) => m.id === c.id); if (x) x.radius = v || undefined; }, c.id + ':radius')} format={pct} />
        <div className="btn-row">
          <button className="btn" onClick={reset}><Icon name="reset" size={18} />Restablecer</button>
        </div>
      </div>
    </div>
  );
}
