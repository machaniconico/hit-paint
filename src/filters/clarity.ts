export interface ClarityOptions {
  amount: number;
  radius: number;
  mask?: Uint8ClampedArray | null;
}

type Mask = Uint8ClampedArray | null | undefined;

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

function rgbIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 3;
}

function maskCoverage(mask: Mask, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function clampRadius(radius: number, width: number, height: number): number {
  const maxRadius = Math.max(1, Math.floor(Math.min(width, height) / 2));
  return Math.max(1, Math.min(maxRadius, Math.round(radius)));
}

function blurredRgb(source: Uint8ClampedArray, width: number, height: number, radius: number): Float64Array {
  const span = radius * 2 + 1;
  const horizontal = new Float64Array(width * height * 3);
  const blurred = new Float64Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    for (let channel = 0; channel < 3; channel++) {
      let sum = source[rgbaIndex(0, y, width) + channel] * (radius + 1);

      for (let offset = 1; offset <= radius; offset++) {
        const sx = clampCoord(offset, width - 1);
        sum += source[rgbaIndex(sx, y, width) + channel];
      }

      for (let x = 0; x < width; x++) {
        horizontal[rgbIndex(x, y, width) + channel] = sum / span;

        if (x < width - 1) {
          const removeX = clampCoord(x - radius, width - 1);
          const addX = clampCoord(x + radius + 1, width - 1);
          sum += source[rgbaIndex(addX, y, width) + channel] - source[rgbaIndex(removeX, y, width) + channel];
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

function midWeight(r: number, g: number, b: number): number {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const weight = 1 - Math.abs(luma - 128) / 128;
  if (weight <= 0) return 0;
  if (weight >= 1) return 1;
  return weight;
}

export function clarity(px: Uint8ClampedArray, w: number, h: number, opts: ClarityOptions): void {
  if (
    w <= 0 ||
    h <= 0 ||
    opts.amount === 0 ||
    opts.radius <= 0 ||
    !Number.isFinite(opts.amount) ||
    !Number.isFinite(opts.radius)
  ) {
    return;
  }

  const source = new Uint8ClampedArray(px);
  const radius = clampRadius(opts.radius, w, h);
  const blurred = blurredRgb(source, w, h, radius);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = y * w + x;
      const coverage = maskCoverage(opts.mask, pixel);
      if (coverage <= 0) continue;

      const rgba = rgbaIndex(x, y, w);
      if (source[rgba + 3] === 0) continue;

      const rgb = rgbIndex(x, y, w);
      const weight = midWeight(source[rgba], source[rgba + 1], source[rgba + 2]);
      if (weight <= 0) continue;

      for (let channel = 0; channel < 3; channel++) {
        const original = source[rgba + channel];
        const detail = original - blurred[rgb + channel];
        const filtered = original + opts.amount * detail * weight;
        px[rgba + channel] = blendChannel(original, filtered, coverage);
      }
    }
  }
}
