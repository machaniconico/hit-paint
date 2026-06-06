export type PixelBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CanvasSize = {
  w: number;
  h: number;
};

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function opaqueBounds(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: { threshold?: number } = {},
): PixelBounds | null {
  const threshold = opts.threshold ?? 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const alpha = px[(y * w + x) * 4 + 3];
      if (alpha <= threshold) continue;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0 || maxY < 0) return null;

  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

export function translatePixels(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  dx: number,
  dy: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length);
  const shiftX = Math.trunc(dx);
  const shiftY = Math.trunc(dy);

  for (let y = 0; y < h; y += 1) {
    const dstY = y + shiftY;
    if (dstY < 0 || dstY >= h) continue;

    for (let x = 0; x < w; x += 1) {
      const dstX = x + shiftX;
      if (dstX < 0 || dstX >= w) continue;

      const src = (y * w + x) * 4;
      const dst = (dstY * w + dstX) * 4;
      out[dst] = px[src];
      out[dst + 1] = px[src + 1];
      out[dst + 2] = px[src + 2];
      out[dst + 3] = px[src + 3];
    }
  }

  return out;
}

export function alignOffset(
  bounds: PixelBounds,
  canvas: CanvasSize,
  mode: AlignMode,
): { dx: number; dy: number } {
  switch (mode) {
    case 'left':
      return { dx: -bounds.x, dy: 0 };
    case 'hcenter':
      return { dx: Math.round((canvas.w - bounds.w) / 2 - bounds.x), dy: 0 };
    case 'right':
      return { dx: canvas.w - (bounds.x + bounds.w), dy: 0 };
    case 'top':
      return { dx: 0, dy: -bounds.y };
    case 'vcenter':
      return { dx: 0, dy: Math.round((canvas.h - bounds.h) / 2 - bounds.y) };
    case 'bottom':
      return { dx: 0, dy: canvas.h - (bounds.y + bounds.h) };
  }
}
