import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';
import type { RGBA } from '../src/types';

function activePixels(): Uint8ClampedArray {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer?.pixels) throw new Error('active raster layer not found');
  return layer.pixels;
}

function setPixel(x: number, y: number, color: RGBA): void {
  const { doc } = useStore.getState();
  const pixels = activePixels();
  const offset = (y * doc.width + x) * 4;
  pixels[offset] = color.r;
  pixels[offset + 1] = color.g;
  pixels[offset + 2] = color.b;
  pixels[offset + 3] = color.a;
}

function rgbaAt(x: number, y: number): number[] {
  const { doc } = useStore.getState();
  const pixels = activePixels();
  const offset = (y * doc.width + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}

function nonTransparentCount(): number {
  const pixels = activePixels();
  let count = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] > 0) count += 1;
  }
  return count;
}

describe('layer effect store wiring', () => {
  beforeEach(() => {
    useStore.getState().newDocument(12, 12, 'effects-ui');
    useStore.getState().setPrimary({ r: 0, g: 128, b: 255, a: 255 });
    useStore.getState().clearSelection();
  });

  it('applyLayerEffect drop-shadow adds shadow pixels around the active raster layer', () => {
    setPixel(3, 3, { r: 255, g: 255, b: 255, a: 255 });
    const beforeCount = nonTransparentCount();

    useStore.getState().applyLayerEffect('drop-shadow');

    expect(nonTransparentCount()).toBeGreaterThan(beforeCount);
    expect(rgbaAt(7, 7)[3]).toBeGreaterThan(0);
  });

  it('applyLayerEffect stroke adds a primary-color outline and preserves the source pixel', () => {
    setPixel(6, 6, { r: 255, g: 0, b: 0, a: 255 });

    useStore.getState().applyLayerEffect('stroke');

    expect(rgbaAt(5, 6)).toEqual([0, 128, 255, 255]);
    expect(rgbaAt(6, 6)).toEqual([255, 0, 0, 255]);
  });

  it('undo restores the original pixels after applying a layer effect', () => {
    setPixel(4, 4, { r: 255, g: 255, b: 255, a: 255 });
    const before = Array.from(activePixels());

    useStore.getState().applyLayerEffect('drop-shadow');
    expect(Array.from(activePixels())).not.toEqual(before);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyLayerEffect glow adds soft primary-color pixels', () => {
    setPixel(6, 6, { r: 255, g: 255, b: 255, a: 255 });

    useStore.getState().applyLayerEffect('glow');

    expect(nonTransparentCount()).toBeGreaterThan(1);
    expect(rgbaAt(5, 6).slice(0, 3)).toEqual([0, 128, 255]);
  });
});
