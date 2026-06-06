import { describe, expect, it } from 'vitest';
import { bevelEmboss, dropShadow, innerShadow, outerGlow, strokeOutline } from '../src/core/layer-effects';
import type { RGBA } from '../src/types';

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const SEMI_RED: RGBA = { r: 255, g: 0, b: 0, a: 180 };
const GRAY: RGBA = { r: 120, g: 120, b: 120, a: 255 };

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function brightness(pixel: number[]): number {
  return pixel[0] + pixel[1] + pixel[2];
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

function paintTransparentRgb(px: Uint8ClampedArray): Uint8ClampedArray {
  px[0] = 17;
  px[1] = 29;
  px[2] = 43;
  px[3] = 0;
  return px;
}

describe('wave23 layer effects', () => {
  it('既存の layer effects exports を維持する', () => {
    expect(typeof dropShadow).toBe('function');
    expect(typeof strokeOutline).toBe('function');
    expect(typeof outerGlow).toBe('function');
  });

  it('innerShadow はソース形状外の透明画素を変更しない', () => {
    const source = paintTransparentRgb(filledRect(5, 5, 1, 1, 3, 3, RED));

    const result = innerShadow(source, 5, 5, { dx: 1, dy: 0, blur: 1, color: BLACK, opacity: 1 });

    expect(pixelAt(result, 0, 0, 5)).toEqual([17, 29, 43, 0]);
    expect(pixelAt(result, 4, 4, 5)[3]).toBe(0);
  });

  it('innerShadow は形状内のエッジを内側より濃くする', () => {
    const source = filledRect(7, 5, 1, 1, 5, 3, SEMI_RED);

    const result = innerShadow(source, 7, 5, { dx: 1, dy: 0, blur: 1, color: [0, 0, 0], opacity: 1 });
    const edge = pixelAt(result, 1, 2, 7);
    const interior = pixelAt(result, 3, 2, 7);

    expect(edge[0]).toBeLessThan(interior[0]);
    expect(edge[3]).toBeGreaterThan(interior[3]);
  });

  it('innerShadow は全透明入力を全透明出力にする', () => {
    const source = new Uint8ClampedArray(4 * 4 * 4);

    const result = innerShadow(source, 4, 4, { dx: 1, dy: 1, blur: 1, color: BLACK, opacity: 1 });

    for (let i = 3; i < result.length; i += 4) {
      expect(result[i]).toBe(0);
    }
  });

  it('innerShadow は入力バッファを変更しない', () => {
    const source = filledRect(5, 5, 1, 1, 3, 3, RED);
    const original = Array.from(source);

    innerShadow(source, 5, 5, { dx: 1, dy: 0, blur: 1, color: BLACK, opacity: 0.5 });

    expect(Array.from(source)).toEqual(original);
  });

  it('innerShadow は opacity=0 で入力とバイト同一の新バッファを返す', () => {
    const source = paintTransparentRgb(filledRect(5, 5, 1, 1, 3, 3, RED));

    const result = innerShadow(source, 5, 5, { dx: 1, dy: 0, blur: 1, color: { r: 0, g: 0, b: 0 }, opacity: 0 });

    expect(Array.from(result)).toEqual(Array.from(source));
    expect(result).not.toBe(source);
  });

  it('bevelEmboss は angle 0 の勾配側をソースより明るくする', () => {
    const source = filledRect(7, 5, 1, 1, 5, 3, GRAY);

    const result = bevelEmboss(source, 7, 5, { depth: 4, blur: 1, angle: 0, opacity: 1 });

    expect(brightness(pixelAt(result, 1, 2, 7))).toBeGreaterThan(brightness(pixelAt(source, 1, 2, 7)));
  });

  it('bevelEmboss は angle 0 の反対側をソースより暗くする', () => {
    const source = filledRect(7, 5, 1, 1, 5, 3, GRAY);

    const result = bevelEmboss(source, 7, 5, { depth: 4, blur: 1, angle: 0, opacity: 1 });

    expect(brightness(pixelAt(result, 5, 2, 7))).toBeLessThan(brightness(pixelAt(source, 5, 2, 7)));
  });

  it('bevelEmboss はソース形状外の透明画素を変更しない', () => {
    const source = paintTransparentRgb(filledRect(5, 5, 1, 1, 3, 3, GRAY));

    const result = bevelEmboss(source, 5, 5, { depth: 4, blur: 1, angle: 0, opacity: 1 });

    expect(pixelAt(result, 0, 0, 5)).toEqual([17, 29, 43, 0]);
    expect(pixelAt(result, 4, 4, 5)[3]).toBe(0);
  });

  it('bevelEmboss は全透明入力を全透明出力にする', () => {
    const source = paintTransparentRgb(new Uint8ClampedArray(4 * 4 * 4));

    const result = bevelEmboss(source, 4, 4, { depth: 4, blur: 1, angle: 0, opacity: 1 });

    for (let i = 3; i < result.length; i += 4) {
      expect(result[i]).toBe(0);
    }
  });

  it('bevelEmboss は入力バッファを変更しない', () => {
    const source = filledRect(5, 5, 1, 1, 3, 3, GRAY);
    const original = Array.from(source);

    bevelEmboss(source, 5, 5, { depth: 4, blur: 1, angle: 0, opacity: 0.5 });

    expect(Array.from(source)).toEqual(original);
  });

  it('bevelEmboss は opacity=0 で入力とバイト同一の新バッファを返す', () => {
    const source = paintTransparentRgb(filledRect(5, 5, 1, 1, 3, 3, GRAY));

    const result = bevelEmboss(source, 5, 5, { depth: 4, blur: 1, angle: 0, opacity: 0 });

    expect(Array.from(result)).toEqual(Array.from(source));
    expect(result).not.toBe(source);
  });
});
