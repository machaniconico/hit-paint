import { describe, expect, it } from 'vitest';
import { addNoise, orderedDither } from '../src/filters/noise';

function clone(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values);
}

describe('noise filters', () => {
  it('reproduces addNoise results with the same seed', () => {
    const original = [
      80, 90, 100, 25,
      120, 130, 140, 128,
      200, 210, 220, 255,
      40, 50, 60, 77,
    ];
    const first = clone(original);
    const second = clone(original);

    addNoise(first, 2, 2, { amount: 35, seed: 1234 });
    addNoise(second, 2, 2, { amount: 35, seed: 1234 });

    expect(Array.from(first)).toEqual(Array.from(second));
    expect(Array.from(first)).not.toEqual(original);
  });

  it('leaves pixels unchanged when amount is zero', () => {
    const original = [
      1, 2, 3, 4,
      250, 251, 252, 253,
    ];
    const pixels = clone(original);

    addNoise(pixels, 2, 1, { amount: 0, seed: 9876 });

    expect(Array.from(pixels)).toEqual(original);
  });

  it('uses one monochrome noise delta for all RGB channels and preserves alpha', () => {
    const pixels = clone([
      100, 100, 100, 42,
      150, 150, 150, 99,
    ]);

    addNoise(pixels, 2, 1, { amount: 50, monochrome: true, seed: 4 });

    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[1]).toBe(pixels[2]);
    expect(pixels[4]).toBe(pixels[5]);
    expect(pixels[5]).toBe(pixels[6]);
    expect(pixels[3]).toBe(42);
    expect(pixels[7]).toBe(99);
  });

  it('quantizes orderedDither levels=2 output to binary channel values', () => {
    const pixels = clone([
      16, 64, 96, 10,
      112, 128, 144, 20,
      160, 176, 192, 30,
      208, 224, 240, 40,
    ]);

    orderedDither(pixels, 4, 1, { levels: 2 });

    for (let i = 0; i < pixels.length; i += 4) {
      expect([0, 255]).toContain(pixels[i]);
      expect([0, 255]).toContain(pixels[i + 1]);
      expect([0, 255]).toContain(pixels[i + 2]);
    }
    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual([10, 20, 30, 40]);
  });

  it('respects mask=0 for both noise and ordered dither', () => {
    const original = [
      20, 30, 40, 50,
      200, 210, 220, 230,
    ];
    const mask = new Uint8ClampedArray([0, 0]);
    const noisy = clone(original);
    const dithered = clone(original);

    addNoise(noisy, 2, 1, { amount: 100, seed: 9, mask });
    orderedDither(dithered, 2, 1, { levels: 2, mask });

    expect(Array.from(noisy)).toEqual(original);
    expect(Array.from(dithered)).toEqual(original);
  });
});
