// GLSL ES 3.00 shaders for the compositor. On iPhone, WebGL2 runs on Metal
// (through ANGLE), so all of this is GPU work.

export const VERT = `#version 300 es
in vec2 a_pos;
uniform mat3 u_mat;
uniform vec2 u_res;
out vec2 v_local;
void main() {
  vec3 p = u_mat * vec3(a_pos, 1.0);
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  v_local = a_pos + 0.5;
}`;

export const LAYER_FRAG = `#version 300 es
precision highp float;
in vec2 v_local;
uniform sampler2D u_tex;
uniform vec4 u_uvRect;
uniform vec2 u_flip;
uniform vec2 u_px;
uniform float u_opacity;
uniform float u_grade;
uniform float u_exposure, u_brightness, u_contrast, u_saturation, u_temp, u_tint;
uniform float u_highlights, u_shadows, u_fade, u_vignette, u_grain, u_sharpen, u_mono, u_sepia;
uniform vec3 u_splitS, u_splitH;
uniform float u_split;
uniform int u_effect;
uniform float u_effAmt;
uniform float u_time;
uniform float u_chromaOn;
uniform vec2 u_keyCbCr;
uniform float u_chromaSim, u_chromaSmooth;
out vec4 o;

vec2 cbcr(vec3 c) { return vec2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

uniform vec4 u_stab;
uniform float u_stabOn, u_aspect;

vec2 toUV(vec2 l) {
  l = clamp(l, 0.0, 1.0);
  if (u_flip.x > 0.5) l.x = 1.0 - l.x;
  if (u_flip.y > 0.5) l.y = 1.0 - l.y;
  if (u_stabOn > 0.5) {
    // Stabilization: source = R(-a) * (shown / zoom - shift), in pixel-proportional units.
    vec2 k = vec2(u_aspect, 1.0);
    vec2 p = (l - 0.5) * k / u_stab.w - u_stab.xy * k;
    float c = cos(u_stab.z), s = sin(u_stab.z);
    l = clamp(mat2(c, -s, s, c) * p / k + 0.5, 0.0, 1.0);
  }
  return u_uvRect.xy + l * u_uvRect.zw;
}
vec4 samp(vec2 l) { return texture(u_tex, toUV(l)); }

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

vec3 grade(vec3 c, vec2 l) {
  c *= exp2(u_exposure);
  c += u_brightness;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c += u_shadows * (1.0 - smoothstep(0.0, 0.55, lum)) * 0.35;
  c += u_highlights * smoothstep(0.45, 1.0, lum) * 0.35;
  c = (c - 0.5) * u_contrast + 0.5;
  c.r += u_temp * 0.12;
  c.b -= u_temp * 0.12;
  c.g -= u_tint * 0.10;
  lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, u_saturation);
  c = mix(c, vec3(lum), u_mono);
  vec3 sep = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
  c = mix(c, sep, u_sepia);
  if (u_split > 0.0) {
    lum = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    vec3 tone = mix(u_splitS, u_splitH, lum);
    c = mix(c, c * tone * 1.6, u_split * 0.6);
  }
  c = mix(c, c * 0.82 + 0.13, u_fade);
  float d = length(l - 0.5) * 1.41;
  c *= 1.0 - u_vignette * smoothstep(0.35, 1.05, d);
  if (u_grain > 0.0) c += (hash(l * 917.0 + fract(u_time * 7.13)) - 0.5) * u_grain * 0.3;
  return c;
}

void main() {
  vec2 l = v_local;
  float t = u_time;
  float a = u_effAmt;
  // Effects that move the sampling position.
  if (u_effect == 1) {
    float tick = floor(t * 12.0);
    float row = floor(l.y * 18.0);
    if (hash(vec2(row, tick)) > 1.0 - 0.35 * a) l.x += (hash(vec2(tick, row)) - 0.5) * 0.18 * a;
  } else if (u_effect == 2) {
    l.x += sin(l.y * 40.0 + t * 6.0) * 0.0025 * a + (hash(vec2(floor(l.y * 120.0), floor(t * 30.0))) - 0.5) * 0.004 * a;
  } else if (u_effect == 6) {
    vec2 b = u_px * mix(6.0, 48.0, a);
    l = (floor(l / b) + 0.5) * b;
  } else if (u_effect == 7) {
    l.x = l.x < 0.5 ? l.x : 1.0 - l.x;
  } else if (u_effect == 12) {
    vec2 p = l - 0.5;
    float ang = atan(p.y, p.x) + t * 0.3;
    float r = length(p);
    float seg = 6.2831853 / mix(3.0, 10.0, a);
    ang = mod(ang, seg);
    ang = abs(ang - seg * 0.5);
    l = vec2(cos(ang), sin(ang)) * r + 0.5;
  }

  vec4 c;
  if (u_effect == 1 || u_effect == 2 || u_effect == 5) {
    float s = u_effect == 5 ? 0.012 * a * (0.6 + 0.4 * sin(t * 3.0)) : (u_effect == 1 ? 0.012 * a : 0.006 * a);
    vec4 m = samp(l);
    c = vec4(samp(l + vec2(s, 0.0)).r, m.g, samp(l - vec2(s, 0.0)).b, m.a);
  } else if (u_effect == 11) {
    vec4 acc = vec4(0.0);
    float rad = a * 24.0;
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      float ang = fi * 2.39996;
      float r = sqrt((fi + 0.5) / 16.0) * rad;
      acc += samp(l + vec2(cos(ang), sin(ang)) * r * u_px);
    }
    c = acc / 16.0;
  } else {
    c = samp(l);
  }

  if (u_sharpen > 0.0) {
    vec4 n = samp(l + vec2(u_px.x, 0.0)) + samp(l - vec2(u_px.x, 0.0)) + samp(l + vec2(0.0, u_px.y)) + samp(l - vec2(0.0, u_px.y));
    c.rgb += (c.rgb - n.rgb * 0.25) * u_sharpen * 1.5;
  }

  float alpha = c.a;
  vec3 rgb = alpha > 0.0 ? c.rgb / alpha : c.rgb;
  if (u_chromaOn > 0.5) {
    float d = distance(cbcr(rgb), u_keyCbCr);
    float k = smoothstep(u_chromaSim, u_chromaSim + u_chromaSmooth + 0.001, d);
    // Pull the key colour out of the edges (spill).
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(vec3(lum), rgb, clamp(k * 1.2, 0.0, 1.0));
    alpha *= k;
  }
  if (u_grade > 0.5) rgb = grade(rgb, v_local);

  // Effects that change the color.
  if (u_effect == 2) {
    rgb *= 0.88 + 0.12 * sin(v_local.y * 900.0);
    rgb += (hash(v_local * 500.0 + t) - 0.5) * 0.12 * a;
    rgb = mix(rgb, vec3(dot(rgb, vec3(0.3, 0.59, 0.11))), 0.2 * a);
  } else if (u_effect == 8) {
    rgb += vec3(pow(max(0.0, sin(t * 6.2831 * 1.2)), 12.0) * a * 1.2);
  } else if (u_effect == 9) {
    vec3 sep = vec3(dot(rgb, vec3(0.393, 0.769, 0.189)), dot(rgb, vec3(0.349, 0.686, 0.168)), dot(rgb, vec3(0.272, 0.534, 0.131)));
    rgb = mix(rgb, sep, a);
    rgb *= 0.92 + 0.08 * hash(vec2(floor(t * 18.0), 1.0));
    float sx = hash(vec2(floor(t * 9.0), 3.0));
    rgb *= 1.0 - 0.5 * a * smoothstep(0.003, 0.0, abs(v_local.x - sx)) * step(0.6, hash(vec2(floor(t * 9.0), 7.0)));
    rgb += (hash(v_local * 700.0 + t) - 0.5) * 0.2 * a;
    rgb *= 1.0 - 0.6 * a * smoothstep(0.4, 1.0, length(v_local - 0.5) * 1.41);
  } else if (u_effect == 10) {
    rgb = hueRotate(rgb, t * 2.0 * a + v_local.y * 2.0 * a);
  } else if (u_effect == 13) {
    rgb = mix(rgb, 1.0 - rgb, a);
  }

  rgb = clamp(rgb, 0.0, 1.0);
  float oa = alpha * u_opacity;
  o = vec4(rgb * oa, oa);
}`;

