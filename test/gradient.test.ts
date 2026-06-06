import { describe, expect, it } from 'vitest';
import { fillLinearGradient, fillRadialGradient } from '../src/tools/gradient';
import type { RGBA } from '../src/types';

function px(pixels: Uint8ClampedArray, x: number, y: number, width: number): RGBA {
  const i = (y * width + x) * 4;
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
}

describe('gradient fills', () => {
  it('interpolates the midpoint color between two linear stops', () => {
    const pixels = new Uint8ClampedArray(3 * 1 * 4);

    fillLinearGradient(pixels, 3, 1, {
      x0: 0,
      y0: 0,
      x1: 2,
      y1: 0,
      stops: [
        { t: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
        { t: 1, color: { r: 0, g: 0, b: 255, a: 255 } },
      ],
    });

    expect(px(pixels, 1, 0, 3)).toEqual({ r: 128, g: 0, b: 128, a: 255 });
  });

  it('leaves masked-out pixels unchanged', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      10, 20, 30, 40,
    ]);
    const before = Array.from(pixels);

    fillLinearGradient(pixels, 2, 1, {
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 0,
      stops: [{ t: 0, color: { r: 255, g: 0, b: 0, a: 255 } }],
      mask: new Uint8ClampedArray([0, 255]),
    });

    expect(Array.from(pixels.slice(0, 4))).toEqual(before.slice(0, 4));
    expect(px(pixels, 1, 0, 2)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('uses the first radial stop at the center and the last stop at the edge', () => {
    const pixels = new Uint8ClampedArray(3 * 1 * 4);

    fillRadialGradient(pixels, 3, 1, {
      cx: 0,
      cy: 0,
      radius: 2,
      stops: [
        { t: 1, color: { r: 0, g: 0, b: 255, a: 255 } },
        { t: 0, color: { r: 255, g: 255, b: 255, a: 255 } },
      ],
    });

    expect(px(pixels, 0, 0, 3)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(px(pixels, 2, 0, 3)).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });

  it('fills with a solid color when only one stop is provided', () => {
    const pixels = new Uint8ClampedArray(2 * 2 * 4);
    const color = { r: 12, g: 34, b: 56, a: 200 };

    fillRadialGradient(pixels, 2, 2, {
      cx: 0,
      cy: 0,
      radius: 10,
      stops: [{ t: 0.5, color }],
    });

    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        expect(px(pixels, x, y, 2)).toEqual(color);
      }
    }
  });

  it('interpolates alpha before src-over compositing', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    ]);

    fillLinearGradient(pixels, 3, 1, {
      x0: 0,
      y0: 0,
      x1: 2,
      y1: 0,
      stops: [
        { t: 0, color: { r: 255, g: 0, b: 0, a: 0 } },
        { t: 1, color: { r: 255, g: 0, b: 0, a: 255 } },
      ],
    });

    expect(px(pixels, 1, 0, 3)).toEqual({ r: 128, g: 0, b: 128, a: 255 });
  });

  it('clamps projection values outside the stop range and applies partial mask coverage', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);

    fillLinearGradient(pixels, 3, 1, {
      x0: 1,
      y0: 0,
      x1: 2,
      y1: 0,
      stops: [
        { t: 0, color: { r: 200, g: 0, b: 0, a: 255 } },
        { t: 1, color: { r: 0, g: 200, b: 0, a: 255 } },
      ],
      mask: new Uint8ClampedArray([128, 255, 255]),
    });

    expect(px(pixels, 0, 0, 3)).toEqual({ r: 100, g: 0, b: 0, a: 255 });
    expect(px(pixels, 2, 0, 3)).toEqual({ r: 0, g: 200, b: 0, a: 255 });
  });
});
