import { describe, expect, it } from 'vitest';
import { pencilSketch } from '../src/filters/sketch';

function grayRow(values: number[], alpha = 255): Uint8ClampedArray {
  const raw: number[] = [];
  for (const value of values) {
    raw.push(value, value, value, alpha);
  }
  return new Uint8ClampedArray(raw);
}

function rgbaRow(values: number[][]): Uint8ClampedArray {
  return new Uint8ClampedArray(values.flat());
}

function pixelAt(pixels: Uint8ClampedArray, x: number): number[] {
  const i = x * 4;
  return Array.from(pixels.slice(i, i + 4));
}

describe('pencilSketch', () => {
  it('detects a dark transition line at a sharp brightness edge', () => {
    const pixels = grayRow([255, 255, 0, 0]);

    pencilSketch(pixels, 4, 1, { blurRadius: 1 });

    expect(Math.min(pixels[4], pixels[8])).toBeLessThan(200);
  });

  it('keeps a flat white region near white', () => {
    const pixels = grayRow([255, 255, 255, 255]);

    pencilSketch(pixels, 4, 1, { blurRadius: 1 });

    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i]).toBeGreaterThanOrEqual(240);
    }
  });

  it('outputs grayscale channels', () => {
    const pixels = rgbaRow([
      [240, 40, 20, 255],
      [10, 160, 220, 255],
      [80, 40, 180, 255],
      [220, 220, 40, 255],
    ]);

    pencilSketch(pixels, 4, 1, { blurRadius: 1 });

    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(pixels[i + 1]);
      expect(pixels[i + 1]).toBe(pixels[i + 2]);
    }
  });

  it('preserves alpha channels', () => {
    const pixels = rgbaRow([
      [255, 255, 255, 11],
      [0, 0, 0, 64],
      [120, 40, 200, 128],
      [30, 160, 60, 255],
    ]);
    const beforeAlpha = [pixels[3], pixels[7], pixels[11], pixels[15]];

    pencilSketch(pixels, 4, 1, { blurRadius: 1 });

    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual(beforeAlpha);
  });

  it('leaves a mask coverage=0 pixel unchanged', () => {
    const pixels = rgbaRow([
      [20, 80, 140, 123],
      [100, 150, 200, 255],
    ]);
    const before = new Uint8ClampedArray(pixels);
    const mask = new Uint8ClampedArray([
      0, 0, 0, 0,
      0, 0, 0, 255,
    ]);

    pencilSketch(pixels, 2, 1, { blurRadius: 1, mask });

    expect(pixelAt(pixels, 0)).toEqual(pixelAt(before, 0));
    expect(pixelAt(pixels, 1)).not.toEqual(pixelAt(before, 1));
  });

  it('returns without changes for w=0 or h=0', () => {
    const widthZero = grayRow([12, 34]);
    const heightZero = grayRow([56, 78]);
    const beforeWidthZero = Array.from(widthZero);
    const beforeHeightZero = Array.from(heightZero);

    expect(() => pencilSketch(widthZero, 0, 1, { blurRadius: 1 })).not.toThrow();
    expect(() => pencilSketch(heightZero, 2, 0, { blurRadius: 1 })).not.toThrow();

    expect(Array.from(widthZero)).toEqual(beforeWidthZero);
    expect(Array.from(heightZero)).toEqual(beforeHeightZero);
  });

  it('strength=0 outputs only input luminance grayscale', () => {
    const pixels = new Uint8ClampedArray([200, 100, 50, 255]);
    const expected = Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50);

    pencilSketch(pixels, 1, 1, { blurRadius: 1, strength: 0 });

    expect(pixelAt(pixels, 0)).toEqual([expected, expected, expected, 255]);
  });
});
