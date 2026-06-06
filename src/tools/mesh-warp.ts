export interface MeshGrid {
  cols: number;
  rows: number;
  points: { x: number; y: number }[];
}

type Point = { x: number; y: number };

const EPSILON = 1e-7;

function rgbaIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function finitePoint(point: Point | undefined): point is Point {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
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
  if (x < -EPSILON || x > width - 1 + EPSILON || y < -EPSILON || y > height - 1 + EPSILON) {
    return;
  }

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

function inverseBilinear(
  x: number,
  y: number,
  p00: Point,
  p10: Point,
  p01: Point,
  p11: Point,
): { u: number; v: number } | null {
  const ax = p10.x - p00.x;
  const ay = p10.y - p00.y;
  const bx = p01.x - p00.x;
  const by = p01.y - p00.y;
  const cx = p11.x - p10.x - p01.x + p00.x;
  const cy = p11.y - p10.y - p01.y + p00.y;

  const affineDet = ax * by - ay * bx;
  let u = 0.5;
  let v = 0.5;

  if (Math.abs(affineDet) > EPSILON) {
    const dx = x - p00.x;
    const dy = y - p00.y;
    u = (dx * by - dy * bx) / affineDet;
    v = (ax * dy - ay * dx) / affineDet;
  }

  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    u = 0.5;
    v = 0.5;
  }

  for (let i = 0; i < 12; i++) {
    const qx = p00.x + ax * u + bx * v + cx * u * v;
    const qy = p00.y + ay * u + by * v + cy * u * v;
    const errX = qx - x;
    const errY = qy - y;

    if (errX * errX + errY * errY < EPSILON * EPSILON) {
      break;
    }

    const j00 = ax + cx * v;
    const j01 = bx + cx * u;
    const j10 = ay + cy * v;
    const j11 = by + cy * u;
    const det = j00 * j11 - j01 * j10;

    if (Math.abs(det) < EPSILON) {
      return null;
    }

    const du = (errX * j11 - j01 * errY) / det;
    const dv = (j00 * errY - errX * j10) / det;
    u -= du;
    v -= dv;

    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      return null;
    }
  }

  const qx = p00.x + ax * u + bx * v + cx * u * v;
  const qy = p00.y + ay * u + by * v + cy * u * v;
  const errX = qx - x;
  const errY = qy - y;
  if (errX * errX + errY * errY > 1e-6) {
    return null;
  }

  return { u, v };
}

export function createMeshGrid(w: number, h: number, cols: number, rows: number): MeshGrid {
  const width = Math.floor(w);
  const height = Math.floor(h);
  const columnCount = Math.floor(cols);
  const rowCount = Math.floor(rows);

  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || !Number.isFinite(columnCount)
    || !Number.isFinite(rowCount)
    || width <= 0
    || height <= 0
    || columnCount < 1
    || rowCount < 1
  ) {
    return { cols: 0, rows: 0, points: [] };
  }

  const points: Point[] = [];
  for (let row = 0; row <= rowCount; row++) {
    for (let col = 0; col <= columnCount; col++) {
      points.push({
        x: (col * width) / columnCount,
        y: (row * height) / rowCount,
      });
    }
  }

  return { cols: columnCount, rows: rowCount, points };
}

export function meshWarp(px: Uint8ClampedArray, w: number, h: number, grid: MeshGrid): Uint8ClampedArray {
  const width = Math.floor(w);
  const height = Math.floor(h);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return new Uint8ClampedArray(0);
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const cols = Math.floor(grid.cols);
  const rows = Math.floor(grid.rows);
  const stride = cols + 1;

  if (
    !Number.isFinite(cols)
    || !Number.isFinite(rows)
    || cols < 1
    || rows < 1
    || grid.points.length < (cols + 1) * (rows + 1)
    || px.length < out.length
  ) {
    return out;
  }

  for (let cellY = 0; cellY < rows; cellY++) {
    for (let cellX = 0; cellX < cols; cellX++) {
      const pointIndex = cellY * stride + cellX;
      const p00 = grid.points[pointIndex];
      const p10 = grid.points[pointIndex + 1];
      const p01 = grid.points[pointIndex + stride];
      const p11 = grid.points[pointIndex + stride + 1];

      if (!finitePoint(p00) || !finitePoint(p10) || !finitePoint(p01) || !finitePoint(p11)) {
        continue;
      }

      const minX = Math.min(p00.x, p10.x, p01.x, p11.x);
      const maxX = Math.max(p00.x, p10.x, p01.x, p11.x);
      const minY = Math.min(p00.y, p10.y, p01.y, p11.y);
      const maxY = Math.max(p00.y, p10.y, p01.y, p11.y);
      const left = Math.max(0, Math.floor(minX - EPSILON));
      const right = Math.min(width - 1, Math.ceil(maxX + EPSILON));
      const top = Math.max(0, Math.floor(minY - EPSILON));
      const bottom = Math.min(height - 1, Math.ceil(maxY + EPSILON));

      if (left > right || top > bottom) {
        continue;
      }

      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const uv = inverseBilinear(x, y, p00, p10, p01, p11);
          if (!uv || uv.u < -EPSILON || uv.u > 1 + EPSILON || uv.v < -EPSILON || uv.v > 1 + EPSILON) {
            continue;
          }

          const u = clamp(uv.u, 0, 1);
          const v = clamp(uv.v, 0, 1);
          const sourceX = ((cellX + u) * width) / cols;
          const sourceY = ((cellY + v) * height) / rows;

          sampleBilinear(px, width, height, sourceX, sourceY, out, rgbaIndex(x, y, width));
        }
      }
    }
  }

  return out;
}
