/**
 * Wave41 / US-4301 — 3D LUT データモデル + トライリニア適用のテスト。
 *
 * jsdom では canvas API が使えないため、純粋配列ロジックとして検証する。
 */
import { describe, it, expect } from 'vitest';
import {
  identityLut,
  sampleLutTrilinear,
  applyLut,
  type Lut3D,
} from '../src/color/lut';

/** インデックス規約に従いノード offset を計算(テスト側の独立実装で規約を確認)。 */
function offset(size: number, ri: number, gi: number, bi: number): number {
  return ((bi * size + gi) * size + ri) * 3;
}

describe('identityLut', () => {
  it('data 長 = size^3*3 になる', () => {
    expect(identityLut(2).data.length).toBe(2 * 2 * 2 * 3);
    expect(identityLut(17).data.length).toBe(17 * 17 * 17 * 3);
  });

  it('size が 2 未満や非整数なら例外', () => {
    expect(() => identityLut(1)).toThrow();
    expect(() => identityLut(2.5)).toThrow();
  });

  it('ノード色が格子座標 (ri,gi,bi)/(size-1) と一致する', () => {
    const size = 5;
    const lut = identityLut(size);
    const denom = size - 1;
    for (const [ri, gi, bi] of [
      [0, 0, 0],
      [size - 1, size - 1, size - 1],
      [2, 1, 4],
      [4, 0, 2],
    ]) {
      const o = offset(size, ri, gi, bi);
      expect(lut.data[o]).toBeCloseTo(ri / denom, 6);
      expect(lut.data[o + 1]).toBeCloseTo(gi / denom, 6);
      expect(lut.data[o + 2]).toBeCloseTo(bi / denom, 6);
    }
  });
});

describe('sampleLutTrilinear (identity)', () => {
  it('任意 (r,g,b) が入力とほぼ一致 (±1e-6)', () => {
    const lut = identityLut(9);
    const samples: Array<[number, number, number]> = [
      [0.0, 0.0, 0.0],
      [1.0, 1.0, 1.0],
      [0.123, 0.456, 0.789],
      [0.5, 0.25, 0.875],
      [0.3333, 0.6666, 0.9999],
    ];
    for (const [r, g, b] of samples) {
      const out = sampleLutTrilinear(lut, r, g, b);
      expect(out.r).toBeCloseTo(r, 6);
      expect(out.g).toBeCloseTo(g, 6);
      expect(out.b).toBeCloseTo(b, 6);
    }
  });

  it('格子点上では該当ノード色に厳密一致(小数部 0)', () => {
    const size = 5;
    const lut = identityLut(size);
    const denom = size - 1;
    // ri=2,gi=4,bi=1 の格子点
    const r = 2 / denom;
    const g = 4 / denom;
    const b = 1 / denom;
    const out = sampleLutTrilinear(lut, r, g, b);
    expect(out.r).toBe(r);
    expect(out.g).toBe(g);
    expect(out.b).toBe(b);
  });

  it('範囲外入力はクランプされる', () => {
    const lut = identityLut(4);
    const lo = sampleLutTrilinear(lut, -1, -0.5, -10);
    expect(lo.r).toBeCloseTo(0, 6);
    expect(lo.g).toBeCloseTo(0, 6);
    expect(lo.b).toBeCloseTo(0, 6);
    const hi = sampleLutTrilinear(lut, 2, 1.5, 99);
    expect(hi.r).toBeCloseTo(1, 6);
    expect(hi.g).toBeCloseTo(1, 6);
    expect(hi.b).toBeCloseTo(1, 6);
  });
});

/** identity の R↔B をノード単位でスワップした非恒等 LUT。 */
function makeSwapRBLut(size: number): Lut3D {
  const id = identityLut(size);
  const data = new Float32Array(id.data.length);
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const o = offset(size, ri, gi, bi);
        // 出力 R<-元 B, B<-元 R
        data[o] = id.data[o + 2];
        data[o + 1] = id.data[o + 1];
        data[o + 2] = id.data[o];
      }
    }
  }
  return { size, data };
}

describe('sampleLutTrilinear (非恒等 swap R<->B)', () => {
  it('補間結果が手計算(R/B 入れ替え)と一致する', () => {
    const lut = makeSwapRBLut(9);
    const cases: Array<[number, number, number]> = [
      [0.2, 0.4, 0.8],
      [0.123, 0.456, 0.789],
      [1.0, 0.0, 0.5],
    ];
    for (const [r, g, b] of cases) {
      const out = sampleLutTrilinear(lut, r, g, b);
      expect(out.r).toBeCloseTo(b, 6);
      expect(out.g).toBeCloseTo(g, 6);
      expect(out.b).toBeCloseTo(r, 6);
    }
  });
});

describe('applyLut', () => {
  it('identity では画素がほぼ不変 (±1)、α は不変', () => {
    const px = new Uint8ClampedArray([
      10, 20, 30, 40,
      255, 0, 128, 200,
      77, 88, 99, 255,
    ]);
    const orig = Uint8ClampedArray.from(px);
    applyLut(px, 3, 1, identityLut(17));
    for (let i = 0; i < px.length; i++) {
      if (i % 4 === 3) {
        expect(px[i]).toBe(orig[i]); // α 厳密不変
      } else {
        expect(Math.abs(px[i] - orig[i])).toBeLessThanOrEqual(1);
      }
    }
  });

  it('swap LUT で R/B が入れ替わる、α 不変', () => {
    const px = new Uint8ClampedArray([200, 100, 50, 123]);
    applyLut(px, 1, 1, makeSwapRBLut(17));
    // 200/255 と 50/255 が入れ替わるので round 後ほぼ元の B/R
    expect(Math.abs(px[0] - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(px[1] - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(px[2] - 200)).toBeLessThanOrEqual(1);
    expect(px[3]).toBe(123);
  });

  it('size=2 の極小 LUT で線形補間が端点間ランプになる', () => {
    // size=2 identity: 各軸ノードは 0 と 1 のみ。中間入力は線形ランプ。
    const lut = identityLut(2);
    const mid = sampleLutTrilinear(lut, 0.5, 0.25, 0.75);
    expect(mid.r).toBeCloseTo(0.5, 6);
    expect(mid.g).toBeCloseTo(0.25, 6);
    expect(mid.b).toBeCloseTo(0.75, 6);

    // 画素でもランプ: グレー 128 -> ほぼ 128 を維持。
    const px = new Uint8ClampedArray([128, 64, 192, 255]);
    applyLut(px, 1, 1, lut);
    expect(Math.abs(px[0] - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(px[1] - 64)).toBeLessThanOrEqual(1);
    expect(Math.abs(px[2] - 192)).toBeLessThanOrEqual(1);
    expect(px[3]).toBe(255);
  });
});
