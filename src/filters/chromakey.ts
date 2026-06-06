import type { RGBA } from '../types';

type Mask = Uint8ClampedArray | null | undefined;

export interface ChromaKeyOptions {
  key: RGBA;
  tolerance: number;
  softness?: number;
  mask?: Uint8ClampedArray | null;
}

function clamp255(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clampRange(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return value;
}

function colorDistance(r: number, g: number, b: number, key: RGBA): number {
  return Math.max(
    Math.abs(r - key.r),
    Math.abs(g - key.g),
    Math.abs(b - key.b),
  );
}

function maskCoverage(mask: Mask, pixelIndex: number): number {
  return mask ? (mask[pixelIndex] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function keyedAlpha(originalAlpha: number, distance: number, tolerance: number, softness: number): number {
  if (distance <= tolerance) return 0;
  if (softness <= 0 || distance > tolerance + softness) return originalAlpha;
  return clamp255(originalAlpha * ((distance - tolerance) / softness));
}

export function chromaKey(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: ChromaKeyOptions,
): void {
  if (w <= 0 || h <= 0) return;

  const tolerance = clampRange(opts.tolerance);
  const softness = clampRange(opts.softness ?? 0);
  const pixelCount = Math.min(w * h, Math.floor(px.length / 4));

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel);
    if (coverage <= 0) continue;

    const index = pixel * 4;
    const originalAlpha = px[index + 3];
    const distance = colorDistance(px[index], px[index + 1], px[index + 2], opts.key);
    const filteredAlpha = keyedAlpha(originalAlpha, distance, tolerance, softness);

    px[index + 3] = blendChannel(originalAlpha, filteredAlpha, coverage);
  }
}
