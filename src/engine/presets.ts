import type { Adjust, TextClip } from '../types';

export interface FilterPreset {
  id: string;
  name: string;
  adjust: Partial<Adjust>;
  mono?: number;
  sepia?: number;
  /** Split toning: shadow tint and highlight tint (RGB 0..1), mixed by `amount`. */
  split?: { shadow: [number, number, number]; highlight: [number, number, number]; amount: number };
  /** Swatch color for the picker. */
  swatch: string;
}

export const FILTERS: FilterPreset[] = [
  { id: 'none', name: 'Ninguno', adjust: {}, swatch: '#444' },
  { id: 'vivid', name: 'Vivo', adjust: { saturation: 35, contrast: 15 }, swatch: '#ff5a5a' },
  { id: 'warm', name: 'Cálido', adjust: { temperature: 35, saturation: 10 }, swatch: '#ff9f43' },
  { id: 'cool', name: 'Frío', adjust: { temperature: -35, tint: -5 }, swatch: '#54a0ff' },
  { id: 'cine', name: 'Cine', adjust: { contrast: 20, saturation: -10 }, split: { shadow: [0.0, 0.35, 0.45], highlight: [1.0, 0.6, 0.3], amount: 0.35 }, swatch: '#1dd1a1' },
  { id: 'bw', name: 'B y N', adjust: { contrast: 15 }, mono: 1, swatch: '#bbb' },
  { id: 'noir', name: 'Noir', adjust: { contrast: 45, brightness: -10, vignette: 40 }, mono: 1, swatch: '#222' },
  { id: 'sepia', name: 'Sepia', adjust: { contrast: 5 }, sepia: 1, swatch: '#a67c52' },
  { id: 'vintage', name: 'Vintage', adjust: { fade: 30, saturation: -20, temperature: 20, vignette: 30, grain: 25 }, swatch: '#c8a26b' },
  { id: 'faded', name: 'Desvaído', adjust: { fade: 45, contrast: -15, saturation: -15 }, swatch: '#a4b0be' },
  { id: 'rosy', name: 'Rosa', adjust: { tint: 25, temperature: 10, brightness: 5 }, swatch: '#ff9ff3' },
  { id: 'film', name: 'Película', adjust: { fade: 15, contrast: 10, grain: 35 }, split: { shadow: [0.2, 0.25, 0.45], highlight: [1.0, 0.85, 0.6], amount: 0.25 }, swatch: '#ffeaa7' },
  { id: 'moody', name: 'Moody', adjust: { saturation: -30, contrast: 20, exposure: -10, shadows: -20 }, swatch: '#576574' },
  { id: 'bright', name: 'Luminoso', adjust: { exposure: 15, shadows: 25, saturation: 10 }, swatch: '#feca57' },
  { id: 'teal', name: 'Teal', adjust: { saturation: 15 }, split: { shadow: [0.0, 0.5, 0.5], highlight: [1.0, 0.7, 0.4], amount: 0.5 }, swatch: '#00d2d3' },
  { id: 'dream', name: 'Sueño', adjust: { fade: 20, brightness: 10, saturation: -5, tint: 10 }, split: { shadow: [0.5, 0.3, 0.7], highlight: [1, 0.9, 0.95], amount: 0.3 }, swatch: '#c56cf0' },
];

export const filterById = (id: string) => FILTERS.find((f) => f.id === id) ?? FILTERS[0];

/** Effects are animated shader passes; the index is the shader's effect id. */
export const EFFECTS: { id: string; name: string; icon: string }[] = [
  { id: 'none', name: 'Ninguno', icon: '⊘' },
  { id: 'glitch', name: 'Glitch', icon: '📺' },
  { id: 'vhs', name: 'VHS', icon: '📼' },
  { id: 'shake', name: 'Temblor', icon: '〰️' },
  { id: 'zoom', name: 'Pulso', icon: '💓' },
  { id: 'rgb', name: 'RGB', icon: '🌈' },
  { id: 'pixel', name: 'Píxel', icon: '👾' },
  { id: 'mirror', name: 'Espejo', icon: '🪞' },
  { id: 'flash', name: 'Flash', icon: '⚡' },
  { id: 'oldfilm', name: 'Cine viejo', icon: '🎞️' },
  { id: 'hue', name: 'Arcoíris', icon: '🎨' },
  { id: 'blur', name: 'Desenfoque', icon: '💧' },
  { id: 'kaleido', name: 'Caleidoscopio', icon: '🔮' },
  { id: 'invert', name: 'Negativo', icon: '◐' },
];
export const effectIndex = (id: string) => Math.max(0, EFFECTS.findIndex((e) => e.id === id));

