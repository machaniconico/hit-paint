import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';

function seedActiveLayer(width: number, height: number, pixels: number[]): void {
  useStore.getState().newDocument(width, height, 'filter menu 2');
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

describe('new filter menu store wiring', () => {
  beforeEach(() => {
    seedActiveLayer(1, 1, [0, 0, 0, 0]);
  });

  it('applyFilter("equalize") changes active raster layer pixels', () => {
    seedActiveLayer(4, 1, [
      96, 96, 96, 255,
      104, 104, 104, 255,
      112, 112, 112, 255,
      120, 120, 120, 255,
    ]);
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('equalize');

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(pixelAt(0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(3)).toEqual([255, 255, 255, 255]);
  });

  it('applyFilter("gamma", { gamma: 2 }) brightens midtones', () => {
    seedActiveLayer(1, 1, [
      64, 128, 192, 255,
    ]);

    useStore.getState().applyFilter('gamma', { gamma: 2 });

    expect(pixelAt(0)).toEqual([128, 181, 221, 255]);
  });

  it('applyFilter("motion-blur", { angle: 0, distance: 5 }) mixes neighboring pixels', () => {
    seedActiveLayer(7, 1, [
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);

    useStore.getState().applyFilter('motion-blur', { angle: 0, distance: 5 });

    expect(pixelAt(3)[0]).toBeGreaterThan(0);
    expect(pixelAt(3)[0]).toBeLessThan(255);
    expect(pixelAt(2)[0]).toBeGreaterThan(0);
  });

  it('applyFilter("zoom-blur") uses the image center and mixes radial samples', () => {
    seedActiveLayer(5, 1, [
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);

    useStore.getState().applyFilter('zoom-blur', { strength: 1 });

    expect(pixelAt(2)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(0)[0]).toBeGreaterThan(0);
    expect(pixelAt(0)[0]).toBeLessThan(255);
    expect(pixelAt(4)[0]).toBeGreaterThan(0);
    expect(pixelAt(4)[0]).toBeLessThan(255);
  });

  it('respects selection mask for new filters', () => {
    seedActiveLayer(2, 1, [
      64, 64, 64, 255,
      64, 64, 64, 255,
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

    useStore.getState().applyFilter('gamma', { gamma: 2 });

    expect(pixelAt(0)).toEqual([128, 128, 128, 255]);
    expect(pixelAt(1)).toEqual([64, 64, 64, 255]);
  });

  it('undo restores pixels after applying a new filter', () => {
    seedActiveLayer(2, 1, [
      64, 64, 64, 255,
      192, 192, 192, 255,
    ]);
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('gamma', { gamma: 2 });
    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });
});
