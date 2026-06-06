import type { RGBA } from '../types';

interface QuantColor {
  r: number;
  g: number;
  b: number;
  aSum: number;
  count: number;
  key: number;
}

interface BucketStats {
  count: number;
  minKey: number;
  varianceR: number;
  varianceG: number;
  varianceB: number;
  splitChannel: 0 | 1 | 2;
  splitVariance: number;
}

interface ColorBucket {
  colors: QuantColor[];
  stats: BucketStats;
}

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function normalizeMaxColors(maxColors: number): number {
  if (!Number.isFinite(maxColors)) return 1;
  return Math.max(1, Math.min(65536, Math.floor(maxColors)));
}

function colorKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

function channelValue(color: QuantColor, channel: 0 | 1 | 2): number {
  if (channel === 0) return color.r;
  if (channel === 1) return color.g;
  return color.b;
}

function createStats(colors: QuantColor[]): BucketStats {
  let count = 0;
  let minKey = Number.POSITIVE_INFINITY;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumR2 = 0;
  let sumG2 = 0;
  let sumB2 = 0;

  for (const color of colors) {
    count += color.count;
    minKey = Math.min(minKey, color.key);
    sumR += color.r * color.count;
    sumG += color.g * color.count;
    sumB += color.b * color.count;
    sumR2 += color.r * color.r * color.count;
    sumG2 += color.g * color.g * color.count;
    sumB2 += color.b * color.b * color.count;
  }

  const varianceR = sumR2 / count - (sumR / count) ** 2;
  const varianceG = sumG2 / count - (sumG / count) ** 2;
  const varianceB = sumB2 / count - (sumB / count) ** 2;
  let splitChannel: 0 | 1 | 2 = 0;
  let splitVariance = varianceR;
  if (varianceG > splitVariance) {
    splitChannel = 1;
    splitVariance = varianceG;
  }
  if (varianceB > splitVariance) {
    splitChannel = 2;
    splitVariance = varianceB;
  }

  return {
    count,
    minKey,
    varianceR,
    varianceG,
    varianceB,
    splitChannel,
    splitVariance,
  };
}

function createBucket(colors: QuantColor[]): ColorBucket {
  return {
    colors,
    stats: createStats(colors),
  };
}

function compareColorsByChannel(channel: 0 | 1 | 2): (left: QuantColor, right: QuantColor) => number {
  return (left, right) => (
    channelValue(left, channel) - channelValue(right, channel)
    || left.r - right.r
    || left.g - right.g
    || left.b - right.b
    || left.key - right.key
  );
}

function compareBucketsForSplit(left: ColorBucket, right: ColorBucket): number {
  return (
    right.stats.splitVariance - left.stats.splitVariance
    || right.stats.count - left.stats.count
    || left.stats.minKey - right.stats.minKey
  );
}

function splitBucket(bucket: ColorBucket): [ColorBucket, ColorBucket] | null {
  if (bucket.colors.length <= 1 || bucket.stats.splitVariance <= 0) return null;

  const sorted = [...bucket.colors].sort(compareColorsByChannel(bucket.stats.splitChannel));
  const half = bucket.stats.count / 2;
  let cumulative = 0;
  let splitIndex = 1;

  for (let index = 0; index < sorted.length - 1; index++) {
    cumulative += sorted[index].count;
    if (cumulative >= half) {
      splitIndex = index + 1;
      break;
    }
  }

  splitIndex = Math.max(1, Math.min(sorted.length - 1, splitIndex));
  return [
    createBucket(sorted.slice(0, splitIndex)),
    createBucket(sorted.slice(splitIndex)),
  ];
}

function averageBucketColor(bucket: ColorBucket): RGBA {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;

  for (const color of bucket.colors) {
    r += color.r * color.count;
    g += color.g * color.count;
    b += color.b * color.count;
    a += color.aSum;
  }

  return {
    r: clamp255(r / bucket.stats.count),
    g: clamp255(g / bucket.stats.count),
    b: clamp255(b / bucket.stats.count),
    a: clamp255(a / bucket.stats.count),
  };
}

