import { describe, expect, it } from 'vitest';

import { composite } from '../src/core/compositor';
import { createGroupLayer, createLayerMask, createRasterLayer } from '../src/core/document';
import type { Layer, PaintDocument } from '../src/types';

function docWith(width: number, height: number, layers: Layer[]): PaintDocument {
  return {
    id: 'doc',
    name: 'group test',
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

describe('group compositing', () => {
  it('creates a group layer without a pixel buffer', () => {
    const group = createGroupLayer();

    expect(group.kind).toBe('group');
    expect(group.name).toBe('グループ');
    expect(group.children).toEqual([]);
    expect(group.pixels).toBeUndefined();
  });

  it('composites group children in children array order from bottom to top', () => {
    const red = createRasterLayer(1, 1, 'red', { r: 255, g: 0, b: 0, a: 255 });
    const blue = createRasterLayer(1, 1, 'blue', { r: 0, g: 0, b: 255, a: 128 });
    const group = createGroupLayer('group', [red.id, blue.id]);

    const img = composite(docWith(1, 1, [red, blue, group]));

    expect(px(img.data)).toEqual([127, 0, 128, 255]);
  });

  it('applies group opacity when compositing the group buffer onto the backdrop', () => {
    const white = createRasterLayer(1, 1, 'white', { r: 255, g: 255, b: 255, a: 255 });
    const black = createRasterLayer(1, 1, 'black', { r: 0, g: 0, b: 0, a: 255 });
    const group = createGroupLayer('group', [black.id]);
    group.opacity = 0.5;

    const img = composite(docWith(1, 1, [white, black, group]));

    expect(px(img.data)).toEqual([128, 128, 128, 255]);
  });

  it('uses the group blend mode for the resolved group buffer', () => {
    const gray = createRasterLayer(1, 1, 'gray', { r: 100, g: 100, b: 100, a: 255 });
    const red = createRasterLayer(1, 1, 'red', { r: 200, g: 0, b: 0, a: 255 });
    const group = createGroupLayer('group', [red.id]);
    group.blendMode = 'multiply';

    const img = composite(docWith(1, 1, [gray, red, group]));

    expect(px(img.data)).toEqual([78, 0, 0, 255]);
  });

  it('skips group children in the flat top-level pass to avoid double compositing', () => {
    const white = createRasterLayer(1, 1, 'white', { r: 255, g: 255, b: 255, a: 255 });
    const black = createRasterLayer(1, 1, 'black', { r: 0, g: 0, b: 0, a: 128 });
    const group = createGroupLayer('group', [black.id]);
    group.opacity = 0.5;

    const img = composite(docWith(1, 1, [white, black, group]));

    expect(px(img.data)).toEqual([191, 191, 191, 255]);
  });

  it('treats an empty group as transparent', () => {
    const white = createRasterLayer(1, 1, 'white', { r: 255, g: 255, b: 255, a: 255 });
    const group = createGroupLayer('group');

    const img = composite(docWith(1, 1, [white, group]));

    expect(px(img.data)).toEqual([255, 255, 255, 255]);
  });

  it('applies a group mask to the resolved group alpha', () => {
    const white = createRasterLayer(1, 1, 'white', { r: 255, g: 255, b: 255, a: 255 });
    const black = createRasterLayer(1, 1, 'black', { r: 0, g: 0, b: 0, a: 255 });
    const group = createGroupLayer('group', [black.id]);
    group.mask = createLayerMask(1, 1, 128);

    const img = composite(docWith(1, 1, [white, black, group]));

    expect(px(img.data)).toEqual([127, 127, 127, 255]);
  });
});
