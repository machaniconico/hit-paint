import { describe, expect, it } from 'vitest';
import { paintMaskDab, paintMaskStroke } from '../src/tools/mask-paint';

function index(width: number, x: number, y: number): number {
  return y * width + x;
}

describe('paintMaskDab', () => {
  it('moves the center pixel to the target value', () => {
    const width = 5;
    const mask = new Uint8ClampedArray(width * 5);

    paintMaskDab(mask, width, 5, { x: 2, y: 2, radius: 2, value: 255 });

    expect(mask[index(width, 2, 2)]).toBe(255);
  });

  it('clips out-of-bounds brush areas without throwing', () => {
    const width = 3;
    const mask = new Uint8ClampedArray(width * 3);

    expect(() => {
      paintMaskDab(mask, width, 3, { x: -1, y: -1, radius: 3, value: 200 });
    }).not.toThrow();

    expect(mask[index(width, 0, 0)]).toBe(200);
  });

  it('uses uniform coverage inside a hard circular edge and leaves outside pixels unchanged', () => {
    const width = 7;
    const mask = new Uint8ClampedArray(width * 7);

    paintMaskDab(mask, width, 7, { x: 3, y: 3, radius: 2, value: 180, hardness: 1 });

    expect(mask[index(width, 3, 3)]).toBe(180);
    expect(mask[index(width, 5, 3)]).toBe(180);
    expect(mask[index(width, 4, 4)]).toBe(180);
    expect(mask[index(width, 6, 3)]).toBe(0);
    expect(mask[index(width, 5, 5)]).toBe(0);
  });

  it('creates intermediate edge values with soft hardness', () => {
    const width = 7;
    const mask = new Uint8ClampedArray(width * 7);

    paintMaskDab(mask, width, 7, { x: 3, y: 3, radius: 3, value: 255, hardness: 0.5 });

    expect(mask[index(width, 3, 3)]).toBe(255);
    expect(mask[index(width, 5, 3)]).toBeGreaterThan(0);
    expect(mask[index(width, 5, 3)]).toBeLessThan(255);
  });

  it('blends additively toward the target value from the existing mask value', () => {
    const width = 5;
    const mask = new Uint8ClampedArray(width * 5);
    mask.fill(100);

    paintMaskDab(mask, width, 5, { x: 2, y: 2, radius: 2, value: 200, hardness: 0 });

    expect(mask[index(width, 2, 2)]).toBe(200);
    expect(mask[index(width, 3, 2)]).toBe(150);
  });

  it('does nothing when radius is zero or negative', () => {
    const width = 3;
    const mask = new Uint8ClampedArray(width * 3);
    mask.fill(77);
    const before = Array.from(mask);

    paintMaskDab(mask, width, 3, { x: 1, y: 1, radius: 0, value: 255 });
    paintMaskDab(mask, width, 3, { x: 1, y: 1, radius: -1, value: 255 });

    expect(Array.from(mask)).toEqual(before);
  });
});

describe('paintMaskStroke', () => {
  it('paints interpolated pixels between two points', () => {
    const width = 7;
    const mask = new Uint8ClampedArray(width);

    paintMaskStroke(
      mask,
      width,
      1,
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
      ],
      { radius: 1, value: 255, spacing: 3 },
    );

    expect(mask[index(width, 0, 0)]).toBe(255);
    expect(mask[index(width, 3, 0)]).toBe(255);
    expect(mask[index(width, 6, 0)]).toBe(255);
  });
});
