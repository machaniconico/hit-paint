export interface PathPoint {
  x: number;
  y: number;
  outX?: number;
  outY?: number;
  inX?: number;
  inY?: number;
}

export interface VectorPath {
  points: PathPoint[];
  closed: boolean;
}

interface Point {
  x: number;
  y: number;
}

function emptyMask(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(Math.max(0, Math.floor(w)) * Math.max(0, Math.floor(h)));
}

function hasOutControl(point: PathPoint): boolean {
  return point.outX !== undefined && point.outY !== undefined;
}

function hasInControl(point: PathPoint): boolean {
  return point.inX !== undefined && point.inY !== undefined;
}

function cubicPoint(a: PathPoint, b: PathPoint, t: number): Point {
  const c1x = hasOutControl(a) ? a.outX as number : a.x;
  const c1y = hasOutControl(a) ? a.outY as number : a.y;
  const c2x = hasInControl(b) ? b.inX as number : b.x;
  const c2y = hasInControl(b) ? b.inY as number : b.y;
  const mt = 1 - t;

  return {
    x: mt * mt * mt * a.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * b.x,
    y: mt * mt * mt * a.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * b.y,
  };
}

function appendSegment(points: Point[], a: PathPoint, b: PathPoint, steps: number): void {
  if (hasOutControl(a) && hasInControl(b)) {
    for (let step = 1; step <= steps; step++) {
      points.push(cubicPoint(a, b, step / steps));
    }
    return;
  }

  points.push({ x: b.x, y: b.y });
}

export function flattenPath(path: VectorPath, steps = 16): Point[] {
  const anchors = path.points;
  if (anchors.length === 0) return [];

  const safeSteps = Math.max(1, Math.floor(steps));
  const flattened: Point[] = [{ x: anchors[0].x, y: anchors[0].y }];

  for (let i = 0; i < anchors.length - 1; i++) {
    appendSegment(flattened, anchors[i], anchors[i + 1], safeSteps);
  }

  if (path.closed && anchors.length > 1) {
    appendSegment(flattened, anchors[anchors.length - 1], anchors[0], safeSteps);
  }

  return flattened;
}

export function rasterizeFill(path: VectorPath, w: number, h: number): Uint8ClampedArray {
  const width = Math.floor(w);
  const height = Math.floor(h);
  const mask = emptyMask(width, height);
  if (width <= 0 || height <= 0 || !path.closed || path.points.length < 3) return mask;

  const polygon = flattenPath(path);
  if (polygon.length < 3) return mask;

  for (let y = 0; y < height; y++) {
    const scanY = y + 0.5;
    const intersections: number[] = [];

    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if (a.y === b.y) continue;

      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      if (scanY < minY || scanY >= maxY) continue;

      const t = (scanY - a.y) / (b.y - a.y);
      intersections.push(a.x + t * (b.x - a.x));
    }

    intersections.sort((a, b) => a - b);

    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const startX = Math.max(0, Math.ceil(intersections[i] - 0.5));
      const endX = Math.min(width - 1, Math.floor(intersections[i + 1] - 0.5));

      for (let x = startX; x <= endX; x++) {
        mask[y * width + x] = 255;
      }
    }
  }

  return mask;
}

export function rasterizeFillCompound(
  paths: VectorPath[],
  w: number,
  h: number,
  opts: { rule?: 'evenodd' | 'nonzero' } = {},
): Uint8ClampedArray {
  const width = Math.floor(w);
  const height = Math.floor(h);
  const mask = emptyMask(width, height);
  if (width <= 0 || height <= 0 || paths.length === 0) return mask;

  const polygons = paths
    .filter((path) => path.closed && path.points.length >= 3)
    .map((path) => flattenPath(path))
    .filter((polygon) => polygon.length >= 3);
  if (polygons.length === 0) return mask;

  const rule = opts.rule ?? 'evenodd';

  for (let y = 0; y < height; y++) {
    const scanY = y + 0.5;

    if (rule === 'nonzero') {
      const crossings: { x: number; winding: number }[] = [];

      for (const polygon of polygons) {
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i];
          const b = polygon[(i + 1) % polygon.length];
          if (a.y === b.y) continue;

          const minY = Math.min(a.y, b.y);
          const maxY = Math.max(a.y, b.y);
          if (scanY < minY || scanY >= maxY) continue;

          const t = (scanY - a.y) / (b.y - a.y);
          crossings.push({
            x: a.x + t * (b.x - a.x),
            winding: b.y < a.y ? 1 : -1,
          });
        }
      }

      crossings.sort((a, b) => a.x - b.x);

      let winding = 0;
      for (let i = 0; i + 1 < crossings.length; i++) {
        winding += crossings[i].winding;
        if (winding === 0) continue;

        const startX = Math.max(0, Math.ceil(crossings[i].x - 0.5));
        const endX = Math.min(width - 1, Math.floor(crossings[i + 1].x - 0.5));

        for (let x = startX; x <= endX; x++) {
          mask[y * width + x] = 255;
        }
      }

      continue;
    }

    const intersections: number[] = [];

    for (const polygon of polygons) {
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        if (a.y === b.y) continue;

        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        if (scanY < minY || scanY >= maxY) continue;

        const t = (scanY - a.y) / (b.y - a.y);
        intersections.push(a.x + t * (b.x - a.x));
      }
    }

    intersections.sort((a, b) => a - b);

    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const startX = Math.max(0, Math.ceil(intersections[i] - 0.5));
      const endX = Math.min(width - 1, Math.floor(intersections[i + 1] - 0.5));

      for (let x = startX; x <= endX; x++) {
        mask[y * width + x] = 255;
      }
    }
  }

  return mask;
}

