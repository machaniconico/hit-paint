import { beforeEach, describe, expect, it } from 'vitest';

import { useStore, type FilterName } from '../src/state/store';

type Expect<T extends true> = T;
type HasLensAndVignette = Expect<
  Extract<FilterName, 'lens'> extends 'lens'
    ? Extract<FilterName, 'vignette'> extends 'vignette'
      ? true
      : false
    : false
>;
const filterNameTypeCheck: HasLensAndVignette = true;

function seedActiveLayer(width: number, height: number, pixels: Uint8ClampedArray): void {
  useStore.getState().newDocument(width, height, 'wave23 filters');
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

function gradientPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = midGrayPixels(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      pixels[i] = x * 24 + y * 3;
      pixels[i + 1] = y * 24 + x * 3;
      pixels[i + 2] = 64 + x * 8 + y * 8;
    }
  }
  return pixels;
}

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

describe('wave23 filter wiring', () => {
  beforeEach(() => {
    void filterNameTypeCheck;
    seedActiveLayer(8, 8, midGrayPixels(8, 8));
  });

  it('applyFilter("lens", { amount: 0.5 }) changes active layer pixels', () => {
    seedActiveLayer(8, 8, gradientPixels(8, 8));
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('lens', { amount: 0.5 });

    expect(Array.from(activePixels())).not.toEqual(before);
  });

  it('undo restores original pixels after lens', () => {
    seedActiveLayer(8, 8, gradientPixels(8, 8));
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('lens', { amount: 0.5 });
    expect(Array.from(activePixels())).not.toEqual(before);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyFilter("vignette", { amount: 0.6 }) darkens corners', () => {
    seedActiveLayer(8, 8, midGrayPixels(8, 8));
    const beforeCorner = pixelAt(activePixels(), 0, 0, 8);

    useStore.getState().applyFilter('vignette', { amount: 0.6 });

    const afterCorner = pixelAt(activePixels(), 0, 0, 8);
    expect(
      afterCorner[0] < beforeCorner[0]
        || afterCorner[1] < beforeCorner[1]
        || afterCorner[2] < beforeCorner[2],
    ).toBe(true);
  });

  it('undo restores original pixels after vignette', () => {
    seedActiveLayer(8, 8, midGrayPixels(8, 8));
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('vignette', { amount: 0.6 });
    expect(Array.from(activePixels())).not.toEqual(before);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });
});