export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_local;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_radius;
out vec4 o;
void main() {
  vec2 uv = vec2(v_local.x, 1.0 - v_local.y);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int x = -3; x <= 3; x++) {
    for (int y = -3; y <= 3; y++) {
      vec2 off = vec2(float(x), float(y));
      float w = exp(-dot(off, off) / 8.0);
      acc += texture(u_tex, uv + off * u_texel * u_radius) * w;
      wsum += w;
    }
  }
  o = vec4((acc / wsum).rgb * 0.8, 1.0);
}`;

export const TRANSITION_FRAG = `#version 300 es
precision highp float;
in vec2 v_local;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_p;
uniform int u_type;
uniform vec2 u_res;
out vec4 o;

vec4 A(vec2 l) { return texture(u_a, vec2(l.x, 1.0 - l.y)); }
vec4 B(vec2 l) { return texture(u_b, vec2(l.x, 1.0 - l.y)); }
bool inside(vec2 l) { return l.x >= 0.0 && l.x <= 1.0 && l.y >= 0.0 && l.y <= 1.0; }
vec4 blurA(vec2 l, float r) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 12; i++) { float fi = float(i); float an = fi * 2.39996; float rr = sqrt((fi + 0.5) / 12.0) * r; acc += A(l + vec2(cos(an), sin(an)) * rr / u_res); }
  return acc / 12.0;
}
vec4 blurB(vec2 l, float r) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 12; i++) { float fi = float(i); float an = fi * 2.39996; float rr = sqrt((fi + 0.5) / 12.0) * r; acc += B(l + vec2(cos(an), sin(an)) * rr / u_res); }
  return acc / 12.0;
}

