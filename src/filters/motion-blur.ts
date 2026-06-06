export interface MotionBlurOptions {
  angle: number;
  distance: number;
}

export interface ZoomBlurOptions {
  cx: number;
  cy: number;
  strength: number;
}

type Mask = Uint8ClampedArray | null | undefined;

function clamp255(value: number): number {
  if (value <= 0) return 0;
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

function maskCoverage(mask: Mask, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function writeAverage(
  target: Uint8ClampedArray,
  source: Uint8ClampedArray,
  dst: number,
  samples: number[],
  coverage: number,
): void {
  for (let channel = 0; channel < 4; channel++) {
    let sum = 0;
    for (const sample of samples) {
      sum += source[sample + channel];
    }
    target[dst + channel] = blendChannel(source[dst + channel], sum / samples.length, coverage);
  }
}

export function motionBlur(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: MotionBlurOptions,
  mask?: Mask,
): void {
  if (w <= 0 || h <= 0 || opts.distance <= 0 || !Number.isFinite(opts.distance) || !Number.isFinite(opts.angle)) return;

  const source = new Uint8ClampedArray(px);
  const radius = Math.max(1, Math.ceil(opts.distance));
  const angle = (opts.angle * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = y * w + x;
      const coverage = maskCoverage(mask, pixel);
      if (coverage <= 0) continue;

      const samples: number[] = [];
      for (let step = -radius; step <= radius; step++) {
        const offset = (step / radius) * opts.distance;
        const sx = clampCoord(Math.round(x + dx * offset), w - 1);
        const sy = clampCoord(Math.round(y + dy * offset), h - 1);
        samples.push(rgbaIndex(sx, sy, w));
      }

      writeAverage(px, source, rgbaIndex(x, y, w), samples, coverage);
    }
  }
}

export function zoomBlur(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: ZoomBlurOptions,
  mask?: Mask,
): void {
  if (
    w <= 0 ||
    h <= 0 ||
    opts.strength <= 0 ||
    !Number.isFinite(opts.strength) ||
    !Number.isFinite(opts.cx) ||
    !Number.isFinite(opts.cy)
  ) {
    return;
  }

  const source = new Uint8ClampedArray(px);
  const strength = Math.min(1, opts.strength);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = y * w + x;
      const coverage = maskCoverage(mask, pixel);
      if (coverage <= 0) continue;

      const vx = x - opts.cx;
      const vy = y - opts.cy;
      const distance = Math.hypot(vx, vy);
      const radius = Math.ceil(distance * strength);
      const sampleCount = Math.max(2, radius + 1);
      const samples: number[] = [];

      for (let i = 0; i < sampleCount; i++) {
        const amount = sampleCount === 1 ? 0 : (i / (sampleCount - 1)) * strength;
        const sx = clampCoord(Math.round(x - vx * amount), w - 1);
        const sy = clampCoord(Math.round(y - vy * amount), h - 1);
        samples.push(rgbaIndex(sx, sy, w));
      }

      writeAverage(px, source, rgbaIndex(x, y, w), samples, coverage);
    }
  }
}
