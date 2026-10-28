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

function drawLine(ctx: CanvasRenderingContext2D, line: string, x: number, y: number, spacing: number, stroke: boolean) {
  if (!spacing) {
    if (stroke) ctx.strokeText(line, x, y); else ctx.fillText(line, x, y);
    return;
  }
  let cx = x;
  for (const ch of line) {
    if (stroke) ctx.strokeText(ch, cx, y); else ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

/**
 * Renders a text clip to a canvas at `scale` (canvas short side / 1080).
 * `chars` reveals only part of the text (typewriter animation).
 */
export function renderText(c: TextClip, scale: number, chars = 1): TextImage {
  const all = [...c.text];
  const shown = chars >= 1 ? c.text : all.slice(0, Math.floor(all.length * chars)).join('');
  const q = Math.round(scale * 100) / 100;
  const key = [shown, c.font, c.size, c.color, c.bold, c.italic, c.align, c.strokeColor, c.strokeWidth, c.bgColor, c.bgOpacity, c.shadow, c.letterSpacing, q, c.text.length].join('|');
  const hit = cache.get(key);
  if (hit) return hit;

  const size = Math.max(4, c.size * q);
  const spacing = c.letterSpacing * q;
  const fontStr = `${c.italic ? 'italic ' : ''}${c.bold ? '700' : '400'} ${size}px ${fontCss(c.font)}`;
  // Web fonts load lazily; the player clears this cache when they arrive.
  try { if (document.fonts && !document.fonts.check(fontStr)) void document.fonts.load(fontStr); } catch { /* ignore */ }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = fontStr;
  // Measure against the full text so the box doesn't grow while typing.
  const fullLines = c.text.split('\n');
  const lines = shown.split('\n');
  const lineH = size * 1.22;
  const widths = fullLines.map((l) => measure(ctx, l || ' ', spacing));
  const maxW = Math.max(1, ...widths);
  const stroke = c.strokeWidth * q;
  const padX = size * (c.bgOpacity > 0 ? 0.45 : 0.15) + stroke;
  const padY = size * (c.bgOpacity > 0 ? 0.25 : 0.12) + stroke;
  const shadowPad = c.shadow ? size * 0.25 : 0;
  const w = Math.ceil(maxW + padX * 2 + shadowPad * 2);
  const h = Math.ceil(fullLines.length * lineH + padY * 2 + shadowPad * 2);
  canvas.width = Math.min(4096, Math.max(2, w));
  canvas.height = Math.min(4096, Math.max(2, h));
  ctx.font = fontStr;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  if (c.bgOpacity > 0) {
    ctx.fillStyle = hexToRgba(c.bgColor, c.bgOpacity);
    const r = size * 0.3;
    const x = shadowPad, y = shadowPad, bw = w - shadowPad * 2, bh = h - shadowPad * 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + bw, y, x + bw, y + bh, r);
    ctx.arcTo(x + bw, y + bh, x, y + bh, r);
    ctx.arcTo(x, y + bh, x, y, r);
    ctx.arcTo(x, y, x + bw, y, r);
    ctx.closePath();
    ctx.fill();
  }

  const xFor = (i: number) => {
    const lw = widths[i] ?? 0;
    if (c.align === 'left') return shadowPad + padX;
    if (c.align === 'right') return w - shadowPad - padX - lw;
    return (w - lw) / 2;
  };
  ctx.textAlign = 'left';
  lines.forEach((line, i) => {
    const y = shadowPad + padY + lineH * (i + 0.5);
    const x = xFor(i);
    if (stroke > 0) {
      ctx.strokeStyle = c.strokeColor;
      ctx.lineWidth = stroke * 2;
      if (c.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = size * 0.15; ctx.shadowOffsetY = size * 0.04; }
      drawLine(ctx, line, x, y, spacing, true);
      ctx.shadowColor = 'transparent';
    } else if (c.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = size * 0.18;
      ctx.shadowOffsetY = size * 0.05;
    }
    ctx.fillStyle = c.color;
    drawLine(ctx, line, x, y, spacing, false);
    ctx.shadowColor = 'transparent';
  });

  const img = { canvas, key };
  cache.set(key, img);
  if (cache.size > 120) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
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
