import { describe, expect, it } from 'vitest';
import { type Quad, perspectiveWarp } from '../src/tools/perspective';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(pixels.slice(index, index + 4));
}

function testImage(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      pixels[index] = x * 30 + y * 5;
      pixels[index + 1] = x * 7 + y * 31;
      pixels[index + 2] = x * 11 + y * 13;
      pixels[index + 3] = 120 + x * 9 + y * 7;
    }
  }

  return pixels;
}

function expectClosePixel(actual: number[], expected: number[], tolerance = 1): void {
  expect(actual).toHaveLength(4);
  expect(expected).toHaveLength(4);

  for (let channel = 0; channel < 4; channel++) {
    expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(tolerance);
  }
}

function sampleExpected(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number[] {
  if (x < 0 || x > width - 1 || y < 0 || y > height - 1) return [0, 0, 0, 0];

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const topLeft = (y0 * width + x0) * 4;
  const topRight = (y0 * width + x1) * 4;
  const bottomLeft = (y1 * width + x0) * 4;
  const bottomRight = (y1 * width + x1) * 4;

  return [0, 1, 2, 3].map((channel) => {
    const top = source[topLeft + channel] * (1 - tx)
      + source[topRight + channel] * tx;
    const bottom = source[bottomLeft + channel] * (1 - tx)
      + source[bottomRight + channel] * tx;
    return Math.round(top * (1 - ty) + bottom * ty);
  });
}

function parallelogramSourceCoord(x: number, y: number, width: number, height: number, dst: Quad): [number, number] {
  const ax = dst.x1 - dst.x0;
  const ay = dst.y1 - dst.y0;
  const bx = dst.x3 - dst.x0;
  const by = dst.y3 - dst.y0;
  const qx = x - dst.x0;
  const qy = y - dst.y0;
  const det = ax * by - ay * bx;
  const u = (qx * by - qy * bx) / det;
  const v = (ax * qy - ay * qx) / det;

  return [u * width, v * height];
}

function trapezoidSourceCoord(x: number, y: number, width: number, height: number): [number, number] {
  const a = 10;
  const b = 2;
  const c = -2;
  const e = 38 / 3;
  const f = -1;
  const g = 2 / 3;
  const v = (f - y) / (y * g - e);
  const u = (x * (g * v + 1) - b * v - c) / a;

  return [u * width, v * height];
}

describe('wave28 perspective warp', () => {
  it('identity warp keeps pixels at integer coordinates', () => {
    const width = 5;
    const height = 4;
    const pixels = testImage(width, height);
    const out = perspectiveWarp(pixels, width, height, {
      x0: 0, y0: 0,
      x1: width, y1: 0,
      x2: width, y2: height,
      x3: 0, y3: height,
    });

    expect(out).not.toBe(pixels);
    expect(out).toHaveLength(width * height * 4);
    for (let i = 0; i < out.length; i++) {
      expect(Math.abs(out[i] - pixels[i])).toBeLessThanOrEqual(1);
    }
  });

  it('parallelogram warp maps output corners to expected source locations', () => {
    const width = 6;
    const height = 6;
    const pixels = testImage(width, height);
    const dst: Quad = {
      x0: -1, y0: -1,
      x1: 7, y1: 0,
      x2: 8, y2: 8,
      x3: 0, y3: 7,
    };
    const out = perspectiveWarp(pixels, width, height, dst);
    const corners = [
      [0, 0],
      [width - 1, 0],
      [width - 1, height - 1],
      [0, height - 1],
    ];

    for (const [x, y] of corners) {
      const [sx, sy] = parallelogramSourceCoord(x, y, width, height, dst);
      expectClosePixel(
        pixelAt(out, x, y, width),
        sampleExpected(pixels, width, height, sx, sy),
      );
    }
  });

  it('trapezoid warp maps output corners to expected source locations', () => {
    const width = 6;
    const height = 6;
    const pixels = testImage(width, height);
    const out = perspectiveWarp(pixels, width, height, {
      x0: -2, y0: -1,
      x1: 8, y1: -1,
      x2: 6, y2: 7,
      x3: 0, y3: 7,
    });
    const corners = [
      [0, 0],
      [width - 1, 0],
      [width - 1, height - 1],
      [0, height - 1],
    ];

    for (const [x, y] of corners) {
      const [sx, sy] = trapezoidSourceCoord(x, y, width, height);
      expectClosePixel(
        pixelAt(out, x, y, width),
        sampleExpected(pixels, width, height, sx, sy),
      );
    }
  });

  it('writes transparent pixels for destinations outside the quad', () => {
    const width = 5;
    const height = 5;
    const pixels = testImage(width, height);
    const out = perspectiveWarp(pixels, width, height, {
      x0: 1, y0: 1,
      x1: 4, y1: 1,
      x2: 4, y2: 4,
      x3: 1, y3: 4,
    });

    expect(pixelAt(out, 0, 0, width)).toEqual([0, 0, 0, 0]);
  });

  it('does not mutate the input array', () => {
    const width = 5;
    const height = 5;
    const pixels = testImage(width, height);
    const before = Array.from(pixels);

    perspectiveWarp(pixels, width, height, {
      x0: -1, y0: 0,
      x1: 5, y1: 1,
      x2: 4, y2: 6,
      x3: 0, y3: 5,
    });

    expect(Array.from(pixels)).toEqual(before);
  });
});
