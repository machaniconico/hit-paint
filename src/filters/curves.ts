export interface CurvePoint {
  x: number;
  y: number;
}

export interface CurvesOptions {
  rgb?: CurvePoint[];
  r?: CurvePoint[];
  g?: CurvePoint[];
  b?: CurvePoint[];
  mask?: Uint8ClampedArray | null;
}

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function normalizePoint(point: CurvePoint): CurvePoint {
  return {
    x: clamp255(point.x),
    y: clamp255(point.y),
  };
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return filtered;
  return clamp255(original + (filtered - original) * coverage);
}

export function buildLut(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);

  if (points.length === 0) {
    for (let value = 0; value < lut.length; value++) {
      lut[value] = value;
    }
    return lut;
  }

  const sorted = points
    .map(normalizePoint)
    .sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  for (let value = 0; value <= first.x; value++) {
    lut[value] = first.y;
  }

  for (let pointIndex = 0; pointIndex < sorted.length - 1; pointIndex++) {
    const start = sorted[pointIndex];
    const end = sorted[pointIndex + 1];

    if (end.x <= start.x) {
      lut[start.x] = end.y;
      continue;
    }

    for (let value = start.x + 1; value <= end.x; value++) {
      const t = (value - start.x) / (end.x - start.x);
      lut[value] = clamp255(start.y + (end.y - start.y) * t);
    }
  }

  for (let value = last.x + 1; value < lut.length; value++) {
    lut[value] = last.y;
  }

  return lut;
}

export function applyCurves(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  options: CurvesOptions,
): void {
  const rgbLut = options.rgb ? buildLut(options.rgb) : null;
  const rLut = options.r ? buildLut(options.r) : rgbLut;
  const gLut = options.g ? buildLut(options.g) : rgbLut;
  const bLut = options.b ? buildLut(options.b) : rgbLut;
  const { mask } = options;

  for (let pixel = 0; pixel < w * h; pixel++) {
    const coverage = mask ? mask[pixel] / 255 : 1;
    if (coverage <= 0) continue;

    const i = pixel * 4;
    if (rLut) px[i] = blendChannel(px[i], rLut[px[i]], coverage);
    if (gLut) px[i + 1] = blendChannel(px[i + 1], gLut[px[i + 1]], coverage);
    if (bLut) px[i + 2] = blendChannel(px[i + 2], bLut[px[i + 2]], coverage);
  }
}
