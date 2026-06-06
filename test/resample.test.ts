import { describe, expect, it } from 'vitest';
import { resampleImage } from '../src/tools/resample';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(pixels.slice(index, index + 4));
}

describe('resampleImage', () => {
  it('nearest は同サイズで内容を維持し、新しいバッファを返す', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      50, 60, 70, 80,
      90, 100, 110, 120,
      130, 140, 150, 160,
    ]);

    const out = resampleImage(pixels, 2, 2, 2, 2, 'nearest');

    expect(out).not.toBe(pixels);
    expect(Array.from(out)).toEqual(Array.from(pixels));
  });

  it('bilinear は同サイズで内容をほぼ維持する', () => {
    const pixels = new Uint8ClampedArray([
      0, 10, 20, 30,
      40, 50, 60, 70,
      80, 90, 100, 110,
      120, 130, 140, 150,
    ]);

    const out = resampleImage(pixels, 2, 2, 2, 2, 'bilinear');

    expect(Array.from(out)).toEqual(Array.from(pixels));
  });

  it('2倍拡大で画素数が4倍になり nearest が値を複製する', () => {
    const pixels = new Uint8ClampedArray([
      1, 2, 3, 4,
      10, 20, 30, 40,
      100, 110, 120, 130,
      200, 210, 220, 230,
    ]);

    const out = resampleImage(pixels, 2, 2, 4, 4, 'nearest');

    expect(out).toHaveLength(4 * 4 * 4);
    expect(pixelAt(out, 0, 0, 4)).toEqual([1, 2, 3, 4]);
    expect(pixelAt(out, 1, 1, 4)).toEqual([1, 2, 3, 4]);
    expect(pixelAt(out, 2, 0, 4)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(out, 3, 1, 4)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(out, 0, 2, 4)).toEqual([100, 110, 120, 130]);
    expect(pixelAt(out, 3, 3, 4)).toEqual([200, 210, 220, 230]);
  });

  it('bilinear は4近傍から中間値を生成する', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 0,
      100, 100, 100, 100,
      200, 200, 200, 200,
      255, 255, 255, 255,
    ]);

    const out = resampleImage(pixels, 2, 2, 3, 3, 'bilinear');

    expect(pixelAt(out, 1, 1, 3)).toEqual([139, 139, 139, 139]);
    expect(pixelAt(out, 0, 0, 3)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(out, 2, 2, 3)).toEqual([255, 255, 255, 255]);
  });

  it('縮小が動作し、端はクランプされる', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      50, 0, 0, 255,
      100, 0, 0, 255,
      150, 0, 0, 255,
      0, 50, 0, 255,
      50, 50, 0, 255,
      100, 50, 0, 255,
      150, 50, 0, 255,
      0, 100, 0, 255,
      50, 100, 0, 255,
      100, 100, 0, 255,
      150, 100, 0, 255,
      0, 150, 0, 255,
      50, 150, 0, 255,
      100, 150, 0, 255,
      150, 150, 0, 255,
    ]);

    const out = resampleImage(pixels, 4, 4, 2, 2, 'bilinear');

    expect(out).toHaveLength(2 * 2 * 4);
    expect(pixelAt(out, 0, 0, 2)).toEqual([25, 25, 0, 255]);
    expect(pixelAt(out, 1, 1, 2)).toEqual([125, 125, 0, 255]);
  });

  it('退化サイズは空バッファを返し、元バッファを変更しない', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      50, 60, 70, 80,
    ]);
    const before = Array.from(pixels);

    expect(resampleImage(pixels, 2, 1, 0, 2, 'nearest')).toHaveLength(0);
    expect(resampleImage(pixels, 2, 1, 2, -1, 'bilinear')).toHaveLength(0);
    expect(resampleImage(pixels, 0, 1, 2, 2, 'nearest')).toHaveLength(0);
    expect(resampleImage(pixels, 2, 0, 2, 2, 'bilinear')).toHaveLength(0);
    expect(Array.from(pixels)).toEqual(before);
  });
});
