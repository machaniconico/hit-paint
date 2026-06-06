import type { RGBA } from '../types';

export interface Swatch {
  color: RGBA;
  weight: number;
}

interface Bucket {
  key: number;
  count: number;
  firstIndex: number;
  sumR: number;
  sumG: number;
  sumB: number;
}

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function bucketKey(r: number, g: number, b: number): number {
  return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
}

function luma(color: RGBA): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

export function extractPalette(px: Uint8ClampedArray, w: number, h: number, count: number): Swatch[] {
  const requested = Math.floor(count);
  if (requested <= 0 || w <= 0 || h <= 0) return [];

  const pixelCount = Math.min(Math.floor(w) * Math.floor(h), Math.floor(px.length / 4));
  if (pixelCount <= 0) return [];

  const buckets = new Map<number, Bucket>();
  let opaquePixels = 0;

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const index = pixel * 4;
    if (px[index + 3] === 0) continue;

    const r = px[index];
    const g = px[index + 1];
    const b = px[index + 2];
    const key = bucketKey(r, g, b);
    const bucket = buckets.get(key);

    if (bucket) {
      bucket.count++;
      bucket.sumR += r;
      bucket.sumG += g;
      bucket.sumB += b;
    } else {
      buckets.set(key, {
        key,
        count: 1,
        firstIndex: pixel,
        sumR: r,
        sumG: g,
        sumB: b,
      });
    }

    opaquePixels++;
  }

  if (opaquePixels === 0) return [];

  return Array.from(buckets.values())
    .sort((left, right) => (
      right.count - left.count
      || left.firstIndex - right.firstIndex
      || left.key - right.key
    ))
    .slice(0, requested)
    .map((bucket) => ({
      color: {
        r: clamp255(bucket.sumR / bucket.count),
        g: clamp255(bucket.sumG / bucket.count),
        b: clamp255(bucket.sumB / bucket.count),
        a: 255,
      },
      weight: bucket.count / opaquePixels,
    }));
}

export function sortByLuma(swatches: Swatch[]): Swatch[] {
  return [...swatches].sort((left, right) => luma(left.color) - luma(right.color));
}

export function toHex(color: RGBA): string {
  const hex = (value: number): string => clamp255(value).toString(16).padStart(2, '0');
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}
