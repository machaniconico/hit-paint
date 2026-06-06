import { describe, expect, it } from 'vitest';
import { mirrorPoints } from '../src/engine/symmetry';

function expectPointClose(
  point: { x: number; y: number },
  expected: { x: number; y: number },
) {
  expect(point.x).toBeCloseTo(expected.x);
  expect(point.y).toBeCloseTo(expected.y);
}

describe('symmetry mirrorPoints', () => {
  it('returns only the input point when mode is none', () => {
    expect(mirrorPoints(3, 4, { mode: 'none', centerX: 10, centerY: 20 })).toEqual([
      { x: 3, y: 4 },
    ]);
  });

  it('adds a centerX mirrored point for horizontal symmetry', () => {
    expect(mirrorPoints(7, 5, { mode: 'horizontal', centerX: 10, centerY: 0 })).toEqual([
      { x: 7, y: 5 },
      { x: 13, y: 5 },
    ]);
  });

  it('adds a centerY mirrored point for vertical symmetry', () => {
    expect(mirrorPoints(7, 5, { mode: 'vertical', centerX: 0, centerY: 10 })).toEqual([
      { x: 7, y: 5 },
      { x: 7, y: 15 },
    ]);
  });

  it('returns four axis-reflected points for both symmetry', () => {
    expect(mirrorPoints(7, 5, { mode: 'both', centerX: 10, centerY: 20 })).toEqual([
      { x: 7, y: 5 },
      { x: 13, y: 5 },
      { x: 7, y: 35 },
      { x: 13, y: 35 },
    ]);
  });

  it('rotates radial symmetry points by equal slice angles around the center', () => {
    const points = mirrorPoints(12, 20, {
      mode: 'radial',
      centerX: 10,
      centerY: 20,
      slices: 4,
    });

    expect(points).toHaveLength(4);
    expectPointClose(points[0], { x: 12, y: 20 });
    expectPointClose(points[1], { x: 10, y: 22 });
    expectPointClose(points[2], { x: 8, y: 20 });
    expectPointClose(points[3], { x: 10, y: 18 });
  });

  it('uses the default radial slice count when slices is omitted', () => {
    const points = mirrorPoints(11, 20, {
      mode: 'radial',
      centerX: 10,
      centerY: 20,
    });

    expect(points).toHaveLength(6);
    expectPointClose(points[0], { x: 11, y: 20 });
  });

  it('keeps duplicate center points safe for radial symmetry', () => {
    const points = mirrorPoints(10, 20, {
      mode: 'radial',
      centerX: 10,
      centerY: 20,
      slices: 4,
    });

    expect(points).toHaveLength(4);
    for (const point of points) {
      expectPointClose(point, { x: 10, y: 20 });
    }
  });
});
