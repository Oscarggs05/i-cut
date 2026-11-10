import { useEffect, useRef, useState } from 'react';
import type { AspectId, Crop, MediaClip } from '../../types';
import { useEditor } from '../../store/editor';
import { findSelected, pickFiles, updateSelected } from '../../store/actions';
import { addCollage } from '../../store/collage';
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
  const [tpl, setTpl] = useState(COLLAGES[0].id);
  const [aspect, setAspect] = useState<AspectId>(COLLAGE_ASPECTS.includes(project.aspect) ? project.aspect : '9:16');
  const [gap, setGap] = useState(0.012);
  const [radius, setRadius] = useState(0);
  const [color, setColor] = useState(project.background.type === 'color' ? project.background.color : '#ffffff');
  const ratio = ratioOf(aspect);
  const n = collageById(tpl).cells.length;
  const hasContent = project.main.length > 0;

  const pick = async () => {
    const files = await pickFiles('video/*,image/*');
    if (!files.length) return;
    await addCollage(files, { template: tpl, aspect, gap, radius, color });
  };

  return (
    <Sheet title="Plantillas de collage">
      <Chips options={COLLAGE_ASPECTS.map((a) => ({ id: a, label: a }))} value={aspect} onChange={setAspect} />
      <div className="grid collage-grid">
        {COLLAGES.map((t) => (
          <button key={t.id} className={`cell ${tpl === t.id ? 'on' : ''}`} onClick={() => setTpl(t.id)}>
            <span className="sw"><CollagePreview id={t.id} ratio={ratio} gap={gap} radius={radius} color={color} /></span>
            {t.name}
          </button>
        ))}
      </div>
      <Slider label="Separación" min={0} max={0.06} step={0.002} value={gap} onChange={setGap} format={(v) => `${Math.round(v * 1000) / 10}`} />
      <Slider label="Esquinas" min={0} max={0.5} step={0.01} value={radius} onChange={setRadius} format={pct} />
      <Swatches colors={COLORS} value={color} onChange={setColor} />
      <button className="btn primary block" style={{ marginTop: 10 }} onClick={() => void pick()}>
        <Icon name="image" size={18} />Elegir {n} fotos o vídeos
      </button>
      <p className="hint">
        Se rellenan en el orden en que los elijas. Cada hueco es un clip: tócalo para recortarlo, moverlo dentro del hueco, aplicarle filtros o cambiar su duración.
        {hasContent && ' El collage se añade al final y el formato elegido se aplica a todo el proyecto.'}
      </p>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Crop

type RatioId = 'free' | 'keep' | 'source' | 'canvas' | '1:1' | '4:5' | '9:16' | '16:9' | '3:4' | '4:3';
type Mode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const RATIOS: { id: RatioId; label: string }[] = [
  { id: 'free', label: 'Libre' },
  { id: 'keep', label: 'Actual' },
  { id: 'source', label: 'Original' },
  { id: 'canvas', label: 'Lienzo' },
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
  { id: '9:16', label: '9:16' },
  { id: '16:9', label: '16:9' },
  { id: '3:4', label: '3:4' },
  { id: '4:3', label: '4:3' },
];

const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.05;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Mirrors a crop for display when the clip is flipped (the same call converts back). */
const mirror = (k: Crop, fh: boolean, fv: boolean): Crop => ({ x: fh ? 1 - k.x - k.w : k.x, y: fv ? 1 - k.y - k.h : k.y, w: k.w, h: k.h });

/** Largest centered crop with a pixel aspect `r` on a source of aspect `src`. */
function centered(r: number, src: number, around: Crop = FULL): Crop {
  let w = 1, h = (w * src) / r;
  if (h > 1) { h = 1; w = (h * r) / src; }
  const cx = around.x + around.w / 2, cy = around.y + around.h / 2;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

/** Timeline start of a media clip (main clips are laid out one after another). */
function clipStart(c: MediaClip, kind: string) {
  const p = S().project!;
  if (kind !== 'main') return c.start;
  return layoutMain(p.main).find((l) => l.clip.id === c.id)?.start ?? 0;
}

export function CropSheet() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const c = findSelected(project, selection) as MediaClip | null;
  const asset = c && c.type === 'media' ? project.assets.find((a) => a.id === c.assetId) : undefined;
  const srcAspect = asset && asset.width && asset.height ? asset.width / asset.height : 1;
  const [ratio, setRatio] = useState<RatioId>(c?.crop ? 'keep' : 'free');
  const [keepAspect] = useState(() => (c?.crop ? (c.crop.w * srcAspect) / c.crop.h : srcAspect));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; x0: number; y0: number; k0: Crop } | null>(null);

  // Draws the source frame under the playhead (or the photo).
  const assetId = asset?.id;
  useEffect(() => {
    if (!asset || !c) return;
    let alive = true;
    const local = clamp(S().time - clipStart(c, selection!.kind), 0, clipDuration(c));
    const t = asset.kind === 'video' ? sourceTime(c, 0, local) : 0;
    void library.still(asset, t).then((img) => {
      const cv = canvasRef.current;
      if (!alive || !img || !cv) return;
      const iw = (img as { width: number }).width, ih = (img as { height: number }).height;
      const k = Math.min(1, 1080 / Math.max(iw, ih));
      cv.width = Math.max(1, Math.round(iw * k));
      cv.height = Math.max(1, Math.round(ih * k));
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    });
    return () => { alive = false; };
    // Only reload when the clip's media changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, c?.id]);

  if (!c || !asset) return null;

  const crop = c.crop ?? FULL;
  const view = mirror(crop, c.flipH, c.flipV);
  const lockedRatio = (id: RatioId): number | null => {
    switch (id) {
      case 'free': return null;
      case 'keep': return keepAspect;
      case 'source': return srcAspect;
      case 'canvas': return aspectRatio(project);
      default: { const [a, b] = id.split(':').map(Number); return a / b; }
    }
  };
  const lock = lockedRatio(ratio);

  const commit = (k: Crop) => {
    const full = k.w > 0.999 && k.h > 0.999;
    updateSelected<MediaClip>((x) => { x.crop = full ? null : { x: k.x, y: k.y, w: k.w, h: k.h }; }, 'crop');
  };
  const commitView = (v: Crop) => commit(mirror(v, c.flipH, c.flipV));

  const chooseRatio = (id: RatioId) => {
    setRatio(id);
    const r = lockedRatio(id);
    if (r) commitView(centered(r, srcAspect, view));
  };

  const down = (mode: Mode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    stageRef.current?.setPointerCapture(e.pointerId);
    drag.current = { mode, x0: e.clientX, y0: e.clientY, k0: view };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const st = stageRef.current;
    if (!d || !st) return;
    const rect = st.getBoundingClientRect();
    const dx = (e.clientX - d.x0) / rect.width, dy = (e.clientY - d.y0) / rect.height;
    const k = d.k0;
    if (d.mode === 'move') {
      commitView({ ...k, x: clamp(k.x + dx, 0, 1 - k.w), y: clamp(k.y + dy, 0, 1 - k.h) });
      return;
    }
    // Resize from a corner while the opposite corner stays put.
    const east = d.mode === 'ne' || d.mode === 'se';
    const south = d.mode === 'sw' || d.mode === 'se';
    const ax = east ? k.x : k.x + k.w;
    const ay = south ? k.y : k.y + k.h;
    const maxW = east ? 1 - ax : ax;
    const maxH = south ? 1 - ay : ay;
    let w = clamp(east ? k.x + k.w + dx - ax : ax - (k.x + dx), MIN, maxW);
    let h = clamp(south ? k.y + k.h + dy - ay : ay - (k.y + dy), MIN, maxH);
    if (lock) {
      // Keep the chosen proportion in source pixels: (w * srcAspect) / h = lock.
      const hFromW = (w * srcAspect) / lock;
      if (hFromW <= maxH) h = Math.max(hFromW, MIN);
      else { h = maxH; w = (h * lock) / srcAspect; }
      w = Math.min(w, maxW);
    }
    commitView({ x: east ? ax : ax - w, y: south ? ay : ay - h, w, h });
  };

  const up = () => { drag.current = null; };
  const flip = `scale(${c.flipH ? -1 : 1}, ${c.flipV ? -1 : 1})`;
  const handles: Mode[] = ['nw', 'ne', 'sw', 'se'];

  return (
    <Sheet title="Recortar">
      <div className="crop-wrap">
        <div ref={stageRef} className="crop-stage" style={{ aspectRatio: String(srcAspect), width: `min(100%, calc(var(--crop-h) * ${srcAspect}))` }}
          onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <canvas ref={canvasRef} className="crop-img" style={{ transform: flip }} />
          <div className="crop-box" style={{ left: `${view.x * 100}%`, top: `${view.y * 100}%`, width: `${view.w * 100}%`, height: `${view.h * 100}%` }}
            onPointerDown={down('move')}>
            <span className="crop-grid" />
            {handles.map((h) => <span key={h} className={`crop-handle ${h}`} onPointerDown={down(h)} />)}
          </div>
        </div>
      </div>
      <Chips options={RATIOS.filter((r) => r.id !== 'keep' || c.crop)} value={ratio} onChange={chooseRatio} />
      <Slider label="Esquinas" min={0} max={0.5} step={0.01} value={c.radius ?? 0} onChange={(v) => updateSelected<MediaClip>((x) => { x.radius = v || undefined; }, 'radius')} format={pct} />
      <div className="btn-row">
        <button className="btn" onClick={() => { setRatio('free'); updateSelected<MediaClip>((x) => { x.crop = null; }); }}><Icon name="reset" size={18} />Restablecer</button>
      </div>
      <p className="hint">Arrastra el recuadro para moverlo y las esquinas para cambiar su tamaño. Solo se verá la parte de dentro.</p>
    </Sheet>
  );
}
