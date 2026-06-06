import { describe, expect, it } from 'vitest';
import { duotone, type DuotoneOptions, type RGBA } from '../src/filters/duotone';

function pixelAt(pixels: Uint8ClampedArray): RGBA {
  return [pixels[0], pixels[1], pixels[2], pixels[3]];
}

function expectCloseChannel(value: number, expected: number): void {
  expect(value).toBeGreaterThanOrEqual(expected - 1);
  expect(value).toBeLessThanOrEqual(expected + 1);
}

describe('duotone', () => {
  it('grayscale: shadow=black highlight=white sets R=G=B=luma', () => {
    const pixels = new Uint8ClampedArray([200, 100, 50, 255]);
    const luma = Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50);
    const opts: DuotoneOptions = {
      shadow: [0, 0, 0, 255],
      highlight: [255, 255, 255, 255],
    };

    duotone(pixels, 1, 1, opts);

    expectCloseChannel(pixels[0], luma);
    expectCloseChannel(pixels[1], luma);
    expectCloseChannel(pixels[2], luma);
    expect(pixels[3]).toBe(255);
  });

  it('pure black pixel -> shadow color', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 255]);

    duotone(pixels, 1, 1, {
      shadow: [0, 0, 255, 255],
      highlight: [255, 255, 0, 255],
    });

    expect(pixelAt(pixels)).toEqual([0, 0, 255, 255]);
  });

  it('pure white pixel -> highlight color', () => {
    const pixels = new Uint8ClampedArray([255, 255, 255, 255]);

    duotone(pixels, 1, 1, {
      shadow: [0, 0, 255, 255],
      highlight: [255, 255, 0, 255],
    });

    expect(pixelAt(pixels)).toEqual([255, 255, 0, 255]);
  });

  it('dark pixel has blue tint, bright pixel has yellow tint (blue->yellow duotone)', () => {
    const pixels = new Uint8ClampedArray([
      30, 30, 30, 255,
      220, 220, 220, 255,
    ]);

    duotone(pixels, 2, 1, {
      shadow: [0, 0, 255, 255],
      highlight: [255, 255, 0, 255],
    });

    expect(pixels[2]).toBeGreaterThan(pixels[0]);
    expect(pixels[4]).toBeGreaterThan(pixels[6]);
    expect(pixels[5]).toBeGreaterThan(pixels[6]);
  });

  it('mask coverage=0 leaves pixel unchanged', () => {
    const pixels = new Uint8ClampedArray([100, 150, 200, 128]);
    const before = pixelAt(pixels);

    duotone(pixels, 1, 1, {
      shadow: [0, 0, 0, 255],
      highlight: [255, 255, 255, 255],
      mask: new Uint8ClampedArray([0]),
    });

    expect(pixelAt(pixels)).toEqual(before);
  });

  it('alpha preserved', () => {
    const pixels = new Uint8ClampedArray([128, 128, 128, 77]);

    duotone(pixels, 1, 1, {
      shadow: [0, 0, 255, 255],
      highlight: [255, 255, 0, 255],
    });

    expect(pixels[3]).toBe(77);
  });

  it('w=0 or h=0 does not throw', () => {
    const opts: DuotoneOptions = {
      shadow: [0, 0, 0, 255],
      highlight: [255, 255, 255, 255],
    };

    expect(() => duotone(new Uint8ClampedArray(), 0, 1, opts)).not.toThrow();
    expect(() => duotone(new Uint8ClampedArray(), 1, 0, opts)).not.toThrow();
  });
});
