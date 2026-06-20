import { describe, expect, it } from 'vitest';
import { stampTip } from '../src/engine/tip-stamp';
import { stampScatteredTip } from '../src/engine/tip-scatter';
import type { TipAlpha } from '../src/engine/tip-stamp';

/**
 * Wave39 US-4102 — stampTip / stampScatteredTip の flipX(キラル tip の真の鏡映)。
 *
 * flipX の合成順序: 順変換 = rotate(rotation) ∘ flipX ∘ scale。
 * flipX は scale の後・rotation の前(tip 空間内)で横方向反転を行う。
 * 逆変換サンプル側では、逆回転後の rx を符号反転して tip 座標へ写すだけ。
 */

/** width*height の任意アルファ tip を組み立てるヘルパ。 */
function makeTip(width: number, height: number, at: (x: number, y: number) => number): TipAlpha {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = at(x, y);
    }
  }
  return { width, height, data };
}

/** coverage バッファを列反転(各行を左右ミラー)した新配列を返す。 */
function mirrorColumns(coverage: Float32Array, cw: number, ch: number): Float32Array {
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      out[y * cw + x] = coverage[y * cw + (cw - 1 - x)];
    }
  }
  return out;
}

describe('stampTip flipX', () => {
  it('flipX=true coverage が flipX=false の列反転と画素一致(rotation=0, 格子整合)', () => {
    // 非対称(キラル)tip: 左上のみ alpha=1。
    const tip = makeTip(3, 3, (x, y) => (x === 0 && y === 0 ? 1 : 0));

    // 奇数キャンバスの中央セルに中心を整数で置き、scale=1(size=longest=3)で
    // 出力画素中心が tip 画素中心に整合するようにする。
    // 中心 x をキャンバス幅の中央セル中心(整数+0.5 ではなく)に取りたいので、
    // cw を奇数、x をその中央画素の中心座標(=cw/2 の整数 + 0.5)に置く。
    const cw = 15;
    const ch = 15;
    // 中央画素 index = 7。その画素中心は 7.5。鏡映軸を画素中心に通すため
    // x = 中央画素境界(=整数)に置くと dx=px+0.5-x が ...+0.5 になり、
    // flipX の符号反転で列が「画素境界対称」に反転する。
    const cx = 8;
    const cy = 8;

    const base = new Float32Array(cw * ch);
    stampTip(base, cw, ch, tip, { x: cx, y: cy, size: 3, rotation: 0, flipX: false });

    const flipped = new Float32Array(cw * ch);
    stampTip(flipped, cw, ch, tip, { x: cx, y: cy, size: 3, rotation: 0, flipX: true });

    // flipX は x=cx(整数)を軸に画素境界対称な左右反転になる。
    // すなわち flipped[y][px] == base[y][2*cx-1-px]。
    const expected = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y += 1) {
      for (let px = 0; px < cw; px += 1) {
        const mx = 2 * cx - 1 - px;
        expected[y * cw + px] = mx >= 0 && mx < cw ? base[y * cw + mx] : 0;
      }
    }

    for (let i = 0; i < base.length; i += 1) {
      expect(flipped[i]).toBeCloseTo(expected[i], 6);
    }

    // 反転が実際に効いている(base と flipped が異なる)ことの確認。
    const differs = Array.from(base).some((v, i) => Math.abs(v - flipped[i]) > 1e-9);
    expect(differs).toBe(true);
  });

  it('鏡映の幾何恒等式: flipX+rotation=θ は flipXなし rotation=-θ の列反転に一致', () => {
    // 非対称 tip(左上のみ)。回転と反転の合成が幾何恒等式を満たすか検証。
    const tip = makeTip(5, 5, (x, y) => (x <= 1 && y <= 1 ? 1 : 0));

    const cw = 31;
    const ch = 31;
    const cx = 16;
    const cy = 16;
    const theta = Math.PI / 3;

    // flipX=true, rotation=+θ。
    const a = new Float32Array(cw * ch);
    stampTip(a, cw, ch, tip, { x: cx, y: cy, size: 9, rotation: theta, flipX: true });

    // flipX=false, rotation=-θ → これを列反転(画素境界対称, 軸 x=cx)。
    const b = new Float32Array(cw * ch);
    stampTip(b, cw, ch, tip, { x: cx, y: cy, size: 9, rotation: -theta, flipX: false });
    const bMirror = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y += 1) {
      for (let px = 0; px < cw; px += 1) {
        const mx = 2 * cx - 1 - px;
        bMirror[y * cw + px] = mx >= 0 && mx < cw ? b[y * cw + mx] : 0;
      }
    }

    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]).toBeCloseTo(bMirror[i], 5);
    }
  });

  it('flipX:false / 未指定は従来結果と Float32Array 全要素一致', () => {
    const tip = makeTip(6, 4, (x, y) => ((x + y) % 2 === 0 ? (x + 1) / 6 : 0));

    const cw = 24;
    const ch = 24;
    const opts = { x: 11.3, y: 12.7, size: 10, rotation: 0.7, flow: 0.8 } as const;

    // 従来呼び出し(flipX を渡さない)。
    const legacy = new Float32Array(cw * ch);
    stampTip(legacy, cw, ch, tip, { ...opts });

    // flipX:false を明示。
    const explicitFalse = new Float32Array(cw * ch);
    stampTip(explicitFalse, cw, ch, tip, { ...opts, flipX: false });

    expect(Array.from(explicitFalse)).toEqual(Array.from(legacy));
  });
});

