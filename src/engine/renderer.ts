import type { Project, Visual } from '../types';
import { effectIndex, filterById, transitionIndex } from './presets';
import { animState, type MediaLayer, type Scene } from './scene';
import { resolveVisual } from './keyframes';
import { stabAt, type StabCorr } from './stabilize';
import { BLUR_FRAG, LAYER_FRAG, TRANSITION_FRAG, VERT } from './shaders';
import { renderText } from './text';

export interface FrameRef {
  key: string;
  src: TexImageSource | null;
  width: number;
  height: number;
  /** Re-uploaded when this changes; -1 uploads every frame (video). */
  version: number | string;
}

export type FrameProvider = (layer: MediaLayer) => FrameRef | null;

export interface LayerBounds {
  id: string;
  kind: 'main' | 'overlay' | 'text';
  /** Corners in canvas pixels: top-left, top-right, bottom-right, bottom-left. */
  corners: [number, number][];
  center: [number, number];
  width: number;
  height: number;
  rotation: number;
}

interface TexEntry { tex: WebGLTexture; w: number; h: number; version: number | string; used: number }
interface Fbo { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }
type Prog = { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private layer: Prog;
  private blur: Prog;
  private trans: Prog;
  private vao: WebGLVertexArrayObject;
  private textures = new Map<string, TexEntry>();
  private fbos: Record<string, Fbo> = {};
  private frame = 0;
  width = 1;
  height = 1;
  lost = false;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas, opts: { preserve?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: !!opts.preserve,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 no está disponible en este navegador.');
    this.gl = gl;
    if ('addEventListener' in canvas) {
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    }
    this.layer = this.program(LAYER_FRAG);
    this.blur = this.program(BLUR_FRAG);
    this.trans = this.program(TRANSITION_FRAG);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    for (const prog of [this.layer, this.blur, this.trans]) {
      const loc = gl.getAttribLocation(prog.p, 'a_pos');
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
    }
    this.vao = vao;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  private program(frag: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
    return { p, u: new Map() };
  }

  private loc(prog: Prog, name: string) {
    if (!prog.u.has(name)) prog.u.set(name, this.gl.getUniformLocation(prog.p, name));
    return prog.u.get(name)!;
  }

  resize(w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.width = w;
    this.height = h;
  }

  private texture(ref: FrameRef): TexEntry | null {
    const gl = this.gl;
    let e = this.textures.get(ref.key);
    if (ref.src && (!e || ref.version === -1 || e.version !== ref.version)) {
      if (!e) {
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        e = { tex, w: ref.width, h: ref.height, version: ref.version, used: this.frame };
        this.textures.set(ref.key, e);
      }
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ref.src);
        e.w = ref.width;
        e.h = ref.height;
        e.version = ref.version;
      } catch {
        // Source not decodable yet; keep the previous frame.
      }
    }
    if (e) e.used = this.frame;
    return e ?? null;
  }

  private fbo(name: string, w: number, h: number): Fbo {
    const gl = this.gl;
    let f = this.fbos[name];
    if (f && f.w === w && f.h === h) return f;
    if (f) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    f = { fb, tex, w, h };
    this.fbos[name] = f;
    return f;
  }

  private bindTarget(f: Fbo | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f ? f.fb : null);
    gl.viewport(0, 0, f ? f.w : this.width, f ? f.h : this.height);
  }

  private setMat(prog: Prog, cx: number, cy: number, w: number, h: number, rotDeg: number, resW: number, resH: number) {
    const r = (rotDeg * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    this.gl.uniformMatrix3fv(this.loc(prog, 'u_mat'), false, [c * w, s * w, 0, -s * h, c * h, 0, cx, cy, 1]);
    this.gl.uniform2f(this.loc(prog, 'u_res'), resW, resH);
  }

  private setGrade(v: Visual | null, time: number, effect: string, effAmt: number) {
    const gl = this.gl;
    const L = (n: string) => this.loc(this.layer, n);
    const ck = v?.chroma;
    gl.uniform1f(L('u_chromaOn'), ck ? 1 : 0);
    if (ck) {
      const n = parseInt(ck.color.slice(1), 16);
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      gl.uniform2f(L('u_keyCbCr'), -0.1687 * r - 0.3313 * g + 0.5 * b, 0.5 * r - 0.4187 * g - 0.0813 * b);
      gl.uniform1f(L('u_chromaSim'), ck.similarity);
      gl.uniform1f(L('u_chromaSmooth'), ck.smoothness);
    }
    if (!v) {
      gl.uniform1f(L('u_grade'), 0);
      gl.uniform1f(L('u_sharpen'), 0);
      gl.uniform1i(L('u_effect'), effectIndex(effect));
      gl.uniform1f(L('u_effAmt'), effAmt);
      gl.uniform1f(L('u_time'), time);
      return;
    }
    const f = filterById(v.filter.id);
    const k = v.filter.intensity;
    const a = (n: keyof Visual['adjust']) => (v.adjust[n] + (f.adjust[n] ?? 0) * k) / 100;
    gl.uniform1f(L('u_grade'), 1);
    gl.uniform1f(L('u_exposure'), a('exposure'));
    gl.uniform1f(L('u_brightness'), a('brightness') * 0.25);
    gl.uniform1f(L('u_contrast'), Math.max(0.05, 1 + a('contrast') * 0.6));
    gl.uniform1f(L('u_saturation'), Math.max(0, 1 + a('saturation')));
    gl.uniform1f(L('u_temp'), a('temperature'));
    gl.uniform1f(L('u_tint'), a('tint'));
    gl.uniform1f(L('u_highlights'), a('highlights'));
    gl.uniform1f(L('u_shadows'), a('shadows'));
    gl.uniform1f(L('u_fade'), Math.max(0, a('fade')));
    gl.uniform1f(L('u_vignette'), Math.max(0, a('vignette')));
    gl.uniform1f(L('u_grain'), Math.max(0, a('grain')));
    gl.uniform1f(L('u_sharpen'), Math.max(0, a('sharpen')));
    gl.uniform1f(L('u_mono'), (f.mono ?? 0) * k);
    gl.uniform1f(L('u_sepia'), (f.sepia ?? 0) * k);
    gl.uniform1f(L('u_split'), f.split ? f.split.amount * k : 0);
    gl.uniform3fv(L('u_splitS'), f.split?.shadow ?? [1, 1, 1]);
    gl.uniform3fv(L('u_splitH'), f.split?.highlight ?? [1, 1, 1]);
    gl.uniform1i(L('u_effect'), effectIndex(effect));
    gl.uniform1f(L('u_effAmt'), effAmt);
    gl.uniform1f(L('u_time'), time);
  }

  private drawQuad() {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Draws a textured layer into the bound target of size resW x resH. */
  private drawTex(tex: TexEntry, cx: number, cy: number, w: number, h: number, rot: number, resW: number, resH: number,
    opts: { visual: Visual | null; flipH?: boolean; flipV?: boolean; opacity: number; rect?: [number, number, number, number]; time: number; effect: string; effAmt: number; stab?: StabCorr | null }) {
    const gl = this.gl;
    const P = this.layer;
    gl.useProgram(P.p);
    this.setMat(P, cx, cy, w, h, rot, resW, resH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    gl.uniform1i(this.loc(P, 'u_tex'), 0);
    gl.uniform4fv(this.loc(P, 'u_uvRect'), opts.rect ?? [0, 0, 1, 1]);
    gl.uniform2f(this.loc(P, 'u_flip'), opts.flipH ? 1 : 0, opts.flipV ? 1 : 0);
    gl.uniform2f(this.loc(P, 'u_px'), 1 / Math.max(1, Math.abs(w)), 1 / Math.max(1, Math.abs(h)));
    gl.uniform1f(this.loc(P, 'u_opacity'), opts.opacity);
    const sc = opts.stab;
    gl.uniform1f(this.loc(P, 'u_stabOn'), sc ? 1 : 0);
    if (sc) {
      gl.uniform4f(this.loc(P, 'u_stab'), sc.dx, sc.dy, sc.da, sc.zoom);
      gl.uniform1f(this.loc(P, 'u_aspect'), tex.w / Math.max(1, tex.h));
    }
    this.setGrade(opts.visual, opts.time, opts.effect, opts.effAmt);
    this.drawQuad();
  }

  private drawBackground(p: Project, layer: MediaLayer | null, tex: TexEntry | null, target: Fbo | null) {
    const gl = this.gl;
    const W = this.width, H = this.height;
    if (p.background.type === 'color' || !layer || !tex) {
      this.bindTarget(target);
      const hex = p.background.type === 'color' ? p.background.color : '#000000';
      const n = parseInt(hex.slice(1), 16);
      gl.clearColor(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    // Blurred, cover-fitted copy of the clip behind it.
    const sw = Math.max(16, Math.round(W / 12)), shh = Math.max(16, Math.round(H / 12));
    const small = this.fbo('bgSmall', sw, shh);
    this.bindTarget(small);
    gl.disable(gl.BLEND);
    const sa = tex.w / tex.h, ta = W / H;
    const rect: [number, number, number, number] = sa > ta ? [(1 - ta / sa) / 2, 0, ta / sa, 1] : [0, (1 - sa / ta) / 2, 1, sa / ta];
    this.drawTex(tex, sw / 2, shh / 2, sw, shh, 0, sw, shh, {
      visual: { ...layer.clip, chroma: null }, flipH: layer.clip.flipH, flipV: layer.clip.flipV, opacity: 1, rect, time: layer.localT, effect: 'none', effAmt: 0,
    });
    this.bindTarget(target);
    const B = this.blur;
    gl.useProgram(B.p);
    this.setMat(B, W / 2, H / 2, W, H, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, small.tex);
    gl.uniform1i(this.loc(B, 'u_tex'), 0);
    gl.uniform2f(this.loc(B, 'u_texel'), 1 / sw, 1 / shh);
    gl.uniform1f(this.loc(B, 'u_radius'), 0.3 + p.background.blur * 1.6);
    this.drawQuad();
  }

  private mediaGeometry(layer: MediaLayer, tex: TexEntry, v = resolveVisual(layer.clip, layer.localT)) {
    const W = this.width, H = this.height;
    const st = animState(v, layer.localT, layer.duration, v.effect.id, v.effect.intensity);
    const s0 = Math.min(W / tex.w, H / tex.h);
    const scale = v.transform.scale * st.scale;
    return {
      cx: W / 2 + (v.transform.x + st.dx) * W,
      cy: H / 2 + (v.transform.y + st.dy) * H,
      w: tex.w * s0 * scale,
      h: tex.h * s0 * scale,
      rot: v.transform.rotation + st.rotation,
      opacity: v.opacity * st.opacity,
    };
  }

  private drawMedia(layer: MediaLayer, tex: TexEntry, out: LayerBounds[], kind: LayerBounds['kind']) {
    const v = resolveVisual(layer.clip, layer.localT);
    const g = this.mediaGeometry(layer, tex, v);
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.drawTex(tex, g.cx, g.cy, g.w, g.h, g.rot, this.width, this.height, {
      visual: v, flipH: v.flipH, flipV: v.flipV, opacity: g.opacity, time: layer.localT, effect: v.effect.id, effAmt: v.effect.intensity,
      stab: stabAt(layer.clip, layer.sourceTime),
    });
    out.push(bounds(v.id, kind, g.cx, g.cy, g.w, g.h, g.rot));
  }

  render(p: Project, scene: Scene, provider: FrameProvider): LayerBounds[] {
    const gl = this.gl;
    this.frame++;
    const out: LayerBounds[] = [];
    const W = this.width, H = this.height;
    const get = (l: MediaLayer) => {
      const ref = provider(l);
      return ref ? this.texture(ref) : null;
    };

    const m = scene.main;
    if (m && m.b) {
      const ta = get(m.a), tb = get(m.b);
      const fa = this.fbo('A', W, H), fb = this.fbo('B', W, H);
      this.drawBackground(p, m.a, ta, fa);
      if (ta) this.drawMedia(m.a, ta, [], 'main');
      this.drawBackground(p, m.b, tb, fb);
      if (tb) this.drawMedia(m.b, tb, [], 'main');
      this.bindTarget(null);
      gl.disable(gl.BLEND);
      const T = this.trans;
      gl.useProgram(T.p);
      this.setMat(T, W / 2, H / 2, W, H, 0, W, H);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fa.tex);
      gl.uniform1i(this.loc(T, 'u_a'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fb.tex);
      gl.uniform1i(this.loc(T, 'u_b'), 1);
      gl.uniform1f(this.loc(T, 'u_p'), m.p);
      gl.uniform1i(this.loc(T, 'u_type'), transitionIndex(m.transition));
      this.drawQuad();
      gl.activeTexture(gl.TEXTURE0);
    } else {
      const ta = m ? get(m.a) : null;
      gl.disable(gl.BLEND);
      this.drawBackground(p, m?.a ?? null, ta, null);
      if (m && ta) this.drawMedia(m.a, ta, out, 'main');
    }

    this.bindTarget(null);
    for (const o of scene.overlays) {
      const t = get(o);
      if (t) this.drawMedia(o, t, out, 'overlay');
    }

    const k = Math.min(W, H) / 1080;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const tl of scene.texts) {
      const c = resolveVisual(tl.clip, tl.localT);
      const st = animState(c, tl.localT, tl.duration, c.effect.id, c.effect.intensity);
      const img = renderText(c, k, st.chars);
      const tex = this.texture({ key: 'text:' + c.id, src: img.canvas, width: img.canvas.width, height: img.canvas.height, version: img.key });
      if (!tex) continue;
      const scale = c.transform.scale * st.scale;
      const cx = W / 2 + (c.transform.x + st.dx) * W;
      const cy = H / 2 + (c.transform.y + st.dy) * H;
      const w = tex.w * scale, h = tex.h * scale;
      const rot = c.transform.rotation + st.rotation;
      this.drawTex(tex, cx, cy, w, h, rot, W, H, {
        visual: null, flipH: c.flipH, flipV: c.flipV, opacity: c.opacity * st.opacity, time: tl.localT, effect: c.effect.id, effAmt: c.effect.intensity,
      });
      out.push(bounds(c.id, 'text', cx, cy, w, h, rot));
    }

    if (this.frame % 120 === 0) this.gc();
    return out;
  }

  private gc() {
    for (const [k, e] of this.textures) {
      if (this.frame - e.used > 240) {
        this.gl.deleteTexture(e.tex);
        this.textures.delete(k);
      }
    }
  }

  dispose() {
    const gl = this.gl;
    for (const e of this.textures.values()) gl.deleteTexture(e.tex);
    this.textures.clear();
    for (const f of Object.values(this.fbos)) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); }
    this.fbos = {};
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

function bounds(id: string, kind: LayerBounds['kind'], cx: number, cy: number, w: number, h: number, rot: number): LayerBounds {
  const r = (rot * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const pt = (x: number, y: number): [number, number] => [cx + c * x * w - s * y * h, cy + s * x * w + c * y * h];
  return { id, kind, corners: [pt(-0.5, -0.5), pt(0.5, -0.5), pt(0.5, 0.5), pt(-0.5, 0.5)], center: [cx, cy], width: w, height: h, rotation: rot };
}
