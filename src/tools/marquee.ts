export type RectMaskBounds = {
  x: number;
  y: number;
  rw: number;
  rh: number;
};

export type EllipseMaskBounds = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};

export type Point = {
  x: number;
  y: number;
};

function makeMask(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function rectMask(width: number, height: number, bounds: RectMaskBounds): Uint8ClampedArray {
  const mask = makeMask(width, height);
  const { x, y, rw, rh } = bounds;
  if (rw <= 0 || rh <= 0) return mask;

  const left = clamp(Math.floor(x), 0, width);
  const top = clamp(Math.floor(y), 0, height);
  const right = clamp(Math.ceil(x + rw), 0, width);
  const bottom = clamp(Math.ceil(y + rh), 0, height);
  if (left >= right || top >= bottom) return mask;

  for (let py = top; py < bottom; py++) {
    const row = py * width;
    for (let px = left; px < right; px++) {
      mask[row + px] = 255;
    }
  }

  return mask;
}

export function ellipseMask(width: number, height: number, bounds: EllipseMaskBounds): Uint8ClampedArray {
  const mask = makeMask(width, height);
  const { cx, cy, rx, ry } = bounds;
  if (rx <= 0 || ry <= 0) return mask;

  const left = clamp(Math.ceil(cx - rx), 0, width);
  const top = clamp(Math.ceil(cy - ry), 0, height);
  const right = clamp(Math.floor(cx + rx) + 1, 0, width);
  const bottom = clamp(Math.floor(cy + ry) + 1, 0, height);
  if (left >= right || top >= bottom) return mask;

  const invRx = 1 / rx;
  const invRy = 1 / ry;

  for (let py = top; py < bottom; py++) {
    const dy = (py - cy) * invRy;
    const dy2 = dy * dy;
    const row = py * width;
    for (let px = left; px < right; px++) {
      const dx = (px - cx) * invRx;
      if (dx * dx + dy2 <= 1) {
        mask[row + px] = 255;
      }
    }
  }

  return mask;
}

function pointInPolygon(x: number, y: number, points: Point[]): boolean {
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (pointOnSegment(x, y, a, b)) return true;

    const crosses = (a.y > y) !== (b.y > y);
    if (!crosses) continue;

    const xAtY = ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (x < xAtY) inside = !inside;
  }

  return inside;
}

function pointOnSegment(x: number, y: number, a: Point, b: Point): boolean {
  const cross = (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > 1e-9) return false;

  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

export function polygonMask(width: number, height: number, points: Point[]): Uint8ClampedArray {
  const mask = makeMask(width, height);
  if (points.length < 3) return mask;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const left = clamp(Math.floor(minX), 0, width);
  const top = clamp(Math.floor(minY), 0, height);
  const right = clamp(Math.ceil(maxX), 0, width);
  const bottom = clamp(Math.ceil(maxY), 0, height);
  if (left >= right || top >= bottom) return mask;

  for (let py = top; py < bottom; py++) {
    const row = py * width;
    for (let px = left; px < right; px++) {
      if (pointInPolygon(px, py, points)) {
        mask[row + px] = 255;
      }
    }
  }

  return mask;
}
