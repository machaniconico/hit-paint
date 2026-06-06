import type { RGBA } from '../types';

export interface GradientStop {
  t: number;
  color: RGBA;
}

interface LinearGradientOptions {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stops: GradientStop[];
  mask?: Uint8ClampedArray | null;
}

interface RadialGradientOptions {
  cx: number;
  cy: number;
  radius: number;
  stops: GradientStop[];
  mask?: Uint8ClampedArray | null;
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sortedStops(stops: GradientStop[]): GradientStop[] {
  return stops
    .map((stop) => ({ t: clamp01(stop.t), color: stop.color }))
    .sort((a, b) => a.t - b.t);
}

function sampleGradient(stops: GradientStop[], rawT: number): RGBA {
  const t = clamp01(rawT);

  if (stops.length === 1 || t <= stops[0].t) {
    return stops[0].color;
  }

  const last = stops[stops.length - 1];
  if (t >= last.t) {
    return last.color;
  }

  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const next = stops[i];
    if (t <= next.t) {
      const span = next.t - prev.t;
      const localT = span === 0 ? 0 : (t - prev.t) / span;
      return {
        r: lerp(prev.color.r, next.color.r, localT),
        g: lerp(prev.color.g, next.color.g, localT),
        b: lerp(prev.color.b, next.color.b, localT),
        a: lerp(prev.color.a, next.color.a, localT),
      };
    }
  }

  return last.color;
}

function compositeSourceOver(
  pixels: Uint8ClampedArray,
  i: number,
  color: RGBA,
  coverage: number,
): void {
  const srcA = clamp01((color.a / 255) * coverage);
  if (srcA === 0) return;

  const dstA = pixels[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);

  if (outA === 0) {
    pixels[i] = 0;
    pixels[i + 1] = 0;
    pixels[i + 2] = 0;
    pixels[i + 3] = 0;
    return;
  }

  const dstScale = dstA * (1 - srcA);
  pixels[i] = (color.r * srcA + pixels[i] * dstScale) / outA;
  pixels[i + 1] = (color.g * srcA + pixels[i + 1] * dstScale) / outA;
  pixels[i + 2] = (color.b * srcA + pixels[i + 2] * dstScale) / outA;
  pixels[i + 3] = outA * 255;
}

export function fillLinearGradient(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: LinearGradientOptions,
): void {
  const stops = sortedStops(opts.stops);
  if (stops.length === 0 || width <= 0 || height <= 0) return;

  const dx = opts.x1 - opts.x0;
  const dy = opts.y1 - opts.y0;
  const lenSq = dx * dx + dy * dy;
  const total = width * height;

  for (let pi = 0; pi < total; pi++) {
    const coverage = opts.mask ? opts.mask[pi] / 255 : 1;
    if (coverage <= 0) continue;

    const x = pi % width;
    const y = Math.floor(pi / width);
    const t = lenSq === 0 ? 0 : ((x - opts.x0) * dx + (y - opts.y0) * dy) / lenSq;
    compositeSourceOver(pixels, pi * 4, sampleGradient(stops, t), coverage);
  }
}

export function fillRadialGradient(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: RadialGradientOptions,
): void {
  const stops = sortedStops(opts.stops);
  if (stops.length === 0 || width <= 0 || height <= 0) return;

  const invRadius = opts.radius > 0 ? 1 / opts.radius : 0;
  const total = width * height;

  for (let pi = 0; pi < total; pi++) {
    const coverage = opts.mask ? opts.mask[pi] / 255 : 1;
    if (coverage <= 0) continue;

    const x = pi % width;
    const y = Math.floor(pi / width);
    const dist = Math.hypot(x - opts.cx, y - opts.cy);
    compositeSourceOver(pixels, pi * 4, sampleGradient(stops, dist * invRadius), coverage);
  }
}
