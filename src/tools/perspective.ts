export interface Quad {
  x0: number; y0: number;
  x1: number; y1: number;
  x2: number; y2: number;
  x3: number; y3: number;
}

const EPSILON = 1e-10;

function rgbaIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function quadArea(q: Quad): number {
  return 0.5 * (
    q.x0 * q.y1 - q.y0 * q.x1
    + q.x1 * q.y2 - q.y1 * q.x2
    + q.x2 * q.y3 - q.y2 * q.x3
    + q.x3 * q.y0 - q.y3 * q.x0
  );
}

function finiteQuad(q: Quad): boolean {
  return Number.isFinite(q.x0) && Number.isFinite(q.y0)
    && Number.isFinite(q.x1) && Number.isFinite(q.y1)
    && Number.isFinite(q.x2) && Number.isFinite(q.y2)
    && Number.isFinite(q.x3) && Number.isFinite(q.y3);
}

function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const augmented = matrix.map((row, i) => [...row, rhs[i]]);

  for (let column = 0; column < size; column++) {
    let pivotRow = column;
    let pivotSize = Math.abs(augmented[column][column]);

    for (let row = column + 1; row < size; row++) {
      const candidate = Math.abs(augmented[row][column]);
      if (candidate > pivotSize) {
        pivotSize = candidate;
        pivotRow = row;
      }
    }

    if (pivotSize < EPSILON) return null;

    if (pivotRow !== column) {
      const tmp = augmented[column];
      augmented[column] = augmented[pivotRow];
      augmented[pivotRow] = tmp;
    }

    const pivot = augmented[column][column];
    for (let col = column; col <= size; col++) {
      augmented[column][col] /= pivot;
    }

    for (let row = 0; row < size; row++) {
      if (row === column) continue;

      const factor = augmented[row][column];
      if (factor === 0) continue;

      for (let col = column; col <= size; col++) {
        augmented[row][col] -= factor * augmented[column][col];
      }
    }
  }

  const out = augmented.map((row) => row[size]);
  return out.every(Number.isFinite) ? out : null;
}

function homographyFromUnitSquare(dst: Quad): number[] | null {
  const src = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const target = [
    [dst.x0, dst.y0],
    [dst.x1, dst.y1],
    [dst.x2, dst.y2],
    [dst.x3, dst.y3],
  ];
  const matrix: number[][] = [];
  const rhs: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const [x, y] = target[i];

    matrix.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    rhs.push(x);
    matrix.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    rhs.push(y);
  }

  const h = solveLinear(matrix, rhs);
  return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
}

function invertHomography(m: number[]): number[] | null {
  const a = m[0];
  const b = m[1];
  const c = m[2];
  const d = m[3];
  const e = m[4];
  const f = m[5];
  const g = m[6];
  const h = m[7];
  const i = m[8];

  const det = a * (e * i - f * h)
    - b * (d * i - f * g)
    + c * (d * h - e * g);

  if (!Number.isFinite(det) || Math.abs(det) < EPSILON) return null;

  const inv = [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];

  return inv.every(Number.isFinite) ? inv : null;
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
  if (x < 0 || x > width - 1 || y < 0 || y > height - 1) return;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;

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

export function perspectiveWarp(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  dst: Quad,
): Uint8ClampedArray {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return new Uint8ClampedArray(0);

  const width = Math.floor(w);
  const height = Math.floor(h);

  if (width <= 0 || height <= 0) return new Uint8ClampedArray(0);

  const out = new Uint8ClampedArray(width * height * 4);
  if (px.length < out.length || !finiteQuad(dst) || Math.abs(quadArea(dst)) < EPSILON) {
    return out;
  }

  const homography = homographyFromUnitSquare(dst);
  if (!homography) return out;

  const inverse = invertHomography(homography);
  if (!inverse) return out;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const denominator = inverse[6] * x + inverse[7] * y + inverse[8];
      if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) continue;

      const u = (inverse[0] * x + inverse[1] * y + inverse[2]) / denominator;
      const v = (inverse[3] * x + inverse[4] * y + inverse[5]) / denominator;
      if (!Number.isFinite(u) || !Number.isFinite(v)) continue;

      sampleBilinear(px, width, height, u * width, v * height, out, rgbaIndex(x, y, width));
    }
  }

  return out;
}
