import { describe, it, expect } from 'vitest';
import { pixelate } from '../src/filters/pixelate';

function repeatedBlock(pixel: number[], count: number): number[] {
  return Array.from({ length: count }, () => pixel).flat();
}

function naiveAveragePixel(pixels: Uint8ClampedArray): number[] {
  const sums = [0, 0, 0, 0];
  const count = pixels.length / 4;

  for (let index = 0; index < pixels.length; index += 4) {
    sums[0] += pixels[index];
    sums[1] += pixels[index + 1];
    sums[2] += pixels[index + 2];
    sums[3] += pixels[index + 3];
  }

  return sums.map((sum) => Math.round(sum / count));
}

describe('pixelate alpha handling', () => {
  it('averages RGB from only opaque pixels when transparent black pixels share a block', () => {
    const pixels = new Uint8ClampedArray([
      200, 40, 80, 255,
      0, 0, 0, 0,
      100, 80, 120, 255,
      0, 0, 0, 0,
    ]);

    pixelate(pixels, 2, 2, { blockSize: 2 });

    expect(Array.from(pixels)).toEqual(repeatedBlock([150, 60, 100, 128], 4));
  });

  it('matches the naive simple average byte-for-byte when every pixel has alpha', () => {
    const pixels = new Uint8ClampedArray([
      10, 30, 50, 100,
      30, 50, 70, 120,
      50, 70, 90, 140,
      70, 90, 110, 160,
    ]);
    const expectedPixel = naiveAveragePixel(pixels);

    pixelate(pixels, 2, 2, { blockSize: 2 });

    expect(Array.from(pixels)).toEqual(repeatedBlock(expectedPixel, 4));
  });

  it('keeps an all-transparent block transparent without NaN or crashes', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 0,
      40, 50, 60, 0,
      70, 80, 90, 0,
      100, 110, 120, 0,
    ]);

    pixelate(pixels, 2, 2, { blockSize: 2 });

    expect(Array.from(pixels)).toEqual(repeatedBlock([0, 0, 0, 0], 4));
  });
});
