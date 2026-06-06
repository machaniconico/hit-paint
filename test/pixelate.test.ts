import { describe, expect, it } from 'vitest';
import { pixelate } from '../src/filters/pixelate';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(pixels.slice(index, index + 4));
}

describe('pixelate', () => {
  it('blockSize=2 で 2x2 ブロックを平均色一律にする', () => {
    const pixels = new Uint8ClampedArray([
      0, 10, 20, 30,
      20, 30, 40, 50,
      40, 50, 60, 70,
      60, 70, 80, 90,
    ]);

    pixelate(pixels, 2, 2, { blockSize: 2 });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([30, 40, 50, 60]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([30, 40, 50, 60]);
    expect(pixelAt(pixels, 0, 1, 2)).toEqual([30, 40, 50, 60]);
    expect(pixelAt(pixels, 1, 1, 2)).toEqual([30, 40, 50, 60]);
  });

  it('端の半端ブロックも平均して処理する', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      100, 0, 0, 255,
      200, 0, 0, 255,
      0, 100, 0, 255,
      100, 100, 0, 255,
      200, 100, 0, 255,
      0, 200, 0, 255,
      100, 200, 0, 255,
      200, 200, 0, 255,
    ]);

    pixelate(pixels, 3, 3, { blockSize: 2 });

    expect(pixelAt(pixels, 0, 0, 3)).toEqual([50, 50, 0, 255]);
    expect(pixelAt(pixels, 1, 1, 3)).toEqual([50, 50, 0, 255]);
    expect(pixelAt(pixels, 2, 0, 3)).toEqual([200, 50, 0, 255]);
    expect(pixelAt(pixels, 2, 1, 3)).toEqual([200, 50, 0, 255]);
    expect(pixelAt(pixels, 0, 2, 3)).toEqual([50, 200, 0, 255]);
    expect(pixelAt(pixels, 1, 2, 3)).toEqual([50, 200, 0, 255]);
    expect(pixelAt(pixels, 2, 2, 3)).toEqual([200, 200, 0, 255]);
  });

  it('blockSize=1 で不変にする', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      50, 60, 70, 80,
    ]);
    const before = Array.from(pixels);

    pixelate(pixels, 2, 1, { blockSize: 1 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('市松模様を灰色化する', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);

    pixelate(pixels, 2, 2, { blockSize: 2 });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([128, 128, 128, 255]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([128, 128, 128, 255]);
    expect(pixelAt(pixels, 0, 1, 2)).toEqual([128, 128, 128, 255]);
    expect(pixelAt(pixels, 1, 1, 2)).toEqual([128, 128, 128, 255]);
  });

  it('mask=0 の画素を不変にする', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 100,
      200, 200, 200, 200,
    ]);
    const before = Array.from(pixels);
    const mask = new Uint8ClampedArray([0, 0]);

    pixelate(pixels, 2, 1, { blockSize: 2, mask });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('中間 mask coverage で平均色への効果をブレンドする', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 100,
      200, 200, 200, 200,
    ]);
    const mask = new Uint8ClampedArray([128, 255]);

    pixelate(pixels, 2, 1, { blockSize: 2, mask });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([50, 50, 50, 125]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([100, 100, 100, 150]);
  });
});
