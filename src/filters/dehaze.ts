export interface DehazeOptions {
  strength: number;
  patch?: number;
  mask?: Uint8ClampedArray | null;
}

type Mask = Uint8ClampedArray | null | undefined;

function clamp255(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clampTransmission(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value <= 0.1) return 0.1;
  if (value >= 1) return 1;
  return value;
}

function rgbaIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function maskCoverage(mask: Mask, pixel: number, pixelCount: number): number {
  if (!mask) return 1;
  if (mask.length === pixelCount * 4) return (mask[pixel * 4 + 3] ?? 0) / 255;
  return (mask[pixel] ?? 0) / 255;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function minRgb(px: Uint8ClampedArray, rgba: number): number {
  return Math.min(px[rgba], px[rgba + 1], px[rgba + 2]);
}

function patchSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 15;
  return Math.max(1, Math.round(value));
}

export function dehaze(px: Uint8ClampedArray, w: number, h: number, opts: DehazeOptions): void {
  if (w <= 0 || h <= 0 || opts.strength === 0) return;

  const pixelCount = Math.min(w * h, Math.floor(px.length / 4));
  if (pixelCount <= 0) return;

  const source = new Uint8ClampedArray(px);
  const darkChannel = new Uint8ClampedArray(pixelCount);
  const size = patchSize(opts.patch);
  const before = Math.floor((size - 1) / 2);
  const after = size - 1 - before;

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const x = pixel % w;
    const y = Math.floor(pixel / w);
    const x0 = Math.max(0, x - before);
    const y0 = Math.max(0, y - before);
    const x1 = Math.min(w - 1, x + after);
    const y1 = Math.min(h - 1, y + after);
    let dark = 255;

    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const sample = yy * w + xx;
        if (sample >= pixelCount) continue;
        dark = Math.min(dark, minRgb(source, rgbaIndex(xx, yy, w)));
      }
    }

    darkChannel[pixel] = dark;
  }

  let atmosphericPixel = 0;
  let maxDark = darkChannel[0];

  for (let pixel = 1; pixel < pixelCount; pixel++) {
    if (darkChannel[pixel] > maxDark) {
      maxDark = darkChannel[pixel];
      atmosphericPixel = pixel;
    }
  }

  const atmosphericRgba = atmosphericPixel * 4;
  const atmosphericR = source[atmosphericRgba];
  const atmosphericG = source[atmosphericRgba + 1];
  const atmosphericB = source[atmosphericRgba + 2];
  const atmosphericLuma = Math.max(1, 0.299 * atmosphericR + 0.587 * atmosphericG + 0.114 * atmosphericB);

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel, pixelCount);
    if (coverage <= 0) continue;

    const rgba = pixel * 4;
    const transmission = clampTransmission(1 - opts.strength * (darkChannel[pixel] / atmosphericLuma));
    const filteredR = (source[rgba] - atmosphericR) / transmission + atmosphericR;
    const filteredG = (source[rgba + 1] - atmosphericG) / transmission + atmosphericG;
    const filteredB = (source[rgba + 2] - atmosphericB) / transmission + atmosphericB;

    px[rgba] = blendChannel(source[rgba], filteredR, coverage);
    px[rgba + 1] = blendChannel(source[rgba + 1], filteredG, coverage);
    px[rgba + 2] = blendChannel(source[rgba + 2], filteredB, coverage);
  }
}
