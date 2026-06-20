/**
 * Wave42 / US-4402 — デュアルブラシ(二次テクスチャによる α 変調)のテスト。
 *
 * jsdom では canvas API が使えないため、純粋配列ロジックとして検証する。
 * 後方互換: strength=0 は無変調(primary と全要素一致 + 非破壊)であることを実証する。
 */
import { describe, it, expect } from 'vitest';
import {
  applyDualBrush,
  type DualBlendMode,
} from '../src/engine/dual-brush';

/** テスト用: 0..1 クランプ(期待値計算の独立実装)。 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

describe('applyDualBrush — strength=0 で無変調 + 非破壊', () => {
  it('strength=0 の出力は primary と全要素一致する', () => {
    const primary = new Float32Array([0.2, 0.5, 0.8, 1.0]);
    const secondary = new Float32Array([0.0, 0.3, 0.6, 0.9]);
    const out = applyDualBrush(primary, 2, 2, secondary, 2, 2, 'multiply', 0);
    // Float32 表現はそのまま保たれるため primary とビット一致(別インスタンス)。
    expect(out).not.toBe(primary);
    for (let i = 0; i < primary.length; i += 1) {
      expect(out[i]).toBe(primary[i]);
    }
  });

  it('strength=0 で primary は変更されない(非破壊)', () => {
    const primary = new Float32Array([0.2, 0.5, 0.8, 1.0]);
    const before = Array.from(primary);
    const secondary = new Float32Array([0.1, 0.7, 0.4, 0.2]);
    const out = applyDualBrush(primary, 2, 2, secondary, 2, 2, 'subtract', 0);
    // primary は不変
    expect(Array.from(primary)).toEqual(before);
    // 返り値は別インスタンス
    expect(out).not.toBe(primary);
  });

  it('strength>0 でも primary は変更されない(非破壊)', () => {
    const primary = new Float32Array([0.2, 0.5, 0.8, 1.0]);
    const before = Array.from(primary);
    const secondary = new Float32Array([0.1, 0.7, 0.4, 0.2]);
    applyDualBrush(primary, 2, 2, secondary, 2, 2, 'multiply', 1);
    expect(Array.from(primary)).toEqual(before);
  });
});

describe('applyDualBrush — 各 blend 式(strength=1)を手計算と照合', () => {
  // 2x2、主と二次が同寸法。strength=1 なので out===combined。
  const primary = new Float32Array([0.2, 0.5, 0.8, 1.0]);
  const secondary = new Float32Array([0.5, 0.4, 1.0, 0.3]);

  it('multiply: a*s', () => {
    const out = applyDualBrush(primary, 2, 2, secondary, 2, 2, 'multiply', 1);
    const exp = [0.2 * 0.5, 0.5 * 0.4, 0.8 * 1.0, 1.0 * 0.3];
    out.forEach((v, i) => expect(v).toBeCloseTo(exp[i], 6));
  });

  it('subtract: clamp01(a-s)', () => {
    const out = applyDualBrush(primary, 2, 2, secondary, 2, 2, 'subtract', 1);
    const exp = [
      clamp01(0.2 - 0.5), // <0 → 0
      clamp01(0.5 - 0.4),
      clamp01(0.8 - 1.0), // <0 → 0
      clamp01(1.0 - 0.3),
    ];
    out.forEach((v, i) => expect(v).toBeCloseTo(exp[i], 6));
  });

  it('min: min(a,s)', () => {
    const out = applyDualBrush(primary, 2, 2, secondary, 2, 2, 'min', 1);
    const exp = [
      Math.min(0.2, 0.5),
      Math.min(0.5, 0.4),
      Math.min(0.8, 1.0),
      Math.min(1.0, 0.3),
    ];
    out.forEach((v, i) => expect(v).toBeCloseTo(exp[i], 6));
  });

  it('screen: 1-(1-a)(1-s)', () => {
    const out = applyDualBrush(primary, 2, 2, secondary, 2, 2, 'screen', 1);
    const exp = [
      1 - (1 - 0.2) * (1 - 0.5),
      1 - (1 - 0.5) * (1 - 0.4),
      1 - (1 - 0.8) * (1 - 1.0),
      1 - (1 - 1.0) * (1 - 0.3),
    ];
    out.forEach((v, i) => expect(v).toBeCloseTo(exp[i], 6));
  });
});

describe('applyDualBrush — strength=0.5 は primary と full-combined の中点', () => {
  it('out = a + (combined - a) * 0.5', () => {
    const primary = new Float32Array([0.2, 0.5, 0.8, 1.0]);
    const secondary = new Float32Array([0.5, 0.4, 1.0, 0.3]);
    const mode: DualBlendMode = 'multiply';
    const half = applyDualBrush(primary, 2, 2, secondary, 2, 2, mode, 0.5);
    const full = applyDualBrush(primary, 2, 2, secondary, 2, 2, mode, 1);
    for (let i = 0; i < primary.length; i += 1) {
      const a = primary[i];
      const expected = a + (full[i] - a) * 0.5;
      expect(half[i]).toBeCloseTo(expected, 6);
    }
  });
});

describe('applyDualBrush — 二次が小さい場合の wrap(タイル)参照', () => {
  it('sx=x%sw, sy=y%sh の規則で二次を繰り返し参照する', () => {
    // 主 4x2、二次 2x2(タイル)。
    const width = 4;
    const height = 2;
    const primary = new Float32Array(width * height).fill(1.0);
    // 二次: [ [0.1, 0.2], [0.3, 0.4] ] (row-major)
    const sw = 2;
    const sh = 2;
    const secondary = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const out = applyDualBrush(primary, width, height, secondary, sw, sh, 'multiply', 1);
    // a=1.0 なので multiply の出力は二次サンプルそのもの。
    // 期待される二次サンプル配置(x%2, y%2):
    //  y=0: x=0→0.1, x=1→0.2, x=2→0.1, x=3→0.2
    //  y=1: x=0→0.3, x=1→0.4, x=2→0.3, x=3→0.4
    const exp = [
      0.1, 0.2, 0.1, 0.2,
      0.3, 0.4, 0.3, 0.4,
    ];
    out.forEach((v, i) => expect(v).toBeCloseTo(exp[i], 6));
  });
});

describe('applyDualBrush — 出力は常に 0..1 範囲内', () => {
  it('極端な入力でもクランプされる', () => {
    // 範囲外を含む入力を与え、出力が 0..1 に収まることを確認。
    const primary = new Float32Array([1.0, 0.0, 0.9, 0.1, 0.5, 0.7]);
    const secondary = new Float32Array([1.0, 0.0, 0.5]);
    for (const mode of ['multiply', 'subtract', 'min', 'screen'] as DualBlendMode[]) {
      for (const strength of [0, 0.25, 0.5, 0.75, 1]) {
        const out = applyDualBrush(primary, 3, 2, secondary, 3, 1, mode, strength);
        for (const v of out) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('strength は 0..1 にクランプされる(>1 は 1 と同じ)', () => {
    const primary = new Float32Array([0.4, 0.6]);
    const secondary = new Float32Array([0.5, 0.5]);
    const atOne = applyDualBrush(primary, 2, 1, secondary, 2, 1, 'multiply', 1);
    const overOne = applyDualBrush(primary, 2, 1, secondary, 2, 1, 'multiply', 5);
    expect(Array.from(overOne)).toEqual(Array.from(atOne));
  });
});
