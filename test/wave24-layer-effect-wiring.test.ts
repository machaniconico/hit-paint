import { beforeEach, describe, expect, it } from 'vitest';

import { useStore, type LayerEffectKind } from '../src/state/store';
import type { RGBA } from '../src/types';

type Expect<T extends true> = T;
type IncludesWave24LayerEffects = Expect<
  'inner-shadow' extends LayerEffectKind
    ? 'bevel-emboss' extends LayerEffectKind
      ? true
      : false
    : false
>;
const layerEffectKindTypeCheck: IncludesWave24LayerEffects = true;

function filledRectPixels(
  width: number,
  height: number,
  x0: number,
  y0: number,
  rectWidth: number,
  rectHeight: number,
  color: RGBA,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = y0; y < y0 + rectHeight; y += 1) {
    for (let x = x0; x < x0 + rectWidth; x += 1) {
      const i = (y * width + x) * 4;
      pixels[i] = color.r;
      pixels[i + 1] = color.g;
      pixels[i + 2] = color.b;
      pixels[i + 3] = color.a;
    }
  }
  return pixels;
}

function seedActiveLayer(width: number, height: number, pixels: Uint8ClampedArray): void {
  useStore.getState().newDocument(width, height, 'wave24 layer effects');
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

function seedOpaqueContentLayer(): void {
  seedActiveLayer(
    12,
    12,
    filledRectPixels(12, 12, 3, 3, 6, 6, { r: 128, g: 128, b: 128, a: 255 }),
  );
}

describe('wave24 layer effect wiring', () => {
  beforeEach(() => {
    void layerEffectKindTypeCheck;
    seedOpaqueContentLayer();
  });

  it('applyLayerEffect("inner-shadow") changes pixels and undo restores them', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyLayerEffect('inner-shadow');

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyLayerEffect("bevel-emboss") changes pixels and undo restores them', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyLayerEffect('bevel-emboss');

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });
});
