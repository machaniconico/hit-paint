import { describe, expect, it } from 'vitest';
import { stampStroke, tipStampAngle } from '../src/engine/stroke-stamp';
import { stampTip, type TipAlpha } from '../src/engine/tip-stamp';
import type { PointerSample } from '../src/types';

/** 全画素 1.0 の矩形 tip。最長辺=size でスケールされる。 */
function solidTip(width: number, height: number): TipAlpha {
  return { width, height, data: new Float32Array(width * height).fill(1) };
}

function sample(x: number, y: number, pressure = 1): PointerSample {
  return { x, y, pressure, t: 0 };
}

/** v>0 の画素の bbox を { w, h } で返す。立っていなければ 0。 */
function litBBox(cov: Float32Array, cw: number, ch: number): { w: number; h: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      if (cov[y * cw + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return { w: 0, h: 0 };
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

describe('tipStampAngle — 方向追従回転 + 角度ジッタ (US-3901)', () => {
  it('(1) followStroke:true + segmentAngle=π/2 + baseAngle=0 → ≈π/2', () => {
    const angle = tipStampAngle({
      followStroke: true,
      segmentAngle: Math.PI / 2,
      baseAngle: 0,
    });
    expect(angle).toBeCloseTo(Math.PI / 2, 10);
  });

  it('(2) followStroke:false なら segmentAngle を無視し baseAngle のみ', () => {
    const angle = tipStampAngle({
      followStroke: false,
      segmentAngle: Math.PI / 2,
      baseAngle: 0.25,
    });
    expect(angle).toBeCloseTo(0.25, 10);

    // followStroke 未指定でも segmentAngle は無視される。
    const angle2 = tipStampAngle({ segmentAngle: Math.PI / 2 });
    expect(angle2).toBeCloseTo(0, 10);
  });

  it('(3) baseAngle 加算が効く(followStroke + baseAngle)', () => {
    const angle = tipStampAngle({
      followStroke: true,
      segmentAngle: Math.PI / 4,
      baseAngle: 0.1,
    });
    expect(angle).toBeCloseTo(Math.PI / 4 + 0.1, 10);
  });

  it('(4) angleJitter は seed+step で決定論的、範囲 [-jitter, +jitter] 内', () => {
    const jitter = 0.5;

    // 同 seed+step → 必ず同値。
    const a1 = tipStampAngle({ angleJitter: jitter, seed: 7, step: 3 });
    const a2 = tipStampAngle({ angleJitter: jitter, seed: 7, step: 3 });
    expect(a1).toBe(a2);

    // step を変えると(一般に)変わる。
    const b = tipStampAngle({ angleJitter: jitter, seed: 7, step: 4 });
    expect(b).not.toBe(a1);

    // seed を変えても(一般に)変わる。
    const c = tipStampAngle({ angleJitter: jitter, seed: 8, step: 3 });
    expect(c).not.toBe(a1);

    // 複数 step で範囲 [-jitter, +jitter] を逸脱しない。
    for (let step = 0; step < 64; step += 1) {
      const v = tipStampAngle({ angleJitter: jitter, seed: 7, step });
      expect(Math.abs(v)).toBeLessThanOrEqual(jitter);
    }
  });

  it('(5) angleJitter=0 ならジッタ無し(seed/step に依存しない)', () => {
    const base = 0.3;
    for (let step = 0; step < 8; step += 1) {
      const v = tipStampAngle({ baseAngle: base, angleJitter: 0, seed: 99, step });
      expect(v).toBeCloseTo(base, 10);
    }
  });
});

describe('stampStroke — 方向追従回転の統合 (US-3901)', () => {
  it('(6a) 回帰: 新オプション未指定なら Wave36 と同じ coverage(rotation のみ)', () => {
    const cw = 160;
    const ch = 40;
    const tip = solidTip(4, 4);
    const size = 4;
    const spacing = 1; // step = spacing*size = 4
    const rotation = 0.3;
    const L = 80;
    const samples = [sample(20, 20), sample(20 + L, 20)];

    // stampStroke(新オプション一切なし)。
    const cov = new Float32Array(cw * ch);
    stampStroke(cov, cw, ch, tip, samples, {
      size,
      spacing,
      rotation,
      pressureSize: null,
      pressureFlow: null,
    });

    // Wave36 相当の期待結果: 同じ歩進で stampTip を直接連打(rotation 固定)。
    const expected = new Float32Array(cw * ch);
    const step = Math.max(0.5, spacing * size);
    for (let traveled = 0; traveled <= L; traveled += step) {
      stampTip(expected, cw, ch, tip, { x: 20 + traveled, y: 20, size, rotation, flow: 1 });
    }

    expect(cov).toEqual(expected);
  });

  it('(6b) followStroke:true で非対称 tip の回転が実際に効く(方向で分布が変わる)', () => {
    const cw = 60;
    const ch = 60;
    // 横長の非対称 tip(8x2)。最長辺=size=8 → 回転 0 なら横長、π/2 なら縦長になる。
    const tip = solidTip(8, 2);
    const size = 8;
    const spacing = 2; // step = 16 → 短いストロークでは始点 1 スタンプのみ

    // 垂直ストローク(進行方向 = π/2)。
    const samples = [sample(30, 24), sample(30, 36)];

    // followStroke なし → tip は横長のまま。
    const covOff = new Float32Array(cw * ch);
    stampStroke(covOff, cw, ch, tip, samples, {
      size,
      spacing,
      pressureSize: null,
      pressureFlow: null,
    });
    const boxOff = litBBox(covOff, cw, ch);

    // followStroke あり → tip が進行方向(π/2)へ回転し縦長になる。
    const covOn = new Float32Array(cw * ch);
    stampStroke(covOn, cw, ch, tip, samples, {
      size,
      spacing,
      followStroke: true,
      pressureSize: null,
      pressureFlow: null,
    });
    const boxOn = litBBox(covOn, cw, ch);

    // 回転なしは「幅 > 高さ」、方向追従は「高さ > 幅」。
    expect(boxOff.w).toBeGreaterThan(boxOff.h);
    expect(boxOn.h).toBeGreaterThan(boxOn.w);
    // coverage 自体も異なる。
    expect(covOn).not.toEqual(covOff);
  });
});
