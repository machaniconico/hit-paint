export interface ConvolveOptions {
  kernel: number[];
  divisor?: number;
  offset?: number;
  mask?: Uint8ClampedArray | null;
}

export interface MaskedFilterOptions {
  mask?: Uint8ClampedArray | null;
}

export interface SharpenConvolveOptions extends MaskedFilterOptions {
  amount?: number;
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

function maskCoverage(mask: Uint8ClampedArray | null | undefined, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function kernelSize(kernel: number[]): number {
  const size = Math.sqrt(kernel.length);
  if (!Number.isInteger(size) || size % 2 !== 1) {
    throw new Error('convolve kernel must be a square array with an odd side length');
  }
  return size;
}

function defaultDivisor(kernel: number[]): number {
  const sum = kernel.reduce((total, value) => total + value, 0);
  return sum === 0 ? 1 : sum;
}

export function convolve(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: ConvolveOptions,
): void {
  if (width <= 0 || height <= 0) return;

  const size = kernelSize(opts.kernel);
  const radius = Math.floor(size / 2);
  const divisor = opts.divisor ?? defaultDivisor(opts.kernel);
  const offset = opts.offset ?? 0;
  const source = new Uint8ClampedArray(pixels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const coverage = maskCoverage(opts.mask, pixel);
      if (coverage <= 0) continue;

      const dst = rgbaIndex(x, y, width);
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let ky = 0; ky < size; ky++) {
          const sy = clampCoord(y + ky - radius, height - 1);
          for (let kx = 0; kx < size; kx++) {
            const sx = clampCoord(x + kx - radius, width - 1);
            const src = rgbaIndex(sx, sy, width);
            sum += source[src + channel] * opts.kernel[ky * size + kx];
          }
        }

        pixels[dst + channel] = blendChannel(source[dst + channel], sum / divisor + offset, coverage);
      }
    }
  }
}

export function sobelEdge(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: MaskedFilterOptions = {},
): void {
  if (width <= 0 || height <= 0) return;

  const source = new Uint8ClampedArray(pixels);
  const gxKernel = [
    -1, 0, 1,
    -2, 0, 2,
    -1, 0, 1,
  ];
  const gyKernel = [
    -1, -2, -1,
    0, 0, 0,
    1, 2, 1,
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const coverage = maskCoverage(opts.mask, pixel);
      if (coverage <= 0) continue;

      const dst = rgbaIndex(x, y, width);
      for (let channel = 0; channel < 3; channel++) {
        let gx = 0;
        let gy = 0;
        for (let ky = 0; ky < 3; ky++) {
          const sy = clampCoord(y + ky - 1, height - 1);
          for (let kx = 0; kx < 3; kx++) {
            const sx = clampCoord(x + kx - 1, width - 1);
            const sample = source[rgbaIndex(sx, sy, width) + channel];
            const kernelIndex = ky * 3 + kx;
            gx += sample * gxKernel[kernelIndex];
            gy += sample * gyKernel[kernelIndex];
          }
        }

        pixels[dst + channel] = blendChannel(source[dst + channel], Math.hypot(gx, gy), coverage);
      }
    }
  }
}

export function emboss(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: MaskedFilterOptions = {},
): void {
  convolve(pixels, width, height, {
    kernel: [
      -2, -1, 0,
      -1, 1, 1,
      0, 1, 2,
    ],
    divisor: 1,
    offset: 128,
    mask: opts.mask,
  });
}

export function sharpen(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: SharpenConvolveOptions = {},
): void {
  const amount = Math.max(0, opts.amount ?? 1);
  convolve(pixels, width, height, {
    kernel: [
      0, -amount, 0,
      -amount, 1 + 4 * amount, -amount,
      0, -amount, 0,
    ],
    divisor: 1,
    offset: 0,
    mask: opts.mask,
  });
}