export const TRANSITIONS: { id: string; name: string; icon: string }[] = [
  { id: 'none', name: 'Ninguna', icon: '⊘' },
  { id: 'fade', name: 'Fundido', icon: '◑' },
  { id: 'black', name: 'Negro', icon: '■' },
  { id: 'white', name: 'Destello', icon: '□' },
  { id: 'slideLeft', name: 'Deslizar ←', icon: '⇠' },
  { id: 'slideRight', name: 'Deslizar →', icon: '⇢' },
  { id: 'slideUp', name: 'Deslizar ↑', icon: '⇡' },
  { id: 'zoom', name: 'Zoom', icon: '⊕' },
  { id: 'wipe', name: 'Barrido', icon: '▤' },
  { id: 'circle', name: 'Círculo', icon: '◯' },
  { id: 'blur', name: 'Desenfoque', icon: '💧' },
  { id: 'pixel', name: 'Píxeles', icon: '▦' },
  { id: 'spin', name: 'Giro', icon: '↻' },
];
export const transitionIndex = (id: string) => Math.max(0, TRANSITIONS.findIndex((e) => e.id === id));

export const ANIMS_IN = [
  { id: 'fade', name: 'Aparecer' },
  { id: 'zoomIn', name: 'Acercar' },
  { id: 'zoomOut', name: 'Alejar' },
  { id: 'slideLeft', name: 'Desde dcha.' },
  { id: 'slideRight', name: 'Desde izq.' },
  { id: 'slideUp', name: 'Desde abajo' },
  { id: 'slideDown', name: 'Desde arriba' },
  { id: 'pop', name: 'Rebote' },
  { id: 'spin', name: 'Giro' },
  { id: 'typewriter', name: 'Máquina escribir' },
];
export const ANIMS_OUT = ANIMS_IN.filter((a) => a.id !== 'typewriter');
export const ANIMS_LOOP = [
  { id: 'pulse', name: 'Latido' },
  { id: 'float', name: 'Flotar' },
  { id: 'wiggle', name: 'Balanceo' },
  { id: 'kenburns', name: 'Ken Burns' },
  { id: 'shake', name: 'Vibrar' },
];

export const FONTS: { id: string; css: string }[] = [
  { id: 'Montserrat', css: '"Montserrat", -apple-system, sans-serif' },
  { id: 'Sistema', css: '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif' },
  { id: 'Bebas Neue', css: '"Bebas Neue", Impact, sans-serif' },
  { id: 'Anton', css: '"Anton", Impact, sans-serif' },
  { id: 'Pacifico', css: '"Pacifico", cursive' },
  { id: 'Lobster', css: '"Lobster", cursive' },
  { id: 'Permanent Marker', css: '"Permanent Marker", cursive' },
  { id: 'Playfair Display', css: '"Playfair Display", Georgia, serif' },
  { id: 'Oswald', css: '"Oswald", sans-serif' },
  { id: 'Caveat', css: '"Caveat", cursive' },
  { id: 'Press Start 2P', css: '"Press Start 2P", monospace' },
  { id: 'Courier', css: '"Courier New", Courier, monospace' },
];
export const fontCss = (id: string) => (FONTS.find((f) => f.id === id) ?? FONTS[0]).css;

