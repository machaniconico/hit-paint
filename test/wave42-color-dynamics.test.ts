/**
 * Wave42 — ブラシ カラーダイナミクス(HSV決定論ジッタ + 前景背景ブレンド) (US-4401)。
 *
 * applyColorDynamics の決定論・後方互換・各ジッタ挙動を純粋配列ロジックで検証する
 * (canvas/DOM 非依存)。
 */

import { describe, it, expect } from 'vitest';
import {
  applyColorDynamics,
  type ColorDynamicsConfig,
} from '../src/engine/brush-color-dynamics';
import { rgbToHsv } from '../src/color/color';
import type { RGBA } from '../src/types';

const ZERO: ColorDynamicsConfig = {
  hueJitter: 0,
  satJitter: 0,
  valueJitter: 0,
  fgBgJitter: 0,
};

const FG: RGBA = { r: 200, g: 80, b: 40, a: 255 };
const BG: RGBA = { r: 10, g: 20, b: 250, a: 128 };

describe('applyColorDynamics — 後方互換(全ジッタ0)', () => {
  it('全ジッタ0 で出力は入力とRGBA完全一致', () => {
    const out = applyColorDynamics(FG, ZERO, 12345, 7);
    expect(out).toEqual(FG);
  });

  it('全ジッタ0 では seed/step/bg を変えても入力一致(振幅0の早期return)', () => {
    const out = applyColorDynamics(FG, ZERO, 999, 3, { bg: BG, pressure: 0.5 });
    expect(out).toEqual(FG);
  });

  it('全ジッタ0 では α も保持される', () => {
    const semi: RGBA = { r: 100, g: 100, b: 100, a: 77 };
    expect(applyColorDynamics(semi, ZERO, 1, 1)).toEqual(semi);
  });
});

describe('applyColorDynamics — 決定論', () => {
  const cfg: ColorDynamicsConfig = {
    hueJitter: 0.3,
    satJitter: 0.2,
    valueJitter: 0.2,
    fgBgJitter: 0,
  };

  it('同一(seed,step)で2回呼ぶと完全一致', () => {
    const a = applyColorDynamics(FG, cfg, 42, 5);
    const b = applyColorDynamics(FG, cfg, 42, 5);
    expect(a).toEqual(b);
  });

  it('step を変えると(統計的に)色が変化する', () => {
    const base = applyColorDynamics(FG, cfg, 42, 0);
    let changed = 0;
    for (let step = 1; step <= 20; step += 1) {
      const out = applyColorDynamics(FG, cfg, 42, step);
      if (out.r !== base.r || out.g !== base.g || out.b !== base.b) changed += 1;
    }
    // 20 サンプル中ほぼ全てが base と異なるはず。
    expect(changed).toBeGreaterThan(15);
  });

  it('α は常に base.a を保持する', () => {
    const out = applyColorDynamics(FG, cfg, 42, 5);
    expect(out.a).toBe(FG.a);
  });
});

describe('applyColorDynamics — hueJitter のみ', () => {
  const cfg: ColorDynamicsConfig = {
    hueJitter: 0.5,
    satJitter: 0,
    valueJitter: 0,
    fgBgJitter: 0,
  };

  it('色相は変化するが彩度/明度はほぼ不変', () => {
    const baseHsv = rgbToHsv(FG);
    let hueChangedCount = 0;
    for (let step = 0; step < 40; step += 1) {
      const out = applyColorDynamics(FG, cfg, 7, step);
      const hsv = rgbToHsv(out);
      // s/v は HSV→RGB 8bit 量子化分の微小誤差のみ許容。
      expect(Math.abs(hsv.s - baseHsv.s)).toBeLessThan(0.03);
      expect(Math.abs(hsv.v - baseHsv.v)).toBeLessThan(0.03);
      if (Math.abs(hsv.h - baseHsv.h) > 1) hueChangedCount += 1;
    }
    expect(hueChangedCount).toBeGreaterThan(20);
  });

  it('色相 jitter の結果 h は常に 0..360 内に循環する(wrap)', () => {
    // 高彩度の赤(h≈10°)に対して大きく振っても h は範囲内に wrap。
    const red: RGBA = { r: 255, g: 30, b: 30, a: 255 };
    const wide: ColorDynamicsConfig = {
      hueJitter: 1,
      satJitter: 0,
      valueJitter: 0,
      fgBgJitter: 0,
    };
    for (let step = 0; step < 60; step += 1) {
      const out = applyColorDynamics(red, wide, 3, step);
      const hsv = rgbToHsv(out);
      expect(hsv.h).toBeGreaterThanOrEqual(0);
      expect(hsv.h).toBeLessThan(360);
    }
  });
});

