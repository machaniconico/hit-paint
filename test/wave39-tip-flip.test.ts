/**
 * Wave39 US-4102 — stampTip/stampScatteredTip の flipX(キラル tip の真の鏡映)。
 *
 * symmetry 鏡映コピーは従来「鏡映角度への回転」近似で、左右非対称(キラル)な
 * tip 形状は真の鏡像にならなかった。flipX は tip 空間の横方向反転を回転の
 * 「前」に適用する(順変換 = rotate(rotation) ∘ flipX ∘ scale)。
 *
 * 検証はすべて純粋配列(Float32Array)操作のみ(canvas/DOM 非依存)。
 */
import { describe, expect, it } from 'vitest';
import { stampTip } from '../src/engine/tip-stamp';
import type { TipAlpha } from '../src/engine/tip-stamp';
import { scatterOffsets, stampScatteredTip } from '../src/engine/tip-scatter';

/** 左上 1 画素のみ alpha=1 の 3x3 キラル(左右非対称) tip。 */
function makeChiralTip(): TipAlpha {
  const data = new Float32Array(9);
  data[0] = 1; // (0,0) = 左上のみ
  return { width: 3, height: 3, data };
}

/** 決定論的な値勾配を持つ 4x3 tip(回転・反転の合成検証用に完全非対称)。 */
function makeGradientTip(): TipAlpha {
  const width = 4;
  const height = 3;
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 1) {
    // 単調勾配 + 行依存項で全画素が異なる値(対称性なし)。
    data[i] = ((i * 7) % 11) / 11;
  }
  return { width, height, data };
}

/** coverage を中心縦軸(キャンバス幅の中央)で列反転した複製を返す。 */
function mirrorColumns(coverage: Float32Array, cw: number, ch: number): Float32Array {
  const out = new Float32Array(coverage.length);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      out[y * cw + x] = coverage[y * cw + (cw - 1 - x)];
    }
  }
  return out;
}

/** 2 つの Float32Array が全要素ビット一致するか検証する。 */
function expectFloat32Equal(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i += 1) {
    if (!Object.is(actual[i], expected[i])) {
      // 失敗位置を特定しやすいメッセージで fail させる。
      expect(`idx=${i} actual=${actual[i]}`).toBe(`idx=${i} expected=${expected[i]}`);
    }
  }
}

describe('stampTip flipX(US-4102)', () => {
  // 9x9 キャンバス中央 (4.5, 4.5) は画素境界に一致し、size=3(scale=1)なら
  // tip 画素中心が出力画素中心へ厳密に写る(bilinear 重みが 0/1 で厳密一致)。
  const cw = 9;
  const ch = 9;
  const center = { x: 4.5, y: 4.5, size: 3 };

  it('flipX=true は rotation=0 で coverage の左右反転(列反転)と厳密一致する', () => {
    const tip = makeChiralTip();
    const plain = new Float32Array(cw * ch);
    const flipped = new Float32Array(cw * ch);

    stampTip(plain, cw, ch, tip, { ...center });
    stampTip(flipped, cw, ch, tip, { ...center, flipX: true });

    // (1) キラル tip なので flip 前後で必ず差が出る(テスト自体の健全性確認)。
    const differs = flipped.some((v, i) => v !== plain[i]);
    expect(differs).toBe(true);

    // (2) flipX 結果 = 元結果の中心縦軸まわり列反転(画素単位の厳密一致)。
    expectFloat32Equal(flipped, mirrorColumns(plain, cw, ch));
  });

  it('flipX+rotation=θ は「flipXなし rotation=-θ」の左右反転と一致する(鏡映恒等式)', () => {
    // 鏡映の幾何恒等式: flipX∘rotate(-θ) = rotate(θ)∘flipX。
    // 鏡映軸がキャンバス中心縦軸(=スタンプ中心 x=4.5)に一致する配置なら、
    // 逆変換の演算列が項ごとに符号反転だけで対応し、ビット一致まで成立する。
    const tip = makeGradientTip();
    const theta = Math.PI / 5;

    const flippedRot = new Float32Array(cw * ch);
    const negRot = new Float32Array(cw * ch);

    stampTip(flippedRot, cw, ch, tip, { ...center, rotation: theta, flipX: true });
    stampTip(negRot, cw, ch, tip, { ...center, rotation: -theta });

    expectFloat32Equal(flippedRot, mirrorColumns(negRot, cw, ch));
  });

  it('flipX:false / 未指定は従来結果と完全一致する(後方互換)', () => {
    const tip = makeGradientTip();
    const theta = 0.7;

    // 従来呼び出し(flipX キー自体なし)を基準とする。
    const baseline = new Float32Array(cw * ch);
    stampTip(baseline, cw, ch, tip, { ...center, rotation: theta, flow: 0.8 });

    const withFalse = new Float32Array(cw * ch);
    stampTip(withFalse, cw, ch, tip, { ...center, rotation: theta, flow: 0.8, flipX: false });

    const withUndefined = new Float32Array(cw * ch);
    stampTip(withUndefined, cw, ch, tip, {
      ...center,
      rotation: theta,
      flow: 0.8,
      flipX: undefined,
    });

    expectFloat32Equal(withFalse, baseline);
    expectFloat32Equal(withUndefined, baseline);
  });
});

