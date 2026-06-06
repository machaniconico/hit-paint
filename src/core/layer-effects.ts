import type { RGBA } from '../types';

export interface DropShadowOptions {
  dx: number;
  dy: number;
  blur: number;
  color: RGBA;
  opacity: number;
}

export interface StrokeOutlineOptions {
  size: number;
  color: RGBA;
  position?: 'outside';
}

export interface OuterGlowOptions {
  blur: number;
  color: RGBA;
  opacity: number;
}

type LayerEffectColorObject = { r: number; g: number; b: number; a?: number };
type LayerEffectColorTuple = readonly [number, number, number];

export type LayerEffectColor = LayerEffectColorObject | LayerEffectColorTuple;

export interface InnerShadowOptions {
  dx: number;
  dy: number;
  blur: number;
  color: LayerEffectColor;
  opacity: number;
}

export interface BevelEmbossOptions {
  depth: number;
  blur: number;
  angle: number;
  opacity: number;
}

/** Add a blurred, offset color copy of source alpha below the source pixels. */
export function dropShadow(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  { dx, dy, blur, color, opacity }: DropShadowOptions,
): Uint8ClampedArray {
  assertBufferSize(px, w, h);
  const shadowAlpha = boxBlur(offsetAlpha(alphaMask(px, w, h), w, h, Math.round(dx), Math.round(dy)), w, h, blur);
  const effect = colorizeAlpha(shadowAlpha, color, opacity);
  return compositeSourceOver(effect, px);
}

/** Add an outside-only outline around the source alpha shape. */
export function strokeOutline(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  { size, color }: StrokeOutlineOptions,
): Uint8ClampedArray {
  assertBufferSize(px, w, h);
  const sourceAlpha = alphaMask(px, w, h);
  const strokeAlpha = outsideMask(dilateAlpha(sourceAlpha, w, h, size), sourceAlpha);
  const effect = colorizeAlpha(strokeAlpha, color, 1);
  return compositeSourceOver(effect, px);
}

/** Add a blurred outside-only glow around the source alpha shape. */
export function outerGlow(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  { blur, color, opacity }: OuterGlowOptions,
): Uint8ClampedArray {
  assertBufferSize(px, w, h);
  const sourceAlpha = alphaMask(px, w, h);
  const glowAlpha = outsideMask(boxBlur(sourceAlpha, w, h, blur), sourceAlpha);
  const effect = colorizeAlpha(glowAlpha, color, opacity);
  return compositeSourceOver(effect, px);
}

/** Add a colorized, offset shadow constrained to the inside of the source alpha shape. */
export function innerShadow(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  { dx, dy, blur, color, opacity }: InnerShadowOptions,
): Uint8ClampedArray {
  assertBufferSize(px, w, h);
  if (opacity <= 0) return new Uint8ClampedArray(px);

  const sourceAlpha = alphaMask(px, w, h);
  const offset = offsetAlpha(sourceAlpha, w, h, Math.round(dx), Math.round(dy));
  const blurred = boxBlur(offset, w, h, blur);
  const shadowAlpha = new Float32Array(sourceAlpha.length);
  for (let i = 0; i < shadowAlpha.length; i++) {
    shadowAlpha[i] = Math.min(sourceAlpha[i], sourceAlpha[i] * (1 - clamp01(blurred[i])));
  }

  const effect = colorizeAlpha(shadowAlpha, color, opacity);
  return compositeEffectOverSource(effect, px, sourceAlpha);
}

/** Add simple alpha-height bevel lighting constrained to the source alpha shape. */
export function bevelEmboss(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  { depth, blur, angle, opacity }: BevelEmbossOptions,
): Uint8ClampedArray {
  assertBufferSize(px, w, h);
  if (opacity <= 0 || depth <= 0) return new Uint8ClampedArray(px);

  const sourceAlpha = alphaMask(px, w, h);
  const height = boxBlur(sourceAlpha, w, h, blur);
  const effect = new Uint8ClampedArray(px.length);
  const radians = (angle * Math.PI) / 180;
  const lightX = Math.cos(radians);
  const lightY = Math.sin(radians);

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const sourceA = sourceAlpha[p];
      if (sourceA <= 0) continue;

      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      const gx = (height[y * w + x1] - height[y * w + x0]) * 0.5;
      const gy = (height[y1 * w + x] - height[y0 * w + x]) * 0.5;
      const g = gx * lightX + gy * lightY;
      const a = clamp01(Math.abs(g) * depth) * clamp01(opacity) * sourceA;
      if (a <= 0) continue;

      const i = p * 4;
      const c = g > 0 ? 255 : 0;
      effect[i] = c;
      effect[i + 1] = c;
      effect[i + 2] = c;
      effect[i + 3] = a * 255;
    }
  }

  return compositeEffectOverSource(effect, px, sourceAlpha);
}

