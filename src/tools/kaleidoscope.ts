export interface KaleidoscopeOptions {
  segments: number;
  cx?: number;
  cy?: number;
  angleOffset?: number;
}

const TWO_PI = Math.PI * 2;

function rgbaIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

function sampleBilinear(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  outIndex: number,
): void {
  const sx = clamp(x, 0, width - 1);
  const sy = clamp(y, 0, height - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;

  const topLeft = rgbaIndex(x0, y0, width);
  const topRight = rgbaIndex(x1, y0, width);
  const bottomLeft = rgbaIndex(x0, y1, width);
  const bottomRight = rgbaIndex(x1, y1, width);

  for (let channel = 0; channel < 4; channel++) {
    const top = source[topLeft + channel] * (1 - tx)
      + source[topRight + channel] * tx;
    const bottom = source[bottomLeft + channel] * (1 - tx)
      + source[bottomRight + channel] * tx;
    out[outIndex + channel] = Math.round(top * (1 - ty) + bottom * ty);
  }
}

export function kaleidoscope(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: KaleidoscopeOptions,
): Uint8ClampedArray {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return new Uint8ClampedArray(0);

  const width = Math.floor(w);
  const height = Math.floor(h);

  if (width <= 0 || height <= 0) return new Uint8ClampedArray(0);

  const segments = Math.floor(opts.segments);
  if (!Number.isFinite(segments) || segments < 2) {
    return new Uint8ClampedArray(px);
  }

  const out = new Uint8ClampedArray(width * height * 4);
  if (px.length < out.length) return out;

  const cx = opts.cx ?? (width - 1) / 2;
  const cy = opts.cy ?? (height - 1) / 2;
  const angleOffset = opts.angleOffset ?? 0;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(angleOffset)) {
    return out;
  }

  const segmentAngle = TWO_PI / segments;
  const halfSegmentAngle = segmentAngle / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const radius = Math.hypot(dx, dy);
      const theta = normalizeAngle(Math.atan2(dy, dx));
      let localAngle = theta % segmentAngle;

      if (localAngle > halfSegmentAngle) {
        localAngle = segmentAngle - localAngle;
      }

      const sampleAngle = localAngle + angleOffset;
      const sx = cx + Math.cos(sampleAngle) * radius;
      const sy = cy + Math.sin(sampleAngle) * radius;
      sampleBilinear(px, width, height, sx, sy, out, rgbaIndex(x, y, width));
    }
  }

  return out;
}
