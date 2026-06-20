import { describe, it, expect } from 'vitest';
import type { VectorPath } from '../src/vector/path';
import {
  measurePath,
  pathLength,
  pointAtLength,
  tangentAtLength,
  pointsAlong,
} from '../src/vector/path-measure';

// 直線パス(0,0)-(10,0)-(10,10):制御点なしの折れ線。総長 20。
const lShape: VectorPath = {
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  closed: false,
};

describe('measurePath / pathLength', () => {
  it('折れ線の累積弧長と総長を返す', () => {
    const m = measurePath(lShape);
    expect(m.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(m.cumulative).toEqual([0, 10, 20]);
    expect(m.total).toBe(20);
  });

  it('pathLength は総長 20', () => {
    expect(pathLength(lShape)).toBe(20);
  });
});

describe('pointAtLength', () => {
  it('第1辺の中点 len=5 → (5,0)', () => {
    expect(pointAtLength(lShape, 5)).toEqual({ x: 5, y: 0 });
  });

  it('第2辺 len=15 → (10,5)', () => {
    expect(pointAtLength(lShape, 15)).toEqual({ x: 10, y: 5 });
  });

  it('len<=0 は始点へクランプ', () => {
    expect(pointAtLength(lShape, -3)).toEqual({ x: 0, y: 0 });
    expect(pointAtLength(lShape, 0)).toEqual({ x: 0, y: 0 });
  });

  it('len>=total は終点へクランプ', () => {
    expect(pointAtLength(lShape, 20)).toEqual({ x: 10, y: 10 });
    expect(pointAtLength(lShape, 999)).toEqual({ x: 10, y: 10 });
  });
});

describe('tangentAtLength', () => {
  it('第1辺で進行方向は +x(angle=0)', () => {
    const t = tangentAtLength(lShape, 5);
    expect(t.x).toBeCloseTo(1, 10);
    expect(t.y).toBeCloseTo(0, 10);
    expect(t.angle).toBeCloseTo(0, 10);
  });

  it('第2辺で進行方向は +y(angle=π/2)', () => {
    const t = tangentAtLength(lShape, 15);
    expect(t.x).toBeCloseTo(0, 10);
    expect(t.y).toBeCloseTo(1, 10);
    expect(t.angle).toBeCloseTo(Math.PI / 2, 10);
  });

  it('単位ベクトルである', () => {
    const t = tangentAtLength(lShape, 15);
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(1, 10);
  });
});

describe('pointsAlong', () => {
  it('spacing=5 で等間隔点と angle を返す', () => {
    const pts = pointsAlong(lShape, 5);
    // 0,5,10,15,20 の 5 点
    expect(pts.length).toBe(5);
    expect(pts[0]).toMatchObject({ x: 0, y: 0 });
    expect(pts[1]).toMatchObject({ x: 5, y: 0 });
    expect(pts[2]).toMatchObject({ x: 10, y: 0 });
    expect(pts[3]).toMatchObject({ x: 10, y: 5 });
    expect(pts[4]).toMatchObject({ x: 10, y: 10 });
    // 第1辺の点は angle=0、第2辺の点は angle=π/2
    expect(pts[1].angle).toBeCloseTo(0, 10);
    expect(pts[3].angle).toBeCloseTo(Math.PI / 2, 10);
  });

  it('offset が開始弧長に反映される', () => {
    const pts = pointsAlong(lShape, 10, 5);
    // 5,15 の 2 点
    expect(pts.length).toBe(2);
    expect(pts[0]).toMatchObject({ x: 5, y: 0 });
    expect(pts[1]).toMatchObject({ x: 10, y: 5 });
  });

  it('spacing<=0 は空配列', () => {
    expect(pointsAlong(lShape, 0)).toEqual([]);
    expect(pointsAlong(lShape, -2)).toEqual([]);
  });
});

describe('退化ケース', () => {
  const onePoint: VectorPath = { points: [{ x: 3, y: 4 }], closed: false };
  const empty: VectorPath = { points: [], closed: false };

  it('点1個:総長0、始点に落ちる', () => {
    expect(pathLength(onePoint)).toBe(0);
    expect(pointAtLength(onePoint, 5)).toEqual({ x: 3, y: 4 });
    const t = tangentAtLength(onePoint, 0);
    expect(t).toEqual({ x: 0, y: 0, angle: 0 });
  });

  it('点1個:pointsAlong は offset<=0 で始点1点のみ', () => {
    const pts = pointsAlong(onePoint, 5);
    expect(pts.length).toBe(1);
    expect(pts[0]).toEqual({ x: 3, y: 4, angle: 0 });
  });

  it('点0個:空・安全値', () => {
    const m = measurePath(empty);
    expect(m.points).toEqual([]);
    expect(m.cumulative).toEqual([]);
    expect(m.total).toBe(0);
    expect(pointAtLength(empty, 5)).toEqual({ x: 0, y: 0 });
    expect(pointsAlong(empty, 5)).toEqual([]);
  });
});
