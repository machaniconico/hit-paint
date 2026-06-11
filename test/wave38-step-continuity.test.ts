import { describe, expect, it } from 'vitest';
import { stampStroke } from '../src/engine/stroke-stamp';
import type { TipAlpha } from '../src/engine/tip-stamp';
import type { PointerSample } from '../src/types';

/**
 * Wave38 US-4001: stampStroke の打点通し番号(stepIndex)継続。
 *
 * angleJitter>0 のときジッタは (seed, 打点通し番号) から決定論的に決まるため、
 * ストロークを分割して呼ぶと従来は通し番号が 0 から数え直され、一括呼び出しと
 * ジッタ列がずれていた。stepIndexStart / nextStepIndex で継続できることを検証する。
 */

/** 横長の長方形 tip(全画素 1.0)。回転の影響が coverage に強く出る形状。 */
function barTip(w: number, h: number): TipAlpha {
  return { width: w, height: h, data: new Float32Array(w * h).fill(1) };
}

function sample(x: number, y: number, pressure = 1): PointerSample {
  return { x, y, pressure, t: 0 };
}

/** 方向が変化する折れ線(followStroke が効く)。 */
function zigzag(): PointerSample[] {
  return [sample(20, 20), sample(60, 28), sample(90, 60), sample(130, 50)];
}

const cw = 160;
const ch = 90;

/** ジッタあり共通パラメータ。 */
const jitterParams = {
  size: 8,
  spacing: 0.6,
  followStroke: true,
  angleJitter: Math.PI / 3,
  seed: 7,
} as const;

describe('stampStroke — 打点通し番号の継続(US-4001)', () => {
  it('(1) stepIndexStart 未指定は従来挙動(再現一致 + stepIndexStart:0 明示と一致)', () => {
    const tip = barTip(8, 2);
    const samples = zigzag();

    // 同条件 2 回で完全再現(決定論)。
    const covA = new Float32Array(cw * ch);
    const covB = new Float32Array(cw * ch);
    const ra = stampStroke(covA, cw, ch, tip, samples, { ...jitterParams });
    const rb = stampStroke(covB, cw, ch, tip, samples, { ...jitterParams });
    expect(Array.from(covB)).toEqual(Array.from(covA));
    expect(rb.residual).toBe(ra.residual);

    // stepIndexStart:0 を明示しても未指定と完全同一(既定値 0 の互換)。
    const covC = new Float32Array(cw * ch);
    const rc = stampStroke(covC, cw, ch, tip, samples, {
      ...jitterParams,
      stepIndexStart: 0,
    });
    expect(Array.from(covC)).toEqual(Array.from(covA));
    expect(rc.nextStepIndex).toBe(ra.nextStepIndex);
  });

  it('(2) angleJitter>0 + followStroke: residual と nextStepIndex を繋げば分割=一括', () => {
    const tip = barTip(8, 2);
    const full = zigzag();

    const covWhole = new Float32Array(cw * ch);
    stampStroke(covWhole, cw, ch, tip, full, { ...jitterParams });

    // 2分割: 前半 full[0..3)、後半 full[2..]。residual と nextStepIndex を繋ぐ。
    const covSplit = new Float32Array(cw * ch);
    const r1 = stampStroke(covSplit, cw, ch, tip, full.slice(0, 3), {
      ...jitterParams,
      residualStart: 0,
      stepIndexStart: 0,
    });
    stampStroke(covSplit, cw, ch, tip, full.slice(2), {
      ...jitterParams,
      residualStart: r1.residual,
      stepIndexStart: r1.nextStepIndex,
    });

    expect(Array.from(covSplit)).toEqual(Array.from(covWhole));
  });

  it('(3) stepIndexStart を渡さない分割はジッタ列がずれて一括と不一致(修正の必要性)', () => {
    const tip = barTip(8, 2);
    const full = zigzag();

    const covWhole = new Float32Array(cw * ch);
    stampStroke(covWhole, cw, ch, tip, full, { ...jitterParams });

    // residual は繋ぐが stepIndexStart は渡さない(=従来の分割呼び出し)。
    const covSplit = new Float32Array(cw * ch);
    const r1 = stampStroke(covSplit, cw, ch, tip, full.slice(0, 3), {
      ...jitterParams,
      residualStart: 0,
    });
    stampStroke(covSplit, cw, ch, tip, full.slice(2), {
      ...jitterParams,
      residualStart: r1.residual,
    });

    // 後半の通し番号が 0 から数え直されるため、一括とは一致しない。
    expect(Array.from(covSplit)).not.toEqual(Array.from(covWhole));
  });

  it('(4) angleJitter=0 なら stepIndexStart は結果に影響しない', () => {
    const tip = barTip(8, 2);
    const samples = zigzag();
    const noJitter = { size: 8, spacing: 0.6, followStroke: true, angleJitter: 0, seed: 7 };

    const covA = new Float32Array(cw * ch);
    const covB = new Float32Array(cw * ch);
    stampStroke(covA, cw, ch, tip, samples, { ...noJitter, stepIndexStart: 0 });
    stampStroke(covB, cw, ch, tip, samples, { ...noJitter, stepIndexStart: 123 });

    expect(Array.from(covB)).toEqual(Array.from(covA));
  });

  it('(5) nextStepIndex は打点数ぶん進む(2連結の合計が一括と一致)', () => {
    const tip = barTip(8, 2);
    const full = zigzag();

    const covWhole = new Float32Array(cw * ch);
    const whole = stampStroke(covWhole, cw, ch, tip, full, { ...jitterParams });

    const covSplit = new Float32Array(cw * ch);
    const r1 = stampStroke(covSplit, cw, ch, tip, full.slice(0, 3), {
      ...jitterParams,
      residualStart: 0,
      stepIndexStart: 0,
    });
    const r2 = stampStroke(covSplit, cw, ch, tip, full.slice(2), {
      ...jitterParams,
      residualStart: r1.residual,
      stepIndexStart: r1.nextStepIndex,
    });

    // 前半・後半で単調に進み、合計は一括呼び出しの打点数と一致する。
    expect(r1.nextStepIndex).toBeGreaterThan(0);
    expect(r2.nextStepIndex).toBeGreaterThan(r1.nextStepIndex);
    expect(r2.nextStepIndex).toBe(whole.nextStepIndex);

    // 空 samples は通し番号も進めない(stepIndexStart をそのまま返す)。
    const covEmpty = new Float32Array(cw * ch);
    const re = stampStroke(covEmpty, cw, ch, tip, [], {
      ...jitterParams,
      residualStart: 1.5,
      stepIndexStart: 42,
    });
    expect(re.nextStepIndex).toBe(42);
    expect(re.residual).toBe(1.5);
  });
});
