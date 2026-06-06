import type { RGBA } from '../types';

export interface HSL {
  /** Hue in degrees, 0..360. Achromatic colors return 0. */
  h: number;
  /** Saturation, 0..1. */
  s: number;
  /** Lightness, 0..1. */
  l: number;
}

export interface TemperatureOptions {
  /** -100..100. Positive warms by raising red and lowering blue. */
  temperature: number;
  /** -100..100. Positive shifts toward magenta, negative toward green. */
  tint?: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const clamp8 = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
const clampSigned100 = (n: number): number => (n < -100 ? -100 : n > 100 ? 100 : n);

const mix = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;

export function rgbToHsl(c: RGBA): HSL {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  let h: number;
  if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }

  h *= 60;
  if (h < 0) h += 360;

  const s = delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number, a = 255): RGBA {
  const hue = (((h % 360) + 360) % 360) / 60;
  const sat = clamp01(s);
  const light = clamp01(l);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue >= 0 && hue < 1) [r, g, b] = [c, x, 0];
  else if (hue < 2) [r, g, b] = [x, c, 0];
  else if (hue < 3) [r, g, b] = [0, c, x];
  else if (hue < 4) [r, g, b] = [0, x, c];
  else if (hue < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return {
    r: clamp8((r + m) * 255),
    g: clamp8((g + m) * 255),
    b: clamp8((b + m) * 255),
    a: clamp8(a),
  };
}

export function adjustTemperature(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: TemperatureOptions,
  mask?: Uint8ClampedArray | null,
): void {
  const pixelCount = Math.min(Math.max(0, Math.trunc(w) * Math.trunc(h)), Math.floor(px.length / 4));
  if (pixelCount === 0) return;

  const temperature = clampSigned100(opts.temperature) / 100;
  const tint = clampSigned100(opts.tint ?? 0) / 100;
  if (temperature === 0 && tint === 0) return;

  for (let i = 0; i < pixelCount; i += 1) {
    const coverage = mask ? (mask[i] ?? 0) / 255 : 1;
    if (coverage <= 0) continue;

    const offset = i * 4;
    const r = px[offset];
    const g = px[offset + 1];
    const b = px[offset + 2];

    let nextR = r + temperature * 32 + tint * 18;
    let nextG = g - tint * 28;
    let nextB = b - temperature * 32 + tint * 18;

    nextR = clamp8(nextR);
    nextG = clamp8(nextG);
    nextB = clamp8(nextB);

    px[offset] = clamp8(mix(r, nextR, coverage));
    px[offset + 1] = clamp8(mix(g, nextG, coverage));
    px[offset + 2] = clamp8(mix(b, nextB, coverage));
  }
}
