import type { RGBA } from '../types';

type Mask = Uint8ClampedArray | null | undefined;

export interface VignetteOptions {
  amount: number;
  radius?: number;
  softness?: number;
  color?: RGBA;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clamp255(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function maskCoverage(mask: Mask, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (value <= edge0) return 0;
  if (value >= edge1) return 1;
  const t = (value - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

function blendMultiplyChannel(original: number, color: number, amount: number): number {
  const multiplied = original * (clamp255(color) / 255);
  return clamp255(original + (multiplied - original) * amount);
}

export function vignette(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: VignetteOptions,
  mask?: Mask,
): void {
  const amount = clamp01(opts.amount);
  if (amount <= 0 || w <= 0 || h <= 0) return;

  const radius = clamp01(opts.radius ?? 0.5);
  const softness = clamp01(opts.softness ?? 0.5);
  const color = opts.color ?? { r: 0, g: 0, b: 0, a: 255 };
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxDistance = Math.hypot(Math.max(cx, w - 1 - cx), Math.max(cy, h - 1 - cy));
  const totalPixels = Math.max(0, w * h);

  if (maxDistance <= 0) return;

  for (let pixel = 0; pixel < totalPixels; pixel++) {
    const coverage = maskCoverage(mask, pixel);
    if (coverage <= 0) continue;

    const x = pixel % w;
    const y = Math.floor(pixel / w);
    const distance = Math.hypot(x - cx, y - cy) / maxDistance;
    const falloff = softness <= 0
      ? (distance >= radius ? 1 : 0)
      : smoothstep(radius, radius + softness, distance);
    const effect = amount * falloff * coverage;

    if (effect <= 0) continue;

    const index = pixel * 4;
    px[index] = blendMultiplyChannel(px[index], color.r, effect);
    px[index + 1] = blendMultiplyChannel(px[index + 1], color.g, effect);
    px[index + 2] = blendMultiplyChannel(px[index + 2], color.b, effect);
  }
}
