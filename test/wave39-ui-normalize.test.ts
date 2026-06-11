// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { normalizeDeg } from '../src/App';

/**
 * US-4103: 基準回転スライダの度数正規化。
 * .sut 由来の tipAngle は負ラジアンや 2π 超を取りうるため、度数変換後の
 * 表示/スライダ value を ((deg%360)+360)%360 で 0..360 (上端含まず) へ
 * 正規化する。setBrush へ渡す値は従来どおり入力値そのままであり、
 * ここでは表示専用の純粋関数 normalizeDeg のみを検証する。
 * (App.tsx からの named export は tree-shaking 可能な単純関数で、
 *  jsdom 上で App モジュールを import しても副作用なく解決できることも兼ねて確認)
 */
describe('wave39 normalizeDeg 度数正規化 (US-4103)', () => {
  it('負角は正の等価角へ写る (-90 → 270)', () => {
    expect(normalizeDeg(-90)).toBe(270);
  });

  it('360 超は 1 周分巻き戻る (370 → 10)', () => {
    expect(normalizeDeg(370)).toBe(10);
  });

  it('0 はそのまま 0 (恒等)', () => {
    expect(normalizeDeg(0)).toBe(0);
  });

  it('360 ちょうどは 0 へ正規化される (スライダ表示レンジは 0..360 上端排他)', () => {
    expect(normalizeDeg(360)).toBe(0);
  });

  it('範囲内の値 (0 < deg < 360) は変化しない', () => {
    expect(normalizeDeg(1)).toBe(1);
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(359)).toBe(359);
  });

  it('-360 の倍数はすべて 0 へ写る (-360, -720, 720)', () => {
    expect(normalizeDeg(-360)).toBe(0);
    expect(normalizeDeg(-720)).toBe(0);
    expect(normalizeDeg(720)).toBe(0);
  });

  it('多重に巻いた負角も正しく写る (-450 → 270, -1 → 359)', () => {
    expect(normalizeDeg(-450)).toBe(270);
    expect(normalizeDeg(-1)).toBe(359);
  });

  it('浮動小数も保ったまま正規化される (370.5 → 10.5, -90.25 → 269.75)', () => {
    expect(normalizeDeg(370.5)).toBeCloseTo(10.5, 10);
    expect(normalizeDeg(-90.25)).toBeCloseTo(269.75, 10);
  });

  it('-0 を返さない (Object.is で +0 と一致)', () => {
    // ((-0 % 360) + 360) % 360 が -0 にならないことの防御的確認
    expect(Object.is(normalizeDeg(-0), 0)).toBe(true);
    expect(Object.is(normalizeDeg(-360), 0)).toBe(true);
  });
});
