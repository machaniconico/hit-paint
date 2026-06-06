import { describe, it, expect } from 'vitest';
import {
  maskIntersect,
  maskInvert,
  maskSubtract,
  maskUnion,
  maskXor,
} from '../src/vector/path-bool';

function values(mask: Uint8ClampedArray): number[] {
  return Array.from(mask);
}

describe('wave24 path boolean masks', () => {
  it('maskUnion returns the pixel-wise maximum coverage', () => {
    const result = maskUnion(
      new Uint8ClampedArray([0, 128, 255, 0]),
      new Uint8ClampedArray([255, 128, 0, 0]),
    );

    expect(values(result)).toEqual([255, 128, 255, 0]);
  });

  it('maskIntersect returns the pixel-wise minimum coverage', () => {
    const result = maskIntersect(
      new Uint8ClampedArray([0, 128, 255, 0]),
      new Uint8ClampedArray([255, 128, 0, 0]),
    );

    expect(values(result)).toEqual([0, 128, 0, 0]);
  });

  it('maskSubtract clamps pixel-wise differences at zero', () => {
    const result = maskSubtract(
      new Uint8ClampedArray([0, 128, 255, 0]),
      new Uint8ClampedArray([255, 128, 0, 0]),
    );

    expect(values(result)).toEqual([0, 0, 255, 0]);
  });

  it('maskXor returns absolute pixel-wise coverage differences', () => {
    const result = maskXor(
      new Uint8ClampedArray([0, 128, 255, 0]),
      new Uint8ClampedArray([255, 128, 0, 0]),
    );

    expect(values(result)).toEqual([255, 0, 255, 0]);
  });

  it('maskInvert flips each coverage value around 255', () => {
    const result = maskInvert(new Uint8ClampedArray([0, 128, 255, 100]));

    expect(values(result)).toEqual([255, 127, 0, 155]);
  });

  it('boolean mask operations do not mutate their inputs', () => {
    const operations = [
      (a: Uint8ClampedArray, b: Uint8ClampedArray) => maskUnion(a, b),
      (a: Uint8ClampedArray, b: Uint8ClampedArray) => maskIntersect(a, b),
      (a: Uint8ClampedArray, b: Uint8ClampedArray) => maskSubtract(a, b),
      (a: Uint8ClampedArray, b: Uint8ClampedArray) => maskXor(a, b),
    ];

    for (const operation of operations) {
      const a = new Uint8ClampedArray([0, 64, 128, 255]);
      const b = new Uint8ClampedArray([255, 128, 64, 0]);
      const originalA = values(a);
      const originalB = values(b);

      const result = operation(a, b);

      expect(result).not.toBe(a);
      expect(result).not.toBe(b);
      expect(values(a)).toEqual(originalA);
      expect(values(b)).toEqual(originalB);
    }

    const input = new Uint8ClampedArray([0, 64, 128, 255]);
    const original = values(input);
    const result = maskInvert(input);

    expect(result).not.toBe(input);
    expect(values(input)).toEqual(original);
  });

  it('maskInvert is reversible when applied twice', () => {
    const input = new Uint8ClampedArray([0, 1, 64, 128, 200, 255]);

    expect(maskInvert(maskInvert(input))).toEqual(input);
  });

  it('maskUnion accepts a shorter secondary mask without changing output length', () => {
    const result = maskUnion(new Uint8ClampedArray([10, 20, 30]), new Uint8ClampedArray([5]));

    expect(result).toHaveLength(3);
    expect(values(result)).toEqual([10, 20, 30]);
  });
});
