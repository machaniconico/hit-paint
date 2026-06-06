import type { RGBA } from '../types';

export interface DisplaceOptions {
  map: Uint8ClampedArray;
  scaleX: number;
  scaleY: number;
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

function displacementFromChannel(map: Uint8ClampedArray, index: number, scale: number): number {
  if (scale === 0 || index >= map.length) return 0;

  const channel = map[index];
  if (channel === 128) return 0;
  return (channel / 255 - 0.5) * 2 * scale;
}

function bilinearChannel(
  source: Uint8ClampedArray,
  c00: number,
  c10: number,
  c01: number,
  c11: number,
  channel: number,
  tx: number,
  ty: number,
): number {
  const top = source[c00 + channel] + (source[c10 + channel] - source[c00 + channel]) * tx;
  const bottom = source[c01 + channel] + (source[c11 + channel] - source[c01 + channel]) * tx;
  return top + (bottom - top) * ty;
}

function sampleBilinear(source: Uint8ClampedArray, width: number, height: number, x: number, y: number): RGBA {
  const sx = clampCoord(x, width - 1);
  const sy = clampCoord(y, height - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;
  const c00 = rgbaIndex(x0, y0, width);
  const c10 = rgbaIndex(x1, y0, width);
  const c01 = rgbaIndex(x0, y1, width);
  const c11 = rgbaIndex(x1, y1, width);

  return {
    r: bilinearChannel(source, c00, c10, c01, c11, 0, tx, ty),
    g: bilinearChannel(source, c00, c10, c01, c11, 1, tx, ty),
    b: bilinearChannel(source, c00, c10, c01, c11, 2, tx, ty),
    a: bilinearChannel(source, c00, c10, c01, c11, 3, tx, ty),
  };
}

export function displace(px: Uint8ClampedArray, w: number, h: number, opts: DisplaceOptions): void {
  if (w <= 0 || h <= 0) return;

  const scaleX = Number.isFinite(opts.scaleX) ? opts.scaleX : 0;
  const scaleY = Number.isFinite(opts.scaleY) ? opts.scaleY : 0;
  if (scaleX === 0 && scaleY === 0) return;

  const pixelCount = w * h;
  const source = new Uint8ClampedArray(px);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = y * w + x;
      const coverage = maskCoverage(opts.mask, pixel, pixelCount);
      if (coverage <= 0) continue;

      const dst = rgbaIndex(x, y, w);
      const dx = displacementFromChannel(opts.map, dst, scaleX);
      const dy = displacementFromChannel(opts.map, dst + 1, scaleY);
      if (dx === 0 && dy === 0) continue;

      const sampled = sampleBilinear(source, w, h, x + dx, y + dy);
      px[dst] = blendChannel(source[dst], sampled.r, coverage);
      px[dst + 1] = blendChannel(source[dst + 1], sampled.g, coverage);
      px[dst + 2] = blendChannel(source[dst + 2], sampled.b, coverage);
      px[dst + 3] = blendChannel(source[dst + 3], sampled.a, coverage);
    }
  }
}