describe('applyColorDynamics — sat/value クランプ', () => {
  it('satJitter/valueJitter 最大でも HSV s,v は 0..1 内', () => {
    const cfg: ColorDynamicsConfig = {
      hueJitter: 0,
      satJitter: 1,
      valueJitter: 1,
      fgBgJitter: 0,
    };
    // 中間色から両極へ振っても 0..1 を超えない。
    const mid: RGBA = { r: 128, g: 96, b: 160, a: 255 };
    for (let step = 0; step < 80; step += 1) {
      const out = applyColorDynamics(mid, cfg, 11, step);
      const hsv = rgbToHsv(out);
      expect(hsv.s).toBeGreaterThanOrEqual(0);
      expect(hsv.s).toBeLessThanOrEqual(1);
      expect(hsv.v).toBeGreaterThanOrEqual(0);
      expect(hsv.v).toBeLessThanOrEqual(1);
    }
  });

  it('RGB 出力は常に 0..255 内に収まる', () => {
    const cfg: ColorDynamicsConfig = {
      hueJitter: 1,
      satJitter: 1,
      valueJitter: 1,
      fgBgJitter: 1,
    };
    for (let step = 0; step < 100; step += 1) {
      const out = applyColorDynamics(FG, cfg, 5, step, { bg: BG });
      for (const c of [out.r, out.g, out.b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
        expect(Number.isInteger(c)).toBe(true);
      }
    }
  });
});

describe('applyColorDynamics — 前景背景ブレンド', () => {
  it('fgBgJitter=1 + bg 指定で出力が base と bg の間に寄る', () => {
    const cfg: ColorDynamicsConfig = {
      hueJitter: 0,
      satJitter: 0,
      valueJitter: 0,
      fgBgJitter: 1,
    };
    // 純粋な fgBg ブレンドのみ。各 step で base と bg の凸結合(min..max 内)になるはず。
    for (let step = 0; step < 50; step += 1) {
      const out = applyColorDynamics(FG, cfg, 8, step, { bg: BG });
      // 線形ブレンドなので各チャンネルは min(fg,bg)..max(fg,bg) の範囲(丸め±1許容)。
      const lo = (a: number, b: number) => Math.min(a, b) - 1;
      const hi = (a: number, b: number) => Math.max(a, b) + 1;
      expect(out.r).toBeGreaterThanOrEqual(lo(FG.r, BG.r));
      expect(out.r).toBeLessThanOrEqual(hi(FG.r, BG.r));
      expect(out.g).toBeGreaterThanOrEqual(lo(FG.g, BG.g));
      expect(out.g).toBeLessThanOrEqual(hi(FG.g, BG.g));
      expect(out.b).toBeGreaterThanOrEqual(lo(FG.b, BG.b));
      expect(out.b).toBeLessThanOrEqual(hi(FG.b, BG.b));
    }
  });

  it('bg 未指定なら fgBgJitter があっても base のまま(ブレンドなし)', () => {
    const cfg: ColorDynamicsConfig = {
      hueJitter: 0,
      satJitter: 0,
      valueJitter: 0,
      fgBgJitter: 1,
    };
    expect(applyColorDynamics(FG, cfg, 8, 2)).toEqual(FG);
  });

  it('混合が進む step では bg 側へ近づく(端で背景へ寄る)', () => {
    const cfg: ColorDynamicsConfig = {
      hueJitter: 0,
      satJitter: 0,
      valueJitter: 0,
      fgBgJitter: 1,
    };
    // bg(青)へ寄るほど b が増え r が減る。最大寄り step を探して bg に近いことを確認。
    let maxBlue = -1;
    for (let step = 0; step < 200; step += 1) {
      const out = applyColorDynamics(FG, cfg, 8, step, { bg: BG });
      if (out.b > maxBlue) maxBlue = out.b;
    }
    // BG.b=250 に十分近づく step が存在する(u→1 付近)。
    expect(maxBlue).toBeGreaterThan(200);
  });

  it('pressure を下げると混合が弱まる(前景寄りになる)', () => {
    const cfg: ColorDynamicsConfig = {
      hueJitter: 0,
      satJitter: 0,
      valueJitter: 0,
      fgBgJitter: 1,
    };
    // 同 step で pressure=1 と pressure=0.1 を比較。低圧の方が base(FG) に近い。
    const distToFg = (c: RGBA) =>
      Math.abs(c.r - FG.r) + Math.abs(c.g - FG.g) + Math.abs(c.b - FG.b);
    let lowCloserCount = 0;
    for (let step = 0; step < 30; step += 1) {
      const full = applyColorDynamics(FG, cfg, 8, step, { bg: BG, pressure: 1 });
      const low = applyColorDynamics(FG, cfg, 8, step, { bg: BG, pressure: 0.1 });
      if (distToFg(low) <= distToFg(full)) lowCloserCount += 1;
    }
    // すべての step で低圧の方が前景に近い(または同等)はず。
    expect(lowCloserCount).toBe(30);
  });
});
