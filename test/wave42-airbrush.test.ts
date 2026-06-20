import { describe, expect, it } from 'vitest';
import { accumulateDwell, buildupAlpha } from '../src/engine/airbrush';

describe('エアブラシ — buildupAlpha(滞留ビルドアップ蓄積)', () => {
  it('flow=0 のとき current を変えない', () => {
    expect(buildupAlpha(0.3, 0, 1, 1)).toBe(0.3);
  });

  it('dt=0 のとき current を変えない', () => {
    expect(buildupAlpha(0.3, 2, 0, 1)).toBe(0.3);
  });

  it('flow<=0 / dt<=0(負値含む)で current を返す', () => {
    expect(buildupAlpha(0.4, -1, 1, 1)).toBe(0.4);
    expect(buildupAlpha(0.4, 1, -5, 1)).toBe(0.4);
  });

  it('ceiling<=current のとき current 不変(天井以上は積み上がらない)', () => {
    expect(buildupAlpha(0.8, 5, 10, 0.8)).toBe(0.8);
    expect(buildupAlpha(0.9, 5, 10, 0.5)).toBe(0.9);
  });

  it('負 dt は 0 扱いとなり蓄積しない', () => {
    expect(buildupAlpha(0.2, 3, -0.0001, 1)).toBe(0.2);
  });

  it('十分大きい dt で ceiling に漸近するが超えない', () => {
    const next = buildupAlpha(0.1, 4, 1000, 0.9);
    expect(next).toBeLessThanOrEqual(0.9);
    expect(next).toBeGreaterThan(0.9 - 1e-9);
  });

  it('蓄積後の next は current 以上 ceiling 以下に収まる', () => {
    const next = buildupAlpha(0.2, 1.5, 0.7, 0.95);
    expect(next).toBeGreaterThanOrEqual(0.2);
    expect(next).toBeLessThanOrEqual(0.95);
  });

  it('dt を増やすと next が単調増加する(ceiling まで)', () => {
    const ceiling = 1;
    const flow = 2;
    const current = 0.1;
    let prev = buildupAlpha(current, flow, 0.1, ceiling);
    for (const dt of [0.2, 0.5, 1, 2, 5, 20]) {
      const next = buildupAlpha(current, flow, dt, ceiling);
      expect(next).toBeGreaterThan(prev);
      expect(next).toBeLessThanOrEqual(ceiling);
      prev = next;
    }
  });

  it('指数飽和の数値が手計算 (1-exp(-flow*dt)) と一致する(±1e-6)', () => {
    const current = 0.2;
    const flow = 1.5;
    const dt = 0.8;
    const ceiling = 0.9;
    const k = 1 - Math.exp(-flow * dt);
    const expected = current + (ceiling - current) * k;
    expect(buildupAlpha(current, flow, dt, ceiling)).toBeCloseTo(expected, 6);
  });

  it('決定論: 同入力なら必ず同出力', () => {
    expect(buildupAlpha(0.33, 2.7, 1.1, 0.88)).toBe(buildupAlpha(0.33, 2.7, 1.1, 0.88));
  });
});

describe('エアブラシ — accumulateDwell(滞留時間積み上げ)', () => {
  it('空配列のとき start をそのまま返す', () => {
    expect(accumulateDwell([], 3, 1, 0.25)).toBe(0.25);
  });

  it('start 既定は 0', () => {
    expect(accumulateDwell([], 3, 1)).toBe(0);
  });

  it('サンプル数が増えると最終αが増加し ceiling で飽和する', () => {
    const flow = 2;
    const ceiling = 0.9;
    const mk = (n: number) => Array.from({ length: n }, () => ({ dt: 0.1 }));
    const a1 = accumulateDwell(mk(1), flow, ceiling);
    const a5 = accumulateDwell(mk(5), flow, ceiling);
    const a20 = accumulateDwell(mk(20), flow, ceiling);
    const a200 = accumulateDwell(mk(200), flow, ceiling);
    expect(a5).toBeGreaterThan(a1);
    expect(a20).toBeGreaterThan(a5);
    expect(a200).toBeGreaterThan(a20);
    expect(a200).toBeLessThanOrEqual(ceiling);
    expect(a200).toBeGreaterThan(ceiling - 1e-6);
  });

  it('合計 dt が大きいほど最終αが大きい(単調)', () => {
    const flow = 1;
    const ceiling = 1;
    const short = accumulateDwell([{ dt: 0.5 }, { dt: 0.5 }], flow, ceiling);
    const long = accumulateDwell([{ dt: 2 }, { dt: 2 }], flow, ceiling);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(ceiling);
  });

  it('連鎖は buildupAlpha の逐次適用と一致する', () => {
    const flow = 1.3;
    const ceiling = 0.8;
    const samples = [{ dt: 0.4 }, { dt: 0.9 }, { dt: 0.2 }];
    let manual = 0.1;
    for (const s of samples) manual = buildupAlpha(manual, flow, s.dt, ceiling);
    expect(accumulateDwell(samples, flow, ceiling, 0.1)).toBe(manual);
  });

  it('決定論: 同入力なら必ず同出力', () => {
    const samples = [{ dt: 0.3 }, { dt: 0.7 }, { dt: 1.1 }];
    expect(accumulateDwell(samples, 2.2, 0.95, 0.05)).toBe(
      accumulateDwell(samples, 2.2, 0.95, 0.05),
    );
  });
});
