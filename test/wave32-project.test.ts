import { describe, expect, it } from 'vitest';

import { deserializeProject, serializeProject } from '../src/io/project';
import type { Layer, PaintDocument } from '../src/types';

function rasterLayer(partial: Partial<Layer> = {}): Layer {
  return {
    id: 'layer-raster',
    name: 'Raster',
    kind: 'raster',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    clipping: false,
    ...partial,
  };
}

function docWith(layers: Layer[]): PaintDocument {
  return {
    id: 'doc-project',
    name: 'Project Test',
    width: 2,
    height: 2,
    dpi: 144,
    layers,
    activeLayerId: layers[0]?.id ?? null,
    selection: null,
  };
}

function bytes(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values);
}

describe('project serialization', () => {
  it('round-trips raster layer pixels exactly', () => {
    const pixels = bytes([0, 1, 2, 3, 10, 20, 30, 40, 255, 128, 64, 32, 7, 8, 9, 10]);
    const doc = docWith([rasterLayer({ pixels })]);

    const restored = deserializeProject(serializeProject(doc));

    expect(restored.layers).toHaveLength(1);
    expect(restored.layers[0].kind).toBe('raster');
    expect(restored.layers[0].blendMode).toBe('normal');
    expect(restored.layers[0].name).toBe('Raster');
    expect(restored.layers[0].pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(restored.layers[0].pixels!)).toEqual(Array.from(pixels));
  });

  it('round-trips shapeData, vectorData, and textData', () => {
    const layer = rasterLayer({
      id: 'editable',
      textData: {
        text: 'Hit',
        x: 4,
        y: 5,
        color: { r: 12, g: 34, b: 56, a: 255 },
        scale: 2,
        letterSpacing: 1,
      },
      vectorData: {
        subpaths: [
          {
            path: { closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
            fill: { r: 1, g: 2, b: 3, a: 255 },
            stroke: { color: { r: 4, g: 5, b: 6, a: 200 }, width: 3, dashArray: [2, 1] },
          },
        ],
      },
      shapeData: {
        shape: 'rounded-rect',
        x: 1,
        y: 2,
        width: 12,
        height: 8,
        cornerRadius: 2,
        style: {
          fill: { r: 90, g: 80, b: 70, a: 255 },
          stroke: { color: { r: 20, g: 30, b: 40, a: 128 }, width: 2 },
        },
      },
    });
    const doc = docWith([layer]);

    const restored = deserializeProject(serializeProject(doc));

    expect(restored.layers[0].textData).toEqual(layer.textData);
    expect(restored.layers[0].vectorData).toEqual(layer.vectorData);
    expect(restored.layers[0].shapeData).toEqual(layer.shapeData);
  });

  it('round-trips layer masks exactly', () => {
    const mask = bytes([0, 64, 128, 255]);
    const doc = docWith([rasterLayer({ mask })]);

    const restored = deserializeProject(serializeProject(doc));

    expect(restored.layers[0].mask).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(restored.layers[0].mask!)).toEqual(Array.from(mask));
  });

  it('writes a numeric top-level version field', () => {
    const serialized = serializeProject(docWith([rasterLayer()]));
    const parsed = JSON.parse(serialized) as { version?: unknown };

    expect(typeof parsed.version).toBe('number');
  });

  it('throws Error for invalid JSON', () => {
    expect(() => deserializeProject('{not json')).toThrow(Error);
  });

  it('preserves layer count across multiple layers', () => {
    const doc = docWith([
      rasterLayer({ id: 'bottom', name: 'Bottom', pixels: bytes([1, 2, 3, 4]) }),
      {
        id: 'group',
        name: 'Group',
        kind: 'group',
        visible: true,
        opacity: 0.5,
        blendMode: 'multiply',
        locked: false,
        clipping: false,
        children: ['bottom'],
      },
      {
        id: 'adjustment',
        name: 'Invert',
        kind: 'adjustment',
        visible: false,
        opacity: 1,
        blendMode: 'normal',
        locked: true,
        clipping: true,
        adjustment: { type: 'invert' },
      },
    ]);

    const restored = deserializeProject(serializeProject(doc));

    expect(restored.layers).toHaveLength(3);
    expect(restored.layers.map((layer) => layer.id)).toEqual(['bottom', 'group', 'adjustment']);
    expect(restored.layers[1].children).toEqual(['bottom']);
    expect(restored.layers[2].adjustment).toEqual({ type: 'invert' });
  });
});
