export interface GaussianBlurOptions {
  radius: number;
  sigma?: number;
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

function gaussianKernel(radius: number, sigma: number | undefined): number[] {
  const integerRadius = Math.max(0, Math.ceil(radius));
  if (integerRadius === 0) return [1];

  const defaultSigma = Math.max(radius / 3, 0.1);
  const resolvedSigma = sigma && Number.isFinite(sigma) && sigma > 0 ? sigma : defaultSigma;
  const kernel: number[] = [];
  let sum = 0;

  for (let offset = -integerRadius; offset <= integerRadius; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * resolvedSigma * resolvedSigma));
    kernel.push(weight);
    sum += weight;
  }

  return kernel.map((weight) => weight / sum);
}

export function gaussianBlur(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: GaussianBlurOptions,
): void {
  if (w <= 0 || h <= 0 || opts.radius <= 0 || !Number.isFinite(opts.radius)) return;

  const pixelCount = w * h;
  const source = new Uint8ClampedArray(px);
  const horizontal = new Float64Array(px.length);
  const kernel = gaussianKernel(opts.radius, opts.sigma);
  const radius = Math.floor(kernel.length / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dst = rgbaIndex(x, y, w);
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let k = -radius; k <= radius; k++) {
        const sx = clampCoord(x + k, w - 1);
        const src = rgbaIndex(sx, y, w);
        const weight = kernel[k + radius];
        const weightedAlpha = weight * source[src + 3];

        red += source[src] * weightedAlpha;
        green += source[src + 1] * weightedAlpha;
        blue += source[src + 2] * weightedAlpha;
        alpha += weightedAlpha;
      }

      horizontal[dst] = red;
      horizontal[dst + 1] = green;
      horizontal[dst + 2] = blue;
      horizontal[dst + 3] = alpha;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = y * w + x;
      const coverage = maskCoverage(opts.mask, pixel, pixelCount);
      if (coverage <= 0) continue;

      const dst = rgbaIndex(x, y, w);
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let k = -radius; k <= radius; k++) {
        const sy = clampCoord(y + k, h - 1);
        const src = rgbaIndex(x, sy, w);
        const weight = kernel[k + radius];

        red += horizontal[src] * weight;
        green += horizontal[src + 1] * weight;
        blue += horizontal[src + 2] * weight;
        alpha += horizontal[src + 3] * weight;
      }

      px[dst] = blendChannel(source[dst], alpha > 0 ? red / alpha : 0, coverage);
      px[dst + 1] = blendChannel(source[dst + 1], alpha > 0 ? green / alpha : 0, coverage);
      px[dst + 2] = blendChannel(source[dst + 2], alpha > 0 ? blue / alpha : 0, coverage);
      px[dst + 3] = blendChannel(source[dst + 3], alpha, coverage);
    }
  }
}
