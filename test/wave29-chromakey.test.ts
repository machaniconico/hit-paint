import { describe, expect, it } from 'vitest';
import { chromaKey } from '../src/filters/chromakey';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(pixels.slice(index, index + 4));
}

describe('wave29 chroma key', () => {
  it('keys a pure green pixel to transparent alpha', () => {
    const pixels = new Uint8ClampedArray([
      0, 255, 0, 255,
    ]);

    chromaKey(pixels, 1, 1, {
      key: { r: 0, g: 255, b: 0, a: 255 },
      tolerance: 10,
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([0, 255, 0, 0]);
  });

  it('leaves colors very different from the key unchanged', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 123,
    ]);

    chromaKey(pixels, 1, 1, {
      key: { r: 0, g: 255, b: 0, a: 255 },
      tolerance: 10,
      softness: 20,
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([255, 0, 0, 123]);
  });

  it('applies partial alpha in the softness zone', () => {
    const pixels = new Uint8ClampedArray([
      0, 245, 20, 200,
    ]);

    chromaKey(pixels, 1, 1, {
      key: { r: 0, g: 255, b: 0, a: 255 },
      tolerance: 10,
      softness: 20,
    });

    const alpha = pixelAt(pixels, 0, 0, 1)[3];
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(200);
  });

  it('does not modify RGB channels after keying', () => {
    const pixels = new Uint8ClampedArray([
      12, 250, 5, 180,
    ]);

    chromaKey(pixels, 1, 1, {
      key: { r: 10, g: 250, b: 5, a: 255 },
      tolerance: 2,
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([12, 250, 5, 0]);
  });

  it('leaves a mask coverage=0 pixel byte-identical', () => {
    const pixels = new Uint8ClampedArray([
      0, 255, 0, 177,
    ]);

    chromaKey(pixels, 1, 1, {
      key: { r: 0, g: 255, b: 0, a: 255 },
      tolerance: 0,
      mask: new Uint8ClampedArray([0]),
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([0, 255, 0, 177]);
  });

  it('returns without changing pixels when width or height is zero', () => {
    const zeroWidth = new Uint8ClampedArray([
      0, 255, 0, 222,
    ]);
    const zeroHeight = new Uint8ClampedArray([
      0, 255, 0, 111,
    ]);
    const beforeZeroWidth = Array.from(zeroWidth);
    const beforeZeroHeight = Array.from(zeroHeight);
    const opts = {
      key: { r: 0, g: 255, b: 0, a: 255 },
      tolerance: 255,
    };

    expect(() => chromaKey(zeroWidth, 0, 1, opts)).not.toThrow();
    expect(() => chromaKey(zeroHeight, 1, 0, opts)).not.toThrow();

    expect(Array.from(zeroWidth)).toEqual(beforeZeroWidth);
    expect(Array.from(zeroHeight)).toEqual(beforeZeroHeight);
  });
});
