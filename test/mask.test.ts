import { describe, expect, it } from 'vitest';

import { composite } from '../src/core/compositor';
import { createLayerMask, createRasterLayer } from '../src/core/document';
import type { Layer, PaintDocument } from '../src/types';

function docWith(width: number, height: number, layers: Layer[]): PaintDocument {
  return {
    id: 'doc',
    name: 'mask test',
    width,
    height,
    dpi: 72,
    layers,
    activeLayerId: layers[0]?.id ?? null,
    selection: null,
  };
}

function px(data: Uint8ClampedArray, pixel = 0): number[] {
  const i = pixel * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

describe('layer masks', () => {
  it('creates an 8-bit mask with the requested fill value', () => {
    const mask = createLayerMask(3, 2, 127);

    expect(mask).toBeInstanceOf(Uint8ClampedArray);
    expect(mask.length).toBe(6);
    expect([...mask]).toEqual([127, 127, 127, 127, 127, 127]);
  });

  it('hides a fully opaque source pixel when mask coverage is zero', () => {
    const layer = createRasterLayer(1, 1, 'red', { r: 255, g: 0, b: 0, a: 255 });
    layer.mask = createLayerMask(1, 1, 0);

    const img = composite(docWith(1, 1, [layer]));

    expect(px(img.data)).toEqual([0, 0, 0, 0]);
  });

  it('keeps source pixels unchanged when mask coverage is full', () => {
    const layer = createRasterLayer(1, 1, 'red', { r: 255, g: 0, b: 0, a: 200 });
    layer.mask = createLayerMask(1, 1, 255);

    const img = composite(docWith(1, 1, [layer]));

    expect(px(img.data)).toEqual([255, 0, 0, 200]);
  });

  it('multiplies source alpha by partial mask coverage', () => {
    const layer = createRasterLayer(1, 1, 'red', { r: 255, g: 0, b: 0, a: 255 });
    layer.mask = createLayerMask(1, 1, 128);

    const img = composite(docWith(1, 1, [layer]));

    expect(px(img.data)).toEqual([255, 0, 0, 128]);
  });

  it('multiplies source alpha and mask coverage together', () => {
    const layer = createRasterLayer(1, 1, 'red', { r: 255, g: 0, b: 0, a: 128 });
    layer.mask = createLayerMask(1, 1, 128);

    const img = composite(docWith(1, 1, [layer]));

    expect(px(img.data)[3]).toBe(64);
  });

  it('applies mask coverage per pixel', () => {
    const layer = createRasterLayer(2, 1, 'red', { r: 255, g: 0, b: 0, a: 255 });
    layer.mask = new Uint8ClampedArray([0, 255]);

    const img = composite(docWith(2, 1, [layer]));

    expect(px(img.data, 0)).toEqual([0, 0, 0, 0]);
    expect(px(img.data, 1)).toEqual([255, 0, 0, 255]);
  });
});
