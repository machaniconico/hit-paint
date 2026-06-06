import { describe, expect, it } from 'vitest';
import { adjustGamma, equalizeHistogram } from '../src/filters/tone';

function px(pixels: Uint8ClampedArray, index: number): number[] {
  const i = index * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function lumaValues(pixels: Uint8ClampedArray): number[] {
  const values: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    values.push(Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]));
  }
  return values;
}

function range(values: number[]): { min: number; max: number } {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

describe('tone filters', () => {
  it('equalizeHistogram は低コントラスト画像の明度レンジを広げる', () => {
    const pixels = new Uint8ClampedArray([
      96, 96, 96, 255,
      104, 104, 104, 255,
      112, 112, 112, 255,
      120, 120, 120, 255,
    ]);
    const before = range(lumaValues(pixels));

    equalizeHistogram(pixels, 4, 1);

    const after = range(lumaValues(pixels));
    expect(after.max - after.min).toBeGreaterThan(before.max - before.min);
    expect(after).toEqual({ min: 0, max: 255 });
  });

  it('equalizeHistogram はアルファを変更しない', () => {
    const pixels = new Uint8ClampedArray([
      40, 40, 40, 0,
      80, 80, 80, 17,
      120, 120, 120, 128,
      160, 160, 160, 255,
    ]);

    equalizeHistogram(pixels, 4, 1);

    expect(px(pixels, 0)[3]).toBe(0);
    expect(px(pixels, 1)[3]).toBe(17);
    expect(px(pixels, 2)[3]).toBe(128);
    expect(px(pixels, 3)[3]).toBe(255);
  });

  it('adjustGamma は gamma=1 で不変', () => {
    const pixels = new Uint8ClampedArray([
      12, 34, 56, 78,
      90, 123, 200, 255,
    ]);
    const before = Array.from(pixels);

    adjustGamma(pixels, 2, 1, { gamma: 1 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('adjustGamma は gamma>1 で中間調を明るくしアルファを変更しない', () => {
    const pixels = new Uint8ClampedArray([
      64, 128, 192, 99,
    ]);

    adjustGamma(pixels, 1, 1, { gamma: 2 });

    expect(px(pixels, 0)).toEqual([128, 181, 221, 99]);
  });

  it('mask=0 は equalizeHistogram と adjustGamma の画素を変更しない', () => {
    const original = new Uint8ClampedArray([
      32, 48, 64, 255,
      96, 112, 128, 255,
      160, 176, 192, 255,
    ]);
    const mask = new Uint8ClampedArray([0, 0, 0]);
    const equalized = new Uint8ClampedArray(original);
    const gammaAdjusted = new Uint8ClampedArray(original);

    equalizeHistogram(equalized, 3, 1, mask);
    adjustGamma(gammaAdjusted, 3, 1, { gamma: 2 }, mask);

    expect(Array.from(equalized)).toEqual(Array.from(original));
    expect(Array.from(gammaAdjusted)).toEqual(Array.from(original));
  });

  it('mask の被覆率で gamma 補正結果をブレンドする', () => {
    const pixels = new Uint8ClampedArray([
      64, 64, 64, 255,
      64, 64, 64, 255,
    ]);
    const mask = new Uint8ClampedArray([128, 255]);

    adjustGamma(pixels, 2, 1, { gamma: 2 }, mask);

    expect(px(pixels, 0)).toEqual([96, 96, 96, 255]);
    expect(px(pixels, 1)).toEqual([128, 128, 128, 255]);
  });
});
