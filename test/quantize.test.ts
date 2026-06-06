import { describe, expect, it } from 'vitest';
import { applyQuantize, quantizeColors } from '../src/filters/quantize';

function rgbAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(pixels.slice(index, index + 3));
}

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(pixels.slice(index, index + 4));
}

function paletteRgbSet(result: ReturnType<typeof quantizeColors>): Set<string> {
  return new Set(result.palette.map((color) => `${color.r},${color.g},${color.b}`));
}

describe('quantizeColors', () => {
  it('2色画像を maxColors=2 で2色パレットにする', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    ]);

    const result = quantizeColors(pixels, 2, 2, 2);

    expect(result.palette).toHaveLength(2);
    expect(paletteRgbSet(result)).toEqual(new Set(['255,0,0', '0,0,255']));
    expect(new Set(Array.from(result.indices))).toHaveLength(2);
  });

  it('palette サイズを maxColors 以下にする', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      32, 0, 0, 255,
      64, 0, 0, 255,
      96, 0, 0, 255,
      128, 0, 0, 255,
      160, 0, 0, 255,
      192, 0, 0, 255,
      224, 0, 0, 255,
    ]);

    const result = quantizeColors(pixels, 8, 1, 3);

    expect(result.palette.length).toBeLessThanOrEqual(3);
    expect(result.indices).toHaveLength(8);
  });

  it('maxColors<1 を1にクランプし、単色画像は palette 1色にする', () => {
    const pixels = new Uint8ClampedArray([
      20, 40, 60, 255,
      20, 40, 60, 128,
      20, 40, 60, 64,
    ]);

    const result = quantizeColors(pixels, 3, 1, 0);

    expect(result.palette).toHaveLength(1);
    expect(result.palette[0]).toMatchObject({ r: 20, g: 40, b: 60 });
    expect(Array.from(result.indices)).toEqual([0, 0, 0]);
  });
});

describe('applyQuantize', () => {
  it('RGB を quantizeColors の最近傍パレット色に丸める', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      240, 10, 10, 255,
      0, 0, 255, 255,
      10, 10, 240, 255,
    ]);
    const expected = quantizeColors(pixels, 4, 1, 2);

    applyQuantize(pixels, 4, 1, 2);

    for (let x = 0; x < 4; x++) {
      const color = expected.palette[expected.indices[x]];
      expect(rgbAt(pixels, x, 0, 4)).toEqual([color.r, color.g, color.b]);
    }
  });

  it('alpha を変更しない', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 0,
      240, 10, 10, 64,
      0, 0, 255, 128,
      10, 10, 240, 255,
    ]);
    const beforeAlpha = [0, 64, 128, 255];

    applyQuantize(pixels, 4, 1, 2);

    expect([pixelAt(pixels, 0, 0, 4)[3], pixelAt(pixels, 1, 0, 4)[3], pixelAt(pixels, 2, 0, 4)[3], pixelAt(pixels, 3, 0, 4)[3]]).toEqual(beforeAlpha);
  });

  it('mask=0 の画素を不変にする', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 255, 200,
    ]);
    const before = Array.from(pixels);
    const mask = new Uint8ClampedArray([0, 0]);

    applyQuantize(pixels, 2, 1, 1, mask);

    expect(Array.from(pixels)).toEqual(before);
  });
});
