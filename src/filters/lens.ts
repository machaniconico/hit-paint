export interface LensDistortOptions {
  amount: number;
  cx?: number;
  cy?: number;
}

type Mask = Uint8ClampedArray | null | undefined;

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clamp(value: number, min: number, max: number): number {
  if (value <= min) return min;
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

function sampleBilinear(source: Uint8ClampedArray, width: number, height: number, x: number, y: number, channel: number): number {
  const sx = clamp(x, 0, width - 1);
  const sy = clamp(y, 0, height - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;

  const c00 = source[rgbaIndex(x0, y0, width) + channel];
  const c10 = source[rgbaIndex(x1, y0, width) + channel];
  const c01 = source[rgbaIndex(x0, y1, width) + channel];
  const c11 = source[rgbaIndex(x1, y1, width) + channel];
  const top = c00 + (c10 - c00) * tx;
  const bottom = c01 + (c11 - c01) * tx;
  return top + (bottom - top) * ty;
}

export function lensDistort(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: LensDistortOptions,
  mask?: Mask,
): void {
  const amount = clamp(opts.amount, -1, 1);
  if (w <= 0 || h <= 0 || amount === 0 || !Number.isFinite(amount)) return;

  const cx = opts.cx ?? (w - 1) / 2;
  const cy = opts.cy ?? (h - 1) / 2;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

  const radiusScale = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(w - 1 - cx, cy),
    Math.hypot(cx, h - 1 - cy),
    Math.hypot(w - 1 - cx, h - 1 - cy),
    1,
  );
  const source = new Uint8ClampedArray(px);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = y * w + x;
      const coverage = maskCoverage(mask, pixel);
      if (coverage <= 0) continue;

      const dx = x - cx;
      const dy = y - cy;
      const radius = Math.hypot(dx, dy) / radiusScale;
      // 宛先半径 r に対し source 係数 1 - amount*r^2 で直接サンプル(順写像 r*(1+amount*r^2) の一次逆近似)。
      // amount>0=樽型: factor<1 で中心寄りからサンプル→中心拡大。amount<0=糸巻き: factor>1 で外寄り。
      // 係数は amount∈[-1,1],r∈[0,1] で [0,2] に収まり単調・端クランプ安全(負方向の潰れなし)。
      const factor = 1 - amount * radius * radius;
      const sx = cx + dx * factor;
      const sy = cy + dy * factor;
      const dst = rgbaIndex(x, y, w);

      for (let channel = 0; channel < 4; channel++) {
        const sampled = sampleBilinear(source, w, h, sx, sy, channel);
        px[dst + channel] = blendChannel(source[dst + channel], sampled, coverage);
      }
    }
  }
}
