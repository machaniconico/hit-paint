export type PushDabOptions = {
  x: number;
  y: number;
  radius: number;
  dx: number;
  dy: number;
  strength: number;
};

export type RadialDabOptions = {
  x: number;
  y: number;
  radius: number;
  strength: number;
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

function pixelIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function brushAmount(x: number, y: number, cx: number, cy: number, radius: number, strength: number): number {
  const distance = Math.hypot(x - cx, y - cy);
  if (distance >= radius) return 0;
  return (1 - distance / radius) * strength;
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

  const topLeft = pixelIndex(x0, y0, width);
  const topRight = pixelIndex(x1, y0, width);
  const bottomLeft = pixelIndex(x0, y1, width);
  const bottomRight = pixelIndex(x1, y1, width);

  for (let channel = 0; channel < 4; channel++) {
    const top = source[topLeft + channel] * (1 - tx) + source[topRight + channel] * tx;
    const bottom = source[bottomLeft + channel] * (1 - tx) + source[bottomRight + channel] * tx;
    out[outIndex + channel] = Math.round(top * (1 - ty) + bottom * ty);
  }
}

function applyWarp(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  strength: number,
  sourcePoint: (px: number, py: number, amount: number) => [number, number],
): void {
  const amountStrength = clamp01(strength);
  if (
    pixels.length === 0
    || width <= 0
    || height <= 0
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(radius)
    || radius <= 0
    || amountStrength <= 0
    || x < 0
    || x > width - 1
    || y < 0
    || y > height - 1
  ) {
    return;
  }

  const left = Math.max(0, Math.floor(x - radius));
  const right = Math.min(width - 1, Math.ceil(x + radius));
  const top = Math.max(0, Math.floor(y - radius));
  const bottom = Math.min(height - 1, Math.ceil(y + radius));
  if (left > right || top > bottom) return;

  const source = new Uint8ClampedArray(pixels);

  for (let py = top; py <= bottom; py++) {
    for (let px = left; px <= right; px++) {
      const amount = brushAmount(px, py, x, y, radius, amountStrength);
      if (amount <= 0) continue;

      const [sx, sy] = sourcePoint(px, py, amount);
      sampleBilinear(source, width, height, sx, sy, pixels, pixelIndex(px, py, width));
    }
  }
}

export function pushDab(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: PushDabOptions,
): void {
  applyWarp(pixels, width, height, opts.x, opts.y, opts.radius, opts.strength, (px, py, amount) => [
    px - opts.dx * amount,
    py - opts.dy * amount,
  ]);
}

function radialDab(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: RadialDabOptions,
  direction: 1 | -1,
): void {
  applyWarp(pixels, width, height, opts.x, opts.y, opts.radius, opts.strength, (px, py, amount) => {
    const vx = px - opts.x;
    const vy = py - opts.y;
    const distance = Math.hypot(vx, vy);
    if (distance <= 0) return [px, py];

    const displacement = opts.radius * amount;
    const nx = vx / distance;
    const ny = vy / distance;
    return [
      px - nx * displacement * direction,
      py - ny * displacement * direction,
    ];
  });
}

export function bloatDab(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: RadialDabOptions,
): void {
  radialDab(pixels, width, height, opts, 1);
}

export function pinchDab(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: RadialDabOptions,
): void {
  radialDab(pixels, width, height, opts, -1);
}
