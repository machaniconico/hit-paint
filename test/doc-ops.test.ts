import { describe, expect, it } from 'vitest';

import { cropDocument, resizeCanvas } from '../src/core/doc-ops';
import type { Layer, PaintDocument } from '../src/types';

function rgba(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values.flatMap((value) => [value, value + 1, value + 2, value + 3]));
}

function pixelValues(pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(pixels.slice(index, index + 4));
}

function raster(id: string, width: number, height: number, pixels = rgba([...Array(width * height).keys()])): Layer {
  return {
    id,
    name: id,
    kind: 'raster',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    clipping: false,
    pixels,
  };
}

function emptyRaster(id: string): Layer {
  return {
    id,
    name: id,
    kind: 'raster',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    clipping: false,
  };
}

function group(id: string, children: string[] = []): Layer {
  return {
    id,
    name: id,
    kind: 'group',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    clipping: false,
    children,
  };
}

function adjustment(id: string): Layer {
  return {
    id,
    name: id,
    kind: 'adjustment',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    clipping: false,
    adjustment: { type: 'invert' },
  };
}

function docWith(width: number, height: number, layers: Layer[]): PaintDocument {
  return {
    id: 'doc',
    name: 'doc ops test',
    width,
    height,
    dpi: 72,
    layers,
    activeLayerId: layers[0]?.id ?? null,
    selection: null,
  };
}

describe('document operations', () => {
  it('crops document dimensions, raster pixels, and masks to the requested rectangle', () => {
    const layer = raster('paint', 4, 3);
    layer.mask = new Uint8ClampedArray([0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23]);
    const doc = docWith(4, 3, [layer]);

    const cropped = cropDocument(doc, { x: 1, y: 1, w: 2, h: 2 });
    const croppedLayer = cropped.layers[0];

    expect(cropped.width).toBe(2);
    expect(cropped.height).toBe(2);
    expect(pixelValues(croppedLayer.pixels!, 2, 0, 0)).toEqual([5, 6, 7, 8]);
    expect(pixelValues(croppedLayer.pixels!, 2, 1, 0)).toEqual([6, 7, 8, 9]);
    expect(pixelValues(croppedLayer.pixels!, 2, 0, 1)).toEqual([9, 10, 11, 12]);
    expect(Array.from(croppedLayer.mask!)).toEqual([11, 12, 21, 22]);
  });

  it('does not mutate the original document, layer array, pixels, or masks when cropping', () => {
    const layer = raster('paint', 3, 2);
    layer.mask = new Uint8ClampedArray([1, 2, 3, 4, 5, 6]);
    const originalPixels = new Uint8ClampedArray(layer.pixels!);
    const originalMask = new Uint8ClampedArray(layer.mask);
    const doc = docWith(3, 2, [layer]);

    const cropped = cropDocument(doc, { x: 1, y: 0, w: 2, h: 1 });

    expect(cropped).not.toBe(doc);
    expect(cropped.layers).not.toBe(doc.layers);
    expect(cropped.layers[0]).not.toBe(layer);
    expect(cropped.layers[0].pixels).not.toBe(layer.pixels);
    expect(cropped.layers[0].mask).not.toBe(layer.mask);
    expect(doc.width).toBe(3);
    expect(doc.height).toBe(2);
    expect(Array.from(layer.pixels!)).toEqual(Array.from(originalPixels));
    expect(Array.from(layer.mask!)).toEqual(Array.from(originalMask));
  });

  it('expands resizeCanvas from the top-left and leaves new margins transparent', () => {
    const doc = docWith(2, 1, [raster('paint', 2, 1, rgba([40, 80]))]);

    const resized = resizeCanvas(doc, { w: 4, h: 3 });
    const pixels = resized.layers[0].pixels!;

    expect(resized.width).toBe(4);
    expect(resized.height).toBe(3);
    expect(pixelValues(pixels, 4, 0, 0)).toEqual([40, 41, 42, 43]);
    expect(pixelValues(pixels, 4, 1, 0)).toEqual([80, 81, 82, 83]);
    expect(pixelValues(pixels, 4, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelValues(pixels, 4, 0, 2)).toEqual([0, 0, 0, 0]);
  });

  it('places existing pixels at the center when using center anchor', () => {
    const doc = docWith(2, 2, [raster('paint', 2, 2, rgba([10, 20, 30, 40]))]);

    const resized = resizeCanvas(doc, { w: 4, h: 4, anchor: 'center' });
    const pixels = resized.layers[0].pixels!;

    expect(pixelValues(pixels, 4, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelValues(pixels, 4, 1, 1)).toEqual([10, 11, 12, 13]);
    expect(pixelValues(pixels, 4, 2, 1)).toEqual([20, 21, 22, 23]);
    expect(pixelValues(pixels, 4, 1, 2)).toEqual([30, 31, 32, 33]);
    expect(pixelValues(pixels, 4, 2, 2)).toEqual([40, 41, 42, 43]);
  });

  it('shrinks resizeCanvas by clipping pixels outside the new canvas', () => {
    const doc = docWith(3, 2, [raster('paint', 3, 2)]);

    const resized = resizeCanvas(doc, { w: 2, h: 1 });

    expect(Array.from(resized.layers[0].pixels!)).toEqual(Array.from(rgba([0, 1])));
  });

  it('handles group, adjustment, and raster layers without pixels', () => {
    const empty = emptyRaster('empty');
    const baseGroup = group('group', ['empty']);
    const invert = adjustment('adjustment');
    const doc = docWith(2, 2, [empty, baseGroup, invert]);

    const cropped = cropDocument(doc, { x: 0, y: 0, w: 1, h: 1 });
    const resized = resizeCanvas(doc, { w: 3, h: 3, anchor: 'center' });

    expect(cropped.layers[0].pixels).toBeUndefined();
    expect(cropped.layers[1].kind).toBe('group');
    expect(cropped.layers[1].children).toEqual(['empty']);
    expect(cropped.layers[2].kind).toBe('adjustment');
    expect(resized.layers).toHaveLength(3);
  });
});
