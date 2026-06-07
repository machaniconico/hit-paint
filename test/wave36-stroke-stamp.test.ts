import { describe, expect, it } from 'vitest';
import { stampStroke } from '../src/engine/stroke-stamp';
import type { TipAlpha } from '../src/engine/tip-stamp';
import type { PressureCurve } from '../src/io/sut-pressure';
import type { PointerSample } from '../src/types';

/** 全画素 1.0 の正方形 tip。最長辺=size でスケールされる。 */
function solidTip(side: number): TipAlpha {
  return { width: side, height: side, data: new Float32Array(side * side).fill(1) };
}

function sample(x: number, y: number, pressure = 1): PointerSample {
  return { x, y, pressure, t: 0 };
}

/** coverage 中で v>0 の画素数を数える。 */
function litCount(cov: Float32Array): number {
  let n = 0;
  for (let i = 0; i < cov.length; i += 1) if (cov[i] > 0) n += 1;
  return n;
}

/** v>0 の画素の x 範囲(bbox 幅)。立っていなければ 0。 */
function litBBoxWidth(cov: Float32Array, cw: number, ch: number): number {
  let minX = Infinity;
  let maxX = -Infinity;
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      if (cov[y * cw + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (maxX < minX) return 0;
  return maxX - minX + 1;
}

describe('stampStroke — tip spacing 連打', () => {
  it('(1) 水平直線ストロークを spacing 間隔で連打する', () => {
    const cw = 200;
    const ch = 40;
    const cov = new Float32Array(cw * ch);
    const tip = solidTip(4); // size=4 を指定すると最長辺4px

    const size = 4;
    const spacing = 1; // s = spacing*size = 4
    const L = 80;
    const samples = [sample(20, 20), sample(20 + L, 20)];

    const { residual } = stampStroke(cov, cw, ch, tip, samples, {
      size,
      spacing,
      pressureSize: null,
      pressureFlow: null,
    });

    // s = spacing*effSize = 4。おおよそ floor(L/s)+1 = 21 個のスタンプ中心。
    const s = spacing * size;
    const expectedStamps = Math.floor(L / s) + 1;

    // 各スタンプ中心 x = 20 + k*s に coverage が立っている。
    for (let k = 0; k < expectedStamps; k += 1) {
      const cx = 20 + k * s;
      expect(cov[20 * cw + cx]).toBeGreaterThan(0);
    }

    expect(residual).toBeGreaterThanOrEqual(0);
  });

  it('(2) 単一サンプルはその点に 1 スタンプ', () => {
    const cw = 40;
    const ch = 40;
    const cov = new Float32Array(cw * ch);
    const tip = solidTip(4);

    stampStroke(cov, cw, ch, tip, [sample(20, 20)], {
      size: 4,
      spacing: 1,
      pressureSize: null,
      pressureFlow: null,
    });

    // 中心に立つ。
    expect(cov[20 * cw + 20]).toBeGreaterThan(0);
    // 1 スタンプ分のみ点灯(過剰連打していない)。
    expect(litCount(cov)).toBeGreaterThan(0);
    expect(litCount(cov)).toBeLessThanOrEqual(4 * 4 + 8);
  });

  it('(3) pressureFlow 全0カーブは立たず、全1カーブは立つ', () => {
    const cw = 80;
    const ch = 40;
    const tip = solidTip(4);
    const samples = [sample(20, 20), sample(60, 20)];

    const zeroCurve: PressureCurve = { points: [0, 0] };
    const covZero = new Float32Array(cw * ch);
    stampStroke(covZero, cw, ch, tip, samples, {
      size: 4,
      spacing: 1,
      pressureSize: null,
      pressureFlow: zeroCurve,
    });
    expect(litCount(covZero)).toBe(0);

    const oneCurve: PressureCurve = { points: [1, 1] };
    const covOne = new Float32Array(cw * ch);
    stampStroke(covOne, cw, ch, tip, samples, {
      size: 4,
      spacing: 1,
      pressureSize: null,
      pressureFlow: oneCurve,
    });
    expect(litCount(covOne)).toBeGreaterThan(0);
  });

  it('(4) pressureSize の大きな倍率は bbox 幅を広げる', () => {
    const cw = 120;
    const ch = 60;
    const tip = solidTip(4);
    const samples = [sample(60, 30)]; // 単一スタンプで幅比較

    // 倍率 1 の基準。
    const covBase = new Float32Array(cw * ch);
    stampStroke(covBase, cw, ch, tip, samples, {
      size: 4,
      spacing: 1,
      pressureSize: { points: [1, 1] },
      pressureFlow: null,
    });
    const baseW = litBBoxWidth(covBase, cw, ch);

    // 倍率 3。
    const covBig = new Float32Array(cw * ch);
    stampStroke(covBig, cw, ch, tip, samples, {
      size: 4,
      spacing: 1,
      pressureSize: { points: [3, 3] },
      pressureFlow: null,
    });
    const bigW = litBBoxWidth(covBig, cw, ch);

    expect(bigW).toBeGreaterThan(baseW);
  });

  it('(5) residual 継続: 2分割と一括が一致(決定論)', () => {
    const cw = 200;
    const ch = 60;
    const tip = solidTip(4);
    const size = 4;
    const spacing = 0.7; // 半端な spacing で residual が効くように

    // 一括ストローク(折れ線)。
    const full: PointerSample[] = [
      sample(20, 30, 0.4),
      sample(70, 30, 0.8),
      sample(120, 50, 0.6),
      sample(160, 50, 1.0),
    ];
    const covWhole = new Float32Array(cw * ch);
    stampStroke(covWhole, cw, ch, tip, full, {
      size,
      spacing,
      pressureSize: { points: [0.5, 1.5] },
      pressureFlow: { points: [0.5, 1] },
    });

    // 2分割: 前半は full[0..2]、後半は full[2..3]。residual を繋ぐ。
    const covSplit = new Float32Array(cw * ch);
    const r1 = stampStroke(covSplit, cw, ch, tip, full.slice(0, 3), {
      size,
      spacing,
      pressureSize: { points: [0.5, 1.5] },
      pressureFlow: { points: [0.5, 1] },
      residualStart: 0,
    });
    stampStroke(covSplit, cw, ch, tip, full.slice(2), {
      size,
      spacing,
      pressureSize: { points: [0.5, 1.5] },
      pressureFlow: { points: [0.5, 1] },
      residualStart: r1.residual,
    });

    expect(Array.from(covSplit)).toEqual(Array.from(covWhole));
  });

  it('(6) 空 samples は no-op で residual===residualStart', () => {
    const cw = 40;
    const ch = 40;
    const cov = new Float32Array(cw * ch);
    const tip = solidTip(4);

    const { residual } = stampStroke(cov, cw, ch, tip, [], {
      size: 4,
      spacing: 1,
      pressureSize: null,
      pressureFlow: null,
      residualStart: 1.23,
    });

    expect(residual).toBe(1.23);
    expect(litCount(cov)).toBe(0);
  });
});
