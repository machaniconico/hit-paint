import { describe, expect, it } from 'vitest';

import type { RGBA } from '../src/types';
import { createShapeData, rasterizeShape, updateShapeData } from '../src/vector/shape';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };

function pixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): RGBA {
  const i = (y * width + x) * 4;
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
}

describe('wave25 shape data', () => {
  it('creates default rect shape data', () => {
    const data = createShapeData();

    expect(data.shape).toBe('rect');
    expect(data.style.fill).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(data.style.stroke).toBeNull();
  });

  it('merges partial shape data over defaults', () => {
    const data = createShapeData({ shape: 'ellipse', style: { fill: BLUE } });

    expect(data.shape).toBe('ellipse');
    expect(data.style.fill).toEqual(BLUE);
    expect(data.style.stroke).toBeNull();
  });

  it('updates shape data immutably', () => {
    const original = createShapeData({ shape: 'rect', x: 1, style: { fill: RED } });
    const updated = updateShapeData(original, { shape: 'ellipse', y: 2, style: { stroke: { color: GREEN, width: 3 } } });

    expect(updated).not.toBe(original);
    expect(updated.style).not.toBe(original.style);
    expect(original).toEqual(createShapeData({ shape: 'rect', x: 1, style: { fill: RED } }));
    expect(updated.shape).toBe('ellipse');
    expect(updated.y).toBe(2);
    expect(updated.style.fill).toEqual(RED);
    expect(updated.style.stroke).toEqual({ color: GREEN, width: 3 });
  });
});

describe('wave25 shape rasterization', () => {
  it('rasterizes a filled rect', () => {
    const pixels = rasterizeShape(createShapeData({ x: 2, y: 2, width: 4, height: 4, style: { fill: RED } }), 10, 10);

    expect(pixel(pixels, 10, 3, 3)).toEqual(RED);
    expect(pixel(pixels, 10, 0, 0).a).toBe(0);
  });

  it('rasterizes a filled ellipse', () => {
    const pixels = rasterizeShape(createShapeData({ shape: 'ellipse', x: 2, y: 2, width: 8, height: 8, style: { fill: RED } }), 12, 12);

    expect(pixel(pixels, 12, 6, 6).a).toBeGreaterThan(0);
    expect(pixel(pixels, 12, 2, 2).a).toBe(0);
  });

  it('rasterizes a filled rounded rect', () => {
    const pixels = rasterizeShape(
      createShapeData({ shape: 'rounded-rect', x: 2, y: 2, width: 8, height: 8, cornerRadius: 3, style: { fill: RED } }),
      12,
      12,
    );

    expect(pixel(pixels, 12, 6, 6).a).toBeGreaterThan(0);
    expect(pixel(pixels, 12, 2, 2).a).toBe(0);
  });

  it('rasterizes a filled hexagon', () => {
    const pixels = rasterizeShape(createShapeData({ shape: 'polygon', x: 2, y: 2, width: 12, height: 12, sides: 6, style: { fill: RED } }), 16, 16);

    expect(pixel(pixels, 16, 8, 8).a).toBeGreaterThan(0);
    expect(pixel(pixels, 16, 0, 0).a).toBe(0);
  });

  it('rasterizes a filled star', () => {
    const pixels = rasterizeShape(
      createShapeData({ shape: 'star', x: 2, y: 2, width: 12, height: 12, sides: 5, innerRatio: 0.5, style: { fill: RED } }),
      16,
      16,
    );

    expect(pixel(pixels, 16, 8, 8).a).toBeGreaterThan(0);
    expect(pixel(pixels, 16, 0, 0).a).toBe(0);
  });

  it('rasterizes a stroked line without fill', () => {
    const pixels = rasterizeShape(
      createShapeData({
        shape: 'line',
        x: 1,
        y: 1,
        width: 8,
        height: 8,
        style: { fill: RED, stroke: { color: BLUE, width: 2 } },
      }),
      12,
      12,
    );

    expect(pixel(pixels, 12, 5, 5)).toEqual(BLUE);
    expect(pixel(pixels, 12, 1, 9).a).toBe(0);
  });

  it('rasterizes a rect stroke over fill', () => {
    const pixels = rasterizeShape(
      createShapeData({ x: 2, y: 2, width: 6, height: 6, style: { fill: RED, stroke: { color: BLUE, width: 2 } } }),
      12,
      12,
    );

    expect(pixel(pixels, 12, 2, 2)).toEqual(BLUE);
  });

  it('returns an empty buffer for zero canvas width', () => {
    const pixels = rasterizeShape(createShapeData(), 0, 10);

    expect(pixels).toHaveLength(0);
  });

  it('applies a visibility mask', () => {
    const mask = new Uint8ClampedArray(10 * 10).fill(255);
    mask[3 * 10 + 3] = 128;
    const pixels = rasterizeShape(createShapeData({ x: 2, y: 2, width: 4, height: 4, style: { fill: RED } }), 10, 10, mask);

    expect(pixel(pixels, 10, 3, 3).a).toBe(128);
  });
});
