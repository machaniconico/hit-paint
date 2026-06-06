import { describe, expect, it } from 'vitest';
import { halftone } from '../src/filters/halftone';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function grayGrid(width: number, height: number, value: number, alpha = 255): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
    pixels[i + 3] = alpha;
  }

  return pixels;
}

function countRed(pixels: Uint8ClampedArray, value: number): number {
  let count = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] === value) count++;
  }

  return count;
}

function alphas(pixels: Uint8ClampedArray): number[] {
  const values: number[] = [];

  for (let i = 3; i < pixels.length; i += 4) {
    values.push(pixels[i]);
  }

  return values;
}

describe('wave27 halftone', () => {
  it('uniform mid-gray image produces a regular dot pattern with black and white pixels', () => {
    const pixels = grayGrid(8, 8, 128);

    halftone(pixels, 8, 8, { cellSize: 4 });

    expect(countRed(pixels, 0)).toBeGreaterThan(0);
    expect(countRed(pixels, 255)).toBeGreaterThan(0);
    expect(pixelAt(pixels, 0, 0, 8)).toEqual(pixelAt(pixels, 4, 0, 8));
    expect(pixelAt(pixels, 1, 1, 8)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(pixels, 0, 0, 8)).toEqual([255, 255, 255, 255]);
  });

  it('all-black input creates maximally large dots that are nearly all black', () => {
    const pixels = grayGrid(8, 8, 0);

    halftone(pixels, 8, 8, { cellSize: 4 });

    expect(countRed(pixels, 0)).toBeGreaterThanOrEqual(60);
    expect(countRed(pixels, 255)).toBeLessThanOrEqual(4);
  });

  it('all-white input creates minimum dots that are nearly all white', () => {
    const pixels = grayGrid(8, 8, 255);

    halftone(pixels, 8, 8, { cellSize: 4 });

    expect(countRed(pixels, 255)).toBeGreaterThanOrEqual(60);
    expect(countRed(pixels, 0)).toBeLessThanOrEqual(4);
  });

  it('cellSize<2 leaves the image unchanged without crashing', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      90, 100, 110, 120,
      180, 190, 200, 210,
      240, 230, 220, 250,
    ]);
    const before = Array.from(pixels);

    halftone(pixels, 2, 2, { cellSize: 1 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('mask coverage=0 pixels are unchanged', () => {
    const pixels = grayGrid(4, 4, 128);
    const before = new Uint8ClampedArray(pixels);
    const mask = new Uint8ClampedArray(16);
    mask.fill(255);
    mask[0] = 0;

    halftone(pixels, 4, 4, { cellSize: 4, mask });

    expect(pixelAt(pixels, 0, 0, 4)).toEqual(pixelAt(before, 0, 0, 4));
    expect(pixelAt(pixels, 1, 1, 4)).toEqual([0, 0, 0, 255]);
  });

  it('alpha channels are preserved', () => {
    const pixels = new Uint8ClampedArray([
      128, 128, 128, 0,
      128, 128, 128, 64,
      128, 128, 128, 128,
      128, 128, 128, 255,
    ]);
    const beforeAlpha = alphas(pixels);

    halftone(pixels, 2, 2, { cellSize: 2 });

    expect(alphas(pixels)).toEqual(beforeAlpha);
  });
});
