import type { RGBA } from '../types';

type Mask = Uint8ClampedArray | null | undefined;
type ColorShift = [number, number, number];

export interface ColorBalanceOptions {
  shadows?: ColorShift;
  midtones?: ColorShift;
  highlights?: ColorShift;
  mask?: Mask;
}

export interface GradientStop {
  t: number;
  color: RGBA;
}

export interface GradientMapOptions {
  stops: GradientStop[];
  mask?: Mask;
}

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampShift(value: number): number {
  if (value <= -100) return -100;
  if (value >= 100) return 100;
  return value;
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function maskCoverage(mask: Mask, pixelIndex: number): number {
  return mask ? mask[pixelIndex] / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function shiftForLuma(value: number, opts: ColorBalanceOptions): ColorShift {
  if (value < 85) return opts.shadows ?? [0, 0, 0];
  if (value < 170) return opts.midtones ?? [0, 0, 0];
  return opts.highlights ?? [0, 0, 0];
}

function normalizedStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.t - b.t);
}

function colorAt(stops: GradientStop[], t: number): RGBA {
  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 255 };

  const clampedT = clamp01(t);
  const first = stops[0];
  const last = stops[stops.length - 1];

  if (clampedT <= first.t) return first.color;
  if (clampedT >= last.t) return last.color;

  for (let i = 0; i < stops.length - 1; i++) {
    const left = stops[i];
    const right = stops[i + 1];
    if (clampedT < left.t || clampedT > right.t) continue;

    const span = right.t - left.t;
    const amount = span <= 0 ? 0 : (clampedT - left.t) / span;
    return {
      r: left.color.r + (right.color.r - left.color.r) * amount,
      g: left.color.g + (right.color.g - left.color.g) * amount,
      b: left.color.b + (right.color.b - left.color.b) * amount,
      a: left.color.a + (right.color.a - left.color.a) * amount,
    };
  }

  return last.color;
}

export function adjustColorBalance(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: ColorBalanceOptions,
): void {
  for (let pixel = 0; pixel < width * height; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    const shift = shiftForLuma(luma(pixels[i], pixels[i + 1], pixels[i + 2]), opts);
    pixels[i] = blendChannel(pixels[i], pixels[i] + clampShift(shift[0]), coverage);
    pixels[i + 1] = blendChannel(pixels[i + 1], pixels[i + 1] + clampShift(shift[1]), coverage);
    pixels[i + 2] = blendChannel(pixels[i + 2], pixels[i + 2] + clampShift(shift[2]), coverage);
  }
}

export function gradientMap(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: GradientMapOptions,
): void {
  const stops = normalizedStops(opts.stops);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    const mapped = colorAt(stops, luma(pixels[i], pixels[i + 1], pixels[i + 2]) / 255);
    pixels[i] = blendChannel(pixels[i], mapped.r, coverage);
    pixels[i + 1] = blendChannel(pixels[i + 1], mapped.g, coverage);
    pixels[i + 2] = blendChannel(pixels[i + 2], mapped.b, coverage);
  }
}
