import { describe, expect, it } from 'vitest';
import { bloom } from '../src/filters/bloom';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function grayGrid(values: number[], alpha = 255): Uint8ClampedArray {
  const raw: number[] = [];
  for (const value of values) {
    raw.push(value, value, value, alpha);
  }
  return new Uint8ClampedArray(raw);
}

describe('bloom', () => {
  it('dark background with one bright pixel spreads glow to neighboring pixels', () => {
    const pixels = grayGrid([
      0, 0, 0,
      0, 255, 0,
      0, 0, 0,
    ]);

    bloom(pixels, 3, 3, { threshold: 200, radius: 1, intensity: 1 });

    expect(pixelAt(pixels, 1, 0, 3)[0]).toBeGreaterThan(0);
    expect(pixelAt(pixels, 0, 1, 3)[1]).toBeGreaterThan(0);
    expect(pixelAt(pixels, 2, 1, 3)[2]).toBeGreaterThan(0);
    expect(pixelAt(pixels, 1, 2, 3)[3]).toBe(255);
  });

  it('threshold=255 is a byte-identical no-op', () => {
    const pixels = new Uint8ClampedArray([
      12, 34, 56, 78,
      255, 250, 245, 240,
      90, 80, 70, 60,
    ]);
    const before = Array.from(pixels);

    bloom(pixels, 3, 1, { threshold: 255, radius: 1, intensity: 2 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('intensity=0 is a byte-identical no-op', () => {
    const pixels = grayGrid([0, 255, 0]);
    const before = Array.from(pixels);

    bloom(pixels, 3, 1, { threshold: 100, radius: 1, intensity: 0 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('fully saturated pixel clamps additive bloom at 255', () => {
    const pixels = new Uint8ClampedArray([255, 255, 255, 128]);

    bloom(pixels, 1, 1, { threshold: 200, radius: 1, intensity: 4 });

    expect(Array.from(pixels)).toEqual([255, 255, 255, 128]);
  });

  it('mask coverage=0 leaves that output pixel unchanged', () => {
    const pixels = grayGrid([0, 255, 0]);
    const before = new Uint8ClampedArray(pixels);
    const mask = new Uint8ClampedArray([
      255, 255, 255, 0,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);

    bloom(pixels, 3, 1, { threshold: 200, radius: 1, intensity: 1, mask });

    expect(pixelAt(pixels, 0, 0, 3)).toEqual(pixelAt(before, 0, 0, 3));
    expect(pixelAt(pixels, 2, 0, 3)[0]).toBeGreaterThan(pixelAt(before, 2, 0, 3)[0]);
  });
});
