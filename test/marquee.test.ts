import { describe, expect, it } from 'vitest';
import { ellipseMask, polygonMask, rectMask } from '../src/tools/marquee';

function selectedCount(mask: Uint8ClampedArray): number {
  return Array.from(mask).filter((value) => value === 255).length;
}

describe('rectMask', () => {
  it('sets rectangle pixels to 255 and leaves outside pixels at 0', () => {
    const mask = rectMask(5, 4, { x: 1, y: 1, rw: 3, rh: 2 });

    expect(mask.length).toBe(20);
    expect(mask[1 * 5 + 1]).toBe(255);
    expect(mask[2 * 5 + 3]).toBe(255);
    expect(mask[0]).toBe(0);
    expect(mask[3 * 5 + 4]).toBe(0);
    expect(selectedCount(mask)).toBe(6);
  });

  it('clamps rectangles that extend outside the canvas bounds', () => {
    const mask = rectMask(4, 4, { x: -2, y: 1, rw: 4, rh: 5 });

    expect(mask[1 * 4 + 0]).toBe(255);
    expect(mask[3 * 4 + 1]).toBe(255);
    expect(mask[0 * 4 + 0]).toBe(0);
    expect(mask[1 * 4 + 2]).toBe(0);
    expect(selectedCount(mask)).toBe(6);
  });

  it('returns an empty mask for degenerate rectangles', () => {
    const zeroWidth = rectMask(3, 3, { x: 1, y: 1, rw: 0, rh: 2 });
    const negativeHeight = rectMask(3, 3, { x: 1, y: 1, rw: 2, rh: -1 });

    expect(Array.from(zeroWidth)).toEqual(new Array(9).fill(0));
    expect(Array.from(negativeHeight)).toEqual(new Array(9).fill(0));
  });
});

describe('ellipseMask', () => {
  it('sets the ellipse center and axis pixels while leaving corner pixels outside', () => {
    const mask = ellipseMask(7, 7, { cx: 3, cy: 3, rx: 2, ry: 1 });

    expect(mask.length).toBe(49);
    expect(mask[3 * 7 + 3]).toBe(255);
    expect(mask[3 * 7 + 1]).toBe(255);
    expect(mask[0]).toBe(0);
    expect(mask[2 * 7 + 1]).toBe(0);
  });

  it('returns an empty mask for degenerate ellipses', () => {
    const mask = ellipseMask(4, 4, { cx: 2, cy: 2, rx: 0, ry: 2 });

    expect(Array.from(mask)).toEqual(new Array(16).fill(0));
  });
});

describe('polygonMask', () => {
  it('sets triangle interior pixels and leaves exterior pixels at 0', () => {
    const mask = polygonMask(6, 6, [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 1, y: 5 },
    ]);

    expect(mask.length).toBe(36);
    expect(mask[2 * 6 + 2]).toBe(255);
    expect(mask[4 * 6 + 4]).toBe(0);
    expect(mask[0]).toBe(0);
  });

  it('clamps polygon evaluation to the canvas bounds', () => {
    const mask = polygonMask(3, 3, [
      { x: -2, y: -2 },
      { x: 2, y: -2 },
      { x: -2, y: 2 },
    ]);

    expect(mask[0]).toBe(255);
    expect(mask[2 * 3 + 2]).toBe(0);
    expect(mask.length).toBe(9);
  });

  it('returns an empty mask for polygons with fewer than three points', () => {
    const mask = polygonMask(3, 3, [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]);

    expect(Array.from(mask)).toEqual(new Array(9).fill(0));
  });
});
