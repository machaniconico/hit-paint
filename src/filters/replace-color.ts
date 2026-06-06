import type { RGBA } from '../types';

type Mask = Uint8ClampedArray | null | undefined;

export interface ReplaceColorOptions {
  from: RGBA;
  to: RGBA;
  tolerance: number;
  fuzziness?: number;
}

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clampRange(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return value;
}

function colorDistance(r: number, g: number, b: number, from: RGBA): number {
  return Math.max(
    Math.abs(r - from.r),
    Math.abs(g - from.g),
    Math.abs(b - from.b),
  );
}

function replacementCoverage(distance: number, tolerance: number, fuzziness: number): number {
  if (distance <= tolerance) return 1;
  if (fuzziness <= 0 || distance >= tolerance + fuzziness) return 0;
  return 1 - (distance - tolerance) / fuzziness;
}

function maskCoverage(mask: Mask, pixelIndex: number): number {
  return mask ? mask[pixelIndex] / 255 : 1;
}

function blendChannel(original: number, replacement: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(replacement);
  return clamp255(original + (replacement - original) * coverage);
}

export function replaceColor(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: ReplaceColorOptions,
  mask?: Mask,
): void {
  const tolerance = clampRange(opts.tolerance);
  const fuzziness = clampRange(opts.fuzziness ?? 0);
  const totalPixels = Math.max(0, w * h);

  for (let pixel = 0; pixel < totalPixels; pixel++) {
    const maskAmount = maskCoverage(mask, pixel);
    if (maskAmount <= 0) continue;

    const index = pixel * 4;
    const r = px[index];
    const g = px[index + 1];
    const b = px[index + 2];
    const distance = colorDistance(r, g, b, opts.from);
    const amount = replacementCoverage(distance, tolerance, fuzziness) * maskAmount;

    if (amount <= 0) continue;

    px[index] = blendChannel(r, opts.to.r, amount);
    px[index + 1] = blendChannel(g, opts.to.g, amount);
    px[index + 2] = blendChannel(b, opts.to.b, amount);
  }
}
