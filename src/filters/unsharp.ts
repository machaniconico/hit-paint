export interface UnsharpMaskOptions {
  amount: number;
  radius: number;
  threshold?: number;
}

type Mask = Uint8ClampedArray | null | undefined;

function clamp255(value: number): number {
  if (value <= 0) return 0;
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

function rgbIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 3;
}

function maskCoverage(mask: Mask, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function clampThreshold(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return value;
}

function gaussianKernel(radius: number): number[] {
  const sampleRadius = Math.max(1, Math.ceil(radius * 3));
  const sigma = Math.max(0.0001, radius);
  const weights: number[] = [];
  let total = 0;

  for (let i = -sampleRadius; i <= sampleRadius; i++) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    weights.push(weight);
    total += weight;
  }

  return weights.map((weight) => weight / total);
}

function blurredRgb(source: Uint8ClampedArray, width: number, height: number, radius: number): Float64Array {
  const kernel = gaussianKernel(radius);
  const sampleRadius = Math.floor(kernel.length / 2);
  const horizontal = new Float64Array(width * height * 3);
  const blurred = new Float64Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dst = rgbIndex(x, y, width);
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let k = 0; k < kernel.length; k++) {
          const sx = clampCoord(x + k - sampleRadius, width - 1);
          sum += source[rgbaIndex(sx, y, width) + channel] * kernel[k];
        }
        horizontal[dst + channel] = sum;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dst = rgbIndex(x, y, width);
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let k = 0; k < kernel.length; k++) {
          const sy = clampCoord(y + k - sampleRadius, height - 1);
          sum += horizontal[rgbIndex(x, sy, width) + channel] * kernel[k];
        }
        blurred[dst + channel] = sum;
      }
    }
  }

  return blurred;
}

export function unsharpMask(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: UnsharpMaskOptions,
  mask?: Mask,
): void {
  if (
    w <= 0 ||
    h <= 0 ||
    opts.amount <= 0 ||
    opts.radius <= 0 ||
    !Number.isFinite(opts.amount) ||
    !Number.isFinite(opts.radius)
  ) {
    return;
  }

  const source = new Uint8ClampedArray(px);
  const blurred = blurredRgb(source, w, h, opts.radius);
  const threshold = clampThreshold(opts.threshold);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = y * w + x;
      const coverage = maskCoverage(mask, pixel);
      if (coverage <= 0) continue;

      const rgba = rgbaIndex(x, y, w);
      const rgb = rgbIndex(x, y, w);
      for (let channel = 0; channel < 3; channel++) {
        const original = source[rgba + channel];
        const diff = original - blurred[rgb + channel];
        if (Math.abs(diff) < threshold) continue;

        px[rgba + channel] = clamp255(original + diff * opts.amount * coverage);
      }
    }
  }
}