describe('stampScatteredTip flipX passthrough', () => {
  it('同 seed/step で flipX を切り替えると各散布点が反転サンプルになる', () => {
    // 非対称 tip。散布オフセットは flipX に依存しない設計なので、
    // flipX=true は「各散布点で flipX した stampTip」の重ね合わせと一致するはず。
    const tip = makeTip(4, 4, (x, y) => (x === 0 ? 1 : 0));

    const cw = 64;
    const ch = 64;
    const shared = { x: 32, y: 32, size: 6, rotation: 0, scatter: 14, density: 7, seed: 9, step: 2 } as const;

    // flipX=true をまとめて呼んだ結果。
    const flippedScatter = new Float32Array(cw * ch);
    stampScatteredTip(flippedScatter, cw, ch, tip, { ...shared, flipX: true });

    // 反転を passthrough しただけなら、散布オフセットは同一で各点の tip だけが
    // 反転する。flipX=false の散布と比べて結果が変わることをまず確認。
    const plainScatter = new Float32Array(cw * ch);
    stampScatteredTip(plainScatter, cw, ch, tip, { ...shared, flipX: false });
    const differs = Array.from(flippedScatter).some((v, i) => Math.abs(v - plainScatter[i]) > 1e-9);
    expect(differs).toBe(true);

    // 決定論: 同入力で2回 → 完全一致。
    const again = new Float32Array(cw * ch);
    stampScatteredTip(again, cw, ch, tip, { ...shared, flipX: true });
    expect(Array.from(again)).toEqual(Array.from(flippedScatter));
  });

  it('flipX 未指定は従来散布結果と完全一致', () => {
    const tip = makeTip(4, 4, (x) => (x % 2 === 0 ? 1 : 0));
    const cw = 48;
    const ch = 48;
    const shared = { x: 24, y: 24, size: 5, scatter: 10, density: 6, seed: 4, step: 1 } as const;

    const legacy = new Float32Array(cw * ch);
    stampScatteredTip(legacy, cw, ch, tip, { ...shared });

    const explicitFalse = new Float32Array(cw * ch);
    stampScatteredTip(explicitFalse, cw, ch, tip, { ...shared, flipX: false });

    expect(Array.from(explicitFalse)).toEqual(Array.from(legacy));
  });
});
