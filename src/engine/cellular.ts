export interface CellularOptions {
  width: number;
  height: number;
  cellSize: number;
  seed: number;
  metric?: 'euclidean' | 'manhattan';
}

const MAX_UNIT_VALUE = 1 - 1 / 0x1000000;

function normalizeSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return Math.floor(size);
}

function normalizeCellSize(cellSize: number): number {
  if (!Number.isFinite(cellSize) || cellSize <= 0) return 1;
  return cellSize;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return MAX_UNIT_VALUE;
  return value;
}

function clamp255(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.floor(value);
}

function hash2(seed: number, cx: number, cy: number): [number, number] {
  let h = (Math.imul(seed | 0, 1664525) + Math.imul(cx | 0, 1013904223) + Math.imul(cy | 0, 22695477)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  const fx = (h >>> 0) / 0x100000000;

  let h2 = (Math.imul(h, 1664525) + 1013904223) | 0;
  h2 ^= h2 >>> 16;
  h2 = Math.imul(h2, 0x45d9f3b);
  h2 ^= h2 >>> 16;
  const fy = (h2 >>> 0) / 0x100000000;

  return [fx, fy];
}

function featureDistance(dx: number, dy: number, metric: 'euclidean' | 'manhattan'): number {
  if (metric === 'manhattan') return Math.abs(dx) + Math.abs(dy);
  return Math.hypot(dx, dy);
}

export function worleyField(opts: CellularOptions): Float32Array {
  const width = normalizeSize(opts.width);
  const height = normalizeSize(opts.height);
  const field = new Float32Array(width * height);

  if (width <= 0 || height <= 0) return field;

  const cellSize = normalizeCellSize(opts.cellSize);
  const metric = opts.metric === 'manhattan' ? 'manhattan' : 'euclidean';

  for (let py = 0; py < height; py++) {
    const cellY = Math.floor(py / cellSize);

    for (let px = 0; px < width; px++) {
      const cellX = Math.floor(px / cellSize);
      let minDistance = Number.POSITIVE_INFINITY;

      for (let dy = -1; dy <= 1; dy++) {
        const neighborY = cellY + dy;

        for (let dx = -1; dx <= 1; dx++) {
          const neighborX = cellX + dx;
          const [fx, fy] = hash2(opts.seed, neighborX, neighborY);
          const featureX = (neighborX + fx) * cellSize;
          const featureY = (neighborY + fy) * cellSize;
          const distance = featureDistance(px - featureX, py - featureY, metric);

          if (distance < minDistance) minDistance = distance;
        }
      }

      field[py * width + px] = clampUnit(minDistance / cellSize);
    }
  }

  return field;
}

export function worleyToGrayscale(field: Float32Array, width: number, height: number): Uint8ClampedArray {
  const outputWidth = normalizeSize(width);
  const outputHeight = normalizeSize(height);
  const pixels = new Uint8ClampedArray(outputWidth * outputHeight * 4);

  for (let i = 0; i < outputWidth * outputHeight; i++) {
    const gray = clamp255(Math.floor((field[i] ?? 0) * 255));
    const offset = i * 4;
    pixels[offset] = gray;
    pixels[offset + 1] = gray;
    pixels[offset + 2] = gray;
    pixels[offset + 3] = 255;
  }

  return pixels;
}
