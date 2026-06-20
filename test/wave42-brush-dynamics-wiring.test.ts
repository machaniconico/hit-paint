/**
 * Wave42 US-4404 — store/App 配線(カラーダイナミクス/デュアル/エアブラシ)の検証。
 *
 * jsdom では canvas API が使えないため、store のストローク経路から切り出した
 * 副作用無しの純粋ヘルパ(resolveDabColor / modulateTipAlpha / accumulateCoverage)
 * と、StoreStrokeEngine の coverage バッファ(Float32Array)だけで検証する。
 *
 * 主眼:
 *  - 各ヘルパが engine 単体(US-4401/4402/4403)と完全一致すること。
 *  - 新フィールド未指定なら従来とバイト同一(coverage/色がゴールデン一致)。
 */

import { describe, it, expect } from 'vitest';
import {
  resolveDabColor,
  modulateTipAlpha,
  accumulateCoverage,
  StoreStrokeEngine,
} from '../src/state/store';
import { applyColorDynamics, type ColorDynamicsConfig } from '../src/engine/brush-color-dynamics';
import { applyDualBrush } from '../src/engine/dual-brush';
import { buildupAlpha, accumulateDwell } from '../src/engine/airbrush';
import type { BrushSettings, PointerSample, RGBA } from '../src/types';
import { DEFAULT_BRUSH } from '../src/types';

const RED: RGBA = { r: 200, g: 40, b: 40, a: 255 };
const BLUE: RGBA = { r: 20, g: 30, b: 220, a: 255 };

// ---------------------------------------------------------------------------
// resolveDabColor — カラーダイナミクス打点色
// ---------------------------------------------------------------------------

describe('resolveDabColor(カラーダイナミクス打点色)', () => {
  const cfg: ColorDynamicsConfig = {
    hueJitter: 0.3,
    satJitter: 0.2,
    valueJitter: 0.15,
    fgBgJitter: 0.4,
  };

  it('設定有りで applyColorDynamics 単体と完全一致する(bg/pressure 込み)', () => {
    for (let step = 0; step < 8; step += 1) {
      const got = resolveDabColor(RED, cfg, 0, step, { pressure: 0.7, bg: BLUE });
      const want = applyColorDynamics(RED, cfg, 0, step, { pressure: 0.7, bg: BLUE });
      expect(got).toEqual(want);
    }
  });

  it('cfg が null/undefined なら base をそのまま返す(バイト同一・新オブジェクト)', () => {
    for (const cfgNone of [null, undefined]) {
      const got = resolveDabColor(RED, cfgNone, 0, 3, { pressure: 0.5, bg: BLUE });
      expect(got).toEqual(RED);
      expect(got).not.toBe(RED); // 参照は別(防御コピー)
    }
  });

  it('全ジッタ0の cfg は base とバイト同一(applyColorDynamics の後方互換)', () => {
    const zero: ColorDynamicsConfig = { hueJitter: 0, satJitter: 0, valueJitter: 0, fgBgJitter: 0 };
    const got = resolveDabColor(RED, zero, 0, 5);
    expect(got).toEqual(RED);
  });
});

// ---------------------------------------------------------------------------
// modulateTipAlpha — デュアルブラシ α 変調
// ---------------------------------------------------------------------------

describe('modulateTipAlpha(デュアルブラシαバッファ変調)', () => {
  const width = 4;
  const height = 3;
  const primary = new Float32Array([
    0.1, 0.2, 0.3, 0.4,
    0.5, 0.6, 0.7, 0.8,
    0.9, 1.0, 0.0, 0.5,
  ]);
  const secondary = new Float32Array([
    0.2, 0.8,
    0.5, 0.3,
  ]);
  const dual = {
    secondary,
    secondaryWidth: 2,
    secondaryHeight: 2,
    mode: 'multiply' as const,
    strength: 0.6,
  };

  it('設定有りで applyDualBrush 単体と完全一致する', () => {
    const got = modulateTipAlpha(primary, width, height, dual);
    const want = applyDualBrush(primary, width, height, secondary, 2, 2, 'multiply', 0.6);
    expect(Array.from(got)).toEqual(Array.from(want));
  });

  it('dual が null/undefined なら入力 alpha を参照同一で返す(無変調)', () => {
    expect(modulateTipAlpha(primary, width, height, null)).toBe(primary);
    expect(modulateTipAlpha(primary, width, height, undefined)).toBe(primary);
  });
});

// ---------------------------------------------------------------------------
// accumulateCoverage — エアブラシ滞留 / 既定 max 合成
// ---------------------------------------------------------------------------

describe('accumulateCoverage(coverage 蓄積)', () => {
  it('airbrushFlow 未指定/0 なら従来どおり max 合成(バイト同一)', () => {
    expect(accumulateCoverage(0.3, 0.7, undefined, undefined)).toBe(0.7);
    expect(accumulateCoverage(0.7, 0.3, undefined, undefined)).toBe(0.7);
    expect(accumulateCoverage(0.5, 0.5, 0, 1)).toBe(0.5);
  });

  it('airbrushFlow>0 なら buildupAlpha 単体と完全一致する(dt=contribution)', () => {
    const got = accumulateCoverage(0.2, 0.5, 2.0, 0.9);
    const want = buildupAlpha(0.2, 2.0, 0.5, 0.9);
    expect(got).toBe(want);
  });

  it('滞留を連続適用すると accumulateDwell と一致する(ceiling へ漸近)', () => {
    const flow = 1.5;
    const ceiling = 0.8;
    const contributions = [0.3, 0.3, 0.3, 0.3];
    let acc = 0;
    for (const c of contributions) acc = accumulateCoverage(acc, c, flow, ceiling);
    const want = accumulateDwell(contributions.map((dt) => ({ dt })), flow, ceiling, 0);
    expect(acc).toBe(want);
    expect(acc).toBeLessThanOrEqual(ceiling);
  });

  it('既定 ceiling は 1(airbrushCeiling 未指定時)', () => {
    expect(accumulateCoverage(0.2, 0.5, 2.0, undefined)).toBe(buildupAlpha(0.2, 2.0, 0.5, 1));
  });
});

