import { describe, expect, it } from 'vitest';
import { flattenPath, rasterizeFill, rasterizeStroke, type VectorPath } from '../src/vector/path';

describe('vector path rasterization', () => {
  it('直線 2 点の flatten は 2 点を返す', () => {
    const path: VectorPath = {
      closed: false,
      points: [
        { x: 1, y: 2 },
        { x: 5, y: 6 },
      ],
    };

    expect(flattenPath(path)).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 6 },
    ]);
  });

  it('ベジェ制御点ありの flatten は中間点が直線から外れる', () => {
    const path: VectorPath = {
      closed: false,
      points: [
        { x: 0, y: 0, outX: 0, outY: 10 },
        { x: 10, y: 0, inX: 10, inY: 10 },
      ],
    };

    const flattened = flattenPath(path, 4);

    expect(flattened).toHaveLength(5);
    expect(flattened[1].y).toBeGreaterThan(0);
    expect(flattened[2].y).toBeGreaterThan(0);
    expect(flattened[2].y).not.toBe(0);
    expect(flattened[4]).toEqual({ x: 10, y: 0 });
  });

  it('rasterizeFill は三角形の内部を 255、外部を 0 にする', () => {
    const path: VectorPath = {
      closed: true,
      points: [
        { x: 2, y: 2 },
        { x: 8, y: 2 },
        { x: 5, y: 8 },
      ],
    };

    const mask = rasterizeFill(path, 10, 10);

    expect(mask[4 * 10 + 5]).toBe(255);
    expect(mask[0]).toBe(0);
    expect(mask[9 * 10 + 9]).toBe(0);
  });

  it('closed path の flatten は末尾から先頭へ繋がる', () => {
    const path: VectorPath = {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: 4 },
      ],
    };

    const flattened = flattenPath(path);

    expect(flattened).toEqual([
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 4 },
      { x: 1, y: 1 },
    ]);
  });

  it('rasterizeStroke は線上を塗る', () => {
    const path: VectorPath = {
      closed: false,
      points: [
        { x: 1, y: 2 },
        { x: 8, y: 2 },
      ],
    };

    const mask = rasterizeStroke(path, 10, 6, 2);

    expect(mask[2 * 10 + 4]).toBe(255);
    expect(mask[5 * 10 + 4]).toBe(0);
  });

  it('退化入力は空マスクを返す', () => {
    expect(rasterizeFill({ closed: true, points: [] }, 10, 10).every((v) => v === 0)).toBe(true);
    expect(rasterizeFill({ closed: true, points: [{ x: 1, y: 1 }] }, 10, 10).every((v) => v === 0)).toBe(true);
    expect(rasterizeStroke({ closed: false, points: [{ x: 1, y: 1 }] }, 10, 10, 2).every((v) => v === 0)).toBe(true);
    expect(rasterizeFill({ closed: true, points: [] }, 0, 10)).toHaveLength(0);
  });

  it('範囲外の図形もキャンバス範囲にクランプして塗る', () => {
    const path: VectorPath = {
      closed: true,
      points: [
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ],
    };

    const mask = rasterizeFill(path, 4, 4);

    expect(mask[0]).toBe(255);
    expect(mask[3 * 4 + 3]).toBe(255);
  });
});
