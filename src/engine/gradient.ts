import type { RGBA } from '../types';

export interface GradientStop {
  offset: number;
  color: RGBA;
}

export type GradientKind = 'linear' | 'radial' | 'conic';

export interface GradientSpec {
  kind: GradientKind;
  stops: GradientStop[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const TWO_PI = Math.PI * 2;

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return clamp255(original);
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function copyColor(color: RGBA): RGBA {
  return {
    r: clamp255(color.r),
    g: clamp255(color.g),
    b: clamp255(color.b),
    a: clamp255(color.a),
  };
}

function sortedStops(stops: GradientStop[]): GradientStop[] {
  return stops
    .map((stop) => ({
      offset: clamp01(stop.offset),
      color: copyColor(stop.color),
    }))
    .sort((a, b) => a.offset - b.offset);
}

function interpolateColor(prev: RGBA, next: RGBA, t: number): RGBA {
  return {
    r: blendChannel(prev.r, next.r, t),
    g: blendChannel(prev.g, next.g, t),
    b: blendChannel(prev.b, next.b, t),
    a: blendChannel(prev.a, next.a, t),
  };
}

function sampleSortedGradient(stops: GradientStop[], rawT: number): RGBA {
  const t = clamp01(rawT);

  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 0 };
  if (stops.length === 1 || t <= stops[0].offset) return copyColor(stops[0].color);

  const last = stops[stops.length - 1];
  if (t >= last.offset) return copyColor(last.color);

  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const next = stops[i];

    if (t <= next.offset) {
      const span = next.offset - prev.offset;
      const localT = span <= 0 ? 0 : (t - prev.offset) / span;
      return interpolateColor(prev.color, next.color, localT);
    }
  }

  return copyColor(last.color);
}

export function sampleGradient(stops: GradientStop[], t: number): RGBA {
  return sampleSortedGradient(sortedStops(stops), t);
}

export function generateGradient(w: number, h: number, spec: GradientSpec): Uint8ClampedArray {
  if (w <= 0 || h <= 0) return new Uint8ClampedArray();

  const pixels = new Uint8ClampedArray(w * h * 4);
  const stops = sortedStops(spec.stops);
  if (stops.length === 0) return pixels;

  const dx = spec.x1 - spec.x0;
  const dy = spec.y1 - spec.y0;
  const lenSq = dx * dx + dy * dy;
  const radius = Math.hypot(dx, dy);
  const referenceAngle = Math.atan2(dy, dx);
  const total = w * h;

  for (let pixel = 0; pixel < total; pixel++) {
    const x = pixel % w;
    const y = Math.floor(pixel / w);
    let t = 0;

    if (spec.kind === 'linear') {
      t = lenSq === 0 ? 0 : ((x - spec.x0) * dx + (y - spec.y0) * dy) / lenSq;
    } else if (spec.kind === 'radial') {
      t = radius === 0 ? 0 : Math.hypot(x - spec.x0, y - spec.y0) / radius;
    } else {
      if (x === spec.x0 && y === spec.y0) {
        t = 0;
      } else {
        let angle = Math.atan2(y - spec.y0, x - spec.x0) - referenceAngle;
        if (angle < 0) angle += TWO_PI;
        if (angle >= TWO_PI) angle -= TWO_PI;
        t = angle / TWO_PI;
      }
    }

    const color = sampleSortedGradient(stops, t);
    const i = pixel * 4;
    pixels[i] = color.r;
    pixels[i + 1] = color.g;
    pixels[i + 2] = color.b;
    pixels[i + 3] = color.a;
  }

  return pixels;
}
