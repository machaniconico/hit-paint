import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';

function seedActiveLayer(width: number, height: number, pixels: number[]): void {
  useStore.getState().newDocument(width, height, 'filter menu');
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
  const i = pixel * 4;
  return Array.from(pixels.slice(i, i + 4));
}

describe('filter menu store wiring', () => {
  beforeEach(() => {
    seedActiveLayer(1, 1, [0, 0, 0, 0]);
  });

  it('applyFilter("auto-levels") changes active raster layer pixels', () => {
    seedActiveLayer(4, 1, [
      50, 60, 70, 255,
      60, 70, 80, 255,
      70, 80, 90, 255,
      80, 90, 100, 255,
    ]);
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('auto-levels');

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(pixelAt(0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(3)).toEqual([255, 255, 255, 255]);
  });

  it('applyFilter("mosaic", { blockSize: 2 }) averages a 2x2 block', () => {
    seedActiveLayer(2, 2, [
      0, 10, 20, 30,
      20, 30, 40, 50,
      40, 50, 60, 70,
      60, 70, 80, 90,
    ]);

    useStore.getState().applyFilter('mosaic', { blockSize: 2 });

    expect(pixelAt(0)).toEqual([30, 40, 50, 60]);
    expect(pixelAt(1)).toEqual([30, 40, 50, 60]);
    expect(pixelAt(2)).toEqual([30, 40, 50, 60]);
    expect(pixelAt(3)).toEqual([30, 40, 50, 60]);
  });

  it('respects selection mask and leaves unselected pixels unchanged', () => {
    seedActiveLayer(2, 1, [
      0, 0, 0, 255,
      200, 200, 200, 255,
    ]);
    useStore.setState((state) => ({
      doc: {
        ...state.doc,
        selection: {
          width: 2,
          height: 1,
          mask: new Uint8ClampedArray([255, 0]),
        },
      },
    }));
    const unselectedBefore = pixelAt(1);

    useStore.getState().applyFilter('mosaic', { blockSize: 2 });

    expect(pixelAt(0)).toEqual([100, 100, 100, 255]);
    expect(pixelAt(1)).toEqual(unselectedBefore);
  });

  it('undo restores pixels after applying a filter', () => {
    seedActiveLayer(2, 2, [
      0, 0, 0, 255,
      200, 200, 200, 255,
      50, 50, 50, 255,
      150, 150, 150, 255,
    ]);
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('mosaic', { blockSize: 2 });
    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });
});
