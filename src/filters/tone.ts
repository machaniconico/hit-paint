function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function pixelCount(px: Uint8ClampedArray, w: number, h: number): number {
  return Math.max(0, Math.min(w * h, Math.floor(px.length / 4)));
}

function maskCoverage(mask: Uint8ClampedArray | null | undefined, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function luma(r: number, g: number, b: number): number {
  return clamp255(0.299 * r + 0.587 * g + 0.114 * b);
}

function blendChannel(original: number, adjusted: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(adjusted);
  return clamp255(original + (adjusted - original) * coverage);
}

function buildEqualizeLut(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  mask: Uint8ClampedArray | null | undefined,
): Uint8Array | null {
  const histogram = Array.from({ length: 256 }, () => 0);
  const count = pixelCount(px, w, h);
  let total = 0;

  for (let pixel = 0; pixel < count; pixel++) {
    const i = pixel * 4;
    if (px[i + 3] === 0 || maskCoverage(mask, pixel) <= 0) continue;

    histogram[luma(px[i], px[i + 1], px[i + 2])]++;
    total++;
  }

  if (total <= 1) return null;

  let cdf = 0;
  let cdfMin = 0;
  for (let value = 0; value < histogram.length; value++) {
    cdf += histogram[value];
    if (cdf > 0) {
      cdfMin = cdf;
      break;
    }
  }

  if (total <= cdfMin) return null;

  const lut = new Uint8Array(256);
  cdf = 0;
  for (let value = 0; value < histogram.length; value++) {
    cdf += histogram[value];
    lut[value] = clamp255(((cdf - cdfMin) * 255) / (total - cdfMin));
  }

  return lut;
}

export function equalizeHistogram(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  mask?: Uint8ClampedArray | null,
): void {
  const lut = buildEqualizeLut(px, w, h, mask);
  if (!lut) return;

  const count = pixelCount(px, w, h);
  for (let pixel = 0; pixel < count; pixel++) {
    const coverage = maskCoverage(mask, pixel);
    const i = pixel * 4;
    if (px[i + 3] === 0 || coverage <= 0) continue;

    const currentLuma = luma(px[i], px[i + 1], px[i + 2]);
    const adjustedLuma = lut[currentLuma];
    const gain = currentLuma <= 0 ? 0 : adjustedLuma / currentLuma;

    px[i] = blendChannel(px[i], px[i] * gain, coverage);
    px[i + 1] = blendChannel(px[i + 1], px[i + 1] * gain, coverage);
    px[i + 2] = blendChannel(px[i + 2], px[i + 2] * gain, coverage);
  }
}

export function adjustGamma(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: { gamma: number },
  mask?: Uint8ClampedArray | null,
): void {
  if (!(opts.gamma > 0)) return;

  const inverseGamma = 1 / opts.gamma;
  const lut = new Uint8Array(256);
  for (let value = 0; value < lut.length; value++) {
    lut[value] = clamp255(255 * Math.pow(value / 255, inverseGamma));
  }

  const count = pixelCount(px, w, h);
  for (let pixel = 0; pixel < count; pixel++) {
    const coverage = maskCoverage(mask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    px[i] = blendChannel(px[i], lut[px[i]], coverage);
    px[i + 1] = blendChannel(px[i + 1], lut[px[i + 1]], coverage);
    px[i + 2] = blendChannel(px[i + 2], lut[px[i + 2]], coverage);
  }
}
