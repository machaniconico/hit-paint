import { describe, expect, it } from 'vitest';
import { chromaticAberration } from '../src/filters/chromatic';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function gradientImage(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = x * 5 + y * 3;
      pixels[i + 1] = x * 2 + y * 7;
      pixels[i + 2] = x * 11 + y;
      pixels[i + 3] = 160 + x + y;
    }
  }

  return pixels;
}

function verticalSplitImage(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const value = x < width / 2 ? 255 : 0;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }
  }

  return pixels;
}

describe('wave28 chromatic aberration', () => {
  it('amount=0 is byte-identical no-op', () => {
    const width = 8;
    const height = 6;
    const pixels = gradientImage(width, height);
    const before = Array.from(pixels);

    chromaticAberration(pixels, width, height, { amount: 0 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('creates a colour fringe on edge pixels near a high-contrast boundary', () => {
    const width = 32;
    const height = 32;
    const pixels = verticalSplitImage(width, height);

    chromaticAberration(pixels, width, height, { amount: 4 });

    const fringe = pixelAt(pixels, 15, 4, width);
    expect(fringe[0] !== fringe[1] || fringe[2] !== fringe[1]).toBe(true);
  });

  it('leaves the centre pixel nearly unchanged when cx and cy are the centre', () => {
    const width = 33;
    const height = 33;
    const center = 16;
    const pixels = gradientImage(width, height);
    const before = pixelAt(pixels, center, center, width);

    chromaticAberration(pixels, width, height, { amount: 12, cx: center, cy: center });

    const after = pixelAt(pixels, center, center, width);
    expect(Math.abs(after[0] - before[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(after[1] - before[1])).toBeLessThanOrEqual(1);
    expect(Math.abs(after[2] - before[2])).toBeLessThanOrEqual(1);
    expect(after[3]).toBe(before[3]);
  });

  it('mask coverage=0 leaves that output pixel byte-identical to original', () => {
    const width = 32;
    const height = 32;
    const pixels = verticalSplitImage(width, height);
    const before = new Uint8ClampedArray(pixels);
    const mask = new Uint8ClampedArray(width * height);
    mask.fill(255);
    mask[4 * width + 15] = 0;

    chromaticAberration(pixels, width, height, { amount: 4, mask });

    expect(pixelAt(pixels, 15, 4, width)).toEqual(pixelAt(before, 15, 4, width));
  });
});
