import type { VectorPath, PathPoint } from './path';

type Point = Pick<PathPoint, 'x' | 'y'>;

function clonePoint(point: PathPoint): PathPoint {
  return { ...point };
}

function distanceToSegmentSquared(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    const pointDx = point.x - start.x;
    const pointDy = point.y - start.y;
    return pointDx * pointDx + pointDy * pointDy;
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const nearestX = start.x + t * dx;
  const nearestY = start.y + t * dy;
  const pointDx = point.x - nearestX;
  const pointDy = point.y - nearestY;

  return pointDx * pointDx + pointDy * pointDy;
}

function simplifyRange(points: PathPoint[], first: number, last: number, keep: boolean[], toleranceSquared: number): void {
  let farthestIndex = -1;
  let farthestDistanceSquared = -1;

  for (let i = first + 1; i < last; i++) {
    const distanceSquared = distanceToSegmentSquared(points[i], points[first], points[last]);
    if (distanceSquared > farthestDistanceSquared) {
      farthestDistanceSquared = distanceSquared;
      farthestIndex = i;
    }
  }

  if (farthestIndex === -1 || farthestDistanceSquared <= toleranceSquared) return;

  keep[farthestIndex] = true;
  simplifyRange(points, first, farthestIndex, keep, toleranceSquared);
  simplifyRange(points, farthestIndex, last, keep, toleranceSquared);
}

export function simplifyPath(path: VectorPath, tolerance: number): VectorPath {
  if (path.points.length < 2 || tolerance <= 0) {
    return {
      closed: path.closed,
      points: path.points.map(clonePoint),
    };
  }

  const keep = path.points.map(() => false);
  keep[0] = true;
  keep[path.points.length - 1] = true;

  simplifyRange(path.points, 0, path.points.length - 1, keep, tolerance * tolerance);

  return {
    closed: path.closed,
    points: path.points.filter((_, i) => keep[i]).map(clonePoint),
  };
}

export function pathBounds(path: VectorPath): { x: number; y: number; width: number; height: number } {
  if (path.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function include(x: number, y: number): void {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  for (const point of path.points) {
    include(point.x, point.y);
    if (point.inX !== undefined && point.inY !== undefined) include(point.inX, point.inY);
    if (point.outX !== undefined && point.outY !== undefined) include(point.outX, point.outY);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function translatePath(path: VectorPath, dx: number, dy: number): VectorPath {
  return {
    closed: path.closed,
    points: path.points.map((point) => {
      const translated: PathPoint = {
        x: point.x + dx,
        y: point.y + dy,
      };

      if (point.outX !== undefined) translated.outX = point.outX + dx;
      if (point.outY !== undefined) translated.outY = point.outY + dy;
      if (point.inX !== undefined) translated.inX = point.inX + dx;
      if (point.inY !== undefined) translated.inY = point.inY + dy;

      return translated;
    }),
  };
}

export function scalePath(
  path: VectorPath,
  sx: number,
  sy: number,
  originX = 0,
  originY = 0,
): VectorPath {
  function scaleX(x: number): number {
    return originX + (x - originX) * sx;
  }

  function scaleY(y: number): number {
    return originY + (y - originY) * sy;
  }

  return {
    closed: path.closed,
    points: path.points.map((point) => {
      const scaled: PathPoint = {
        x: scaleX(point.x),
        y: scaleY(point.y),
      };

      if (point.outX !== undefined) scaled.outX = scaleX(point.outX);
      if (point.outY !== undefined) scaled.outY = scaleY(point.outY);
      if (point.inX !== undefined) scaled.inX = scaleX(point.inX);
      if (point.inY !== undefined) scaled.inY = scaleY(point.inY);

      return scaled;
    }),
  };
}
