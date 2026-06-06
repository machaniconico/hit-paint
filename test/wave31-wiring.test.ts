import { beforeEach, describe, expect, it } from 'vitest';

import { useStore, type FilterName } from '../src/state/store';
import { createMeshGrid } from '../src/tools/mesh-warp';

type Expect<T extends true> = T;
type HasWave31Filters = Expect<
  Extract<FilterName, 'sketch'> extends 'sketch'
    ? Extract<FilterName, 'adaptive-threshold'> extends 'adaptive-threshold'
      ? true
      : false
    : false
>;
const filterNameTypeCheck: HasWave31Filters = true;

function patternPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = 20 + x * 30 + y * 8;
      pixels[i + 1] = 200 - x * 18 + y * 6;
      pixels[i + 2] = 40 + x * 11 + y * 28;
      pixels[i + 3] = 255;
    }
  }

  return pixels;
}

function seedActiveLayer(width: number, height: number, pixels: Uint8ClampedArray): void {
  useStore.getState().newDocument(width, height, 'wave31 wiring');
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

function activePixels(): Uint8ClampedArray {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer?.pixels) throw new Error('active raster layer is missing pixels');
  return layer.pixels;
}

function expectBinaryRgb(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    expect([0, 255]).toContain(pixels[i]);
    expect([0, 255]).toContain(pixels[i + 1]);
    expect([0, 255]).toContain(pixels[i + 2]);
    expect(pixels[i]).toBe(pixels[i + 1]);
    expect(pixels[i]).toBe(pixels[i + 2]);
  }
}

function maxChannelDelta(actual: Uint8ClampedArray, expected: number[]): number {
  let maxDelta = 0;

  for (let i = 0; i < actual.length; i += 1) {
    maxDelta = Math.max(maxDelta, Math.abs(actual[i] - expected[i]));
  }

  return maxDelta;
}

describe('wave31 wiring', () => {
  beforeEach(() => {
    void filterNameTypeCheck;
    seedActiveLayer(6, 6, patternPixels(6, 6));
  });

  it('FilterName type includes sketch and adaptive-threshold', () => {
    expect(filterNameTypeCheck).toBe(true);
  });

  it('applyFilter("sketch", { blurRadius: 4 }) changes pixels and undo restores original', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('sketch', { blurRadius: 4 });

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyFilter("adaptive-threshold", { radius: 6 }) binarizes pixels and undo restores original', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('adaptive-threshold', { radius: 6 });

    expect(Array.from(activePixels())).not.toEqual(before);
    expectBinaryRgb(activePixels());
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyMeshWarp with a center-shifted grid changes pixels and undo restores original', () => {
    const before = Array.from(activePixels());
    const grid = createMeshGrid(6, 6, 2, 2);
    grid.points[4] = { x: grid.points[4].x + 1, y: grid.points[4].y - 1 };

    useStore.getState().applyMeshWarp(grid);

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyMeshWarp with an identity grid leaves pixels byte-close', () => {
    const before = Array.from(activePixels());
    const grid = createMeshGrid(6, 6, 2, 2);

    expect(() => useStore.getState().applyMeshWarp(grid)).not.toThrow();

    expect(maxChannelDelta(activePixels(), before)).toBeLessThanOrEqual(2);
  });
});