function assertBufferSize(px: Uint8ClampedArray, w: number, h: number): void {
  if (w < 0 || h < 0 || px.length !== w * h * 4) {
    throw new Error('RGBA buffer length must be width * height * 4');
  }
}

function alphaMask(px: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 3, p = 0; p < out.length; i += 4, p++) out[p] = px[i] / 255;
  return out;
}

function offsetAlpha(alpha: Float32Array, w: number, h: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= w) continue;
      out[y * w + x] = alpha[sy * w + sx];
    }
  }
  return out;
}

function boxBlur(alpha: Float32Array, w: number, h: number, blur: number): Float32Array {
  const radius = Math.max(0, Math.round(blur));
  if (radius <= 0) return new Float32Array(alpha);

  const horizontal = new Float32Array(alpha.length);
  const out = new Float32Array(alpha.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let kx = Math.max(0, x - radius); kx <= Math.min(w - 1, x + radius); kx++) {
        sum += alpha[y * w + kx];
        count++;
      }
      horizontal[y * w + x] = sum / count;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let ky = Math.max(0, y - radius); ky <= Math.min(h - 1, y + radius); ky++) {
        sum += horizontal[ky * w + x];
        count++;
      }
      out[y * w + x] = sum / count;
    }
  }

  return out;
}

function dilateAlpha(alpha: Float32Array, w: number, h: number, size: number): Float32Array {
  const radius = Math.max(0, Math.round(size));
  const out = new Float32Array(alpha.length);
  if (radius <= 0) return out;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let maxAlpha = 0;
      for (let ky = Math.max(0, y - radius); ky <= Math.min(h - 1, y + radius); ky++) {
        for (let kx = Math.max(0, x - radius); kx <= Math.min(w - 1, x + radius); kx++) {
          maxAlpha = Math.max(maxAlpha, alpha[ky * w + kx]);
        }
      }
      out[y * w + x] = maxAlpha;
    }
  }

  return out;
}

function outsideMask(effectAlpha: Float32Array, sourceAlpha: Float32Array): Float32Array {
  const out = new Float32Array(effectAlpha.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = effectAlpha[i] * (1 - sourceAlpha[i]);
  }
  return out;
}

function colorizeAlpha(alpha: Float32Array, color: LayerEffectColor, opacity: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(alpha.length * 4);
  const rgba = normalizeColor(color);
  const colorAlpha = clamp01((rgba.a / 255) * opacity);
  if (colorAlpha <= 0) return out;

  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    const a = clamp01(alpha[p] * colorAlpha);
    if (a <= 0) continue;
    out[i] = rgba.r;
    out[i + 1] = rgba.g;
    out[i + 2] = rgba.b;
    out[i + 3] = a * 255;
  }

  return out;
}

function normalizeColor(color: LayerEffectColor): RGBA {
  if (isColorTuple(color)) {
    return { r: color[0], g: color[1], b: color[2], a: 255 };
  }
  return { r: color.r, g: color.g, b: color.b, a: color.a ?? 255 };
}

function isColorTuple(color: LayerEffectColor): color is LayerEffectColorTuple {
  return Array.isArray(color);
}

function compositeEffectOverSource(
  effect: Uint8ClampedArray,
  source: Uint8ClampedArray,
  sourceAlpha: Float32Array,
): Uint8ClampedArray {
  const out = compositeSourceOver(source, effect);
  for (let p = 0, i = 0; p < sourceAlpha.length; p++, i += 4) {
    if (sourceAlpha[p] > 0) continue;
    out[i] = source[i];
    out[i + 1] = source[i + 1];
    out[i + 2] = source[i + 2];
    out[i + 3] = source[i + 3];
  }
  return out;
}

function compositeSourceOver(dst: Uint8ClampedArray, src: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dst);
  for (let i = 0; i < src.length; i += 4) {
    const sa = src[i + 3] / 255;
    if (sa <= 0) {
      // Source pixel is fully transparent. Where the effect also contributes
      // nothing, preserve the source's original bytes so a no-op effect
      // (e.g. opacity=0) round-trips byte-for-byte; where the effect IS
      // present (shadow/glow showing through), keep the effect pixel.
      if (out[i + 3] <= 0) {
        out[i] = src[i];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[i + 2];
        out[i + 3] = src[i + 3];
      }
      continue;
    }

    const da = out[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) continue;

    const sr = src[i] / 255;
    const sg = src[i + 1] / 255;
    const sb = src[i + 2] / 255;
    const dr = out[i] / 255;
    const dg = out[i + 1] / 255;
    const db = out[i + 2] / 255;

    out[i] = ((sr * sa + dr * da * (1 - sa)) / oa) * 255;
    out[i + 1] = ((sg * sa + dg * da * (1 - sa)) / oa) * 255;
    out[i + 2] = ((sb * sa + db * da * (1 - sa)) / oa) * 255;
    out[i + 3] = oa * 255;
  }
  return out;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
