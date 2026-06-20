/**
 * Wave41 / US-4303 — 組み込み LUT プリセットの手続き生成テスト。
 *
 * jsdom では canvas API が使えないため、LUT の data 配列を直接検証する純粋ロジックテスト。
 * generateLut の index 規約が lut.ts(identityLut)と一致すること、各プリセットが正しい
 * 長さ・値域の Lut3D を返すこと、各変換の色特性(暖色/寒色/S字/モノクロ)を検証する。
 */

import { describe, it, expect } from 'vitest';
import { identityLut, type Lut3D } from '../src/color/lut';
import {
  generateLut,
  LUT_PRESETS,
  LUT_PRESET_NAMES,
  DEFAULT_LUT_SIZE,
  sepiaTransform,
  type LutPresetName,
} from '../src/color/lut-presets';

/** ノード (ri,gi,bi) の data オフセット(lut.ts と同一規約)。 */
function nodeOffset(size: number, ri: number, gi: number, bi: number): number {
  return ((bi * size + gi) * size + ri) * 3;
}

/** ノード (ri,gi,bi) の色を取り出す。 */
function nodeColor(
  lut: Lut3D,
  ri: number,
  gi: number,
  bi: number,
): { r: number; g: number; b: number } {
  const o = nodeOffset(lut.size, ri, gi, bi);
  return { r: lut.data[o], g: lut.data[o + 1], b: lut.data[o + 2] };
}

describe('generateLut の基本契約', () => {
  it('恒等変換が identityLut と data 一致する (size=2)', () => {
    const id = identityLut(2);
    const gen = generateLut(2, (rgb) => rgb);
    expect(gen.size).toBe(id.size);
    expect(gen.data.length).toBe(id.data.length);
    for (let i = 0; i < id.data.length; i++) {
      expect(gen.data[i]).toBeCloseTo(id.data[i], 10);
    }
  });

  it('恒等変換が identityLut と data 一致する (size=5)', () => {
    const id = identityLut(5);
    const gen = generateLut(5, (rgb) => rgb);
    for (let i = 0; i < id.data.length; i++) {
      expect(gen.data[i]).toBeCloseTo(id.data[i], 10);
    }
  });

  it('出力を 0..1 にクランプする(範囲外を返す変換でも data は 0..1)', () => {
    const lut = generateLut(3, () => ({ r: 5, g: -5, b: 0.5 }));
    for (let i = 0; i < lut.data.length; i += 3) {
      expect(lut.data[i]).toBe(1); // 5 → 1
      expect(lut.data[i + 1]).toBe(0); // -5 → 0
      expect(lut.data[i + 2]).toBeCloseTo(0.5, 10);
    }
  });

  it('size<2 や非整数を拒否する', () => {
    expect(() => generateLut(1, (rgb) => rgb)).toThrow();
    expect(() => generateLut(2.5, (rgb) => rgb)).toThrow();
  });
});