void main() {
  vec2 l = v_local;
  float p = clamp(u_p, 0.0, 1.0);
  float e = p * p * (3.0 - 2.0 * p);
  vec4 c;
  if (u_type == 2) {
    c = p < 0.5 ? mix(A(l), vec4(0, 0, 0, 1), p * 2.0) : mix(vec4(0, 0, 0, 1), B(l), p * 2.0 - 1.0);
  } else if (u_type == 3) {
    c = p < 0.5 ? mix(A(l), vec4(1), p * 2.0) : mix(vec4(1), B(l), p * 2.0 - 1.0);
  } else if (u_type == 4) {
    c = l.x < 1.0 - e ? A(l + vec2(e, 0.0)) : B(l - vec2(1.0 - e, 0.0));
  } else if (u_type == 5) {
    c = l.x > e ? A(l - vec2(e, 0.0)) : B(l + vec2(1.0 - e, 0.0));
  } else if (u_type == 6) {
    c = l.y < 1.0 - e ? A(l + vec2(0.0, e)) : B(l - vec2(0.0, 1.0 - e));
  } else if (u_type == 7) {
    vec4 a = A((l - 0.5) / (1.0 + e * 1.5) + 0.5);
    vec4 b = B((l - 0.5) / (0.4 + e * 0.6) + 0.5);
    c = mix(a, b, e);
  } else if (u_type == 8) {
    c = mix(A(l), B(l), smoothstep(l.x - 0.04, l.x + 0.04, e * 1.08 - 0.04));
  } else if (u_type == 9) {
    vec2 d = (l - 0.5) * vec2(u_res.x / u_res.y, 1.0);
    float r = e * length(vec2(u_res.x / u_res.y, 1.0)) * 0.55;
    c = mix(A(l), B(l), smoothstep(r + 0.01, r - 0.01, length(d)));
  } else if (u_type == 10) {
    float bell = sin(p * 3.14159);
    c = mix(blurA(l, bell * 40.0), blurB(l, bell * 40.0), e);
  } else if (u_type == 11) {
    float bell = sin(p * 3.14159);
    vec2 b = vec2(max(1.0, bell * 60.0)) / u_res;
    vec2 q = (floor(l / b) + 0.5) * b;
    c = p < 0.5 ? A(q) : B(q);
  } else if (u_type == 12) {
    float ang = e * 6.2831;
    float s = 1.0 - sin(p * 3.14159) * 0.6;
    vec2 d = (l - 0.5) * vec2(u_res.x / u_res.y, 1.0);
    d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * d / s;
    vec2 q = d / vec2(u_res.x / u_res.y, 1.0) + 0.5;
    c = inside(q) ? (p < 0.5 ? A(q) : B(q)) : vec4(0, 0, 0, 1);
  } else {
    c = mix(A(l), B(l), p);
  }
  o = c;
}`;
