// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  rasterizeDashedStroke,
  rasterizeFill,
  rasterizeFillCompound,
  rasterizeStroke,
  type VectorPath,
} from '../src/vector/path';

function alphaAt(mask: Uint8ClampedArray, w: number, x: number, y: number): number {
  return mask[y * w + x];
}

function isEmptyMask(mask: Uint8ClampedArray): boolean {
  return mask.every((value) => value === 0);
}

describe('wave23 vector rasterization', () => {
  it('nonzero compound fill keeps a counter-wound donut hole empty', () => {
    const outer: VectorPath = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 35, y: 0 },
        { x: 35, y: 35 },
        { x: 0, y: 35 },
      ],
    };
    const inner: VectorPath = {
      closed: true,
      points: [
        { x: 10, y: 10 },
        { x: 10, y: 30 },
        { x: 30, y: 30 },
        { x: 30, y: 10 },
      ],
    };

    const mask = rasterizeFillCompound([outer, inner], 40, 40, { rule: 'nonzero' });

    expect(alphaAt(mask, 40, 20, 20)).toBe(0);
    expect(alphaAt(mask, 40, 5, 15)).toBe(255);
  });

  it('evenodd compound fill matches rasterizeFill for a single triangle', () => {
    const tri: VectorPath = {
      closed: true,
      points: [
        { x: 4, y: 4 },
        { x: 28, y: 8 },
        { x: 12, y: 30 },
      ],
    };

    const compound = rasterizeFillCompound([tri], 32, 32);
    const single = rasterizeFill(tri, 32, 32);

    expect(compound).toEqual(single);
  });

  it('dashed stroke paints a periodic subset of a horizontal line', () => {
    const line: VectorPath = {
      closed: false,
      points: [
        { x: 2, y: 20 },
        { x: 38, y: 20 },
      ],
    };

    const mask = rasterizeDashedStroke(line, 40, 40, 2, [2, 2]);
    const row = Array.from({ length: 40 }, (_, x) => alphaAt(mask, 40, x, 20));

    expect(row.some((value) => value === 255)).toBe(true);
    expect(row.some((value) => value === 0)).toBe(true);
  });

  it('empty dash array falls back to a solid stroke', () => {
    const line: VectorPath = {
      closed: false,
      points: [
        { x: 2, y: 20 },
        { x: 38, y: 20 },
      ],
    };

    const dashed = rasterizeDashedStroke(line, 40, 40, 2, []);
    const solid = rasterizeStroke(line, 40, 40, 2);

    expect(dashed).toEqual(solid);
  });

  it('dashed stroke returns an empty mask for degenerate inputs', () => {
    const line: VectorPath = {
      closed: false,
      points: [
        { x: 2, y: 20 },
        { x: 38, y: 20 },
      ],
    };

    expect(isEmptyMask(rasterizeDashedStroke(line, 40, 40, 0, [2, 2]))).toBe(true);
    expect(isEmptyMask(rasterizeDashedStroke({ closed: false, points: [] }, 40, 40, 2, [2, 2]))).toBe(true);
    expect(rasterizeDashedStroke(line, 0, 40, 2, [2, 2])).toHaveLength(0);
  });
});