function collectColors(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  includeTransparent: boolean,
): QuantColor[] {
  const colors = new Map<number, QuantColor>();
  const totalPixels = Math.max(0, width * height);

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex++) {
    const index = pixelIndex * 4;
    const alpha = pixels[index + 3] ?? 0;
    if (!includeTransparent && alpha === 0) continue;

    const r = pixels[index] ?? 0;
    const g = pixels[index + 1] ?? 0;
    const b = pixels[index + 2] ?? 0;
    const key = colorKey(r, g, b);
    const existing = colors.get(key);

    if (existing) {
      existing.count++;
      existing.aSum += alpha;
    } else {
      colors.set(key, { r, g, b, aSum: alpha, count: 1, key });
    }
  }

  return [...colors.values()].sort((left, right) => left.key - right.key);
}

function buildPalette(colors: QuantColor[], maxColors: number): RGBA[] {
  if (colors.length === 0) return [];
  if (colors.length <= maxColors) {
    return colors.map((color) => ({
      r: color.r,
      g: color.g,
      b: color.b,
      a: clamp255(color.aSum / color.count),
    }));
  }

  const buckets = [createBucket(colors)];
  while (buckets.length < maxColors) {
    buckets.sort(compareBucketsForSplit);
    const splitIndex = buckets.findIndex((bucket) => (
      bucket.colors.length > 1 && bucket.stats.splitVariance > 0
    ));
    if (splitIndex === -1) break;

    const split = splitBucket(buckets[splitIndex]);
    if (!split) break;
    buckets.splice(splitIndex, 1, split[0], split[1]);
  }

  return buckets
    .map(averageBucketColor)
    .sort((left, right) => (
      colorKey(left.r, left.g, left.b) - colorKey(right.r, right.g, right.b)
      || left.a - right.a
    ));
}

function nearestPaletteIndex(palette: RGBA[], r: number, g: number, b: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < palette.length; index++) {
    const color = palette[index];
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function createIndexArray(length: number, paletteLength: number): Uint8Array | Uint16Array {
  if (paletteLength <= 256) return new Uint8Array(length);
  return new Uint16Array(length);
}

function blendChannel(original: number, quantized: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return quantized;
  return clamp255(original + (quantized - original) * coverage);
}

export function quantizeColors(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  maxColors: number,
): { palette: RGBA[]; indices: Uint8Array | Uint16Array } {
  const totalPixels = Math.max(0, width * height);
  const targetColors = normalizeMaxColors(maxColors);
  let colors = collectColors(pixels, width, height, false);
  if (colors.length === 0 && totalPixels > 0) {
    colors = collectColors(pixels, width, height, true);
  }

  const palette = buildPalette(colors, targetColors);
  const indices = createIndexArray(totalPixels, palette.length);
  if (palette.length === 0) return { palette, indices };

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex++) {
    const index = pixelIndex * 4;
    indices[pixelIndex] = nearestPaletteIndex(
      palette,
      pixels[index] ?? 0,
      pixels[index + 1] ?? 0,
      pixels[index + 2] ?? 0,
    );
  }

  return { palette, indices };
}

export function applyQuantize(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  maxColors: number,
  mask?: Uint8ClampedArray | null,
): void {
  const { palette, indices } = quantizeColors(pixels, width, height, maxColors);
  if (palette.length === 0) return;

  const totalPixels = Math.max(0, width * height);
  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex++) {
    const coverage = mask ? (mask[pixelIndex] ?? 0) / 255 : 1;
    if (coverage <= 0) continue;

    const index = pixelIndex * 4;
    const color = palette[indices[pixelIndex]];
    pixels[index] = blendChannel(pixels[index], color.r, coverage);
    pixels[index + 1] = blendChannel(pixels[index + 1], color.g, coverage);
    pixels[index + 2] = blendChannel(pixels[index + 2], color.b, coverage);
  }
}