function distanceToSegmentSquared(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    const pointDx = px - a.x;
    const pointDy = py - a.y;
    return pointDx * pointDx + pointDy * pointDy;
  }

  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lengthSquared));
  const nearestX = a.x + t * dx;
  const nearestY = a.y + t * dy;
  const pointDx = px - nearestX;
  const pointDy = py - nearestY;
  return pointDx * pointDx + pointDy * pointDy;
}

export function rasterizeStroke(path: VectorPath, w: number, h: number, width: number): Uint8ClampedArray {
  const canvasWidth = Math.floor(w);
  const canvasHeight = Math.floor(h);
  const mask = emptyMask(canvasWidth, canvasHeight);
  if (canvasWidth <= 0 || canvasHeight <= 0 || width <= 0 || path.points.length < 2) return mask;

  const polyline = flattenPath(path);
  if (polyline.length < 2) return mask;

  const radius = width / 2;
  const radiusSquared = radius * radius;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius));
    const maxX = Math.min(canvasWidth - 1, Math.ceil(Math.max(a.x, b.x) + radius));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius));
    const maxY = Math.min(canvasHeight - 1, Math.ceil(Math.max(a.y, b.y) + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (distanceToSegmentSquared(x + 0.5, y + 0.5, a, b) <= radiusSquared) {
          mask[y * canvasWidth + x] = 255;
        }
      }
    }
  }

  return mask;
}

function paintStrokeSegment(
  mask: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  radius: number,
  a: Point,
  b: Point,
): void {
  const radiusSquared = radius * radius;
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius));
  const maxX = Math.min(canvasWidth - 1, Math.ceil(Math.max(a.x, b.x) + radius));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius));
  const maxY = Math.min(canvasHeight - 1, Math.ceil(Math.max(a.y, b.y) + radius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (distanceToSegmentSquared(x + 0.5, y + 0.5, a, b) <= radiusSquared) {
        mask[y * canvasWidth + x] = 255;
      }
    }
  }
}

function pointOnSegment(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function rasterizeDashedStroke(
  path: VectorPath,
  w: number,
  h: number,
  width: number,
  dash: number[],
  offset = 0,
): Uint8ClampedArray {
  const canvasWidth = Math.floor(w);
  const canvasHeight = Math.floor(h);
  const mask = emptyMask(canvasWidth, canvasHeight);
  if (canvasWidth <= 0 || canvasHeight <= 0 || width <= 0 || path.points.length < 2) return mask;
  if (dash.length === 0) return rasterizeStroke(path, canvasWidth, canvasHeight, width);

  const pattern = dash.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const patternLength = pattern.reduce((sum, value) => sum + value, 0);
  if (patternLength <= 0) return rasterizeStroke(path, canvasWidth, canvasHeight, width);

  const polyline = flattenPath(path);
  if (polyline.length < 2) return mask;

  const radius = width / 2;
  let phase = offset % patternLength;
  if (phase < 0) phase += patternLength;

  let dashIndex = 0;
  while (phase >= pattern[dashIndex]) {
    phase -= pattern[dashIndex];
    dashIndex = (dashIndex + 1) % pattern.length;
  }
  let dashRemaining = pattern[dashIndex] - phase;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);
    if (segmentLength === 0) continue;

    let walked = 0;
    while (walked < segmentLength) {
      while (dashRemaining <= 0) {
        dashIndex = (dashIndex + 1) % pattern.length;
        dashRemaining = pattern[dashIndex];
      }

      const step = Math.min(dashRemaining, segmentLength - walked);
      if (dashIndex % 2 === 0 && step > 0) {
        const from = pointOnSegment(a, b, walked / segmentLength);
        const to = pointOnSegment(a, b, (walked + step) / segmentLength);
        paintStrokeSegment(mask, canvasWidth, canvasHeight, radius, from, to);
      }

      walked += step;
      dashRemaining -= step;
    }
  }

  return mask;
}
