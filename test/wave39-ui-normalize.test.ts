// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { normalizeDeg } from '../src/App';

/**
 * US-4103: 基準回転スライダの角度正規化(normalizeDeg)を純粋配列ロジックで検証する。
 * .sut 由来の tipAngle はラジアン保持で負値や 2π 超を取りうるため、度数変換後に
 * 0..360 へ畳む必要がある。canvas API には一切依存しない(jsdom で安全に走る)。
 * 関数は App.tsx の named export(単なる純粋関数)で、React 描画は一切行わない。
 */
describe('normalizeDeg (US-4103 回転スライダ負値正規化)', () => {
  it('負角は 0..360 へ正規化される (-90 → 270)', () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(-1)).toBe(359);
    expect(normalizeDeg(-180)).toBe(180);
  });

  it('360 超は 0..360 へ折り返す (370 → 10)', () => {
    expect(normalizeDeg(370)).toBe(10);
    expect(normalizeDeg(450)).toBe(90);
    expect(normalizeDeg(721)).toBe(1);
  });

  it('0 と 360 の境界: 0 はそのまま、360 は 0 に畳まれる', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(180)).toBe(180);
  });

  it('-360 の倍数は 0 に正規化される', () => {
    expect(normalizeDeg(-360)).toBe(0);
    expect(normalizeDeg(-720)).toBe(0);
    expect(normalizeDeg(720)).toBe(0);
  });

  it('浮動小数も剰余は保たれる(丸めは UI 側 Math.round の責務)', () => {
    expect(normalizeDeg(-0.5)).toBeCloseTo(359.5, 6);
    expect(normalizeDeg(360.25)).toBeCloseTo(0.25, 6);
    expect(normalizeDeg(45.75)).toBeCloseTo(45.75, 6);
    expect(normalizeDeg(-359.5)).toBeCloseTo(0.5, 6);
  });

  it('結果は常に [0, 360) の半開区間に収まる', () => {
    for (const deg of [-1000, -360, -90, -0.1, 0, 0.1, 90, 359.9, 360, 1000.5]) {
      const r = normalizeDeg(deg);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
    }
  });
});
