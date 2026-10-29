import type { Project, TextClip } from '../types';
import { fontCss } from './presets';

export interface TextImage {
  canvas: HTMLCanvasElement;
  key: string;
}

const cache = new Map<string, TextImage>();

function hexToRgba(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function measure(ctx: CanvasRenderingContext2D, line: string, spacing: number) {
  if (!spacing) return ctx.measureText(line).width;
  let w = 0;
  for (const ch of line) w += ctx.measureText(ch).width + spacing;
  return Math.max(0, w - spacing);
}

/** Draws `line` from `x`, optionally moving each character vertically (wave). */
function drawLine(ctx: CanvasRenderingContext2D, line: string, x: number, y: number, spacing: number, stroke: boolean, charDy?: (i: number) => number) {
  if (!spacing && !charDy) {
    if (stroke) ctx.strokeText(line, x, y); else ctx.fillText(line, x, y);
    return;
  }
  let cx = x;
  let i = 0;
  for (const ch of line) {
    const cy = y + (charDy ? charDy(i) : 0);
    if (stroke) ctx.strokeText(ch, cx, cy); else ctx.fillText(ch, cx, cy);
    cx += ctx.measureText(ch).width + spacing;
    i++;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
const q = (v: number) => Math.round(v * 20) / 20;

/** How one word looks at a given moment. */
interface WordState {
  alpha: number;
  scale: number;
  /** Vertical offset in font sizes. */
  dy: number;
  /** 1 paints the word in the highlight color. */
  hi: number;
  /** Karaoke: fraction of the word already sung. */
  sweep: number;
  box: number;
}

/** Word timings: from speech recognition when they match the text, else spread evenly. */
function wordTimes(c: TextClip, n: number): { start: number; end: number }[] {
  if (c.words && c.words.length === n) return c.words;
  // Reveal styles finish early so the whole line can be read before it goes.
  const span = c.wordAnim === 'pop' || c.wordAnim === 'reveal' ? Math.min(c.duration * 0.7, n * 0.3) : c.duration;
  return Array.from({ length: n }, (_, i) => ({ start: (span * i) / n, end: (span * (i + 1)) / n }));
}

function wordStates(c: TextClip, n: number, t: number): WordState[] {
  const anim = c.wordAnim ?? 'none';
  const times = wordTimes(c, n);
  return times.map((w, i) => {
    const s: WordState = { alpha: 1, scale: 1, dy: 0, hi: 0, sweep: 0, box: 0 };
    if (anim === 'none' || anim === 'wave') return s;
    // A word stays "current" until the next one starts, so the highlight
    // doesn't blink off during short pauses.
    const until = i + 1 < n ? Math.max(w.end, times[i + 1].start) : Infinity;
    const active = t >= w.start && t < until;
    const into = t - w.start;
    switch (anim) {
      case 'karaoke': s.sweep = q(clamp01(into / Math.max(0.05, w.end - w.start))); break;
      case 'highlight': if (active) { s.hi = 1; s.scale = q(1 + 0.12 * easeOut(clamp01(into / 0.08))); } break;
      case 'box': if (active) { s.box = 1; s.scale = 1.05; } break;
      case 'pop':
        if (t < w.start) { s.alpha = 0; s.scale = 0; } else s.scale = q(Math.max(0, easeOutBack(clamp01(into / 0.18))));
        if (active && c.highlight) s.hi = 1;
        break;
      case 'reveal': {
        const p = clamp01(into / 0.25);
        s.alpha = q(p);
        s.dy = q((1 - easeOut(p)) * 0.35);
        break;
      }
      case 'bounce':
        if (active) { s.hi = 1; s.dy = -q(Math.sin(Math.PI * clamp01(into / 0.25)) * 0.25); }
        break;
    }
    return s;
  });
}

/**
 * Renders a text clip to a canvas at `scale` (canvas short side / 1080).
 * `chars` reveals only part of the text (typewriter animation) and `t` is
 * the time into the clip, used by word-by-word animations.
 */
export function renderText(c: TextClip, scale: number, chars = 1, t = 0): TextImage {
  const text = c.uppercase ? c.text.toLocaleUpperCase() : c.text;
  const anim = c.wordAnim ?? 'none';
  const lines = text.split('\n').map((l) => l.split(/\s+/).filter(Boolean));
  const nWords = lines.reduce((s, l) => s + l.length, 0);
  const states = wordStates(c, nWords, t);
  const totalChars = [...text].length;
  const shownChars = chars >= 1 ? totalChars : Math.floor(totalChars * chars);
  // Wave moves every frame; 30 steps a second is smooth and keeps the cache useful.
  const waveT = anim === 'wave' ? Math.round(t * 30) / 30 : 0;
  const qs = Math.round(scale * 100) / 100;
  const key = [text, shownChars, c.font, c.size, c.color, c.bold, c.italic, c.align, c.strokeColor, c.strokeWidth, c.bgColor, c.bgOpacity, c.shadow,
    c.letterSpacing, qs, anim, c.highlight, c.glow, waveT, states.map((s) => `${s.alpha},${s.scale},${s.dy},${s.hi},${s.sweep},${s.box}`).join(';')].join('|');
  const hit = cache.get(key);
  if (hit) return hit;

  const size = Math.max(4, c.size * qs);
  const spacing = c.letterSpacing * qs;
  const fontStr = `${c.italic ? 'italic ' : ''}${c.bold ? '700' : '400'} ${size}px ${fontCss(c.font)}`;
  // Web fonts load lazily; the player clears this cache when they arrive.
  try { if (document.fonts && !document.fonts.check(fontStr)) void document.fonts.load(fontStr); } catch { /* ignore */ }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = fontStr;
  // Lay out every word up front (against the full text, so the box doesn't
  // change size while words appear or typing runs).
  const gap = ctx.measureText(' ').width + spacing * 2;
  type Placed = { text: string; x: number; w: number; line: number; first: number; index: number };
  const words: Placed[] = [];
  const widths: number[] = [];
  let index = 0, first = 0;
  lines.forEach((ws, li) => {
    let x = 0;
    for (const w of ws) {
      const ww = measure(ctx, w, spacing);
      words.push({ text: w, x, w: ww, line: li, first, index: index++ });
      x += ww + gap;
      first += [...w].length + 1;
    }
    widths.push(ws.length ? x - gap : measure(ctx, ' ', spacing));
  });
  const lineH = size * 1.22;
  const maxW = Math.max(1, ...widths);
  const stroke = c.strokeWidth * qs;
  const padX = size * (c.bgOpacity > 0 ? 0.45 : 0.15) + stroke;
  const padY = size * (c.bgOpacity > 0 ? 0.25 : 0.12) + stroke;
  // Room around the box for the shadow, glow and words that grow or jump.
  const outer = (c.shadow ? size * 0.25 : 0) + (c.glow ? size * 0.3 : 0) + (anim !== 'none' ? size * 0.3 : 0);
  const w = Math.ceil(maxW + padX * 2 + outer * 2);
  const h = Math.ceil(lines.length * lineH + padY * 2 + outer * 2);
  canvas.width = Math.min(4096, Math.max(2, w));
  canvas.height = Math.min(4096, Math.max(2, h));
  ctx.font = fontStr;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';

  if (c.bgOpacity > 0) {
    ctx.fillStyle = hexToRgba(c.bgColor, c.bgOpacity);
    roundRect(ctx, outer, outer, w - outer * 2, h - outer * 2, size * 0.3);
    ctx.fill();
  }

  const lineX = (i: number) => {
    const lw = widths[i] ?? 0;
    if (c.align === 'left') return outer + padX;
    if (c.align === 'right') return w - outer - padX - lw;
    return (w - lw) / 2;
  };
  const hiColor = c.highlight ?? '#ffe600';
  const visible = (p: Placed) => [...p.text].slice(0, Math.max(0, shownChars - p.first)).join('');
  const charDy = anim === 'wave' ? (p: Placed) => (i: number) => Math.sin(waveT * 6 - (p.first + i) * 0.55) * size * 0.12 : () => undefined;

  /** Positions the context at the word's center, scaled, and runs `draw` at its left edge. */
  const at = (p: Placed, draw: (x: number) => void) => {
    const s = states[p.index];
    if (s.alpha <= 0 || s.scale <= 0) return;
    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.translate(lineX(p.line) + p.x + p.w / 2, outer + padY + lineH * (p.line + 0.5) + s.dy * size);
    ctx.scale(s.scale, s.scale);
    draw(-p.w / 2);
    ctx.restore();
  };

  // Box behind the current word.
  for (const p of words) {
    if (!states[p.index].box) continue;
    at(p, (x) => {
      ctx.fillStyle = hiColor;
      const px = size * 0.14;
      roundRect(ctx, x - px, -size * 0.62, p.w + px * 2, size * 1.24, size * 0.22);
      ctx.fill();
    });
  }

  const shadowOn = (blur: number, dy: number, a: number) => {
    ctx.shadowColor = `rgba(0,0,0,${a})`;
    ctx.shadowBlur = size * blur;
    ctx.shadowOffsetY = size * dy;
  };
  if (stroke > 0) {
    ctx.strokeStyle = c.strokeColor;
    ctx.lineWidth = stroke * 2;
    for (const p of words) {
      at(p, (x) => {
        if (c.shadow) shadowOn(0.15, 0.04, 0.6);
        drawLine(ctx, visible(p), x, 0, spacing, true, charDy(p));
      });
    }
  }
  for (const p of words) {
    const s = states[p.index];
    at(p, (x) => {
      const str = visible(p);
      const paint = (color: string) => {
        ctx.fillStyle = color;
        if (c.glow) {
          ctx.shadowColor = color === c.color ? (c.highlight ?? c.color) : color;
          ctx.shadowBlur = size * 0.35;
          ctx.shadowOffsetY = 0;
          drawLine(ctx, str, x, 0, spacing, false, charDy(p));
        } else if (c.shadow && stroke <= 0) shadowOn(0.18, 0.05, 0.65);
        drawLine(ctx, str, x, 0, spacing, false, charDy(p));
        ctx.shadowColor = 'transparent';
      };
      paint(s.hi ? hiColor : c.color);
      if (s.sweep > 0) {
        // Karaoke: the sung part of the word is repainted in the highlight color.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - size, -size, size + p.w * s.sweep, size * 2);
        ctx.clip();
        paint(hiColor);
        ctx.restore();
      }
    });
  }

  const img = { canvas, key };
  cache.set(key, img);
  if (cache.size > 120) {
    const k = cache.keys().next().value;
    if (k !== undefined) cache.delete(k);
  }
  return img;
}

export function clearTextCache() {
  cache.clear();
}

/**
 * Loads every web font the project's texts use and drops renders made with a
 * fallback font, so an export never starts with the wrong typeface.
 */
export async function loadProjectFonts(p: Project) {
  if (!document.fonts) return;
  const fonts = new Set(p.texts.map((c) => `${c.italic ? 'italic ' : ''}${c.bold ? '700' : '400'} 40px ${fontCss(c.font)}`));
  await Promise.all([...fonts].map((f) => document.fonts.load(f).catch(() => [])));
  await document.fonts.ready;
  clearTextCache();
}
