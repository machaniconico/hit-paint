import { describe, expect, it } from 'vitest';
import { dropShadow, outerGlow, strokeOutline } from '../src/core/layer-effects';
import type { RGBA } from '../src/types';

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function filledRect(w: number, h: number, x0: number, y0: number, rw: number, rh: number, color: RGBA): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const i = (y * w + x) * 4;
      px[i] = color.r;
      px[i + 1] = color.g;
      px[i + 2] = color.b;
      px[i + 3] = color.a;
    }
  }
  return px;
}

describe('layer effects', () => {
  it('dropShadow は透明背景の不透明四角から右下に影画素を生成する', () => {
    const source = filledRect(5, 5, 1, 1, 2, 2, RED);

    const result = dropShadow(source, 5, 5, { dx: 1, dy: 1, blur: 0, color: BLACK, opacity: 1 });

    expect(pixelAt(result, 3, 3, 5)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(result, 1, 1, 5)).toEqual([255, 0, 0, 255]);
  });

  it('strokeOutline は輪郭の外側に指定色を追加し元の塗りを保つ', () => {
    const source = filledRect(5, 5, 2, 2, 1, 1, RED);

    const result = strokeOutline(source, 5, 5, { size: 1, color: BLUE, position: 'outside' });

    expect(pixelAt(result, 1, 2, 5)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(result, 2, 2, 5)).toEqual([255, 0, 0, 255]);
  });

  it('outerGlow は縁の外側へぼかした発光を追加する', () => {
    const source = filledRect(5, 5, 2, 2, 1, 1, RED);

    const result = outerGlow(source, 5, 5, { blur: 1, color: GREEN, opacity: 1 });

    expect(pixelAt(result, 1, 2, 5)[1]).toBeGreaterThan(0);
    expect(pixelAt(result, 1, 2, 5)[3]).toBeGreaterThan(0);
    expect(pixelAt(result, 2, 2, 5)).toEqual([255, 0, 0, 255]);
  });

  it('opacity=0 の効果はソース同等の新バッファを返す', () => {
    const source = filledRect(4, 4, 1, 1, 1, 1, RED);

    const shadow = dropShadow(source, 4, 4, { dx: 1, dy: 1, blur: 1, color: BLACK, opacity: 0 });
    const glow = outerGlow(source, 4, 4, { blur: 1, color: GREEN, opacity: 0 });

    expect(Array.from(shadow)).toEqual(Array.from(source));
    expect(Array.from(glow)).toEqual(Array.from(source));
    expect(shadow).not.toBe(source);
    expect(glow).not.toBe(source);
  });

  it('opacity=0 は透明画素が非0のRGBを持っていてもバイト同一を保つ', () => {
    // 透明(alpha=0)だが RGB が残っている画素を含むソース。効果が無いなら元のバイトを保持すべき。
    const source = filledRect(4, 4, 1, 1, 1, 1, RED);
    source[0] = 10; // (0,0) を [10,20,30,0] の透明画素にする
    source[1] = 20;
    source[2] = 30;
    source[3] = 0;

    const shadow = dropShadow(source, 4, 4, { dx: 1, dy: 1, blur: 1, color: BLACK, opacity: 0 });
    const glow = outerGlow(source, 4, 4, { blur: 1, color: GREEN, opacity: 0 });

    expect(Array.from(shadow)).toEqual(Array.from(source));
    expect(Array.from(glow)).toEqual(Array.from(source));
  });

  it('全透明入力は全透明出力になる', () => {
    const source = new Uint8ClampedArray(4 * 4 * 4);

    const shadow = dropShadow(source, 4, 4, { dx: 1, dy: 1, blur: 1, color: BLACK, opacity: 1 });
    const stroke = strokeOutline(source, 4, 4, { size: 1, color: BLUE });
    const glow = outerGlow(source, 4, 4, { blur: 1, color: GREEN, opacity: 1 });

    expect(Array.from(shadow)).toEqual(Array.from(source));
    expect(Array.from(stroke)).toEqual(Array.from(source));
    expect(Array.from(glow)).toEqual(Array.from(source));
  });

  it('元バッファを変更しない', () => {
    const source = filledRect(4, 4, 1, 1, 1, 1, RED);
    const original = Array.from(source);

    dropShadow(source, 4, 4, { dx: 1, dy: 1, blur: 1, color: BLACK, opacity: 0.5 });
    strokeOutline(source, 4, 4, { size: 1, color: BLUE });
    outerGlow(source, 4, 4, { blur: 1, color: GREEN, opacity: 0.5 });

    expect(Array.from(source)).toEqual(original);
  });
});
