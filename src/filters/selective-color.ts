import { hslToRgb, rgbToHsl } from '../color/convert';
import type { RGBA } from '../types';

export type ColorRange = 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas';

export interface SelectiveColorOptions {
  range: ColorRange;
  hueShift?: number;
  satScale?: number;
  lightScale?: number;
  mask?: Uint8ClampedArray | null;
}

type Mask = Uint8ClampedArray | null | undefined;

const RANGE_CENTERS: Record<ColorRange, number> = {
  reds: 0,
  yellows: 60,
  greens: 120,
  cyans: 180,
  blues: 240,
  magentas: 300,
};

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function pixelCount(px: Uint8ClampedArray, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(w * h), Math.floor(px.length / 4)));
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}

function maskCoverage(mask: Mask, pixelIndex: number): number {
  return mask ? (mask[pixelIndex] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function hueDistance(a: number, b: number): number {
  const distance = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(distance, 360 - distance);
}

function rangeWeight(hue: number, range: ColorRange): number {
  const distance = hueDistance(hue, RANGE_CENTERS[range]);
  if (distance >= 60) return 0;
  return 1 - distance / 60;
}

export function selectiveColor(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: SelectiveColorOptions,
): void {
  const totalPixels = pixelCount(px, w, h);
  if (totalPixels <= 0) return;

  const hueShift = finiteOrDefault(opts.hueShift, 0);
  const satScale = finiteOrDefault(opts.satScale, 1);
  const lightScale = finiteOrDefault(opts.lightScale, 1);
  if (hueShift === 0 && satScale === 1 && lightScale === 1) return;

  for (let pixel = 0; pixel < totalPixels; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    const color: RGBA = {
      r: px[i],
      g: px[i + 1],
      b: px[i + 2],
      a: px[i + 3],
    };
    const hsl = rgbToHsl(color);
    const weight = rangeWeight(hsl.h, opts.range);
    if (weight <= 0) continue;

    const filtered = hslToRgb(
      hsl.h + hueShift * weight,
      hsl.s * (1 + (satScale - 1) * weight),
      hsl.l * (1 + (lightScale - 1) * weight),
      color.a,
    );

    px[i] = blendChannel(color.r, filtered.r, coverage);
    px[i + 1] = blendChannel(color.g, filtered.g, coverage);
    px[i + 2] = blendChannel(color.b, filtered.b, coverage);
  }
}
