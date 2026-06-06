import { describe, expect, it } from 'vitest';
import { vignette } from '../src/filters/vignette';

function solid(width: number, height: number, r = 160, g = 160, b = 160, a = 255): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  }
  return pixels;
}

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(pixels.slice(index, index + 4));
}

function luma([r, g, b]: number[]): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

describe('vignette', () => {
  it('四隅を中心より暗くする', () => {
    const pixels = solid(5, 5, 180, 180, 180);

    vignette(pixels, 5, 5, { amount: 1, radius: 0.2, softness: 0.6 });

    const center = luma(pixelAt(pixels, 2, 2, 5));
    expect(luma(pixelAt(pixels, 0, 0, 5))).toBeLessThan(center);
    expect(luma(pixelAt(pixels, 4, 0, 5))).toBeLessThan(center);
    expect(luma(pixelAt(pixels, 0, 4, 5))).toBeLessThan(center);
    expect(luma(pixelAt(pixels, 4, 4, 5))).toBeLessThan(center);
  });

  it('中心はほぼ不変で alpha も保持する', () => {
    const pixels = solid(5, 5, 123, 145, 167, 77);

    vignette(pixels, 5, 5, { amount: 1, radius: 0.4, softness: 0.4 });

    expect(pixelAt(pixels, 2, 2, 5)).toEqual([123, 145, 167, 77]);
    expect(pixelAt(pixels, 0, 0, 5)[3]).toBe(77);
  });

  it('amount=0 では不変にする', () => {
    const pixels = solid(3, 3, 90, 100, 110, 120);
    const before = new Uint8ClampedArray(pixels);

    vignette(pixels, 3, 3, { amount: 0, radius: 0, softness: 1 });

    expect(Array.from(pixels)).toEqual(Array.from(before));
  });

  it('mask=0 の画素は不変にする', () => {
    const pixels = solid(3, 1, 200, 200, 200, 222);
    const before = new Uint8ClampedArray(pixels);

    vignette(pixels, 3, 1, { amount: 1, radius: 0, softness: 0 }, new Uint8ClampedArray([0, 255, 0]));

    expect(pixelAt(pixels, 0, 0, 3)).toEqual(pixelAt(before, 0, 0, 3));
    expect(pixelAt(pixels, 2, 0, 3)).toEqual(pixelAt(before, 2, 0, 3));
    expect(pixelAt(pixels, 1, 0, 3)[3]).toBe(222);
  });

  it('color 指定で着色ビネットにする', () => {
    const pixels = solid(3, 3, 180, 180, 180);

    vignette(pixels, 3, 3, {
      amount: 1,
      radius: 0,
      softness: 0,
      color: { r: 255, g: 0, b: 0, a: 255 },
    });

    const corner = pixelAt(pixels, 0, 0, 3);
    expect(corner[0]).toBe(180);
    expect(corner[1]).toBe(0);
    expect(corner[2]).toBe(0);
    expect(corner[3]).toBe(255);
  });
});
