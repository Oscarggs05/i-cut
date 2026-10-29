import { useEffect, useRef, useState } from 'react';
import type { TextClip } from '../../types';
import { useEditor } from '../../store/editor';
import { addText, findSelected, updateSelected } from '../../store/actions';
import { COLORS, FONTS, HIGHLIGHTS, STICKERS, TEXT_STYLES, TEXT_TEMPLATES, WORD_ANIMS, applyTemplate, fontCss, templateOf, type TextTemplate } from '../../engine/presets';
import { Chips, Sheet, Slider, Swatches, Toggle } from '../controls';

const S = () => useEditor.getState();

function useText() {
  const project = useEditor((s) => s.project)!;
  const selection = useEditor((s) => s.selection);
  const c = findSelected(project, selection);
  return c && c.type === 'text' ? c : null;
}

const upd = (fn: (c: TextClip) => void, key?: string) => updateSelected<TextClip>(fn, key);

/** A small sample of how a template looks: the second letter shows the highlighted word. */
function TemplateSample({ t }: { t: TextTemplate }) {
  const st = t.style;
  const color = st.color ?? '#ffffff';
  const hi = st.highlight ?? '#ffe600';
  const anim = st.wordAnim ?? 'none';
  const word = anim !== 'none' && anim !== 'wave' && anim !== 'reveal';
  const stroke = st.strokeWidth ? `1.5px ${st.strokeColor ?? '#000'}` : undefined;
  return (
    <span className="sw" style={{
      fontFamily: fontCss(st.font ?? 'Montserrat'), fontWeight: st.bold === false ? 400 : 700, fontSize: st.font === 'Press Start 2P' ? 13 : 22,
      background: st.bgOpacity ? st.bgColor : undefined, color, WebkitTextStroke: stroke,
      textShadow: st.glow ? `0 0 8px ${hi}` : st.shadow ? '0 2px 4px rgba(0,0,0,.7)' : undefined,
      fontStyle: anim === 'wave' ? 'italic' : undefined,
    }}>
      <span>
        A
        <span style={word ? (anim === 'box' ? { background: hi, borderRadius: 4, padding: '0 2px' } : { color: hi }) : undefined}>{st.uppercase ? 'A' : 'a'}</span>
      </span>
    </span>
  );
}

/** Template picker; `onPick` gets the template id. */
export function TemplateGrid({ only, value, onPick }: { only?: 'caption'; value: string | null; onPick: (id: string) => void }) {
  return (
    <div className="grid">
      {TEXT_TEMPLATES.filter((t) => !only || t.caption).map((t) => (
        <button key={t.id} className={`cell ${value === t.id ? 'on' : ''}`} onClick={() => onPick(t.id)}>
          <TemplateSample t={t} />{t.name}
        </button>
      ))}
    </div>
  );
}

/** Word animation, highlight color and case for a text (or every caption). */
export function WordControls({ c, set }: { c: TextClip; set: (fn: (x: TextClip) => void) => void }) {
  const anim = c.wordAnim ?? 'none';
  return (
    <>
      <div className="hint">Animación por palabra</div>
      <Chips options={WORD_ANIMS} value={anim} onChange={(v) => set((x) => { x.wordAnim = v; })} />
      {anim !== 'none' && anim !== 'reveal' && (
        <>
          <div className="hint">Color de la palabra resaltada</div>
          <Swatches colors={HIGHLIGHTS} value={c.highlight ?? '#ffe600'} onChange={(col) => set((x) => { x.highlight = col; })} />
        </>
      )}
      <Toggle label="Mayúsculas" on={!!c.uppercase} onChange={(v) => set((x) => { x.uppercase = v; })} />
      <Toggle label="Brillo neón" on={!!c.glow} onChange={(v) => set((x) => { x.glow = v; })} />
    </>
  );
}

