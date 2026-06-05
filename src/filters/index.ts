export interface GaussianBlurOptions {
  radius: number;
}

export interface BrightnessContrastOptions {
  brightness: number;
  contrast: number;
}

export interface HueSaturationOptions {
  hue: number;
  saturation: number;
}

export interface LevelsOptions {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export interface SharpenOptions {
  amount: number;
}

export interface ThresholdOptions {
  level: number;
}

export interface PosterizeOptions {
  levels: number;
}

type Mask = Uint8ClampedArray | null | undefined;

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function wrapHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

function maskCoverage(mask: Mask, pixelIndex: number): number {
  return mask ? mask[pixelIndex] / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function resolveNoOptionsMask(
  optsOrMask?: Mask | Record<string, never>,
  mask?: Mask,
): Mask {
  return optsOrMask instanceof Uint8ClampedArray ? optsOrMask : mask;
}

function createGaussianKernel(radius: number): number[] {
  const integerRadius = Math.max(0, Math.ceil(radius));
  if (integerRadius === 0) return [1];

  const sigma = Math.max(radius / 3, 0.1);
  const kernel: number[] = [];
  let sum = 0;

  for (let offset = -integerRadius; offset <= integerRadius; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel.push(weight);
    sum += weight;
  }

  return kernel.map((weight) => weight / sum);
}

function rgbaIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

export function gaussianBlur(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: GaussianBlurOptions,
  mask?: Mask,
): Uint8ClampedArray {
  const radius = Math.max(0, opts.radius);
  if (radius === 0 || width <= 0 || height <= 0) return pixels;

  const source = new Uint8ClampedArray(pixels);
  const horizontal = new Float64Array(pixels.length);
  const kernel = createGaussianKernel(radius);
  const kernelRadius = Math.floor(kernel.length / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dst = rgbaIndex(x, y, width);

      for (let channel = 0; channel < 4; channel++) {
        let value = 0;
        for (let k = -kernelRadius; k <= kernelRadius; k++) {
          const sampleX = Math.min(width - 1, Math.max(0, x + k));
          value += source[rgbaIndex(sampleX, y, width) + channel] * kernel[k + kernelRadius];
        }
        horizontal[dst + channel] = value;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dst = rgbaIndex(x, y, width);
      const pixel = y * width + x;
      const coverage = maskCoverage(mask, pixel);
      if (coverage <= 0) continue;

      for (let channel = 0; channel < 4; channel++) {
        let filtered = 0;
        for (let k = -kernelRadius; k <= kernelRadius; k++) {
          const sampleY = Math.min(height - 1, Math.max(0, y + k));
          filtered += horizontal[rgbaIndex(x, sampleY, width) + channel] * kernel[k + kernelRadius];
        }
        pixels[dst + channel] = blendChannel(source[dst + channel], filtered, coverage);
      }
    }
  }

  return pixels;
}

export function adjustBrightnessContrast(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: BrightnessContrastOptions,
  mask?: Mask,
): Uint8ClampedArray {
  const brightness = Math.max(-100, Math.min(100, opts.brightness)) * 2.55;
  const contrast = Math.max(-100, Math.min(100, opts.contrast)) * 2.55;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let pixel = 0; pixel < width * height; pixel++) {
    const coverage = maskCoverage(mask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      const original = pixels[i + channel];
      const filtered = factor * (original - 128) + 128 + brightness;
      pixels[i + channel] = blendChannel(original, filtered, coverage);
    }
  }

  return pixels;
}

export function invertColors(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  optsOrMask?: Mask | Record<string, never>,
  mask?: Mask,
): Uint8ClampedArray {
  const resolvedMask = resolveNoOptionsMask(optsOrMask, mask);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const coverage = maskCoverage(resolvedMask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      const original = pixels[i + channel];
      pixels[i + channel] = blendChannel(original, 255 - original, coverage);
    }
  }

  return pixels;
}

export function grayscale(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  optsOrMask?: Mask | Record<string, never>,
  mask?: Mask,
): Uint8ClampedArray {
  const resolvedMask = resolveNoOptionsMask(optsOrMask, mask);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const coverage = maskCoverage(resolvedMask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    const originalR = pixels[i];
    const originalG = pixels[i + 1];
    const originalB = pixels[i + 2];
    const luminance = 0.299 * originalR + 0.587 * originalG + 0.114 * originalB;

    pixels[i] = blendChannel(originalR, luminance, coverage);
    pixels[i + 1] = blendChannel(originalG, luminance, coverage);
    pixels[i + 2] = blendChannel(originalB, luminance, coverage);
  }

  return pixels;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }
  }

  return {
    h: wrapHue(h),
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const chroma = v * s;
  const segment = wrapHue(h) / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const m = v - chroma;
  let r = 0;
  let g = 0;
  let b = 0;

  if (segment < 1) {
    r = chroma;
    g = x;
  } else if (segment < 2) {
    r = x;
    g = chroma;
  } else if (segment < 3) {
    g = chroma;
    b = x;
  } else if (segment < 4) {
    g = x;
    b = chroma;
  } else if (segment < 5) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  return [
    clamp255((r + m) * 255),
    clamp255((g + m) * 255),
    clamp255((b + m) * 255),
  ];
}

