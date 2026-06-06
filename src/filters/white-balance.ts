export interface WhiteBalanceOptions {
  strength?: number;
  mask?: Uint8ClampedArray | null;
}

type Mask = Uint8ClampedArray | null | undefined;

const clamp255 = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 255) return 255;
  return value;
};

function clampStrength(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 1;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function pixelCount(px: Uint8ClampedArray, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(w * h), Math.floor(px.length / 4)));
}

function maskCoverage(mask: Mask, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

export function autoWhiteBalance(px: Uint8ClampedArray, w: number, h: number, opts?: WhiteBalanceOptions): void {
  const options = opts ?? {};
  const strength = clampStrength(options.strength);
  if (strength <= 0) return;

  const totalPixels = pixelCount(px, w, h);
  if (totalPixels <= 0) return;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let opaqueCount = 0;

  for (let pixel = 0; pixel < totalPixels; pixel++) {
    const i = pixel * 4;
    if (px[i + 3] <= 0) continue;

    sumR += px[i];
    sumG += px[i + 1];
    sumB += px[i + 2];
    opaqueCount++;
  }

  if (opaqueCount <= 0) return;

  const meanR = sumR / opaqueCount;
  const meanG = sumG / opaqueCount;
  const meanB = sumB / opaqueCount;
  const gray = (meanR + meanG + meanB) / 3;
  const gainR = meanR > 0 ? gray / meanR : 1;
  const gainG = meanG > 0 ? gray / meanG : 1;
  const gainB = meanB > 0 ? gray / meanB : 1;
  const effectiveGainR = 1 + (gainR - 1) * strength;
  const effectiveGainG = 1 + (gainG - 1) * strength;
  const effectiveGainB = 1 + (gainB - 1) * strength;

  for (let pixel = 0; pixel < totalPixels; pixel++) {
    const i = pixel * 4;
    if (px[i + 3] <= 0) continue;

    const coverage = maskCoverage(options.mask, pixel);
    if (coverage <= 0) continue;

    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];

    px[i] = blendChannel(r, r * effectiveGainR, coverage);
    px[i + 1] = blendChannel(g, g * effectiveGainG, coverage);
    px[i + 2] = blendChannel(b, b * effectiveGainB, coverage);
  }
}
