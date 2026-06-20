import { describe, expect, it } from 'vitest';
import {
  strokeToOutline,
  type StrokeOutlineOptions,
} from '../src/vector/stroke-outline';

/** シューレース公式で多角形(閉リング)の符号付き面積を求め、絶対値を返す。 */
function polygonArea(ring: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 頂点集合として近似一致するか(順序非依存)。 */
function hasVertex(ring: { x: number; y: number }[], x: number, y: number, eps = 1e-6): boolean {
  return ring.some((p) => Math.abs(p.x - x) < eps && Math.abs(p.y - y) < eps);
}

describe('strokeToOutline — 水平線分 / cap=butt', () => {
  const opts: StrokeOutlineOptions = { width: 4, cap: 'butt', join: 'miter' };
  const ring = strokeToOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }], opts);

  it('矩形の4頂点を含む', () => {
    expect(hasVertex(ring, 0, -2)).toBe(true);
    expect(hasVertex(ring, 10, -2)).toBe(true);
    expect(hasVertex(ring, 10, 2)).toBe(true);
    expect(hasVertex(ring, 0, 2)).toBe(true);
  });

  it('頂点数は4(butt は端点を伸ばさない)', () => {
    expect(ring.length).toBe(4);
  });

  it('面積 = 幅10 × 太さ4 = 40', () => {
    expect(polygonArea(ring)).toBeCloseTo(40, 6);
  });
});

describe('strokeToOutline — cap=square', () => {
  const ring = strokeToOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
    width: 4,
    cap: 'square',
  });

  it('両端が width/2 ずつ伸びて面積 = (10+4)*4 = 56', () => {
    expect(polygonArea(ring)).toBeCloseTo(56, 6);
  });

  it('伸びた端の頂点 (-2,±2) と (12,±2) を含む', () => {
    expect(hasVertex(ring, -2, 2)).toBe(true);
    expect(hasVertex(ring, -2, -2)).toBe(true);
    expect(hasVertex(ring, 12, 2)).toBe(true);
    expect(hasVertex(ring, 12, -2)).toBe(true);
  });
});

describe('strokeToOutline — L字 2セグメント join=miter/bevel', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it('miter は単一の尖り、bevel は2点の切り落としで頂点数が異なる(miter < bevel)', () => {
    const miter = strokeToOutline(path, { width: 4, join: 'miter' });
    const bevel = strokeToOutline(path, { width: 4, join: 'bevel' });
    // miter の凸角は apex 1点、bevel は pPrev/pNext の2点 → 凸側で1点少ない。
    expect(miter.length).toBeLessThan(bevel.length);
    expect(miter.length).not.toBe(bevel.length);
  });

  it('miterLimit を厳しくすると bevel にフォールバックし bevel と同じ頂点数になる', () => {
    const beveled = strokeToOutline(path, { width: 4, join: 'miter', miterLimit: 1 });
    const bevel = strokeToOutline(path, { width: 4, join: 'bevel' });
    expect(beveled.length).toBe(bevel.length);
  });
});

describe('strokeToOutline — round cap/join は arcSteps に従う', () => {
  it('round cap の点数が arcSteps を増やすと増える', () => {
    const few = strokeToOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      width: 4,
      cap: 'round',
      arcSteps: 4,
    });
    const many = strokeToOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      width: 4,
      cap: 'round',
      arcSteps: 16,
    });
    expect(many.length).toBeGreaterThan(few.length);
  });

  it('round join の点数が arcSteps を増やすと増える', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const few = strokeToOutline(path, { width: 4, join: 'round', arcSteps: 2 });
    const many = strokeToOutline(path, { width: 4, join: 'round', arcSteps: 12 });
    expect(many.length).toBeGreaterThan(few.length);
  });
});

describe('strokeToOutline — 退化(点1個)でドット生成', () => {
  it('round なら円近似(arcSteps*2 頂点)', () => {
    const ring = strokeToOutline([{ x: 5, y: 5 }], {
      width: 4,
      cap: 'round',
      arcSteps: 8,
    });
    expect(ring.length).toBe(16);
    // 中心から半径 2 上にすべて乗る。
    for (const p of ring) {
      const r = Math.hypot(p.x - 5, p.y - 5);
      expect(r).toBeCloseTo(2, 6);
    }
  });

  it('round 以外は正方形(4頂点, 面積=width^2=16)', () => {
    const ring = strokeToOutline([{ x: 5, y: 5 }], { width: 4, cap: 'square' });
    expect(ring.length).toBe(4);
    expect(polygonArea(ring)).toBeCloseTo(16, 6);
  });
});

describe('strokeToOutline — 退化入力 / 重複点', () => {
  it('空入力は空配列', () => {
    expect(strokeToOutline([], { width: 4 })).toEqual([]);
  });

  it('width<=0 は空配列', () => {
    expect(strokeToOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { width: 0 })).toEqual([]);
  });

  it('重複点はスキップされ、実質1点ならドット扱い', () => {
    const ring = strokeToOutline(
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
      { width: 4, cap: 'square' },
    );
    expect(ring.length).toBe(4);
    expect(polygonArea(ring)).toBeCloseTo(16, 6);
  });

  it('重複を含む2点線分でも矩形面積が保たれる', () => {
    const ring = strokeToOutline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      { width: 4, cap: 'butt' },
    );
    expect(polygonArea(ring)).toBeCloseTo(40, 6);
  });
});

describe('strokeToOutline — リング向き規約(CW)', () => {
  it('水平線分 butt の符号付き面積が負(画面座標 y 下向きで CW)', () => {
    const ring = strokeToOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      width: 4,
      cap: 'butt',
    });
    let signed = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      signed += a.x * b.y - b.x * a.y;
    }
    expect(signed).toBeLessThan(0);
  });
});

describe('strokeToOutline — 決定論', () => {
  it('同一入力で同一出力(複数回呼び出し)', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const opts: StrokeOutlineOptions = { width: 6, cap: 'round', join: 'round', arcSteps: 5 };
    const a = strokeToOutline(path, opts);
    const b = strokeToOutline(path, opts);
    expect(a).toEqual(b);
  });
});
