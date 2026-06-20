import { describe, expect, it } from 'vitest';
import {
  EASINGS,
  easeLinear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInSine,
  easeOutSine,
  easeInOutSine,
  easeInBack,
  easeOutBack,
  easeInOutBack,
  lerp,
  lerpClamped,
  lerpPoint,
  tweenValue,
  tweenFrames,
} from '../src/anim/tween';
import type { Frame } from '../src/anim/timeline';
import type { Layer } from '../src/types';

/**
 * Wave40 US-4201 — イージング関数群 + 中割り tween の純粋ロジック検証。
 * jsdom では canvas 不可なので、すべて数値/配列レベルで検証する。
 */

/** opacity だけ指定した最小 Layer を作るヘルパ(他フィールドはダミー)。 */
function makeLayer(id: string, opacity: number): Layer {
  return {
    id,
    name: id,
    kind: 'raster',
    visible: true,
    opacity,
    blendMode: 'normal',
    locked: false,
    clipping: false,
  };
}

function makeFrame(id: string, layers: Layer[], durationMs: number): Frame {
  return { id, layers, durationMs };
}

describe('イージング関数 端点と性質', () => {
  const all = Object.entries(EASINGS);

  it('全 easing が f(0)≈0, f(1)≈1', () => {
    for (const [name, fn] of all) {
      expect(fn(0)).toBeCloseTo(0, 6);
      expect(fn(1)).toBeCloseTo(1, 6);
    }
  });

  it('EASINGS の登録数と linear', () => {
    expect(all.length).toBe(13);
    expect(EASINGS.linear).toBe(easeLinear);
    expect(easeLinear(0.37)).toBeCloseTo(0.37, 10);
  });

  it('InOut 系は t=0.5 で 0.5 (quad/cubic/sine)', () => {
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 10);
  });

  it('Out 系は対応する In 系の鏡像: easeOut(t) ≈ 1 - easeIn(1 - t)', () => {
    const pairs: Array<[(t: number) => number, (t: number) => number]> = [
      [easeInQuad, easeOutQuad],
      [easeInCubic, easeOutCubic],
      [easeInSine, easeOutSine],
      [easeInBack, easeOutBack],
    ];
    for (const [inFn, outFn] of pairs) {
      for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        expect(outFn(t)).toBeCloseTo(1 - inFn(1 - t), 9);
      }
    }
  });

  it('quad/cubic の単調増加と数値', () => {
    expect(easeInQuad(0.5)).toBeCloseTo(0.25, 10);
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 10);
    expect(easeOutQuad(0.5)).toBeCloseTo(0.75, 10);
  });

  it('back 系は端点で厳密 0/1 でオーバーシュートする', () => {
    expect(easeInBack(0)).toBeCloseTo(0, 10);
    expect(easeInBack(1)).toBeCloseTo(1, 10);
    // easeInBack は途中で負へアンダーシュートする
    expect(easeInBack(0.2)).toBeLessThan(0);
    // easeOutBack は途中で 1 を超える
    expect(easeOutBack(0.8)).toBeGreaterThan(1);
  });
});

describe('lerp / lerpClamped / lerpPoint', () => {
  it('lerp は外挿を許す', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(2, 6, 0.25)).toBe(3);
    expect(lerp(0, 10, 1.5)).toBe(15);
    expect(lerp(0, 10, -0.5)).toBe(-5);
  });

  it('lerpClamped は t を [0,1] にクランプ', () => {
    expect(lerpClamped(0, 10, 1.5)).toBe(10);
    expect(lerpClamped(0, 10, -0.5)).toBe(0);
    expect(lerpClamped(0, 10, 0.3)).toBeCloseTo(3, 10);
  });

  it('lerpPoint は x/y を独立補間', () => {
    const p = lerpPoint({ x: 0, y: 4 }, { x: 10, y: 0 }, 0.5);
    expect(p).toEqual({ x: 5, y: 2 });
  });
});

