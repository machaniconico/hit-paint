import { describe, expect, it } from 'vitest';
import { autoWhiteBalance } from '../src/filters/white-balance';

type RGBA = [number, number, number, number];

function rgbaBuffer(colors: RGBA[]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flat());
}

function pixelAt(pixels: Uint8ClampedArray, pixel: number): RGBA {
  const i = pixel * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

function rgbMeans(pixels: Uint8ClampedArray): [number, number, number] {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] <= 0) continue;
    sumR += pixels[i];
    sumG += pixels[i + 1];
    sumB += pixels[i + 2];
    count++;
  }

  return [sumR / count, sumG / count, sumB / count];
}

function expectNearlySameBytes(actual: Uint8ClampedArray, expected: Uint8ClampedArray, tolerance = 1): void {
  expect(actual.length).toBe(expected.length);

  for (let i = 0; i < actual.length; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(tolerance);
  }
}

describe('autoWhiteBalance', () => {
  it('red-cast image means become approximately equal after correction', () => {
    const pixels = rgbaBuffer([
      [180, 60, 70, 255],
      [210, 70, 80, 255],
      [190, 50, 60, 255],
      [200, 80, 90, 255],
    ]);

    autoWhiteBalance(pixels, 2, 2);

    const [meanR, meanG, meanB] = rgbMeans(pixels);
    expect(Math.abs(meanR - meanG)).toBeLessThanOrEqual(5);
    expect(Math.abs(meanR - meanB)).toBeLessThanOrEqual(5);
    expect(Math.abs(meanG - meanB)).toBeLessThanOrEqual(5);
  });

  it('already balanced channel means stay nearly byte-identical', () => {
    const pixels = rgbaBuffer([
      [10, 60, 80, 255],
      [90, 40, 20, 255],
      [50, 50, 50, 255],
    ]);
    const before = new Uint8ClampedArray(pixels);

    autoWhiteBalance(pixels, 3, 1);

    expectNearlySameBytes(pixels, before);
  });

  it('strength=0 keeps output byte-identical', () => {
    const pixels = rgbaBuffer([
      [210, 50, 60, 255],
      [190, 60, 70, 128],
      [180, 70, 80, 64],
    ]);
    const before = Array.from(pixels);

    autoWhiteBalance(pixels, 3, 1, { strength: 0 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('preserves original alpha values', () => {
    const pixels = rgbaBuffer([
      [200, 40, 60, 0],
      [190, 50, 70, 64],
      [180, 60, 80, 128],
      [170, 70, 90, 255],
    ]);
    const alphas = [pixels[3], pixels[7], pixels[11], pixels[15]];

    autoWhiteBalance(pixels, 4, 1);

    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual(alphas);
  });

  it('mask coverage=0 leaves masked pixels unchanged', () => {
    const pixels = rgbaBuffer([
      [220, 50, 60, 255],
      [180, 70, 80, 255],
    ]);
    const before = new Uint8ClampedArray(pixels);

    autoWhiteBalance(pixels, 2, 1, { mask: new Uint8ClampedArray([0, 255]) });

    expect(pixelAt(pixels, 0)).toEqual(pixelAt(before, 0));
    expect(pixelAt(pixels, 1)).not.toEqual(pixelAt(before, 1));
  });

  it('w=0 or h=0 does not crash', () => {
    const pixels = rgbaBuffer([
      [220, 50, 60, 255],
    ]);
    const before = Array.from(pixels);

    expect(() => autoWhiteBalance(pixels, 0, 1)).not.toThrow();
    expect(() => autoWhiteBalance(pixels, 1, 0)).not.toThrow();
    expect(Array.from(pixels)).toEqual(before);
  });
});
