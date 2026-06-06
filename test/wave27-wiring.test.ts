import { beforeEach, describe, expect, it } from 'vitest';

import { useStore, type FilterName } from '../src/state/store';
import type { Layer, RGBA } from '../src/types';
import type { ShapeData } from '../src/vector/shape';

type Expect<T extends true> = T;
type HasWave27Filters = Expect<
  Extract<FilterName, 'gaussian'> extends 'gaussian'
    ? Extract<FilterName, 'bloom'> extends 'bloom'
      ? true
      : false
    : false
>;
const filterNameTypeCheck: HasWave27Filters = true;

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };

function seedActiveLayer(width: number, height: number, pixels: number[]): void {
  useStore.getState().newDocument(width, height, 'wave27 wiring');
  const { doc } = useStore.getState();
  useStore.setState({
    doc: {
      ...doc,
      layers: doc.layers.map((layer) => (
        layer.id === doc.activeLayerId
          ? { ...layer, pixels: new Uint8ClampedArray(pixels) }
          : layer
      )),
      selection: null,
    },
  });
}

function activeLayer(): Layer {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer) throw new Error('active layer not found');
  return layer;
}

function activePixels(): Uint8ClampedArray {
  const layer = activeLayer();
  if (!layer.pixels) throw new Error('active raster layer is missing pixels');
  return layer.pixels;
}

function pixelAt(pixel: number): number[] {
  const pixels = activePixels();
  const index = pixel * 4;
  return Array.from(pixels.slice(index, index + 4));
}

function cloneData<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

function roundedRectShape(): Partial<ShapeData> {
  return {
    shape: 'rounded-rect',
    x: 2,
    y: 2,
    width: 12,
    height: 12,
    cornerRadius: 0,
    style: { fill: RED, stroke: null },
  };
}

describe('wave27 store wiring', () => {
  beforeEach(() => {
    void filterNameTypeCheck;
    seedActiveLayer(1, 1, [0, 0, 0, 0]);
  });

  it('FilterName type includes gaussian and bloom', () => {
    expect(filterNameTypeCheck).toBe(true);
  });

  it('applyFilter("gaussian", { radius: 3 }) changes pixels and undo restores them', () => {
    seedActiveLayer(5, 1, [
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('gaussian', { radius: 3 });

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(pixelAt(2)[0]).toBeLessThan(255);
    expect(pixelAt(1)[0]).toBeGreaterThan(0);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyFilter("bloom", { threshold: 100, radius: 4, intensity: 1 }) brightens near bright areas and undo restores', () => {
    seedActiveLayer(5, 1, [
      0, 0, 0, 255,
      0, 0, 0, 255,
      220, 220, 220, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('bloom', { threshold: 100, radius: 4, intensity: 1 });

    expect(pixelAt(1)[0]).toBeGreaterThan(0);
    expect(pixelAt(3)[0]).toBeGreaterThan(0);
    expect(Array.from(activePixels())).not.toEqual(before);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('updateActiveShapeLayer({ cornerRadius: 8 }) reflects shape data, regenerates pixels, and undo restores', () => {
    useStore.getState().newDocument(16, 16, 'wave27 shape');
    useStore.getState().addShapeLayer(roundedRectShape());
    const beforeShapeData = cloneData(activeLayer().shapeData);
    const beforePixels = Array.from(activePixels());

    useStore.getState().updateActiveShapeLayer({ cornerRadius: 8 });

    expect(activeLayer().shapeData?.cornerRadius).toBe(8);
    expect(Array.from(activePixels())).not.toEqual(beforePixels);

    useStore.getState().undo();

    expect(activeLayer().shapeData).toEqual(beforeShapeData);
    expect(Array.from(activePixels())).toEqual(beforePixels);
  });
});
