import { describe, expect, it } from 'vitest';
import { adjustColorBalance, gradientMap } from '../src/filters/color-balance';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

describe('color balance and gradient map filters', () => {
  it('applies shadow RGB shifts only to shadow-luma pixels', () => {
    const pixels = new Uint8ClampedArray([
      20, 30, 40, 255,
      100, 110, 120, 255,
      220, 230, 240, 255,
    ]);

    adjustColorBalance(pixels, 3, 1, { shadows: [20, -10, 5] });

    expect(pixelAt(pixels, 0, 0, 3)).toEqual([40, 20, 45, 255]);
    expect(pixelAt(pixels, 1, 0, 3)).toEqual([100, 110, 120, 255]);
    expect(pixelAt(pixels, 2, 0, 3)).toEqual([220, 230, 240, 255]);
  });

  it('does not over-apply midtone shifts to highlight-luma pixels', () => {
    const pixels = new Uint8ClampedArray([
      128, 128, 128, 255,
      230, 230, 230, 255,
    ]);

    adjustColorBalance(pixels, 2, 1, { midtones: [40, -20, 10] });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([168, 108, 138, 255]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([230, 230, 230, 255]);
  });

  it('maps black to the first stop and white to the last stop', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);

    gradientMap(pixels, 2, 1, {
      stops: [
        { t: 0, color: { r: 10, g: 20, b: 30, a: 40 } },
        { t: 1, color: { r: 200, g: 210, b: 220, a: 230 } },
      ],
    });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([10, 20, 30, 255]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([200, 210, 220, 255]);
  });

  it('interpolates gradient stops by pixel luma', () => {
    const pixels = new Uint8ClampedArray([
      128, 128, 128, 99,
    ]);

    gradientMap(pixels, 1, 1, {
      stops: [
        { t: 0, color: { r: 0, g: 0, b: 0, a: 0 } },
        { t: 1, color: { r: 255, g: 0, b: 255, a: 255 } },
      ],
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([128, 0, 128, 99]);
  });

  it('preserves alpha for color balance and gradient map', () => {
    const balanced = new Uint8ClampedArray([
      40, 40, 40, 17,
    ]);
    const mapped = new Uint8ClampedArray([
      255, 255, 255, 203,
    ]);

    adjustColorBalance(balanced, 1, 1, { shadows: [100, 100, 100] });
    gradientMap(mapped, 1, 1, {
      stops: [
        { t: 0, color: { r: 0, g: 0, b: 0, a: 0 } },
        { t: 1, color: { r: 10, g: 20, b: 30, a: 0 } },
      ],
    });

    expect(pixelAt(balanced, 0, 0, 1)).toEqual([140, 140, 140, 17]);
    expect(pixelAt(mapped, 0, 0, 1)).toEqual([10, 20, 30, 203]);
  });

  it('leaves mask=0 pixels unchanged', () => {
    const original = [
      30, 30, 30, 44,
      255, 255, 255, 55,
    ];
    const mask = new Uint8ClampedArray([0, 0]);

    const balanced = new Uint8ClampedArray(original);
    adjustColorBalance(balanced, 2, 1, {
      shadows: [100, 100, 100],
      highlights: [-100, -100, -100],
      mask,
    });

    const mapped = new Uint8ClampedArray(original);
    gradientMap(mapped, 2, 1, {
      stops: [
        { t: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
        { t: 1, color: { r: 0, g: 0, b: 255, a: 255 } },
      ],
      mask,
    });

    expect(Array.from(balanced)).toEqual(original);
    expect(Array.from(mapped)).toEqual(original);
  });

  it('blends RGB effects by partial mask coverage', () => {
    const pixels = new Uint8ClampedArray([
      100, 100, 100, 77,
    ]);

    adjustColorBalance(pixels, 1, 1, {
      midtones: [100, 0, -100],
      mask: new Uint8ClampedArray([128]),
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([150, 100, 50, 77]);
  });
});