describe('プリセットレジストリ', () => {
  it('最低 4 種のプリセットが登録されている', () => {
    expect(LUT_PRESET_NAMES.length).toBeGreaterThanOrEqual(4);
    for (const name of ['warm', 'cool', 'sepia', 'contrastS', 'monochrome']) {
      expect(LUT_PRESETS[name]).toBeTypeOf('function');
    }
  });

  it('全プリセットが正しい data 長 (size^3*3) と 0..1 の値を返す', () => {
    const sizes = [DEFAULT_LUT_SIZE, 2, 9];
    for (const name of LUT_PRESET_NAMES) {
      for (const size of sizes) {
        const lut = LUT_PRESETS[name as LutPresetName](size);
        expect(lut.size).toBe(size);
        expect(lut.data.length).toBe(size * size * size * 3);
        for (let i = 0; i < lut.data.length; i++) {
          expect(lut.data[i]).toBeGreaterThanOrEqual(0);
          expect(lut.data[i]).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('size 省略時は DEFAULT_LUT_SIZE を使う', () => {
    const lut = LUT_PRESETS.warm();
    expect(lut.size).toBe(DEFAULT_LUT_SIZE);
  });
});

describe('warm / cool の色特性', () => {
  // 中間グレーに最も近いノードを size から選ぶ。
  const size = 9;
  const mid = Math.floor((size - 1) / 2); // 4 → 正規化 0.5

  it('warm は中間グレーで R>B になる', () => {
    const lut = LUT_PRESETS.warm(size);
    const c = nodeColor(lut, mid, mid, mid);
    expect(c.r).toBeGreaterThan(c.b);
  });

  it('cool は中間グレーで B>R になる', () => {
    const lut = LUT_PRESETS.cool(size);
    const c = nodeColor(lut, mid, mid, mid);
    expect(c.b).toBeGreaterThan(c.r);
  });

  it('warm と cool は R/B が鏡映関係(中間グレー)', () => {
    const w = nodeColor(LUT_PRESETS.warm(size), mid, mid, mid);
    const c = nodeColor(LUT_PRESETS.cool(size), mid, mid, mid);
    expect(w.r).toBeCloseTo(c.b, 6);
    expect(w.b).toBeCloseTo(c.r, 6);
  });
});

describe('contrastS の S 字トーン特性', () => {
  const size = 17;
  const denom = size - 1;
  const lut = LUT_PRESETS.contrastS(size);

  // グレー軸 (ri=gi=bi=k) を 0..1 でサンプルした R チャンネル列。
  const grayR: number[] = [];
  for (let k = 0; k < size; k++) {
    grayR.push(nodeColor(lut, k, k, k).r);
  }

  it('端点を保つ: 黒(0)→0, 白(1)→1', () => {
    expect(grayR[0]).toBeCloseTo(0, 6);
    expect(grayR[size - 1]).toBeCloseTo(1, 6);
  });

  it('単調増加(非減少)である', () => {
    for (let k = 1; k < size; k++) {
      expect(grayR[k]).toBeGreaterThanOrEqual(grayR[k - 1] - 1e-9);
    }
  });

  it('中間 0.5 付近の傾きが線形(=1)より急', () => {
    // 0.5 を挟む隣接ノード間の差分を分点幅で割った傾き。
    const lo = Math.floor((size - 1) / 2);
    const hi = lo + 1;
    const slope = (grayR[hi] - grayR[lo]) / (1 / denom);
    expect(slope).toBeGreaterThan(1);
  });

  it('両端(暗部・明部)は線形より引き締まる(傾き<1)', () => {
    const slopeLow = (grayR[1] - grayR[0]) / (1 / denom);
    const slopeHigh = (grayR[size - 1] - grayR[size - 2]) / (1 / denom);
    expect(slopeLow).toBeLessThan(1);
    expect(slopeHigh).toBeLessThan(1);
  });
});

describe('monochrome のグレースケール特性', () => {
  const size = 6;
  const lut = LUT_PRESETS.monochrome(size);

  it('全ノードで R=G=B(グレー)になる', () => {
    for (let bi = 0; bi < size; bi++) {
      for (let gi = 0; gi < size; gi++) {
        for (let ri = 0; ri < size; ri++) {
          const c = nodeColor(lut, ri, gi, bi);
          expect(c.g).toBeCloseTo(c.r, 6);
          expect(c.b).toBeCloseTo(c.r, 6);
        }
      }
    }
  });

  it('純緑ノードは純赤ノードより明るい(輝度ベース)', () => {
    const max = size - 1;
    const red = nodeColor(lut, max, 0, 0).r;
    const green = nodeColor(lut, 0, max, 0).r;
    expect(green).toBeGreaterThan(red);
  });
});

describe('sepia の着色特性', () => {
  it('中間グレー入力で R>G>B の茶系になる', () => {
    const out = sepiaTransform({ r: 0.5, g: 0.5, b: 0.5 });
    expect(out.r).toBeGreaterThan(out.g);
    expect(out.g).toBeGreaterThan(out.b);
  });
});
