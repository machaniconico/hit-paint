import { describe, expect, it } from 'vitest';
import { gaussianBlur } from '../src/filters/gaussian';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function setPixel(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  rgba: [number, number, number, number],
): void {
  const i = (y * width + x) * 4;
  pixels[i] = rgba[0];
  pixels[i + 1] = rgba[1];
  pixels[i + 2] = rgba[2];
  pixels[i + 3] = rgba[3];
}

function grayGrid(values: number[], alpha = 255): Uint8ClampedArray {
  const raw: number[] = [];
  for (const value of values) {
    raw.push(value, value, value, alpha);
  }
  return new Uint8ClampedArray(raw);
}

function sumChannel(pixels: Uint8ClampedArray, channel: number): number {
  let sum = 0;
  for (let i = channel; i < pixels.length; i += 4) {
    sum += pixels[i];
  }
  return sum;
}

function rgbaMask(pixelCount: number, alpha = 255): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 3; i < mask.length; i += 4) {
    mask[i] = alpha;
  }
  return mask;
}

describe('wave26 gaussian blur', () => {
  it('radius=0 is byte-identical no-op', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      200, 210, 220, 230,
      5, 15, 25, 35,
    ]);
    const before = Array.from(pixels);

    gaussianBlur(pixels, 3, 1, { radius: 0 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('conserves energy for a single opaque bright point', () => {
    const width = 5;
    const height = 5;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 3; i < pixels.length; i += 4) {
      pixels[i] = 255;
    }
    setPixel(pixels, 2, 2, width, [255, 255, 255, 255]);
    const beforeSum = sumChannel(pixels, 0);

    gaussianBlur(pixels, width, height, { radius: 1, sigma: 1 });

    expect(pixelAt(pixels, 2, 2, width)[0]).toBeLessThan(255);
    expect(pixelAt(pixels, 2, 1, width)[0]).toBeGreaterThan(0);
    expect(sumChannel(pixels, 0)).toBeGreaterThanOrEqual(beforeSum * 0.99);
    expect(sumChannel(pixels, 0)).toBeLessThanOrEqual(beforeSum * 1.01);
  });

  it('does not bleed RGB from transparent pixels', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 0,
      255, 255, 255, 255,
      255, 0, 0, 0,
    ]);

    gaussianBlur(pixels, 3, 1, { radius: 1, sigma: 1 });

    for (const x of [0, 2]) {
      const adjacent = pixelAt(pixels, x, 0, 3);
      expect(adjacent[3]).toBeGreaterThan(0);
      expect(adjacent[0]).toBe(adjacent[1]);
      expect(adjacent[1]).toBe(adjacent[2]);
      expect(adjacent[0]).toBeGreaterThan(240);
    }
  });

  it('preserves symmetry of symmetric input', () => {
    const pixels = grayGrid([0, 64, 128, 255, 128, 64, 0]);

    gaussianBlur(pixels, 7, 1, { radius: 2, sigma: 1 });

    for (let x = 0; x < 7; x++) {
      expect(pixelAt(pixels, x, 0, 7)).toEqual(pixelAt(pixels, 6 - x, 0, 7));
    }
  });

  it('leaves mask alpha=0 pixels byte-identical', () => {
    const pixels = grayGrid([0, 255, 0]);
    const before = new Uint8ClampedArray(pixels);
    const mask = rgbaMask(3);
    mask[1 * 4 + 3] = 0;

    gaussianBlur(pixels, 3, 1, { radius: 1, sigma: 1, mask });

    expect(pixelAt(pixels, 1, 0, 3)).toEqual(pixelAt(before, 1, 0, 3));
    expect(pixelAt(pixels, 0, 0, 3)[0]).toBeGreaterThan(pixelAt(before, 0, 0, 3)[0]);
  });
});
