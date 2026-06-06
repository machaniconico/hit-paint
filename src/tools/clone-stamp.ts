export interface CloneStampOptions {
  srcX: number; srcY: number;   // 複製元中心
  dstX: number; dstY: number;   // 複製先中心
  radius: number;               // 円形ブラシ半径
  hardness?: number;            // 0..1 縁の柔らかさ(既定1=ハード)
  opacity?: number;             // 0..1(既定1)
  mask?: Uint8ClampedArray | null;
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

function rgbaIndex(x: number, y: number, width: number): number {
  return 4 * (y * width + x);
}

export function cloneStampDab(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: CloneStampOptions,
): void {
  const radius = opts.radius;
  const opacity = clamp01(opts.opacity ?? 1);

  if (
    radius <= 0 ||
    opacity <= 0 ||
    w <= 0 ||
    h <= 0 ||
    !Number.isFinite(radius) ||
    !Number.isFinite(opts.srcX) ||
    !Number.isFinite(opts.srcY) ||
    !Number.isFinite(opts.dstX) ||
    !Number.isFinite(opts.dstY)
  ) {
    return;
  }

  const source = new Uint8ClampedArray(px);
  const hardness = clamp01(opts.hardness ?? 1);
  const radiusSq = radius * radius;
  const minX = Math.max(0, Math.floor(opts.dstX - radius - 1));
  const maxX = Math.min(w - 1, Math.ceil(opts.dstX + radius + 1));
  const minY = Math.max(0, Math.floor(opts.dstY - radius - 1));
  const maxY = Math.min(h - 1, Math.ceil(opts.dstY + radius + 1));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - opts.dstX;
      const dy = y + 0.5 - opts.dstY;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) continue;

      const sx = Math.round(opts.srcX + (x - opts.dstX));
      const sy = Math.round(opts.srcY + (y - opts.dstY));
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;

      const dist = Math.sqrt(distSq);
      const falloff = hardness >= 1
        ? 1
        : clamp01(1 - (dist / radius - hardness) / (1 - hardness + 1e-9));
      const pixel = y * w + x;
      const maskCov = opts.mask ? opts.mask[pixel] / 255 : 1;
      const alpha = clamp01(falloff * opacity * clamp01(maskCov));
      if (alpha <= 0) continue;

      const si = rgbaIndex(sx, sy, w);
      const di = rgbaIndex(x, y, w);
      const invAlpha = 1 - alpha;

      px[di] = clamp255(source[si] * alpha + px[di] * invAlpha);
      px[di + 1] = clamp255(source[si + 1] * alpha + px[di + 1] * invAlpha);
      px[di + 2] = clamp255(source[si + 2] * alpha + px[di + 2] * invAlpha);
      px[di + 3] = clamp255(source[si + 3] * alpha + px[di + 3] * invAlpha);
    }
  }
}