export const TEXT_STYLES: { name: string; color: string; strokeColor: string; strokeWidth: number; bgColor: string; bgOpacity: number; shadow: boolean }[] = [
  { name: 'Clásico', color: '#ffffff', strokeColor: '#000000', strokeWidth: 0, bgColor: '#000000', bgOpacity: 0, shadow: true },
  { name: 'Contorno', color: '#ffffff', strokeColor: '#000000', strokeWidth: 8, bgColor: '#000000', bgOpacity: 0, shadow: false },
  { name: 'Amarillo', color: '#ffe600', strokeColor: '#000000', strokeWidth: 8, bgColor: '#000000', bgOpacity: 0, shadow: false },
  { name: 'Caja', color: '#000000', strokeColor: '#000000', strokeWidth: 0, bgColor: '#ffffff', bgOpacity: 1, shadow: false },
  { name: 'Caja negra', color: '#ffffff', strokeColor: '#000000', strokeWidth: 0, bgColor: '#000000', bgOpacity: 0.7, shadow: false },
  { name: 'Neón', color: '#00fff0', strokeColor: '#ff00e5', strokeWidth: 4, bgColor: '#000000', bgOpacity: 0, shadow: true },
  { name: 'Rojo', color: '#ffffff', strokeColor: '#ff2d55', strokeWidth: 10, bgColor: '#000000', bgOpacity: 0, shadow: false },
  { name: 'Burbuja', color: '#ffffff', strokeColor: '#000000', strokeWidth: 0, bgColor: '#ff2d55', bgOpacity: 1, shadow: false },
];

export const COLORS = [
  '#ffffff', '#000000', '#ff2d55', '#ff9500', '#ffcc00', '#34c759', '#00c7be',
  '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff6482', '#a2845e', '#8e8e93',
];

export const STICKERS = [
  '😂', '😍', '🔥', '❤️', '👍', '🎉', '😎', '🤯', '😭', '🥳', '💯', '✨', '⭐', '🚀',
  '👀', '💥', '🙌', '👏', '🤔', '😱', '🥰', '😜', '🤩', '😡', '💀', '👻', '🎵', '🎶',
  '📍', '✅', '❌', '⚠️', '➡️', '⬅️', '⬆️', '⬇️', '💬', '💭', '🗯️', '🏆', '🎁', '🌈',
  '☀️', '🌙', '⚡', '💧', '🌸', '🍕', '🍔', '☕', '🎬', '📸', '🎮', '⚽', '🏀', '🐶',
  '🐱', '🦄', '💎', '💰', '🕶️', '👑', '💪', '🙏', '👉', '👈', '🤙', '✌️', 'LOL', 'WOW',
  'OMG', 'NEW', 'SALE', 'LIVE',
];

/** Word-by-word text animations (rendered in engine/text.ts). */
export const WORD_ANIMS = [
  { id: 'none', label: 'Ninguna' },
  { id: 'karaoke', label: 'Karaoke' },
  { id: 'highlight', label: 'Resaltar' },
  { id: 'box', label: 'Caja' },
  { id: 'pop', label: 'Palabra a palabra' },
  { id: 'reveal', label: 'Aparecer' },
  { id: 'bounce', label: 'Salto' },
  { id: 'wave', label: 'Ola' },
];

export const HIGHLIGHTS = ['#ffe600', '#3cff6b', '#00c7ff', '#ff2d55', '#ff9500', '#ff2bd6', '#ffffff', '#000000'];

type TemplateStyle = Pick<TextClip, 'font' | 'bold' | 'italic' | 'color' | 'strokeColor' | 'strokeWidth' | 'bgColor' | 'bgOpacity'
  | 'shadow' | 'letterSpacing' | 'animIn' | 'animOut' | 'animLoop' | 'wordAnim' | 'highlight' | 'uppercase' | 'glow'>;

export interface TextTemplate {
  id: string;
  name: string;
  /** Offered as a subtitle style too. */
  caption: boolean;
  style: Partial<TemplateStyle>;
}

const TEMPLATE_BASE: TemplateStyle = {
  font: 'Montserrat', bold: true, italic: false, color: '#ffffff', strokeColor: '#000000', strokeWidth: 0,
  bgColor: '#000000', bgOpacity: 0, shadow: false, letterSpacing: 0, animIn: null, animOut: null, animLoop: null,
  wordAnim: 'none', highlight: '#ffe600', uppercase: false, glow: false,
};

