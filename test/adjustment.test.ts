import { describe, expect, it } from 'vitest';

import { composite } from '../src/core/compositor';
import { createAdjustmentLayer, createRasterLayer } from '../src/core/document';
import type { Layer, PaintDocument } from '../src/types';

function docWith(width: number, height: number, layers: Layer[]): PaintDocument {
  return {
    id: 'doc',
    name: 'adjustment test',
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

describe('adjustment layers', () => {
  it('creates an adjustment layer without a pixel buffer', () => {
    const layer = createAdjustmentLayer('invert', undefined, 'invert adjustment');

    expect(layer.kind).toBe('adjustment');
    expect(layer.name).toBe('invert adjustment');
    expect(layer.adjustment).toEqual({ type: 'invert', opts: undefined });
    expect(layer.pixels).toBeUndefined();
  });

  it('inverts the composited backdrop below the adjustment layer', () => {
    const base = createRasterLayer(1, 1, 'base', { r: 10, g: 20, b: 30, a: 255 });
    const adjustment = createAdjustmentLayer('invert');

    const img = composite(docWith(1, 1, [base, adjustment]));

    expect(px(img.data)).toEqual([245, 235, 225, 255]);
  });

  it('uses opacity as adjustment effect strength', () => {
    const base = createRasterLayer(1, 1, 'base', { r: 10, g: 20, b: 30, a: 255 });
    const adjustment = createAdjustmentLayer('invert');
    adjustment.opacity = 0.5;

    const img = composite(docWith(1, 1, [base, adjustment]));

    expect(px(img.data)).toEqual([128, 128, 128, 255]);
  });

  it('keeps mask=0 pixels unchanged', () => {
    const base = createRasterLayer(2, 1, 'base', { r: 10, g: 20, b: 30, a: 255 });
    const adjustment = createAdjustmentLayer('invert');
    adjustment.mask = new Uint8ClampedArray([0, 255]);

    const img = composite(docWith(2, 1, [base, adjustment]));

    expect(px(img.data, 0)).toEqual([10, 20, 30, 255]);
    expect(px(img.data, 1)).toEqual([245, 235, 225, 255]);
  });

  it('applies grayscale to the composited backdrop', () => {
    const base = createRasterLayer(1, 1, 'base', { r: 100, g: 150, b: 200, a: 64 });
    const adjustment = createAdjustmentLayer('grayscale');

    const img = composite(docWith(1, 1, [base, adjustment]));

    expect(px(img.data)).toEqual([141, 141, 141, 64]);
  });

  it('does not change composite output when no adjustment layer is present', () => {
    const base = createRasterLayer(1, 1, 'base', { r: 100, g: 150, b: 200, a: 255 });
    const top = createRasterLayer(1, 1, 'top', { r: 200, g: 50, b: 0, a: 128 });

    const img = composite(docWith(1, 1, [base, top]));

    expect(px(img.data)).toEqual([150, 100, 100, 255]);
  });
});
