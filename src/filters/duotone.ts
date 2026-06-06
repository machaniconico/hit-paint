export type RGBA = [number, number, number, number];

type Mask = Uint8ClampedArray | null | undefined;

export interface DuotoneOptions {
  shadow: RGBA;
  highlight: RGBA;
  mask?: Uint8ClampedArray | null;
}

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function maskCoverage(mask: Mask, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function duotone(px: Uint8ClampedArray, w: number, h: number, opts: DuotoneOptions): void {
  if (w <= 0 || h <= 0) return;

  const totalPixels = Math.min(w * h, Math.floor(px.length / 4));

  for (let pixel = 0; pixel < totalPixels; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel);
    if (coverage <= 0) continue;

    const i = pixel * 4;
    const t = luma(px[i], px[i + 1], px[i + 2]) / 255;
    const newR = clamp255(opts.shadow[0] + t * (opts.highlight[0] - opts.shadow[0]));
    const newG = clamp255(opts.shadow[1] + t * (opts.highlight[1] - opts.shadow[1]));
    const newB = clamp255(opts.shadow[2] + t * (opts.highlight[2] - opts.shadow[2]));

    px[i] = blendChannel(px[i], newR, coverage);
    px[i + 1] = blendChannel(px[i + 1], newG, coverage);
    px[i + 2] = blendChannel(px[i + 2], newB, coverage);
  }
}