export function adjustHueSaturation(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: HueSaturationOptions,
  mask?: Mask,
): Uint8ClampedArray {
  const hue = Math.max(-180, Math.min(180, opts.hue));
  const saturation = Math.max(-100, Math.min(100, opts.saturation));

  for (let pixel = 0; pixel < width * height; pixel++) {
    const coverage = maskCoverage(mask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    const originalR = pixels[i];
    const originalG = pixels[i + 1];
    const originalB = pixels[i + 2];
    const hsv = rgbToHsv(originalR, originalG, originalB);
    const adjustedS = saturation < 0
      ? hsv.s * (1 + saturation / 100)
      : hsv.s + (1 - hsv.s) * (saturation / 100);
    const [filteredR, filteredG, filteredB] = hsvToRgb(hsv.h + hue, clamp01(adjustedS), hsv.v);

    pixels[i] = blendChannel(originalR, filteredR, coverage);
    pixels[i + 1] = blendChannel(originalG, filteredG, coverage);
    pixels[i + 2] = blendChannel(originalB, filteredB, coverage);
  }

  return pixels;
}

export function adjustLevels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: LevelsOptions,
  mask?: Mask,
): Uint8ClampedArray {
  const inBlack = Math.max(0, Math.min(255, opts.inBlack));
  const inWhite = Math.max(0, Math.min(255, opts.inWhite));
  const gamma = Math.max(0.01, opts.gamma);
  const outBlack = Math.max(0, Math.min(255, opts.outBlack));
  const outWhite = Math.max(0, Math.min(255, opts.outWhite));
  const inputRange = Math.max(1, inWhite - inBlack);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const coverage = maskCoverage(mask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      const original = pixels[i + channel];
      const normalized = clamp01((original - inBlack) / inputRange);
      const corrected = Math.pow(normalized, 1 / gamma);
      const filtered = outBlack + corrected * (outWhite - outBlack);
      pixels[i + channel] = blendChannel(original, filtered, coverage);
    }
  }

  return pixels;
}

export function sharpen(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: SharpenOptions,
  mask?: Mask,
): Uint8ClampedArray {
  const amount = Math.max(0, Math.min(2, opts.amount));
  if (amount === 0 || width <= 0 || height <= 0) return pixels;

  const source = new Uint8ClampedArray(pixels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const coverage = maskCoverage(mask, pixel);
      if (coverage <= 0) continue;

      const center = rgbaIndex(x, y, width);
      const left = rgbaIndex(Math.max(0, x - 1), y, width);
      const right = rgbaIndex(Math.min(width - 1, x + 1), y, width);
      const top = rgbaIndex(x, Math.max(0, y - 1), width);
      const bottom = rgbaIndex(x, Math.min(height - 1, y + 1), width);

      for (let channel = 0; channel < 3; channel++) {
        const original = source[center + channel];
        const laplacian = (4 * original)
          - source[left + channel]
          - source[right + channel]
          - source[top + channel]
          - source[bottom + channel];
        pixels[center + channel] = blendChannel(original, original + laplacian * amount, coverage);
      }
    }
  }

  return pixels;
}

export function threshold(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: ThresholdOptions,
  mask?: Mask,
): Uint8ClampedArray {
  const level = Math.max(0, Math.min(255, opts.level));

  for (let pixel = 0; pixel < width * height; pixel++) {
    const coverage = maskCoverage(mask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    const originalR = pixels[i];
    const originalG = pixels[i + 1];
    const originalB = pixels[i + 2];
    const luminance = 0.299 * originalR + 0.587 * originalG + 0.114 * originalB;
    const filtered = luminance >= level ? 255 : 0;

    pixels[i] = blendChannel(originalR, filtered, coverage);
    pixels[i + 1] = blendChannel(originalG, filtered, coverage);
    pixels[i + 2] = blendChannel(originalB, filtered, coverage);
  }

  return pixels;
}

export function posterize(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: PosterizeOptions,
  mask?: Mask,
): Uint8ClampedArray {
  const levels = Math.max(2, Math.min(255, Math.round(opts.levels)));
  const step = 255 / (levels - 1);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const coverage = maskCoverage(mask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      const original = pixels[i + channel];
      const filtered = Math.round(original / step) * step;
      pixels[i + channel] = blendChannel(original, filtered, coverage);
    }
  }

  return pixels;
}

export function sepia(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  optsOrMask?: Mask | Record<string, never>,
  mask?: Mask,
): Uint8ClampedArray {
  const resolvedMask = resolveNoOptionsMask(optsOrMask, mask);

  for (let pixel = 0; pixel < width * height; pixel++) {
    const coverage = maskCoverage(resolvedMask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    const originalR = pixels[i];
    const originalG = pixels[i + 1];
    const originalB = pixels[i + 2];
    const filteredR = 0.393 * originalR + 0.769 * originalG + 0.189 * originalB;
    const filteredG = 0.349 * originalR + 0.686 * originalG + 0.168 * originalB;
    const filteredB = 0.272 * originalR + 0.534 * originalG + 0.131 * originalB;

    pixels[i] = blendChannel(originalR, filteredR, coverage);
    pixels[i + 1] = blendChannel(originalG, filteredG, coverage);
    pixels[i + 2] = blendChannel(originalB, filteredB, coverage);
  }

  return pixels;
}