export function TextSheet({ initialTab = 'text' }: { initialTab?: 'text' | 'style' | 'tpl' }) {
  const c = useText();
  const [tab, setTab] = useState<'text' | 'tpl' | 'font' | 'style' | 'stroke' | 'bg'>(initialTab);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (tab === 'text' && ta.current) {
      ta.current.focus();
      if (c && (c.text === 'Escribe aquí')) ta.current.select();
    }
  }, [tab]);
  if (!c) return null;
  return (
    <Sheet title={c.sticker ? 'Sticker' : 'Texto'}>
      <div className="tabs">
        <button className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>Texto</button>
        {!c.sticker && <button className={tab === 'tpl' ? 'on' : ''} onClick={() => setTab('tpl')}>Plantillas</button>}
        <button className={tab === 'font' ? 'on' : ''} onClick={() => setTab('font')}>Fuente</button>
        <button className={tab === 'style' ? 'on' : ''} onClick={() => setTab('style')}>Estilo</button>
        <button className={tab === 'stroke' ? 'on' : ''} onClick={() => setTab('stroke')}>Contorno</button>
        <button className={tab === 'bg' ? 'on' : ''} onClick={() => setTab('bg')}>Fondo</button>
      </div>
      {tab === 'text' && (
        <>
          <textarea ref={ta} className="text-input" value={c.text} rows={2} onChange={(e) => upd((x) => { x.text = e.target.value || ' '; }, 'text')} />
          <div className="style-list" style={{ marginTop: 10 }}>
            {TEXT_STYLES.map((s) => (
              <button key={s.name} aria-label={s.name} style={{ color: s.color, background: s.bgOpacity ? s.bgColor : '#3a3a3c', WebkitTextStroke: s.strokeWidth ? `1.5px ${s.strokeColor}` : undefined }}
                onClick={() => upd((x) => { Object.assign(x, { color: s.color, strokeColor: s.strokeColor, strokeWidth: s.strokeWidth, bgColor: s.bgColor, bgOpacity: s.bgOpacity, shadow: s.shadow }); })}>
                Aa
              </button>
            ))}
          </div>
        </>
      )}
      {tab === 'tpl' && (
        <>
          <TemplateGrid value={templateOf(c)} onPick={(id) => upd((x) => applyTemplate(x, id))} />
          <WordControls c={c} set={(fn) => upd(fn)} />
          <p className="hint">Las animaciones por palabra siguen la voz en los subtítulos automáticos; en un texto escrito a mano, las palabras se reparten a lo largo de su duración.</p>
        </>
      )}
      {tab === 'font' && (
        <>
          <div className="font-list">
            {FONTS.map((f) => (
              <button key={f.id} className={c.font === f.id ? 'on' : ''} style={{ fontFamily: f.css }} onClick={() => upd((x) => { x.font = f.id; })}>{f.id}</button>
            ))}
          </div>
          <div className="btn-row">
            <button className={`btn ${c.bold ? 'primary' : ''}`} onClick={() => upd((x) => { x.bold = !x.bold; })}><b>B</b></button>
            <button className={`btn ${c.italic ? 'primary' : ''}`} onClick={() => upd((x) => { x.italic = !x.italic; })}><i>I</i></button>
            {(['left', 'center', 'right'] as const).map((al) => (
              <button key={al} className={`btn ${c.align === al ? 'primary' : ''}`} onClick={() => upd((x) => { x.align = al; })}>{al === 'left' ? '⇤' : al === 'center' ? '≡' : '⇥'}</button>
            ))}
          </div>
          <Slider label="Tamaño" min={20} max={400} step={1} value={c.size} onChange={(v) => upd((x) => { x.size = v; }, 'size')} />
          <Slider label="Espaciado" min={-10} max={60} step={1} value={c.letterSpacing} onChange={(v) => upd((x) => { x.letterSpacing = v; }, 'ls')} />
        </>
      )}
      {tab === 'style' && (
        <>
          <Swatches colors={COLORS} value={c.color} onChange={(col) => upd((x) => { x.color = col; })} />
          <Slider label="Opacidad" min={0} max={1} value={c.opacity} onChange={(v) => upd((x) => { x.opacity = v; }, 'op')} format={(v) => `${Math.round(v * 100)}%`} />
          <Toggle label="Sombra" on={c.shadow} onChange={(v) => upd((x) => { x.shadow = v; })} />
        </>
      )}
      {tab === 'stroke' && (
        <>
          <Swatches colors={COLORS} value={c.strokeColor} onChange={(col) => upd((x) => { x.strokeColor = col; if (!x.strokeWidth) x.strokeWidth = 6; })} />
          <Slider label="Grosor" min={0} max={30} step={0.5} value={c.strokeWidth} onChange={(v) => upd((x) => { x.strokeWidth = v; }, 'sw')} />
        </>
      )}
      {tab === 'bg' && (
        <>
          <Swatches colors={COLORS} value={c.bgColor} onChange={(col) => upd((x) => { x.bgColor = col; if (!x.bgOpacity) x.bgOpacity = 1; })} />
          <Slider label="Opacidad" min={0} max={1} value={c.bgOpacity} onChange={(v) => upd((x) => { x.bgOpacity = v; }, 'bgo')} format={(v) => `${Math.round(v * 100)}%`} />
        </>
      )}
    </Sheet>
  );
}

export function StickersSheet() {
  return (
    <Sheet title="Stickers">
      <div className="sticker-grid">
        {STICKERS.map((s) => (
          <button key={s} className={/^[A-Z]+$/.test(s) ? 'word' : ''} onClick={() => { addText(true, s); S().setSheet(null); }}>{s}</button>
        ))}
      </div>
      <p className="hint">Muévelos, pellízcalos y gíralos sobre la vista previa. Añádeles animaciones desde la barra inferior.</p>
    </Sheet>
  );
}
