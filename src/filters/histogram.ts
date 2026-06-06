export interface Histogram {
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
}

export interface AutoToneOptions {
  clipPercent?: number;
  mask?: Uint8ClampedArray | null;
}

function createBins(): number[] {
  return Array.from({ length: 256 }, () => 0);
}

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clampClipPercent(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0.5;
  if (value <= 0) return 0;
  if (value >= 50) return 50;
  return value;
}

function pixelCount(pixels: Uint8ClampedArray, width: number, height: number): number {
  return Math.max(0, Math.min(width * height, Math.floor(pixels.length / 4)));
}

function luma(r: number, g: number, b: number): number {
  return clamp255(0.299 * r + 0.587 * g + 0.114 * b);
}

function maskCoverage(mask: Uint8ClampedArray | null | undefined, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function blendChannel(original: number, adjusted: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(adjusted);
  return clamp255(original + (adjusted - original) * coverage);
}

function stretch(value: number, min: number, max: number): number {
  if (max <= min) return value;
  return ((value - min) * 255) / (max - min);
}

function boundsFromHistogram(histogram: number[], total: number, clipPercent: number): { min: number; max: number } | null {
  if (total <= 0) return null;

  const clipped = Math.floor(total * (clipPercent / 100));
  let lowerSum = 0;
  let min = 0;
  for (let value = 0; value < 256; value++) {
    lowerSum += histogram[value];
    if (lowerSum > clipped) {
      min = value;
      break;
    }
  }

  let upperSum = 0;
  let max = 255;
  for (let value = 255; value >= 0; value--) {
    upperSum += histogram[value];
    if (upperSum > clipped) {
      max = value;
      break;
    }
  }

  return { min, max };
}

function buildMaskedHistograms(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8ClampedArray | null | undefined,
): Histogram & { total: number } {
  const histogram: Histogram & { total: number } = {
    r: createBins(),
    g: createBins(),
    b: createBins(),
    luma: createBins(),
    total: 0,
  };

  const count = pixelCount(pixels, width, height);
  for (let pixel = 0; pixel < count; pixel++) {
    const i = pixel * 4;
    if (pixels[i + 3] === 0 || maskCoverage(mask, pixel) <= 0) continue;

    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    histogram.r[r]++;
    histogram.g[g]++;
    histogram.b[b]++;
    histogram.luma[luma(r, g, b)]++;
    histogram.total++;
  }

  return histogram;
}

export function computeHistogram(pixels: Uint8ClampedArray, width: number, height: number): Histogram {
  const histogram = buildMaskedHistograms(pixels, width, height, null);
  return {
    r: histogram.r,
    g: histogram.g,
    b: histogram.b,
    luma: histogram.luma,
  };
}

export function autoLevels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: AutoToneOptions = {},
): void {
  const histogram = buildMaskedHistograms(pixels, width, height, opts.mask);
  const clipPercent = clampClipPercent(opts.clipPercent);
  const rBounds = boundsFromHistogram(histogram.r, histogram.total, clipPercent);
  const gBounds = boundsFromHistogram(histogram.g, histogram.total, clipPercent);
  const bBounds = boundsFromHistogram(histogram.b, histogram.total, clipPercent);
  if (!rBounds || !gBounds || !bBounds) return;

  const count = pixelCount(pixels, width, height);
  for (let pixel = 0; pixel < count; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel);
    const i = pixel * 4;
    if (pixels[i + 3] === 0 || coverage <= 0) continue;

    pixels[i] = blendChannel(pixels[i], stretch(pixels[i], rBounds.min, rBounds.max), coverage);
    pixels[i + 1] = blendChannel(pixels[i + 1], stretch(pixels[i + 1], gBounds.min, gBounds.max), coverage);
    pixels[i + 2] = blendChannel(pixels[i + 2], stretch(pixels[i + 2], bBounds.min, bBounds.max), coverage);
  }
}

export function autoContrast(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: AutoToneOptions = {},
): void {
  const histogram = buildMaskedHistograms(pixels, width, height, opts.mask);
  const bounds = boundsFromHistogram(histogram.luma, histogram.total, clampClipPercent(opts.clipPercent));
  if (!bounds || bounds.max <= bounds.min) return;

  const count = pixelCount(pixels, width, height);
  for (let pixel = 0; pixel < count; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel);
    const i = pixel * 4;
    if (pixels[i + 3] === 0 || coverage <= 0) continue;

    const currentLuma = luma(pixels[i], pixels[i + 1], pixels[i + 2]);
    const adjustedLuma = stretch(currentLuma, bounds.min, bounds.max);
    const scale = currentLuma <= 0 ? adjustedLuma / 255 : adjustedLuma / currentLuma;

    pixels[i] = blendChannel(pixels[i], pixels[i] * scale, coverage);
    pixels[i + 1] = blendChannel(pixels[i + 1], pixels[i + 1] * scale, coverage);
    pixels[i + 2] = blendChannel(pixels[i + 2], pixels[i + 2] * scale, coverage);
  }
}
