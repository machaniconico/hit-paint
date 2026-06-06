import { describe, expect, it } from 'vitest';
import { replaceColor } from '../src/filters/replace-color';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(pixels.slice(index, index + 4));
}

describe('replaceColor', () => {
  it('from に完全一致する画素を to に置換する', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 255,
      80, 90, 100, 200,
    ]);

    replaceColor(pixels, 2, 1, {
      from: { r: 10, g: 20, b: 30, a: 255 },
      to: { r: 200, g: 150, b: 100, a: 0 },
      tolerance: 0,
    });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([200, 150, 100, 255]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([80, 90, 100, 200]);
  });

  it('tolerance 外の色は変更しない', () => {
    const pixels = new Uint8ClampedArray([
      20, 20, 20, 255,
    ]);

    replaceColor(pixels, 1, 1, {
      from: { r: 10, g: 20, b: 30, a: 255 },
      to: { r: 200, g: 0, b: 0, a: 255 },
      tolerance: 9,
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([20, 20, 20, 255]);
  });

  it('fuzziness があると境界域の画素を中間色にする', () => {
    const pixels = new Uint8ClampedArray([
      15, 0, 0, 255,
    ]);

    replaceColor(pixels, 1, 1, {
      from: { r: 0, g: 0, b: 0, a: 255 },
      to: { r: 115, g: 100, b: 100, a: 255 },
      tolerance: 10,
      fuzziness: 10,
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([65, 50, 50, 255]);
  });

  it('RGB のみ置換して alpha を変更しない', () => {
    const pixels = new Uint8ClampedArray([
      1, 2, 3, 77,
    ]);

    replaceColor(pixels, 1, 1, {
      from: { r: 1, g: 2, b: 3, a: 255 },
      to: { r: 9, g: 8, b: 7, a: 0 },
      tolerance: 0,
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([9, 8, 7, 77]);
  });

  it('mask=0 の画素を変更しない', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 255,
      10, 20, 30, 255,
    ]);
    const mask = new Uint8ClampedArray([0, 255]);

    replaceColor(pixels, 2, 1, {
      from: { r: 10, g: 20, b: 30, a: 255 },
      to: { r: 100, g: 110, b: 120, a: 255 },
      tolerance: 0,
    }, mask);

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([10, 20, 30, 255]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([100, 110, 120, 255]);
  });

  it('負の tolerance を 0 にクランプする', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 255,
      11, 20, 30, 255,
    ]);

    replaceColor(pixels, 2, 1, {
      from: { r: 10, g: 20, b: 30, a: 255 },
      to: { r: 200, g: 210, b: 220, a: 255 },
      tolerance: -10,
    });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([200, 210, 220, 255]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([11, 20, 30, 255]);
  });
});
