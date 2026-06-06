type Mask = Uint8ClampedArray | null | undefined;

export interface AddNoiseOptions {
  amount: number;
  monochrome?: boolean;
  seed?: number;
  mask?: Mask;
}

export interface OrderedDitherOptions {
  levels: number;
  mask?: Mask;
}

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function pixelCount(pixels: Uint8ClampedArray, width: number, height: number): number {
  return Math.max(0, Math.min(width * height, Math.floor(pixels.length / 4)));
}

function maskCoverage(mask: Mask, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function clampAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (amount >= 100) return 100;
  return amount;
}

function normalizeSeed(seed: number | undefined): number {
  return (seed ?? 1) >>> 0;
}

function nextLcg(state: number): number {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

function randomUnit(state: number): number {
  return state / 0x100000000;
}

function noiseDelta(state: number, amplitude: number): number {
  return (randomUnit(state) * 2 - 1) * amplitude;
}

function quantizeWithThreshold(value: number, levels: number, threshold: number): number {
  const step = 255 / (levels - 1);
  const level = Math.floor((value / 255) * (levels - 1) + threshold);
  return clamp255(level * step);
}

export function addNoise(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: AddNoiseOptions,
): void {
  const amplitude = (clampAmount(options.amount) / 100) * 128;
  if (amplitude <= 0) return;

  let state = normalizeSeed(options.seed);
  const count = pixelCount(pixels, width, height);

  for (let pixel = 0; pixel < count; pixel++) {
    const coverage = maskCoverage(options.mask, pixel);
    const i = pixel * 4;

    state = nextLcg(state);
    const redDelta = noiseDelta(state, amplitude);
    let greenDelta = redDelta;
    let blueDelta = redDelta;

    if (!options.monochrome) {
      state = nextLcg(state);
      greenDelta = noiseDelta(state, amplitude);
      state = nextLcg(state);
      blueDelta = noiseDelta(state, amplitude);
    }

    if (coverage <= 0) continue;

    pixels[i] = blendChannel(pixels[i], pixels[i] + redDelta, coverage);
    pixels[i + 1] = blendChannel(pixels[i + 1], pixels[i + 1] + greenDelta, coverage);
    pixels[i + 2] = blendChannel(pixels[i + 2], pixels[i + 2] + blueDelta, coverage);
  }
}

export function orderedDither(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: OrderedDitherOptions,
): void {
  const levels = Math.max(2, Math.floor(options.levels));
  const count = pixelCount(pixels, width, height);

  for (let pixel = 0; pixel < count; pixel++) {
    const coverage = maskCoverage(options.mask, pixel);
    if (coverage <= 0) continue;

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const threshold = (BAYER_4X4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
    const i = pixel * 4;

    pixels[i] = blendChannel(pixels[i], quantizeWithThreshold(pixels[i], levels, threshold), coverage);
    pixels[i + 1] = blendChannel(pixels[i + 1], quantizeWithThreshold(pixels[i + 1], levels, threshold), coverage);
    pixels[i + 2] = blendChannel(pixels[i + 2], quantizeWithThreshold(pixels[i + 2], levels, threshold), coverage);
  }
}
