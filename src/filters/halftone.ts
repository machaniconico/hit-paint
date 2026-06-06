export interface HalftoneOptions {
  cellSize: number;
  angle?: number;
  grayscale?: boolean;
  mask?: Uint8ClampedArray | null;
}

type Mask = Uint8ClampedArray | null | undefined;

interface CellStats {
  count: number;
  r: number;
  g: number;
  b: number;
  luminance: number;
}

interface GridPoint {
  x: number;
  y: number;
}

function clamp255(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
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

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function toGridPoint(
  x: number,
  y: number,
  originX: number,
  originY: number,
  cos: number,
  sin: number,
): GridPoint {
  const dx = x + 0.5 - originX;
  const dy = y + 0.5 - originY;

  return {
    x: dx * cos + dy * sin + originX,
    y: -dx * sin + dy * cos + originY,
  };
}

function radiusForAverage(average: number, maxRadius: number): number {
  if (average <= 0) return maxRadius;
  if (average >= 255) return 0;
  return maxRadius * (1 - average / 255);
}

export function halftone(px: Uint8ClampedArray, w: number, h: number, opts: HalftoneOptions): void {
  if (w <= 0 || h <= 0 || px.length === 0) return;

  const cellSize = Math.floor(opts.cellSize);
  if (!Number.isFinite(opts.cellSize) || cellSize < 2) return;

  const pixelCount = Math.min(w * h, Math.floor(px.length / 4));
  if (pixelCount <= 0) return;

  const source = new Uint8ClampedArray(px);
  const angle = Number.isFinite(opts.angle) ? opts.angle ?? 0 : 0;
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const originX = w / 2;
  const originY = h / 2;
  const grayscale = opts.grayscale ?? true;
  const maxRadius = (cellSize * Math.SQRT2) / 2;
  const cells = new Map<string, CellStats>();

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const x = pixel % w;
    const y = Math.floor(pixel / w);
    const grid = toGridPoint(x, y, originX, originY, cos, sin);
    const cellX = Math.floor(grid.x / cellSize);
    const cellY = Math.floor(grid.y / cellSize);
    const key = cellKey(cellX, cellY);
    let stats = cells.get(key);

    if (!stats) {
      stats = { count: 0, r: 0, g: 0, b: 0, luminance: 0 };
      cells.set(key, stats);
    }

    const rgba = pixel * 4;
    const r = source[rgba];
    const g = source[rgba + 1];
    const b = source[rgba + 2];
    stats.count++;
    stats.r += r;
    stats.g += g;
    stats.b += b;
    stats.luminance += luminance(r, g, b);
  }

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel);
    if (coverage <= 0) continue;

    const x = pixel % w;
    const y = Math.floor(pixel / w);
    const grid = toGridPoint(x, y, originX, originY, cos, sin);
    const cellX = Math.floor(grid.x / cellSize);
    const cellY = Math.floor(grid.y / cellSize);
    const stats = cells.get(cellKey(cellX, cellY));
    if (!stats || stats.count <= 0) continue;

    const centerX = cellX * cellSize + cellSize / 2;
    const centerY = cellY * cellSize + cellSize / 2;
    const distance = Math.hypot(grid.x - centerX, grid.y - centerY);
    const rgba = pixel * 4;

    if (grayscale) {
      const average = stats.luminance / stats.count;
      const filtered = distance <= radiusForAverage(average, maxRadius) ? 0 : 255;
      px[rgba] = blendChannel(source[rgba], filtered, coverage);
      px[rgba + 1] = blendChannel(source[rgba + 1], filtered, coverage);
      px[rgba + 2] = blendChannel(source[rgba + 2], filtered, coverage);
      continue;
    }

    const red = distance <= radiusForAverage(stats.r / stats.count, maxRadius) ? 0 : 255;
    const green = distance <= radiusForAverage(stats.g / stats.count, maxRadius) ? 0 : 255;
    const blue = distance <= radiusForAverage(stats.b / stats.count, maxRadius) ? 0 : 255;

    px[rgba] = blendChannel(source[rgba], red, coverage);
    px[rgba + 1] = blendChannel(source[rgba + 1], green, coverage);
    px[rgba + 2] = blendChannel(source[rgba + 2], blue, coverage);
  }
}
