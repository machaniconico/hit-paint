import { describe, expect, it } from 'vitest';

import type { RGBA } from '../src/types';
import {
  createTextLayerData,
  measureTextLayer,
  rasterizeTextLayer,
  updateTextLayerData,
} from '../src/text/text-layer';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

function pixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): RGBA {
  const i = (y * width + x) * 4;
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
}

describe('text layer data', () => {
  it('creates default editable text layer data', () => {
    expect(createTextLayerData()).toEqual({
      text: '',
      x: 0,
      y: 0,
      color: { r: 0, g: 0, b: 0, a: 255 },
      scale: 1,
      letterSpacing: 1,
    });
  });

  it('merges partial text layer data over defaults', () => {
    expect(createTextLayerData({ text: 'Hi', x: 3, color: BLUE })).toEqual({
      text: 'Hi',
      x: 3,
      y: 0,
      color: BLUE,
      scale: 1,
      letterSpacing: 1,
    });
  });

  it('updates text layer data immutably', () => {
    const original = createTextLayerData({ text: 'A', x: 1, color: RED });
    const updated = updateTextLayerData(original, { text: 'B', y: 2 });

    expect(updated).not.toBe(original);
    expect(original).toEqual({ text: 'A', x: 1, y: 0, color: RED, scale: 1, letterSpacing: 1 });
    expect(updated).toEqual({ text: 'B', x: 1, y: 2, color: RED, scale: 1, letterSpacing: 1 });
  });

  it('rasterizes into a new transparent buffer with the requested color', () => {
    const data = createTextLayerData({ text: 'A', color: RED });
    const pixels = rasterizeTextLayer(data, 8, 8);
    const nextPixels = rasterizeTextLayer(data, 8, 8);

    expect(pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(nextPixels).not.toBe(pixels);
    expect(pixels).toHaveLength(8 * 8 * 4);
    expect(pixel(pixels, 8, 1, 0)).toEqual(RED);
    expect(pixel(pixels, 8, 0, 0)).toEqual(TRANSPARENT);
    expect(data).toEqual({ text: 'A', x: 0, y: 0, color: RED, scale: 1, letterSpacing: 1 });
  });

  it('changes rasterized pixels after editing text data', () => {
    const original = createTextLayerData({ text: 'I', color: RED });
    const edited = updateTextLayerData(original, { text: 'L' });

    const before = rasterizeTextLayer(original, 8, 8);
    const after = rasterizeTextLayer(edited, 8, 8);

    expect(pixel(before, 8, 0, 0)).toEqual(TRANSPARENT);
    expect(pixel(after, 8, 0, 0)).toEqual(RED);
    expect(before).not.toEqual(after);
    expect(original.text).toBe('I');
  });

  it('leaves masked-out glyph pixels transparent', () => {
    const data = createTextLayerData({ text: 'A', color: RED });
    const mask = new Uint8ClampedArray(8 * 8).fill(255);
    mask[1] = 0;

    const pixels = rasterizeTextLayer(data, 8, 8, mask);

    expect(pixel(pixels, 8, 1, 0)).toEqual(TRANSPARENT);
    expect(pixel(pixels, 8, 2, 0)).toEqual(RED);
  });

  it('measures an empty text layer as zero width and zero height', () => {
    expect(measureTextLayer(createTextLayerData())).toEqual({ width: 0, height: 0 });
  });
});
