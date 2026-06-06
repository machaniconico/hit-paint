import { beforeEach, describe, expect, it } from 'vitest';

import { useStore, type FilterName } from '../src/state/store';

type Expect<T extends true> = T;
type HasHalftoneFilter = Expect<
  Extract<FilterName, 'halftone'> extends 'halftone' ? true : false
>;
const filterNameTypeCheck: HasHalftoneFilter = true;

function midGrayPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 128;
    pixels[i + 1] = 128;
    pixels[i + 2] = 128;
    pixels[i + 3] = 255;
  }

  return pixels;
}

function seedActiveLayer(width: number, height: number, pixels: Uint8ClampedArray): void {
  useStore.getState().newDocument(width, height, 'wave28 wiring');
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

function countRed(pixels: Uint8ClampedArray, value: number): number {
  let count = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] === value) count++;
  }

  return count;
}

function isOpaqueGrayscale(pixels: Uint8ClampedArray): boolean {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2] || pixels[i + 3] !== 255) {
      return false;
    }
  }

  return true;
}

describe('wave28 wiring', () => {
  beforeEach(() => {
    void filterNameTypeCheck;
    seedActiveLayer(8, 8, midGrayPixels(8, 8));
  });

  it('FilterName type includes halftone', () => {
    expect(filterNameTypeCheck).toBe(true);
  });

  it('applyFilter("halftone", { cellSize: 4 }) produces dots and undo restores original pixels', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('halftone', { cellSize: 4 });

    const after = activePixels();
    expect(countRed(after, 0)).toBeGreaterThan(0);
    expect(countRed(after, 255)).toBeGreaterThan(0);
    expect(Array.from(after)).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('fillWithNoise({ scale: 16, seed: 2 }) changes active layer pixels to noise and undo restores original', () => {
    const before = Array.from(activePixels());

    useStore.getState().fillWithNoise({ scale: 16, seed: 2 });

    const after = activePixels();
    expect(Array.from(after)).not.toEqual(before);
    expect(isOpaqueGrayscale(after)).toBe(true);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('fillWithNoise produces deterministic pixels for the same seed', () => {
    useStore.getState().fillWithNoise({ scale: 16, seed: 2 });
    const first = Array.from(activePixels());

    seedActiveLayer(8, 8, midGrayPixels(8, 8));
    useStore.getState().fillWithNoise({ scale: 16, seed: 2 });
    const second = Array.from(activePixels());

    expect(second).toEqual(first);
  });
});
