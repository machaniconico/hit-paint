import type { RGBA } from '../types';

export interface OilPaintOptions {
  radius: number;
  mask?: Uint8ClampedArray | null;
}

type Mask = Uint8ClampedArray | null | undefined;

interface QuadrantBounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface QuadrantStats {
  color: RGBA;
  variance: number;
}

function clamp255(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clampCoord(value: number, max: number): number {
  if (value <= 0) return 0;
  if (value >= max) return max;
  return value;
}

function rgbaIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function maskCoverage(mask: Mask, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function quadrantStats(source: Uint8ClampedArray, width: number, bounds: QuadrantBounds): QuadrantStats {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let luma = 0;
  let lumaSq = 0;
  let count = 0;

  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const i = rgbaIndex(x, y, width);
      const red = source[i];
      const green = source[i + 1];
      const blue = source[i + 2];
      const alpha = source[i + 3];
      const sampleLuma = luminance(red, green, blue);

      r += red;
      g += green;
      b += blue;
      a += alpha;
      luma += sampleLuma;
      lumaSq += sampleLuma * sampleLuma;
      count++;
    }
  }

  const meanLuma = luma / count;

  return {
    color: {
      r: clamp255(r / count),
      g: clamp255(g / count),
      b: clamp255(b / count),
      a: clamp255(a / count),
    },
    variance: lumaSq / count - meanLuma * meanLuma,
  };
}

export function oilPaint(px: Uint8ClampedArray, w: number, h: number, opts: OilPaintOptions): void {
  if (w <= 0 || h <= 0 || !Number.isFinite(opts.radius) || opts.radius <= 0) return;

  const pixelCount = Math.min(w * h, Math.floor(px.length / 4));
  if (pixelCount <= 0) return;

  const radius = Math.floor(opts.radius);
  if (radius <= 0) return;

  const source = new Uint8ClampedArray(px);

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel);
    if (coverage <= 0) continue;

    const x = pixel % w;
    const y = Math.floor(pixel / w);
    const left = clampCoord(x - radius, w - 1);
    const right = clampCoord(x + radius, w - 1);
    const top = clampCoord(y - radius, h - 1);
    const bottom = clampCoord(y + radius, h - 1);
    const quadrants: QuadrantBounds[] = [
      { x0: left, x1: x, y0: top, y1: y },
      { x0: x, x1: right, y0: top, y1: y },
      { x0: left, x1: x, y0: y, y1: bottom },
      { x0: x, x1: right, y0: y, y1: bottom },
    ];
    let winner = quadrantStats(source, w, quadrants[0]);

    for (let i = 1; i < quadrants.length; i++) {
      const candidate = quadrantStats(source, w, quadrants[i]);
      if (candidate.variance < winner.variance) winner = candidate;
    }

    const rgba = pixel * 4;
    px[rgba] = blendChannel(source[rgba], winner.color.r, coverage);
    px[rgba + 1] = blendChannel(source[rgba + 1], winner.color.g, coverage);
    px[rgba + 2] = blendChannel(source[rgba + 2], winner.color.b, coverage);
    px[rgba + 3] = blendChannel(source[rgba + 3], winner.color.a, coverage);
  }
}
