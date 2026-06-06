export type RGBA = [number, number, number, number];

type Mask = Uint8ClampedArray | null | undefined;

export interface SketchOptions {
  blurRadius: number;
  strength?: number;
  mask?: Uint8ClampedArray | null;
}

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

function boxBlurChannel(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const span = radius * 2 + 1;
  const horizontal = new Float32Array(width * height);
  const blurred = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    let sum = source[y * width] * (radius + 1);

    for (let offset = 1; offset <= radius; offset++) {
      sum += source[y * width + clampCoord(offset, width - 1)];
    }

    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = sum / span;

      if (x < width - 1) {
        const removeX = clampCoord(x - radius, width - 1);
        const addX = clampCoord(x + radius + 1, width - 1);
        sum += source[y * width + addX] - source[y * width + removeX];
      }
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = horizontal[x] * (radius + 1);

    for (let offset = 1; offset <= radius; offset++) {
      sum += horizontal[clampCoord(offset, height - 1) * width + x];
    }

    for (let y = 0; y < height; y++) {
      blurred[y * width + x] = sum / span;

      if (y < height - 1) {
        const removeY = clampCoord(y - radius, height - 1);
        const addY = clampCoord(y + radius + 1, height - 1);
        sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
      }
    }
  }

  return blurred;
}

export function pencilSketch(px: Uint8ClampedArray, w: number, h: number, opts: SketchOptions): void {
  if (w <= 0 || h <= 0) return;

  const pixelCount = Math.min(w * h, Math.floor(px.length / 4));
  const gray = new Float32Array(pixelCount);
  const inverted = new Float32Array(pixelCount);

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const rgba = pixel * 4;
    const value = luma(px[rgba], px[rgba + 1], px[rgba + 2]);
    gray[pixel] = value;
    inverted[pixel] = 255 - value;
  }

  const radius = Number.isFinite(opts.blurRadius) ? Math.round(opts.blurRadius) : 0;
  const blurred = radius > 0 ? boxBlurChannel(inverted, w, h, radius) : inverted;
  const strength = opts.strength === undefined ? 1 : Math.max(0, Math.min(1, opts.strength));

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const rgba = rgbaIndex(pixel % w, Math.floor(pixel / w), w);
    const denominator = 255 - blurred[pixel];
    const dodged = denominator <= 0 ? 255 : clamp255((gray[pixel] * 255) / denominator);
    const filtered = clamp255(gray[pixel] + (dodged - gray[pixel]) * strength);
    const coverage = maskCoverage(opts.mask, pixel);

    px[rgba] = blendChannel(px[rgba], filtered, coverage);
    px[rgba + 1] = blendChannel(px[rgba + 1], filtered, coverage);
    px[rgba + 2] = blendChannel(px[rgba + 2], filtered, coverage);
  }
}
