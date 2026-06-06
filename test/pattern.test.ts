import { describe, expect, it } from 'vitest';
import { makeSeamless, tileFill } from '../src/tools/pattern';

function rgbaAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

describe('pattern tools', () => {
  it('repeats the tile across multiple blocks', () => {
    const dst = new Uint8ClampedArray(4 * 4 * 4);
    const tile = new Uint8ClampedArray([
      255, 0, 0, 255,   0, 255, 0, 255,
      0, 0, 255, 255,   255, 255, 0, 255,
    ]);

    tileFill(dst, 4, 4, tile, 2, 2);

    for (let blockY = 0; blockY < 2; blockY++) {
      for (let blockX = 0; blockX < 2; blockX++) {
        expect(rgbaAt(dst, blockX * 2, blockY * 2, 4)).toEqual([255, 0, 0, 255]);
        expect(rgbaAt(dst, blockX * 2 + 1, blockY * 2, 4)).toEqual([0, 255, 0, 255]);
        expect(rgbaAt(dst, blockX * 2, blockY * 2 + 1, 4)).toEqual([0, 0, 255, 255]);
        expect(rgbaAt(dst, blockX * 2 + 1, blockY * 2 + 1, 4)).toEqual([255, 255, 0, 255]);
      }
    }
  });

  it('applies positive offsets to the repeated tile origin', () => {
    const dst = new Uint8ClampedArray(4 * 1 * 4);
    const tile = new Uint8ClampedArray([
      10, 0, 0, 255,
      20, 0, 0, 255,
    ]);

    tileFill(dst, 4, 1, tile, 2, 1, { offsetX: 1 });

    expect(rgbaAt(dst, 0, 0, 4)).toEqual([20, 0, 0, 255]);
    expect(rgbaAt(dst, 1, 0, 4)).toEqual([10, 0, 0, 255]);
    expect(rgbaAt(dst, 2, 0, 4)).toEqual([20, 0, 0, 255]);
    expect(rgbaAt(dst, 3, 0, 4)).toEqual([10, 0, 0, 255]);
  });

  it('leaves mask=0 pixels unchanged and uses partial mask coverage', () => {
    const dst = new Uint8ClampedArray([
      10, 20, 30, 255,
      10, 20, 30, 255,
    ]);
    const tile = new Uint8ClampedArray([
      255, 0, 0, 255,
    ]);

    tileFill(dst, 2, 1, tile, 1, 1, { mask: new Uint8ClampedArray([0, 128]) });

    expect(rgbaAt(dst, 0, 0, 2)).toEqual([10, 20, 30, 255]);
    expect(rgbaAt(dst, 1, 0, 2)).toEqual([133, 10, 15, 255]);
  });

  it('treats degenerate tile dimensions as no-op', () => {
    const dst = new Uint8ClampedArray([
      1, 2, 3, 4,
    ]);

    tileFill(dst, 1, 1, new Uint8ClampedArray([255, 0, 0, 255]), 0, 1);

    expect(Array.from(dst)).toEqual([1, 2, 3, 4]);
  });

  it('returns a new seamless buffer, preserves the source, and blends opposite edges', () => {
    const src = new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    ]);
    const before = Array.from(src);

    const seamless = makeSeamless(src, 4, 1, 1);

    expect(seamless).not.toBe(src);
    expect(Array.from(src)).toEqual(before);
    expect(rgbaAt(seamless, 0, 0, 4)[0]).toBeLessThan(255);
    expect(rgbaAt(seamless, 0, 0, 4)[2]).toBeGreaterThan(0);
    expect(rgbaAt(seamless, 3, 0, 4)[0]).toBeGreaterThan(0);
    expect(rgbaAt(seamless, 3, 0, 4)[2]).toBeLessThan(255);
  });

  it('returns an empty buffer for invalid seamless dimensions', () => {
    expect(makeSeamless(new Uint8ClampedArray([1, 2, 3, 4]), 0, 1, 1)).toHaveLength(0);
  });
});
