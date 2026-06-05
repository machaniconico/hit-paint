import { describe, expect, it } from 'vitest';

import { composite } from '../src/core/compositor';
import { createGroupLayer, createLayerMask, createRasterLayer } from '../src/core/document';
import { compositeAuto, isWebGLAvailable } from '../src/core/gpu-compositor';
import type { Layer, PaintDocument } from '../src/types';

function docWith(width: number, height: number, layers: Layer[]): PaintDocument {
  return {
    id: 'doc',
    name: 'gpu compositor test',
    width,
    height,
    dpi: 72,
    layers,
    activeLayerId: layers[0]?.id ?? null,
    selection: null,
  };
}

function expectAutoMatchesCpu(doc: PaintDocument): void {
  const gpu = compositeAuto(doc);
  const cpu = composite(doc);

  expect(gpu.width).toBe(cpu.width);
  expect(gpu.height).toBe(cpu.height);
  expect(Array.from(gpu.data)).toEqual(Array.from(cpu.data));
}

describe('gpu compositor fallback', () => {
  it('reports WebGL2 as unavailable in jsdom', () => {
    expect(isWebGLAvailable()).toBe(false);
  });

  it('falls back byte-identically for normal layers', () => {
    const base = createRasterLayer(2, 1, 'base', { r: 20, g: 40, b: 60, a: 255 });
    const top = createRasterLayer(2, 1, 'top', { r: 200, g: 100, b: 50, a: 128 });
    top.pixels![4] = 0;
    top.pixels![5] = 255;
    top.pixels![6] = 120;
    top.pixels![7] = 64;

    expectAutoMatchesCpu(docWith(2, 1, [base, top]));
  });

  it('falls back byte-identically for multiply and screen blends', () => {
    const base = createRasterLayer(2, 1, 'base', { r: 120, g: 80, b: 40, a: 255 });
    const multiply = createRasterLayer(2, 1, 'multiply', { r: 200, g: 160, b: 80, a: 192 });
    const screen = createRasterLayer(2, 1, 'screen', { r: 30, g: 90, b: 220, a: 128 });
    multiply.blendMode = 'multiply';
    screen.blendMode = 'screen';

    expectAutoMatchesCpu(docWith(2, 1, [base, multiply, screen]));
  });

  it('falls back byte-identically for masks and groups', () => {
    const white = createRasterLayer(1, 1, 'white', { r: 255, g: 255, b: 255, a: 255 });
    const black = createRasterLayer(1, 1, 'black', { r: 0, g: 0, b: 0, a: 255 });
    const group = createGroupLayer('group', [black.id]);
    group.mask = createLayerMask(1, 1, 128);

    expectAutoMatchesCpu(docWith(1, 1, [white, black, group]));
  });
});
