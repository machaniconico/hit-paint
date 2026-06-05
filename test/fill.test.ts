/**
 * HIT Paint — fill.ts のユニットテスト
 * jsdom 環境; canvas は使用しない (純粋な配列操作のみ)
 */

import { describe, it, expect } from 'vitest';
import { floodFill, fillRegion } from '../src/tools/fill';
import type { RGBA } from '../src/types';

// ---------------------------------------------------------------------------
// テストヘルパー
// ---------------------------------------------------------------------------

/** w×h の全透明バッファを生成する */
function transparentBuffer(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h * 4); // 全要素 0
}

/** flat pixel index から RGBA を取得する */
function getPixel(pixels: Uint8ClampedArray, x: number, y: number, w: number): RGBA {
  const i = (y * w + x) * 4;
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
}

const RED: RGBA   = { r: 255, g: 0,   b: 0,   a: 255 };
const GREEN: RGBA = { r: 0,   g: 255, b: 0,   a: 255 };
const BLUE: RGBA  = { r: 0,   g: 0,   b: 255, a: 255 };
const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

// ---------------------------------------------------------------------------
// floodFill テスト
// ---------------------------------------------------------------------------

describe('floodFill', () => {
  it('8×8 の全透明バッファを (4,4) から赤で塗りつぶす (tolerance=0)', () => {
    const W = 8, H = 8;
    const pixels = transparentBuffer(W, H);
    const changed = floodFill(pixels, W, H, 4, 4, RED, 0);

    expect(changed).toBe(true);

    // 全 64 ピクセルが赤になっていること
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = getPixel(pixels, x, y, W);
        expect(p).toEqual(RED);
      }
    }
  });

  it('左半分が青、右半分が透明のバッファで境界を越えないこと (tolerance=0)', () => {
    const W = 8, H = 4;
    const pixels = transparentBuffer(W, H);

    // 左半分 (x=0..3) を青で塗る
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W / 2; x++) {
        const i = (y * W + x) * 4;
        pixels[i]     = BLUE.r;
        pixels[i + 1] = BLUE.g;
        pixels[i + 2] = BLUE.b;
        pixels[i + 3] = BLUE.a;
      }
    }

    // 右半分 (x=4) から赤で塗りつぶす — 透明領域のみに広がるはず
    const changed = floodFill(pixels, W, H, 4, 0, RED, 0);
    expect(changed).toBe(true);

    // 右半分はすべて赤
    for (let y = 0; y < H; y++) {
      for (let x = W / 2; x < W; x++) {
        expect(getPixel(pixels, x, y, W)).toEqual(RED);
      }
    }

    // 左半分は青のまま (赤に変わっていない)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W / 2; x++) {
        expect(getPixel(pixels, x, y, W)).toEqual(BLUE);
      }
    }
  });

  it('範囲外の座標を指定した場合は false を返す', () => {
    const pixels = transparentBuffer(4, 4);
    expect(floodFill(pixels, 4, 4, -1, 0, RED, 0)).toBe(false);
    expect(floodFill(pixels, 4, 4, 4,  0, RED, 0)).toBe(false);
    expect(floodFill(pixels, 4, 4, 0, -1, RED, 0)).toBe(false);
    expect(floodFill(pixels, 4, 4, 0,  4, RED, 0)).toBe(false);
  });

  it('シード色と塗り色が同じで tolerance=0 のとき false を返す (変更なし)', () => {
    const pixels = transparentBuffer(4, 4);
    // シードは透明 (0,0,0,0) と同じ色で塗ろうとする
    const result = floodFill(pixels, 4, 4, 0, 0, TRANSPARENT, 0);
    expect(result).toBe(false);
  });

  it('tolerance > 0 で近似色を塗りつぶす', () => {
    const W = 4, H = 1;
    const pixels = new Uint8ClampedArray([
      // (0,0) seed: r=200
      200, 0, 0, 255,
      // (1,0) r=210 — 差10, tolerance=20 なので含まれる
      210, 0, 0, 255,
      // (2,0) r=230 — 差30, tolerance=20 を超えるため含まれない
      230, 0, 0, 255,
      // (3,0) — 届かない
      230, 0, 0, 255,
    ]);

    floodFill(pixels, W, H, 0, 0, GREEN, 20);

    expect(getPixel(pixels, 0, 0, W)).toEqual(GREEN); // seed
    expect(getPixel(pixels, 1, 0, W)).toEqual(GREEN); // 差10 ≤ 20
    // (2,0) は差30 > 20 なので変わらない
    expect(getPixel(pixels, 2, 0, W)).toEqual({ r: 230, g: 0, b: 0, a: 255 });
  });

  it('選択マスクが指定された場合、mask=0 の領域は塗りつぶさない', () => {
    const W = 4, H = 1;
    const pixels = transparentBuffer(W, H);
    // mask: (0) と (2) だけ選択
    const mask = new Uint8ClampedArray([255, 0, 255, 0]);

    floodFill(pixels, W, H, 0, 0, RED, 0, mask);

    expect(getPixel(pixels, 0, 0, W)).toEqual(RED);       // 選択内 → 塗られる
    expect(getPixel(pixels, 1, 0, W)).toEqual(TRANSPARENT); // 選択外 → 変わらない
    // (2,0) はシードと同じ透明色だが連続していないため到達しない (mask=255 でも (1) が壁)
    expect(getPixel(pixels, 2, 0, W)).toEqual(TRANSPARENT);
  });
});

// ---------------------------------------------------------------------------
// fillRegion テスト
// ---------------------------------------------------------------------------

describe('fillRegion', () => {
  it('全バッファを塗りつぶす (selection なし)', () => {
    const W = 4, H = 4;
    const pixels = transparentBuffer(W, H);
    fillRegion(pixels, W, H, BLUE);

    for (let i = 0; i < W * H; i++) {
      const p = getPixel(pixels, i % W, Math.floor(i / W), W);
      expect(p).toEqual(BLUE);
    }
  });

  it('選択マスクの範囲のみ塗りつぶす', () => {
    const W = 4, H = 1;
    const pixels = transparentBuffer(W, H);
    const mask = new Uint8ClampedArray([255, 0, 255, 0]);

    fillRegion(pixels, W, H, RED, mask);

    expect(getPixel(pixels, 0, 0, W)).toEqual(RED);
    expect(getPixel(pixels, 1, 0, W)).toEqual(TRANSPARENT);
    expect(getPixel(pixels, 2, 0, W)).toEqual(RED);
    expect(getPixel(pixels, 3, 0, W)).toEqual(TRANSPARENT);
  });
});
