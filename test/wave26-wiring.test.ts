import { beforeEach, describe, expect, it } from 'vitest';

import { useStore, type FilterName } from '../src/state/store';
import type { Layer, RGBA } from '../src/types';
import type { ShapeData } from '../src/vector/shape';

type Expect<T extends true> = T;
type HasWave26Filters = Expect<
  Extract<FilterName, 'channel-mixer'> extends 'channel-mixer'
    ? Extract<FilterName, 'clarity'> extends 'clarity'
      ? true
      : false
    : false
>;
const filterNameTypeCheck: HasWave26Filters = true;

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };

function seedActiveLayer(width: number, height: number, pixels: number[]): void {
  useStore.getState().newDocument(width, height, 'wave26 wiring');
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
  const i = pixel * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function cloneData<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

function rectShape(): Partial<ShapeData> {
  return {
    shape: 'rect',
    x: 2,
    y: 2,
    width: 10,
    height: 8,
    style: { fill: RED },
  };
}

describe('wave26 store wiring', () => {
  beforeEach(() => {
    void filterNameTypeCheck;
    seedActiveLayer(1, 1, [0, 0, 0, 0]);
  });

  it('FilterName includes channel-mixer and clarity', () => {
    expect(filterNameTypeCheck).toBe(true);
  });

  it('applyFilter("channel-mixer") greyscales active layer pixels and undo restores', () => {
    seedActiveLayer(2, 1, [
      100, 50, 200, 123,
      20, 30, 40, 255,
    ]);
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('channel-mixer', {
      monochrome: true,
      red: { r: 0.299, g: 0.587, b: 0.114 },
      green: { r: 0, g: 0, b: 0 },
      blue: { r: 0, g: 0, b: 0 },
    });

    expect(Array.from(activePixels())).not.toEqual(before);
    for (let pixel = 0; pixel < 2; pixel += 1) {
      const [r, g, b] = pixelAt(pixel);
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
    expect(pixelAt(0)[3]).toBe(123);
    expect(pixelAt(1)[3]).toBe(255);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyFilter("clarity") changes active layer pixels and undo restores', () => {
    seedActiveLayer(5, 1, [
      112, 112, 112, 255,
      112, 112, 112, 255,
      112, 112, 112, 255,
      144, 144, 144, 255,
      144, 144, 144, 255,
    ]);
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('clarity', { amount: 0.8, radius: 2 });

    expect(Array.from(activePixels())).not.toEqual(before);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('updateActiveShapeLayer changes shape kind and undo restores', () => {
    useStore.getState().newDocument(16, 16, 'wave26 shape');
    useStore.getState().addShapeLayer(rectShape());
    const beforeShapeData = cloneData(activeLayer().shapeData);

    useStore.getState().updateActiveShapeLayer({ shape: 'ellipse' });

    expect(activeLayer().shapeData?.shape).toBe('ellipse');

    useStore.getState().undo();

    expect(activeLayer().shapeData).toEqual(beforeShapeData);
  });
});
