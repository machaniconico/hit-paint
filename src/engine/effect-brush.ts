export type EffectBrushOptions = {
  x: number;
  y: number;
  radius: number;
  strength: number;
  hardness?: number;
};

type RgbTransform = (
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  amount: number,
) => [number, number, number];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function pixelIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function average3x3(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
      const i = pixelIndex(xx, yy, width);
      r += src[i];
      g += src[i + 1];
      b += src[i + 2];
      count++;
    }
  }

  return [r / count, g / count, b / count];
}

function brushCoverage(dx: number, dy: number, radius: number, hardness: number): number {
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) return 0;
  if (radius <= 0) return 0;

  const normalized = distance / radius;
  if (hardness >= 1) return 1;
  if (normalized <= hardness) return 1;

  return Math.max(0, (1 - normalized) / (1 - hardness));
}

function applyDab(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: EffectBrushOptions,
  transform: RgbTransform,
): void {
  const strength = clamp01(opts.strength);
  const radius = Math.max(0, opts.radius);
  if (pixels.length === 0 || width <= 0 || height <= 0 || radius <= 0 || strength <= 0) {
    return;
  }

  const hardness = clamp01(opts.hardness ?? 0);
  const left = Math.max(0, Math.floor(opts.x - radius));
  const right = Math.min(width - 1, Math.ceil(opts.x + radius));
  const top = Math.max(0, Math.floor(opts.y - radius));
  const bottom = Math.min(height - 1, Math.ceil(opts.y + radius));
  const src = new Uint8ClampedArray(pixels);

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const amount = strength * brushCoverage(x - opts.x, y - opts.y, radius, hardness);
      if (amount <= 0) continue;

      const i = pixelIndex(x, y, width);
      const [r, g, b] = transform(src, width, height, x, y, amount);
      pixels[i] = clampByte(r);
      pixels[i + 1] = clampByte(g);
      pixels[i + 2] = clampByte(b);
    }
  }
}

export function blurDab(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: EffectBrushOptions,
): void {
  applyDab(pixels, width, height, opts, (src, w, h, x, y, amount) => {
    const i = pixelIndex(x, y, w);
    const [r, g, b] = average3x3(src, w, h, x, y);
    return [
      src[i] + (r - src[i]) * amount,
      src[i + 1] + (g - src[i + 1]) * amount,
      src[i + 2] + (b - src[i + 2]) * amount,
    ];
  });
}

export function sharpenDab(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: EffectBrushOptions,
): void {
  applyDab(pixels, width, height, opts, (src, w, h, x, y, amount) => {
    const i = pixelIndex(x, y, w);
    const [r, g, b] = average3x3(src, w, h, x, y);
    return [
      src[i] + (src[i] - r) * amount,
      src[i + 1] + (src[i + 1] - g) * amount,
      src[i + 2] + (src[i + 2] - b) * amount,
    ];
  });
}

export function dodgeDab(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: EffectBrushOptions,
): void {
  applyDab(pixels, width, height, opts, (src, w, _h, x, y, amount) => {
    const i = pixelIndex(x, y, w);
    const factor = 1 + amount;
    return [
      src[i] * factor,
      src[i + 1] * factor,
      src[i + 2] * factor,
    ];
  });
}

export function burnDab(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: EffectBrushOptions,
): void {
  applyDab(pixels, width, height, opts, (src, w, _h, x, y, amount) => {
    const i = pixelIndex(x, y, w);
    const factor = 1 - amount;
    return [
      src[i] * factor,
      src[i + 1] * factor,
      src[i + 2] * factor,
    ];
  });
}
