export interface AdaptiveThresholdOptions {
  radius: number;
  bias?: number;
  mask?: Uint8ClampedArray | null;
}

type Mask = Uint8ClampedArray | null | undefined;

function clamp255(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
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

function grayscale(r: number, g: number, b: number): number {
  return clamp255((299 * r + 587 * g + 114 * b) / 1000);
}

export function adaptiveThreshold(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: AdaptiveThresholdOptions,
): void {
  if (w <= 0 || h <= 0 || px.length === 0) return;

  const pixelCount = Math.min(w * h, Math.floor(px.length / 4));
  if (pixelCount <= 0) return;

  const radius = Number.isFinite(opts.radius) ? Math.max(0, Math.floor(opts.radius)) : 0;
  const bias = Number.isFinite(opts.bias) ? opts.bias ?? 0 : 0;
  const source = new Uint8ClampedArray(px);
  const gray = new Uint8ClampedArray(pixelCount);
  const stride = w + 1;
  const integral = new Float64Array((h + 1) * stride);

  for (let y = 0; y < h; y++) {
    let rowSum = 0;

    for (let x = 0; x < w; x++) {
      const pixel = y * w + x;
      if (pixel >= pixelCount) break;

      const rgba = pixel * 4;
      const value = grayscale(source[rgba], source[rgba + 1], source[rgba + 2]);
      gray[pixel] = value;
      rowSum += value;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = y * w + x;
      if (pixel >= pixelCount) return;

      const value = gray[pixel];
      const coverage = maskCoverage(opts.mask, pixel, pixelCount);
      if (coverage <= 0) continue;

      const x0 = Math.max(0, x - radius);
      const y0 = Math.max(0, y - radius);
      const x1 = Math.min(w - 1, x + radius);
      const y1 = Math.min(h - 1, y + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * stride + x1 + 1]
        - integral[y0 * stride + x1 + 1]
        - integral[(y1 + 1) * stride + x0]
        + integral[y0 * stride + x0];
      const localMean = radius <= 0 ? value : sum / area;
      const filtered = value > localMean - bias ? 255 : 0;
      const rgba = pixel * 4;

      px[rgba] = blendChannel(source[rgba], filtered, coverage);
      px[rgba + 1] = blendChannel(source[rgba + 1], filtered, coverage);
      px[rgba + 2] = blendChannel(source[rgba + 2], filtered, coverage);
    }
  }
}
