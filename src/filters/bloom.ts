export interface BloomOptions {
  threshold: number;
  radius: number;
  intensity: number;
  mask?: Uint8ClampedArray | null;
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
  return mask ? (mask[pixel * 4 + 3] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function boxBlurRgb(source: Float64Array, width: number, height: number, radius: number): Float64Array {
  const span = radius * 2 + 1;
  const horizontal = new Float64Array(width * height * 3);
  const blurred = new Float64Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let channel = 0; channel < 3; channel++) {
      let sum = source[rgbIndex(0, y, width) + channel] * (radius + 1);

      for (let offset = 1; offset <= radius; offset++) {
        const sx = clampCoord(offset, width - 1);
        sum += source[rgbIndex(sx, y, width) + channel];
      }

      for (let x = 0; x < width; x++) {
        horizontal[rgbIndex(x, y, width) + channel] = sum / span;

        if (x < width - 1) {
          const removeX = clampCoord(x - radius, width - 1);
          const addX = clampCoord(x + radius + 1, width - 1);
          sum += source[rgbIndex(addX, y, width) + channel] - source[rgbIndex(removeX, y, width) + channel];
        }
      }
    }
  }

  for (let x = 0; x < width; x++) {
    for (let channel = 0; channel < 3; channel++) {
      let sum = horizontal[rgbIndex(x, 0, width) + channel] * (radius + 1);

      for (let offset = 1; offset <= radius; offset++) {
        const sy = clampCoord(offset, height - 1);
        sum += horizontal[rgbIndex(x, sy, width) + channel];
      }

      for (let y = 0; y < height; y++) {
        blurred[rgbIndex(x, y, width) + channel] = sum / span;

        if (y < height - 1) {
          const removeY = clampCoord(y - radius, height - 1);
          const addY = clampCoord(y + radius + 1, height - 1);
          sum += horizontal[rgbIndex(x, addY, width) + channel] - horizontal[rgbIndex(x, removeY, width) + channel];
        }
      }
    }
  }

  return blurred;
}

export function bloom(px: Uint8ClampedArray, w: number, h: number, opts: BloomOptions): void {
  if (
    w <= 0 ||
    h <= 0 ||
    opts.intensity <= 0 ||
    opts.radius <= 0 ||
    opts.threshold >= 255 ||
    !Number.isFinite(opts.intensity) ||
    !Number.isFinite(opts.radius) ||
    !Number.isFinite(opts.threshold)
  ) {
    return;
  }

  const source = new Uint8ClampedArray(px);
  const threshold = Math.max(0, Math.min(255, opts.threshold));
  const radius = Math.max(1, Math.round(opts.radius));
  const glow = new Float64Array(w * h * 3);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rgba = rgbaIndex(x, y, w);
      if (luma(source[rgba], source[rgba + 1], source[rgba + 2]) <= threshold) continue;

      const rgb = rgbIndex(x, y, w);
      glow[rgb] = source[rgba];
      glow[rgb + 1] = source[rgba + 1];
      glow[rgb + 2] = source[rgba + 2];
    }
  }

  const blurred = boxBlurRgb(glow, w, h, radius);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = y * w + x;
      const coverage = maskCoverage(opts.mask, pixel);
      if (coverage <= 0) continue;

      const rgba = rgbaIndex(x, y, w);
      const rgb = rgbIndex(x, y, w);

      for (let channel = 0; channel < 3; channel++) {
        const original = source[rgba + channel];
        const filtered = original + blurred[rgb + channel] * opts.intensity;
        px[rgba + channel] = blendChannel(original, filtered, coverage);
      }
    }
  }
}
