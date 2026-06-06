import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';

function seedActiveLayer(width: number, height: number, pixels: number[]): void {
  useStore.getState().newDocument(width, height, 'quantize menu');
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

function pixelAt(pixel: number): number[] {
  const pixels = activePixels();
  const index = pixel * 4;
  return Array.from(pixels.slice(index, index + 4));
}

function rgbKeyAt(pixel: number): string {
  const [r, g, b] = pixelAt(pixel);
  return `${r},${g},${b}`;
}

function uniqueRgbCount(): number {
  const { doc } = useStore.getState();
  return new Set(Array.from({ length: doc.width * doc.height }, (_, pixel) => rgbKeyAt(pixel))).size;
}

describe('quantize filter menu store wiring', () => {
  beforeEach(() => {
    seedActiveLayer(1, 1, [0, 0, 0, 0]);
  });

  it('applyFilter("quantize", { maxColors: 2 }) reduces active layer color count', () => {
    seedActiveLayer(4, 1, [
      255, 0, 0, 255,
      250, 20, 10, 255,
      0, 0, 255, 255,
      10, 20, 240, 255,
    ]);
    expect(uniqueRgbCount()).toBe(4);

    useStore.getState().applyFilter('quantize', { maxColors: 2 });

    expect(uniqueRgbCount()).toBeLessThanOrEqual(2);
  });

  it('respects selection mask and leaves unselected pixels unchanged', () => {
    seedActiveLayer(3, 1, [
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
    ]);
    useStore.setState((state) => ({
      doc: {
        ...state.doc,
        selection: {
          width: 3,
          height: 1,
          mask: new Uint8ClampedArray([255, 255, 0]),
        },
      },
    }));
    const unselectedBefore = pixelAt(2);

    useStore.getState().applyFilter('quantize', { maxColors: 1 });

    expect(pixelAt(0)).not.toEqual([255, 0, 0, 255]);
    expect(pixelAt(1)).not.toEqual([0, 255, 0, 255]);
    expect(pixelAt(2)).toEqual(unselectedBefore);
  });

  it('undo restores pixels after applying quantize', () => {
    seedActiveLayer(4, 1, [
      255, 0, 0, 255,
      250, 20, 10, 255,
      0, 0, 255, 255,
      10, 20, 240, 255,
    ]);
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('quantize', { maxColors: 2 });
    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });
});
