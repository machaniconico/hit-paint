// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { VectorPath } from '../src/vector/path';
import { pathBounds, scalePath, simplifyPath, translatePath } from '../src/vector/simplify';

describe('wave26 vector path simplification and transforms', () => {
  it('simplifyPath reduces nearly-collinear anchors to endpoints and preserves endpoint handles', () => {
    const path: VectorPath = {
      closed: false,
      points: [
        { x: 0, y: 0, outX: -1, outY: 0 },
        { x: 1, y: 0.03, inX: 0.5, inY: 2 },
        { x: 2, y: -0.02 },
        { x: 3, y: 0.04 },
        { x: 4, y: -0.01 },
        { x: 5, y: 0, inX: 6, inY: 0 },
      ],
    };

    const simplified = simplifyPath(path, 0.1);

    expect(simplified).toEqual<VectorPath>({
      closed: false,
      points: [
        { x: 0, y: 0, outX: -1, outY: 0 },
        { x: 5, y: 0, inX: 6, inY: 0 },
      ],
    });
  });

  it('simplifyPath keeps zigzag anchors when every deviation exceeds tolerance', () => {
    const path: VectorPath = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 3 },
        { x: 2, y: -3 },
        { x: 3, y: 3 },
        { x: 4, y: -3 },
        { x: 5, y: 0 },
      ],
    };

    expect(simplifyPath(path, 1)).toEqual(path);
  });

  it('simplifyPath returns two or fewer points as an equivalent new path', () => {
    const empty: VectorPath = { closed: false, points: [] };
    const onePoint: VectorPath = { closed: true, points: [{ x: 2, y: 3, outX: 4, outY: 5 }] };
    const twoPoints: VectorPath = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    };

    const emptyResult = simplifyPath(empty, 99);
    const onePointResult = simplifyPath(onePoint, 99);
    const twoPointResult = simplifyPath(twoPoints, 99);

    expect(emptyResult).toEqual(empty);
    expect(onePointResult).toEqual(onePoint);
    expect(twoPointResult).toEqual(twoPoints);
    expect(emptyResult).not.toBe(empty);
    expect(emptyResult.points).not.toBe(empty.points);
    expect(onePointResult.points[0]).not.toBe(onePoint.points[0]);
    expect(twoPointResult.points[0]).not.toBe(twoPoints.points[0]);
  });

  it('simplifyPath keeps all points when tolerance is zero or negative', () => {
    const path: VectorPath = {
      closed: true,
      points: [
        { x: 0, y: 0, outX: 1, outY: 0 },
        { x: 1, y: 2, inX: 0.5, inY: 1.5, outX: 1.5, outY: 2.5 },
        { x: 2, y: 0, inX: 1, inY: 0 },
      ],
    };

    const zeroTolerance = simplifyPath(path, 0);
    const negativeTolerance = simplifyPath(path, -1);

    expect(zeroTolerance).toEqual(path);
    expect(negativeTolerance).toEqual(path);
    expect(zeroTolerance).not.toBe(path);
    expect(zeroTolerance.points).not.toBe(path.points);
    expect(zeroTolerance.points[1]).not.toBe(path.points[1]);
  });

  it('pathBounds returns the AABB for anchors and control points', () => {
    const path: VectorPath = {
      closed: true,
      points: [
        { x: 2, y: 4, outX: -1, outY: 8 },
        { x: 6, y: -2, inX: 8, inY: -5 },
        { x: 3, y: 5, outX: 10, outY: 7 },
      ],
    };

    expect(pathBounds(path)).toEqual({ x: -1, y: -5, width: 11, height: 13 });
  });

  it('pathBounds returns a zero rectangle for an empty path', () => {
    expect(pathBounds({ closed: false, points: [] })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('translatePath shifts anchors and handles without mutating the source path', () => {
    const path: VectorPath = {
      closed: true,
      points: [
        { x: 1, y: 2, outX: 3, outY: 4 },
        { x: -2, y: 5, inX: -3, inY: 6 },
      ],
    };
    const original: VectorPath = JSON.parse(JSON.stringify(path));

    const translated = translatePath(path, 10, -3);

    expect(translated).toEqual<VectorPath>({
      closed: true,
      points: [
        { x: 11, y: -1, outX: 13, outY: 1 },
        { x: 8, y: 2, inX: 7, inY: 3 },
      ],
    });
    expect(path).toEqual(original);
    expect(translated).not.toBe(path);
    expect(translated.points[0]).not.toBe(path.points[0]);
  });

  it('scalePath scales anchors and handles around the default origin without mutating the source path', () => {
    const path: VectorPath = {
      closed: false,
      points: [
        { x: 1, y: 2, outX: 3, outY: 4 },
        { x: -2, y: 5, inX: -3, inY: 6 },
      ],
    };
    const original: VectorPath = JSON.parse(JSON.stringify(path));

    const scaled = scalePath(path, 2, -1);

    expect(scaled).toEqual<VectorPath>({
      closed: false,
      points: [
        { x: 2, y: -2, outX: 6, outY: -4 },
        { x: -4, y: -5, inX: -6, inY: -6 },
      ],
    });
    expect(path).toEqual(original);
    expect(scaled).not.toBe(path);
    expect(scaled.points[0]).not.toBe(path.points[0]);
  });

  it('scalePath scales anchors and handles around a provided origin', () => {
    const path: VectorPath = {
      closed: true,
      points: [
        { x: 2, y: 3, outX: 4, outY: 5 },
        { x: 0, y: 1, inX: -2, inY: -1 },
      ],
    };

    const scaled = scalePath(path, 3, 2, 1, 1);

    expect(scaled).toEqual<VectorPath>({
      closed: true,
      points: [
        { x: 4, y: 5, outX: 10, outY: 9 },
        { x: -2, y: 1, inX: -8, inY: -3 },
      ],
    });
    expect(path).toEqual<VectorPath>({
      closed: true,
      points: [
        { x: 2, y: 3, outX: 4, outY: 5 },
        { x: 0, y: 1, inX: -2, inY: -1 },
      ],
    });
  });
});