describe('stampScatteredTip flipX passthrough(US-4102)', () => {
  const cw = 48;
  const ch = 48;

  it('散布なしパス(scatter=0)では stampTip の flipX 単発スタンプと一致する', () => {
    const tip = makeChiralTip();
    const viaScattered = new Float32Array(cw * ch);
    const viaDirect = new Float32Array(cw * ch);

    stampScatteredTip(viaScattered, cw, ch, tip, {
      x: 24.5,
      y: 24.5,
      size: 6,
      scatter: 0,
      density: 1,
      flipX: true,
    });
    stampTip(viaDirect, cw, ch, tip, { x: 24.5, y: 24.5, size: 6, flipX: true });

    expectFloat32Equal(viaScattered, viaDirect);
  });

  it('散布パスで flipX が各散布点の stampTip へ渡る(同 seed/step で全打点が反転サンプル)', () => {
    const tip = makeChiralTip();
    const opts = { x: 24, y: 24, size: 6, scatter: 5, density: 4, seed: 42, step: 3 };

    const flipped = new Float32Array(cw * ch);
    stampScatteredTip(flipped, cw, ch, tip, { ...opts, flipX: true });

    const plain = new Float32Array(cw * ch);
    stampScatteredTip(plain, cw, ch, tip, { ...opts });

    // (1) キラル tip なので flipX 有無で散布結果が変わる。
    const differs = flipped.some((v, i) => v !== plain[i]);
    expect(differs).toBe(true);

    // (2) 各散布点が flipX 付き stampTip と同一であることを、stepSeed 合成式
    //     (tip-scatter.ts の実装と同一)+ scatterOffsets の再現で全点検証する。
    const stepSeed =
      (Math.imul(opts.seed | 0, 0x9e3779b9) ^ Math.imul((opts.step | 0) + 1, 0x85ebca6b)) | 0;
    const offsets = scatterOffsets(stepSeed, opts.density, opts.scatter);
    expect(offsets.length).toBe(opts.density);

    const manual = new Float32Array(cw * ch);
    for (const { dx, dy } of offsets) {
      stampTip(manual, cw, ch, tip, {
        x: opts.x + dx,
        y: opts.y + dy,
        size: opts.size,
        flipX: true,
      });
    }

    expectFloat32Equal(flipped, manual);
  });

  it('flipX 未指定の散布結果は従来(flipX:false)と完全一致する(後方互換)', () => {
    const tip = makeGradientTip();
    const opts = { x: 20, y: 28, size: 8, rotation: 0.3, scatter: 6, density: 5, seed: 7, step: 2 };

    const baseline = new Float32Array(cw * ch);
    stampScatteredTip(baseline, cw, ch, tip, { ...opts });

    const withFalse = new Float32Array(cw * ch);
    stampScatteredTip(withFalse, cw, ch, tip, { ...opts, flipX: false });

    expectFloat32Equal(withFalse, baseline);
  });
});