describe('tweenValue 中割り', () => {
  it('steps=3 で長さ3、linear で t=i/(steps+1) に一致・単調増加', () => {
    const out = tweenValue(0, 1, 3, 'linear');
    expect(out).toHaveLength(3);
    expect(out[0]).toBeCloseTo(0.25, 10);
    expect(out[1]).toBeCloseTo(0.5, 10);
    expect(out[2]).toBeCloseTo(0.75, 10);
    expect(out[0]).toBeLessThan(out[1]);
    expect(out[1]).toBeLessThan(out[2]);
  });

  it('端点 from/to は含まない(0 と 1 が出ない)', () => {
    const out = tweenValue(0, 1, 3, 'linear');
    expect(out).not.toContain(0);
    expect(out).not.toContain(1);
  });

  it('steps=0 で空配列・負も空', () => {
    expect(tweenValue(0, 1, 0)).toEqual([]);
    expect(tweenValue(0, 1, -2)).toEqual([]);
  });

  it('easing 関数を直接渡せる', () => {
    const out = tweenValue(0, 10, 1, easeInQuad);
    // 1 中割り → t=0.5, easeInQuad(0.5)=0.25 → 0..10 で 2.5
    expect(out).toHaveLength(1);
    expect(out[0]).toBeCloseTo(2.5, 10);
  });
});

describe('tweenFrames 中割りフレーム生成', () => {
  it('opacity 0→1 のレイヤー間に count=3 で 3 枚、linear 補間', () => {
    const a = makeFrame('a', [makeLayer('L1', 0)], 100);
    const b = makeFrame('b', [makeLayer('L1', 1)], 100);
    const out = tweenFrames(a, b, 3, 'linear');
    expect(out).toHaveLength(3);
    expect(out[0].layers[0].opacity).toBeCloseTo(0.25, 10);
    expect(out[1].layers[0].opacity).toBeCloseTo(0.5, 10);
    expect(out[2].layers[0].opacity).toBeCloseTo(0.75, 10);
    expect(out.map((f) => f.id)).toEqual(['tween_1', 'tween_2', 'tween_3']);
  });

  it('durationMs を線形補間', () => {
    const a = makeFrame('a', [makeLayer('L1', 0)], 100);
    const b = makeFrame('b', [makeLayer('L1', 1)], 200);
    const out = tweenFrames(a, b, 1, 'linear');
    // t=0.5 → 150
    expect(out[0].durationMs).toBeCloseTo(150, 10);
  });

  it('元フレーム・元レイヤーは不変で参照非共有', () => {
    const aLayer = makeLayer('L1', 0);
    const bLayer = makeLayer('L1', 1);
    const a = makeFrame('a', [aLayer], 100);
    const b = makeFrame('b', [bLayer], 100);
    const out = tweenFrames(a, b, 2, 'linear');
    // 元の opacity は変わらない
    expect(aLayer.opacity).toBe(0);
    expect(bLayer.opacity).toBe(1);
    // レイヤー参照が共有されていない
    expect(out[0].layers[0]).not.toBe(aLayer);
    expect(out[0].layers[0]).not.toBe(bLayer);
    // 中割りを書き換えても元に波及しない
    out[0].layers[0].opacity = 0.99;
    expect(aLayer.opacity).toBe(0);
  });

  it('レイヤー数不一致は a 側をフォールバック複製(対応無し)', () => {
    const a = makeFrame('a', [makeLayer('L1', 0.2), makeLayer('L2', 0.4)], 100);
    const b = makeFrame('b', [makeLayer('L1', 1)], 100); // L2 が無い
    const out = tweenFrames(a, b, 1, 'linear');
    expect(out[0].layers).toHaveLength(2);
    // L1 は補間される(t=0.5: 0.2→1 で 0.6)
    expect(out[0].layers[0].opacity).toBeCloseTo(0.6, 10);
    // L2 は対応が無いので a 側のまま
    expect(out[0].layers[1].opacity).toBeCloseTo(0.4, 10);
  });

  it('id 対応を index より優先(順序が違っても id で対応付け)', () => {
    const a = makeFrame('a', [makeLayer('L1', 0), makeLayer('L2', 0)], 100);
    // b は順序逆で L2 の opacity が高い
    const b = makeFrame('b', [makeLayer('L2', 1), makeLayer('L1', 0.5)], 100);
    const out = tweenFrames(a, b, 1, 'linear');
    // L1: 0→0.5, t=0.5 → 0.25
    expect(out[0].layers[0].opacity).toBeCloseTo(0.25, 10);
    // L2: 0→1, t=0.5 → 0.5
    expect(out[0].layers[1].opacity).toBeCloseTo(0.5, 10);
  });

  it('count=0 で空配列', () => {
    const a = makeFrame('a', [makeLayer('L1', 0)], 100);
    const b = makeFrame('b', [makeLayer('L1', 1)], 100);
    expect(tweenFrames(a, b, 0, 'linear')).toEqual([]);
  });
});
