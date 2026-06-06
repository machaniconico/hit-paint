export interface MaskDabOptions {
  x: number;
  y: number;
  radius: number;
  value: number;
  hardness?: number;
  shape?: 'round' | 'soft';
  flow?: number;
}

type MaskStrokePoint = {
  x: number;
  y: number;
};

type MaskStrokeOptions = Omit<MaskDabOptions, 'x' | 'y'> & {
  spacing?: number;
};

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function coverageAtDistance(distance: number, radius: number, hardness: number): number {
  if (distance > radius) return 0;
  if (hardness >= 1) return 1;

  const innerRadius = radius * hardness;
  if (distance <= innerRadius) return 1;

  const fadeWidth = radius - innerRadius;
  if (fadeWidth <= 0) return 1;

  return Math.max(0, Math.min(1, (radius - distance) / fadeWidth));
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function softCoverageAtDistance(distance: number, radius: number, hardness: number): number {
  if (distance > radius) return 0;
  if (hardness >= 1) return 1;

  const innerRadius = radius * hardness;
  if (distance <= innerRadius) return 1;

  const fadeWidth = radius - innerRadius;
  if (fadeWidth <= 0) return 1;

  const t = Math.max(0, Math.min(1, (radius - distance) / fadeWidth));
  return smoothstep(t);
}

export function paintMaskDab(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  opts: MaskDabOptions,
): void {
  const radius = opts.radius;
  if (radius <= 0 || width <= 0 || height <= 0) return;

  const value = clampByte(opts.value);
  const hardness = clampUnit(opts.hardness ?? 1);
  const flow = clampUnit(opts.flow ?? 1);
  const shape = opts.shape ?? 'round';

  const minX = Math.max(0, Math.ceil(opts.x - radius));
  const maxX = Math.min(width - 1, Math.floor(opts.x + radius));
  const minY = Math.max(0, Math.ceil(opts.y - radius));
  const maxY = Math.min(height - 1, Math.floor(opts.y + radius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const distance = Math.hypot(x - opts.x, y - opts.y);
      const coverage =
        shape === 'soft'
          ? softCoverageAtDistance(distance, radius, hardness)
          : coverageAtDistance(distance, radius, hardness);
      if (coverage <= 0) continue;

      const effectiveCoverage = coverage * flow;
      if (effectiveCoverage <= 0) continue;

      const index = y * width + x;
      if (index >= mask.length) continue;

      mask[index] = Math.round(mask[index] * (1 - effectiveCoverage) + value * effectiveCoverage);
    }
  }
}

export function paintMaskStroke(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  points: MaskStrokePoint[],
  opts: MaskStrokeOptions,
): void {
  if (points.length === 0) return;

  const spacing = Math.max(1, opts.spacing ?? opts.radius * 0.25);

  paintMaskDab(mask, width, height, { ...opts, x: points[0].x, y: points[0].y });

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    const distance = Math.hypot(next.x - prev.x, next.y - prev.y);
    const steps = Math.max(1, Math.ceil(distance / spacing));

    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      paintMaskDab(mask, width, height, {
        ...opts,
        x: prev.x + (next.x - prev.x) * t,
        y: prev.y + (next.y - prev.y) * t,
      });
    }
  }
}