// ---------------------------------------------------------------------------
// StoreStrokeEngine 経路 — 新フィールド未指定でバイト同一(ゴールデン)
// ---------------------------------------------------------------------------

const W = 32;
const H = 32;
const SYM = { mode: 'none' as const, centerX: W / 2, centerY: H / 2, slices: 6 };
const DYN = { sizeJitter: 0, opacityJitter: 0, scatter: 0, seed: 0 };

function makeStroke(): PointerSample[] {
  return [
    { x: 8, y: 8, pressure: 0.6, t: 0 },
    { x: 16, y: 12, pressure: 0.8, t: 10 },
    { x: 22, y: 20, pressure: 1.0, t: 20 },
  ];
}

function runEngine(brush: BrushSettings, base?: RGBA, bg?: RGBA): Float32Array {
  const engine = new StoreStrokeEngine(W, H, brush, false, SYM, DYN, base, bg);
  for (const s of makeStroke()) engine.addSample(s);
  return engine.coverage.slice();
}

describe('StoreStrokeEngine — 新フィールド未指定でバイト同一', () => {
  it('colorDynamics/dualBrush/airbrush いずれも未指定なら DEFAULT_BRUSH と coverage 完全一致', () => {
    const plain: BrushSettings = { ...DEFAULT_BRUSH };
    const explicitUnset: BrushSettings = {
      ...DEFAULT_BRUSH,
      colorDynamics: null,
      dualBrush: null,
      airbrushFlow: 0,
    };
    const golden = runEngine(plain);
    const same = runEngine(explicitUnset);
    expect(Array.from(same)).toEqual(Array.from(golden));
  });

  it('colorDynamics 未指定では commit が単色 color のまま(色源を切り替えない)', () => {
    // colorDynamics 無し → commit は引数 color をそのまま使う。
    const brush: BrushSettings = { ...DEFAULT_BRUSH };
    const engine = new StoreStrokeEngine(W, H, brush, false, SYM, DYN, RED, BLUE);
    for (const s of makeStroke()) engine.addSample(s);
    const target = new Uint8ClampedArray(W * H * 4);
    engine.commit(target, RED, null);
    // 塗られた画素は RED 色相のはず(色バッファ非使用)。代表点を確認。
    let painted = -1;
    for (let i = 0; i < W * H; i += 1) {
      if (target[i * 4 + 3] > 0) { painted = i; break; }
    }
    expect(painted).toBeGreaterThanOrEqual(0);
    const o = painted * 4;
    // 単色 RED なので r>g かつ r>b(カラージッタ無し)。
    expect(target[o]).toBeGreaterThan(target[o + 1]);
    expect(target[o]).toBeGreaterThan(target[o + 2]);
  });
});

// ---------------------------------------------------------------------------
// StoreStrokeEngine — エアブラシ有効時の挙動(滞留で濃くなる)
// ---------------------------------------------------------------------------

describe('StoreStrokeEngine — エアブラシ滞留', () => {
  it('同一点に複数打点すると coverage が単調増加し ceiling を超えない', () => {
    const ceiling = 0.7;
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      shape: 'pixel',
      size: 4,
      spacing: 0.01,
      pressureSize: false,
      pressureOpacity: false,
      airbrushFlow: 2.0,
      airbrushCeiling: ceiling,
    };
    const engine = new StoreStrokeEngine(W, H, brush, false, SYM, DYN);
    // 同一座標を滞留として複数回打つ。
    for (let k = 0; k < 6; k += 1) {
      engine.addSample({ x: 16, y: 16, pressure: 1, t: k * 5 });
    }
    let maxCov = 0;
    for (let i = 0; i < engine.coverage.length; i += 1) {
      maxCov = Math.max(maxCov, engine.coverage[i]);
    }
    expect(maxCov).toBeGreaterThan(0);
    expect(maxCov).toBeLessThanOrEqual(ceiling + 1e-6);
  });
});

// ---------------------------------------------------------------------------
// StoreStrokeEngine — カラーダイナミクス有効時、打点色が反映される
// ---------------------------------------------------------------------------

describe('StoreStrokeEngine — カラーダイナミクス有効', () => {
  it('色相ジッタ大で塗り色が base(RED) からズレる(commit が色バッファを使う)', () => {
    const cfg: ColorDynamicsConfig = {
      hueJitter: 0.9,
      satJitter: 0,
      valueJitter: 0,
      fgBgJitter: 0,
    };
    const brush: BrushSettings = {
      ...DEFAULT_BRUSH,
      shape: 'pixel',
      size: 6,
      spacing: 0.2,
      pressureSize: false,
      pressureOpacity: false,
      colorDynamics: cfg,
    };
    const engine = new StoreStrokeEngine(W, H, brush, false, SYM, DYN, RED, BLUE);
    for (const s of makeStroke()) engine.addSample(s);
    const target = new Uint8ClampedArray(W * H * 4);
    engine.commit(target, RED, null);
    // 塗られた画素のどこかで g もしくは b が RED.g/RED.b を上回る(色相がズレた証拠)。
    let shifted = false;
    for (let i = 0; i < W * H; i += 1) {
      const o = i * 4;
      if (target[o + 3] === 0) continue;
      if (target[o + 1] > RED.g + 5 || target[o + 2] > RED.b + 5) { shifted = true; break; }
    }
    expect(shifted).toBe(true);
  });
});
