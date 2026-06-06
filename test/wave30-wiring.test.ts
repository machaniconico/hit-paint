import { beforeEach, describe, expect, it } from 'vitest';

import { useStore, type FilterName } from '../src/state/store';

type Expect<T extends true> = T;
type HasWave30Filters = Expect<
  Extract<FilterName, 'duotone'> extends 'duotone'
    ? Extract<FilterName, 'chromakey'> extends 'chromakey'
      ? true
      : false
    : false
>;
const filterNameTypeCheck: HasWave30Filters = true;

function colorPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = 40 + x * 50 + y * 15;
      pixels[i + 1] = 180 - x * 20 + y * 25;
      pixels[i + 2] = 30 + x * 35 + y * 45;
      pixels[i + 3] = 220 + x * 5 + y * 7;
    }
  }

  return pixels;
}

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
  useStore.getState().newDocument(width, height, 'wave30 wiring');
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

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const offset = (y * width + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}

function isOpaqueGrayscale(pixels: Uint8ClampedArray): boolean {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2] || pixels[i + 3] !== 255) {
      return false;
    }
  }

  return true;
}

function uniqueRedCount(pixels: Uint8ClampedArray): number {
  const seen = new Set<number>();

  for (let i = 0; i < pixels.length; i += 4) {
    seen.add(pixels[i]);
  }

  return seen.size;
}

describe('wave30 wiring', () => {
  beforeEach(() => {
    void filterNameTypeCheck;
    seedActiveLayer(4, 4, colorPixels(4, 4));
  });

  it('FilterName type includes duotone and chromakey', () => {
    expect(filterNameTypeCheck).toBe(true);
  });

  it('applyFilter("duotone") grayscales pixels and undo restores original', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('duotone', {
      shadow: { r: 0, g: 0, b: 0, a: 255 },
      highlight: { r: 255, g: 255, b: 255, a: 255 },
    });

    const after = activePixels();
    expect(Array.from(after)).not.toEqual(before);

    for (let i = 0; i < after.length; i += 4) {
      expect(after[i]).toBe(after[i + 1]);
      expect(after[i + 1]).toBe(after[i + 2]);
      expect(after[i + 3]).toBe(before[i + 3]);
    }

    expect(useStore.getState().canUndo).toBe(true);
    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyFilter("chromakey") makes green pixels transparent and undo restores original', () => {
    seedActiveLayer(2, 2, new Uint8ClampedArray([
      0, 255, 0, 255,
      255, 0, 0, 255,
      0, 230, 20, 200,
      10, 20, 30, 180,
    ]));
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('chromakey', {
      key: { r: 0, g: 255, b: 0, a: 255 },
      tolerance: 80,
    });

    expect(pixelAt(activePixels(), 0, 0, 2)).toEqual([0, 255, 0, 0]);
    expect(pixelAt(activePixels(), 0, 1, 2)[3]).toBe(0);
    expect(pixelAt(activePixels(), 1, 1, 2)).toEqual([10, 20, 30, 180]);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('fillWithCellular replaces pixels with deterministic cellular noise and undo restores original', () => {
    seedActiveLayer(16, 16, midGrayPixels(16, 16));
    const before = Array.from(activePixels());

    useStore.getState().fillWithCellular({ cellSize: 16, seed: 3 });
    const first = Array.from(activePixels());

    expect(first).not.toEqual(before);
    expect(isOpaqueGrayscale(activePixels())).toBe(true);
    expect(uniqueRedCount(activePixels())).toBeGreaterThan(1);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();
    expect(Array.from(activePixels())).toEqual(before);

    seedActiveLayer(16, 16, midGrayPixels(16, 16));
    useStore.getState().fillWithCellular({ cellSize: 16, seed: 3 });

    expect(Array.from(activePixels())).toEqual(first);
  });
});
