/**
 * HIT Paint — filters のユニットテスト
 *
 * jsdom 環境; canvas は使用しない (純粋な配列操作のみ)
 */

import { describe, it, expect } from 'vitest';
import {
  adjustBrightnessContrast,
  adjustHueSaturation,
  adjustLevels,
  gaussianBlur,
  grayscale,
  invertColors,
  posterize,
  sepia,
  sharpen,
  threshold,
} from '../src/filters';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

describe('filters', () => {
  it('gaussianBlur は radius=0 のとき同一参照を変更せず返す', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      200, 210, 220, 230,
    ]);
    const original = Array.from(pixels);

    const result = gaussianBlur(pixels, 2, 1, { radius: 0 });

    expect(result).toBe(pixels);
    expect(Array.from(pixels)).toEqual(original);
  });

  it('gaussianBlur は水平・垂直の2パスで近傍色を混ぜる', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);

    gaussianBlur(pixels, 3, 1, { radius: 1 });

    expect(pixelAt(pixels, 0, 0, 3)[0]).toBeGreaterThan(0);
    expect(pixelAt(pixels, 1, 0, 3)[0]).toBeLessThan(255);
    expect(pixelAt(pixels, 0, 0, 3)[3]).toBe(255);
    expect(pixelAt(pixels, 1, 0, 3)[3]).toBe(255);
  });

  it('adjustBrightnessContrast は RGB のみ変更し alpha を保つ', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 123,
    ]);

    adjustBrightnessContrast(pixels, 1, 1, { brightness: 10, contrast: 0 });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([36, 46, 56, 123]);
  });

  it('invertColors は alpha を変更しない', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 77,
      200, 150, 100, 201,
    ]);

    invertColors(pixels, 2, 1);

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([245, 235, 225, 77]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([55, 105, 155, 201]);
  });

  it('invertColors は mask=0 の画素を不変にし中間 mask は効果をブレンドする', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      100, 100, 100, 50,
    ]);
    const mask = new Uint8ClampedArray([0, 128]);

    invertColors(pixels, 2, 1, {}, mask);

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([128, 128, 128, 50]);
  });

  it('grayscale は輝度を RGB に適用し alpha を変更しない', () => {
    const pixels = new Uint8ClampedArray([
      100, 150, 200, 64,
    ]);

    grayscale(pixels, 1, 1);

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([141, 141, 141, 64]);
  });

  it('adjustHueSaturation は hue を度数で回転する', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 222,
    ]);

    adjustHueSaturation(pixels, 1, 1, { hue: 120, saturation: 0 });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([0, 255, 0, 222]);
  });

  it('adjustLevels は標準レベル補正を RGB に適用し alpha を保つ', () => {
    const pixels = new Uint8ClampedArray([
      50, 125, 200, 99,
    ]);

    adjustLevels(pixels, 1, 1, {
      inBlack: 50,
      inWhite: 200,
      gamma: 1,
      outBlack: 0,
      outWhite: 255,
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([0, 128, 255, 99]);
  });

  it('sharpen は平坦領域を不変に保つ', () => {
    const pixels = new Uint8ClampedArray([
      50, 100, 150, 10,
      50, 100, 150, 20,
      50, 100, 150, 30,
      50, 100, 150, 40,
      50, 100, 150, 50,
      50, 100, 150, 60,
      50, 100, 150, 70,
      50, 100, 150, 80,
      50, 100, 150, 90,
    ]);
    const original = Array.from(pixels);

    sharpen(pixels, 3, 3, { amount: 2 });

    expect(Array.from(pixels)).toEqual(original);
  });

  it('threshold は輝度を level で二値化し alpha を保つ', () => {
    const pixels = new Uint8ClampedArray([
      20, 20, 20, 11,
      200, 200, 200, 22,
      255, 0, 0, 33,
    ]);

    threshold(pixels, 3, 1, { level: 128 });

    expect(pixelAt(pixels, 0, 0, 3)).toEqual([0, 0, 0, 11]);
    expect(pixelAt(pixels, 1, 0, 3)).toEqual([255, 255, 255, 22]);
    expect(pixelAt(pixels, 2, 0, 3)).toEqual([0, 0, 0, 33]);
  });

  it('posterize は指定された階調へ RGB を量子化する', () => {
    const pixels = new Uint8ClampedArray([
      10, 64, 100, 44,
      130, 190, 250, 55,
    ]);

    posterize(pixels, 2, 1, { levels: 3 });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([0, 128, 128, 44]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([128, 128, 255, 55]);
  });

  it('sepia は標準セピア行列を RGB に適用し alpha を保つ', () => {
    const pixels = new Uint8ClampedArray([
      100, 150, 200, 77,
    ]);

    sepia(pixels, 1, 1);

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([192, 171, 134, 77]);
  });

  it('追加フィルターは mask=0 の画素を変更しない', () => {
    const original = [
      20, 40, 60, 80,
      180, 160, 140, 120,
      90, 100, 110, 130,
    ];
    const mask = new Uint8ClampedArray([0, 0, 0]);

    const sharpenPixels = new Uint8ClampedArray(original);
    sharpen(sharpenPixels, 3, 1, { amount: 2 }, mask);
    expect(Array.from(sharpenPixels)).toEqual(original);

    const thresholdPixels = new Uint8ClampedArray(original);
    threshold(thresholdPixels, 3, 1, { level: 100 }, mask);
    expect(Array.from(thresholdPixels)).toEqual(original);

    const posterizePixels = new Uint8ClampedArray(original);
    posterize(posterizePixels, 3, 1, { levels: 2 }, mask);
    expect(Array.from(posterizePixels)).toEqual(original);

    const sepiaPixels = new Uint8ClampedArray(original);
    sepia(sepiaPixels, 3, 1, {}, mask);
    expect(Array.from(sepiaPixels)).toEqual(original);
  });
});
