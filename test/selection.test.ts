/**
 * HIT Paint — 選択・変形ツールのユニットテスト
 *
 * 純粋な配列ロジックのみを検証する。
 * getContext / toBlob / createImageBitmap は呼び出さない。
 */

import { describe, it, expect } from 'vitest';
import {
  selectAll,
  rectSelection,
  lassoSelection,
  invertSelection,
  isEmpty,
  growSelection,
  shrinkSelection,
  featherSelection,
  combineSelection,
} from '../src/tools/selection';
import { moveLayerPixels } from '../src/tools/transform';

function countSelected(mask: Uint8ClampedArray): number {
  return Array.from(mask).filter((v) => v > 0).length;
}

// ---------------------------------------------------------------------------
// selectAll
// ---------------------------------------------------------------------------

describe('selectAll', () => {
  it('全ピクセルが 255 になる', () => {
    const sel = selectAll(4, 4);
    expect(sel.mask.length).toBe(16);
    expect(sel.mask.every((v) => v === 255)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rectSelection
// ---------------------------------------------------------------------------

describe('rectSelection', () => {
  it('矩形内部が 255、外部が 0', () => {
    // 10×10 キャンバス、(2,2)-(5,5) の矩形
    const sel = rectSelection(10, 10, 2, 2, 5, 5);
    expect(sel.width).toBe(10);
    expect(sel.height).toBe(10);

    // (3,3) は矩形内 → 255
    expect(sel.mask[3 * 10 + 3]).toBe(255);

    // (8,8) は矩形外 → 0
    expect(sel.mask[8 * 10 + 8]).toBe(0);
  });

  it('座標が逆順でも正しく正規化される', () => {
    const sel1 = rectSelection(10, 10, 2, 2, 5, 5);
    const sel2 = rectSelection(10, 10, 5, 5, 2, 2);
    expect(Array.from(sel1.mask)).toEqual(Array.from(sel2.mask));
  });

  it('矩形の境界ピクセルが正しい', () => {
    // 左上 (2,2) は内側、(1,1) は外側
    const sel = rectSelection(10, 10, 2, 2, 5, 5);
    expect(sel.mask[2 * 10 + 2]).toBe(255); // 左上角（内側）
    expect(sel.mask[1 * 10 + 1]).toBe(0);   // 左上の一つ外
  });
});

// ---------------------------------------------------------------------------
// lassoSelection
// ---------------------------------------------------------------------------

describe('lassoSelection', () => {
  it('三角形の内部ピクセルが 255', () => {
    // (0,0)-(10,0)-(5,10) の三角形 on 12×12
    const sel = lassoSelection(12, 12, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ]);
    // 中心付近 (5,5) は三角形内部
    expect(sel.mask[5 * 12 + 5]).toBe(255);
  });

  it('三角形の外部ピクセルが 0', () => {
    const sel = lassoSelection(12, 12, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ]);
    // (11,11) は三角形外部
    expect(sel.mask[11 * 12 + 11]).toBe(0);
  });

  it('頂点が 2 点以下なら空の選択を返す', () => {
    const sel = lassoSelection(10, 10, [{ x: 0, y: 0 }, { x: 5, y: 5 }]);
    expect(isEmpty(sel)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// invertSelection
// ---------------------------------------------------------------------------

describe('invertSelection', () => {
  it('全選択を反転すると空になる', () => {
    const all = selectAll(4, 4);
    const inv = invertSelection(all);
    expect(inv.mask.every((v) => v === 0)).toBe(true);
  });

  it('反転後にさらに反転すると元に戻る', () => {
    const sel = rectSelection(8, 8, 2, 2, 6, 6);
    const double = invertSelection(invertSelection(sel));
    expect(Array.from(double.mask)).toEqual(Array.from(sel.mask));
  });
});

// ---------------------------------------------------------------------------
// 選択範囲の精製・合成
// ---------------------------------------------------------------------------

describe('selection refinement', () => {
  it('growSelection は 8 近傍で外周を増やす', () => {
    const sel = rectSelection(5, 5, 2, 2, 3, 3);
    const grown = growSelection(sel, 1);

    expect(countSelected(grown.mask)).toBe(9);
    expect(grown.mask[1 * 5 + 1]).toBe(255);
    expect(grown.mask[3 * 5 + 3]).toBe(255);
    expect(grown.mask[0]).toBe(0);
    expect(countSelected(sel.mask)).toBe(1);
  });

  it('shrinkSelection は境界を削って選択範囲を減らす', () => {
    const sel = selectAll(5, 5);
    const shrunk = shrinkSelection(sel, 1);

    expect(countSelected(shrunk.mask)).toBe(9);
    expect(shrunk.mask[2 * 5 + 2]).toBe(255);
    expect(shrunk.mask[0]).toBe(0);
    expect(countSelected(sel.mask)).toBe(25);
  });

  it('featherSelection は境界に中間値を作る', () => {
    const sel = rectSelection(5, 5, 2, 0, 5, 5);
    const feathered = featherSelection(sel, 1);

    const outsideBoundary = feathered.mask[2 * 5 + 1];
    const insideBoundary = feathered.mask[2 * 5 + 2];
    expect(outsideBoundary).toBeGreaterThan(0);
    expect(outsideBoundary).toBeLessThan(255);
    expect(insideBoundary).toBeGreaterThan(0);
    expect(insideBoundary).toBeLessThan(255);
    expect(Array.from(sel.mask)).toEqual(Array.from(rectSelection(5, 5, 2, 0, 5, 5).mask));
  });
});

describe('combineSelection', () => {
  it('replace は b の選択で置き換える', () => {
    const a = rectSelection(3, 1, 0, 0, 1, 1);
    const b = rectSelection(3, 1, 2, 0, 3, 1);

    const combined = combineSelection(a, b, 'replace');

    expect(Array.from(combined.mask)).toEqual([0, 0, 255]);
    expect(combined.mask).not.toBe(b.mask);
  });

  it('add は coverage の max を取る', () => {
    const a = rectSelection(3, 1, 0, 0, 2, 1);
    const b = rectSelection(3, 1, 1, 0, 3, 1);

    const combined = combineSelection(a, b, 'add');

    expect(Array.from(combined.mask)).toEqual([255, 255, 255]);
  });

  it('subtract は b の選択部分を a から取り除く', () => {
    const a = rectSelection(3, 1, 0, 0, 3, 1);
    const b = rectSelection(3, 1, 1, 0, 2, 1);

    const combined = combineSelection(a, b, 'subtract');

    expect(Array.from(combined.mask)).toEqual([255, 0, 255]);
  });

  it('intersect は coverage の min を取る', () => {
    const a = rectSelection(3, 1, 0, 0, 2, 1);
    const b = rectSelection(3, 1, 1, 0, 3, 1);

    const combined = combineSelection(a, b, 'intersect');

    expect(Array.from(combined.mask)).toEqual([0, 255, 0]);
  });

  it('サイズ不一致なら a と同じ内容の新しい選択を返す', () => {
    const a = rectSelection(3, 1, 0, 0, 2, 1);
    const b = selectAll(2, 1);

    const combined = combineSelection(a, b, 'add');

    expect(combined).not.toBe(a);
    expect(combined.width).toBe(a.width);
    expect(combined.height).toBe(a.height);
    expect(Array.from(combined.mask)).toEqual(Array.from(a.mask));
  });
});

// ---------------------------------------------------------------------------
// isEmpty
// ---------------------------------------------------------------------------

describe('isEmpty', () => {
  it('空マスクは isEmpty = true', () => {
    const sel = rectSelection(4, 4, 2, 2, 2, 2); // 縮退した矩形
    expect(isEmpty(sel)).toBe(true);
  });

  it('非空マスクは isEmpty = false', () => {
    const sel = selectAll(4, 4);
    expect(isEmpty(sel)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// moveLayerPixels
// ---------------------------------------------------------------------------

describe('moveLayerPixels', () => {
  it('既知の不透明ピクセルを (+2,+1) シフトして期待インデックスに現れる', () => {
    // 10×10 の透明バッファを用意
    const width = 10;
    const height = 10;
    const pixels = new Uint8ClampedArray(width * height * 4); // 全透明

    // (3,4) に赤の不透明ピクセルを置く
    const srcX = 3, srcY = 4;
    const srcIdx = (srcY * width + srcX) * 4;
    pixels[srcIdx] = 200;     // R
    pixels[srcIdx + 1] = 50;  // G
    pixels[srcIdx + 2] = 10;  // B
    pixels[srcIdx + 3] = 255; // A

    const out = moveLayerPixels(pixels, width, height, 2, 1);

    // 移動後の座標は (3+2, 4+1) = (5, 5)
    const dstX = 5, dstY = 5;
    const dstIdx = (dstY * width + dstX) * 4;
    expect(out[dstIdx]).toBe(200);
    expect(out[dstIdx + 1]).toBe(50);
    expect(out[dstIdx + 2]).toBe(10);
    expect(out[dstIdx + 3]).toBe(255);

    // 元の位置 (3,4) は透明になっている
    expect(out[srcIdx + 3]).toBe(0);
  });

  it('シフトで範囲外に出たピクセルは透明になる', () => {
    const width = 4, height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    // (0,0) に不透明ピクセル
    pixels[3] = 255;

    // 大きくシフトして完全に範囲外へ
    const out = moveLayerPixels(pixels, width, height, 10, 10);
    // 出力バッファは全透明
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('(0,0) シフトは恒等変換', () => {
    const width = 4, height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels[7] = 128; // 適当なピクセル
    const out = moveLayerPixels(pixels, width, height, 0, 0);
    expect(Array.from(out)).toEqual(Array.from(pixels));
  });
});
