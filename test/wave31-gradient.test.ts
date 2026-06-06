import { describe, expect, it } from 'vitest';
import { generateGradient, sampleGradient } from '../src/engine/gradient';
import type { RGBA } from '../src/types';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): RGBA {
  const i = (y * width + x) * 4;
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
}

describe('wave31 gradient engine', () => {
  it('samples a two-stop black to white gradient', () => {
    const stops = [
      { offset: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
      { offset: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
    ];

    expect(sampleGradient(stops, 0)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(sampleGradient(stops, 1)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(sampleGradient(stops, 0.5)).toEqual({ r: 128, g: 128, b: 128, a: 255 });
  });

  it('clamps out-of-range sample positions', () => {
    const stops = [
      { offset: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
      { offset: 1, color: { r: 0, g: 0, b: 255, a: 255 } },
    ];

    expect(sampleGradient(stops, -1)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(sampleGradient(stops, 2)).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });

  it('generates a horizontal linear gradient from left to right', () => {
    const pixels = generateGradient(3, 1, {
      kind: 'linear',
      x0: 0,
      y0: 0,
      x1: 2,
      y1: 0,
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
        { offset: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
      ],
    });

    expect(pixelAt(pixels, 0, 0, 3)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(pixelAt(pixels, 1, 0, 3)).toEqual({ r: 128, g: 128, b: 128, a: 255 });
    expect(pixelAt(pixels, 2, 0, 3)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it('generates a radial gradient from center to outer edge', () => {
    const pixels = generateGradient(3, 1, {
      kind: 'radial',
      x0: 0,
      y0: 0,
      x1: 2,
      y1: 0,
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
        { offset: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
      ],
    });

    expect(pixelAt(pixels, 0, 0, 3)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(pixelAt(pixels, 2, 0, 3)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it('generates a conic gradient by angle around the center', () => {
    const pixels = generateGradient(2, 2, {
      kind: 'conic',
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 0,
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
        { offset: 0.25, color: { r: 255, g: 255, b: 255, a: 255 } },
        { offset: 1, color: { r: 0, g: 0, b: 0, a: 255 } },
      ],
    });

    expect(pixelAt(pixels, 1, 0, 2)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(pixelAt(pixels, 0, 1, 2)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it('sorts unsorted stops before interpolation', () => {
    const color = sampleGradient([
      { offset: 1, color: { r: 0, g: 0, b: 255, a: 255 } },
      { offset: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
      { offset: 0.5, color: { r: 0, g: 255, b: 0, a: 255 } },
    ], 0.25);

    expect(color).toEqual({ r: 128, g: 128, b: 0, a: 255 });
  });

  it('returns transparent pixels for empty stops and an empty buffer for empty dimensions', () => {
    expect(generateGradient(0, 4, {
      kind: 'linear',
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 0,
      stops: [],
    })).toHaveLength(0);

    expect(Array.from(generateGradient(1, 1, {
      kind: 'linear',
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 0,
      stops: [],
    }))).toEqual([0, 0, 0, 0]);
  });
});
