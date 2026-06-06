import { beforeEach, describe, expect, it } from 'vitest';

import { useStore, type FilterName } from '../src/state/store';
import type { Quad } from '../src/tools/perspective';

type Expect<T extends true> = T;
type HasWave29Filters = Expect<
  Extract<FilterName, 'chromatic'> extends 'chromatic'
    ? Extract<FilterName, 'oil'> extends 'oil'
      ? true
      : false
    : false
>;
const filterNameTypeCheck: HasWave29Filters = true;

function patternPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = x * 45 + y * 9;
      pixels[i + 1] = x * 11 + y * 41;
      pixels[i + 2] = 220 - x * 23 - y * 17;
      pixels[i + 3] = 180 + x * 7 + y * 5;
    }
  }

  return pixels;
}

function seedActiveLayer(width: number, height: number, pixels: Uint8ClampedArray): void {
  useStore.getState().newDocument(width, height, 'wave29 wiring');
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

function expectPixelsClose(actual: Uint8ClampedArray, expected: number[], tolerance = 1): void {
  expect(actual).toHaveLength(expected.length);

  for (let i = 0; i < actual.length; i += 1) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(tolerance);
  }
}

describe('wave29 wiring', () => {
  beforeEach(() => {
    void filterNameTypeCheck;
    seedActiveLayer(4, 4, patternPixels(4, 4));
  });

  it('FilterName type includes chromatic and oil', () => {
    expect(filterNameTypeCheck).toBe(true);
  });

  it('applyFilter("chromatic", { amount: 3 }) changes pixels and undo restores original', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('chromatic', { amount: 3 });

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyFilter("oil", { radius: 2 }) changes pixels and undo restores original', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('oil', { radius: 2 });

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyPerspective with a trapezoid quad changes pixels and undo restores original', () => {
    const before = Array.from(activePixels());
    const dst: Quad = {
      x0: 0.4, y0: 0,
      x1: 3.6, y1: 0,
      x2: 4, y2: 4,
      x3: 0, y3: 4,
    };

    useStore.getState().applyPerspective(dst);

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyPerspective with an identity quad leaves pixels approximately unchanged', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyPerspective({
      x0: 0, y0: 0,
      x1: 4, y1: 0,
      x2: 4, y2: 4,
      x3: 0, y3: 4,
    });

    expectPixelsClose(activePixels(), before);
  });
});