export const TEXT_TEMPLATES: TextTemplate[] = [
  { id: 'karaoke', name: 'Karaoke', caption: true, style: { strokeWidth: 8, wordAnim: 'karaoke', highlight: '#ffe600' } },
  { id: 'highlight', name: 'Resaltado', caption: true, style: { strokeWidth: 10, uppercase: true, wordAnim: 'highlight', highlight: '#3cff6b' } },
  { id: 'box', name: 'Caja', caption: true, style: { shadow: true, uppercase: true, wordAnim: 'box', highlight: '#ff2d55' } },
  { id: 'pop', name: 'Palabra a palabra', caption: true, style: { font: 'Anton', bold: false, strokeWidth: 8, uppercase: true, wordAnim: 'pop', highlight: '#ffe600' } },
  { id: 'reveal', name: 'Suave', caption: true, style: { shadow: true, wordAnim: 'reveal' } },
  { id: 'bounce', name: 'Salto', caption: true, style: { strokeWidth: 8, uppercase: true, wordAnim: 'bounce', highlight: '#00c7ff' } },
  { id: 'neon', name: 'Neón', caption: true, style: { glow: true, wordAnim: 'highlight', highlight: '#ff2bd6' } },
  { id: 'simple', name: 'Sencillo', caption: true, style: { strokeWidth: 8, animIn: { id: 'pop', duration: 0.15 } } },
  { id: 'tv', name: 'Televisión', caption: true, style: { bold: false, bgOpacity: 0.65, animIn: { id: 'fade', duration: 0.1 } } },
  { id: 'typewriter', name: 'Máquina', caption: false, style: { font: 'Courier', shadow: true, animIn: { id: 'typewriter', duration: 1.2 } } },
  { id: 'cinema', name: 'Cine', caption: false, style: { font: 'Playfair Display', bold: false, uppercase: true, letterSpacing: 14, shadow: true, animIn: { id: 'fade', duration: 0.8 }, animOut: { id: 'fade', duration: 0.6 } } },
  { id: 'wave', name: 'Ola', caption: false, style: { font: 'Lobster', bold: false, strokeColor: '#ff2d55', strokeWidth: 6, wordAnim: 'wave' } },
  { id: 'impact', name: 'Impacto', caption: false, style: { font: 'Anton', bold: false, uppercase: true, color: '#ffe600', strokeWidth: 10, animIn: { id: 'zoomOut', duration: 0.35 }, animLoop: { id: 'pulse', duration: 0.8 } } },
  { id: 'label', name: 'Etiqueta', caption: false, style: { bgColor: '#ff2d55', bgOpacity: 1, animIn: { id: 'pop', duration: 0.3 }, animLoop: { id: 'wiggle', duration: 1.2 } } },
  { id: 'retro', name: 'Retro', caption: false, style: { font: 'Press Start 2P', bold: false, color: '#00fff0', glow: true, highlight: '#ff00e5', animIn: { id: 'typewriter', duration: 1 } } },
  { id: 'slide', name: 'Rótulo', caption: false, style: { font: 'Oswald', uppercase: true, bgOpacity: 0.8, animIn: { id: 'slideRight', duration: 0.4 }, animOut: { id: 'slideLeft', duration: 0.4 } } },
];

/** Gives a text clip the full look of a template (font, colors and animations). */
export function applyTemplate(c: TextClip, id: string) {
  const t = TEXT_TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  Object.assign(c, structuredClone({ ...TEMPLATE_BASE, ...t.style }));
}

/** Which template a clip currently looks like, if any. */
export function templateOf(c: TextClip): string | null {
  const keys = Object.keys(TEMPLATE_BASE) as (keyof TemplateStyle)[];
  const norm = (v: unknown) => JSON.stringify(v ?? null);
  return TEXT_TEMPLATES.find((t) => keys.every((k) => norm(c[k] ?? TEMPLATE_BASE[k]) === norm({ ...TEMPLATE_BASE, ...t.style }[k])))?.id ?? null;
}
