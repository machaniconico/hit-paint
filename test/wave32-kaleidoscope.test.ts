import { describe, expect, it } from 'vitest';
import { kaleidoscope } from '../src/tools/kaleidoscope';

const TWO_PI = Math.PI * 2;

function horizontalRedGradient(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const maxX = Math.max(1, width - 1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = Math.round((x / maxX) * 255);
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      pixels[i + 3] = 255;
    }
  }

  return pixels;
}

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

function expectPixelsNearlyEqual(
  actual: Uint8ClampedArray,
  expected: Uint8ClampedArray,
  tolerance: number,
): void {
  expect(actual).toHaveLength(expected.length);

  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(tolerance);
  }
}

describe('wave32 kaleidoscope', () => {
  it('segments=6 maps points one segment apart to the same output color', () => {
    const width = 16;
    const height = 16;
    const cx = 7;
    const cy = 7;
    const radius = 8;
    const input = horizontalRedGradient(width, height);

    const output = kaleidoscope(input, width, height, { segments: 6, cx, cy });
    const x0 = cx + radius;
    const y0 = cy;
    const x1 = Math.round(cx + radius * Math.cos(TWO_PI / 6));
    const y1 = Math.round(cy + radius * Math.sin(TWO_PI / 6));

    expect(pixelAt(output, x1, y1, width)).toEqual(pixelAt(output, x0, y0, width));
  });

  it('segments=1 returns a near-identity copy', () => {
    const width = 16;
    const height = 16;
    const input = horizontalRedGradient(width, height);

    const output = kaleidoscope(input, width, height, { segments: 1 });

    expect(output).not.toBe(input);
    expectPixelsNearlyEqual(output, input, 1);
  });

  it('does not mutate the input pixels', () => {
    const width = 16;
    const height = 16;
    const input = horizontalRedGradient(width, height);
    const before = new Uint8ClampedArray(input);

    kaleidoscope(input, width, height, { segments: 6, cx: 7, cy: 7 });

    expect(Array.from(input)).toEqual(Array.from(before));
  });

  it('returns an empty buffer for non-positive dimensions', () => {
    const input = horizontalRedGradient(2, 2);

    expect(kaleidoscope(input, 0, 2, { segments: 6 })).toHaveLength(0);
    expect(kaleidoscope(input, 2, 0, { segments: 6 })).toHaveLength(0);
    expect(kaleidoscope(input, -1, 2, { segments: 6 })).toHaveLength(0);
  });
});
