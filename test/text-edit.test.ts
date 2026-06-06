import { beforeEach, describe, expect, it } from 'vitest';

import { createTextLayer } from '../src/core/document';
import { useStore } from '../src/state/store';
import { createTextLayerData } from '../src/text/text-layer';
import type { RGBA } from '../src/types';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

function resetStore(): void {
  useStore.getState().newDocument(16, 16, 'text edit');
  useStore.getState().setPrimary(RED);
}

function hasPaintedPixel(pixels: Uint8ClampedArray | undefined): boolean {
  if (!pixels) return false;
  for (const channel of pixels) {
    if (channel !== 0) return true;
  }
  return false;
}

function pixelsEqual(a: Uint8ClampedArray | undefined, b: Uint8ClampedArray | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe('editable text layer store wiring', () => {
  beforeEach(() => {
    resetStore();
  });

  it('creates a text layer with textData and rasterized pixels', () => {
    const data = createTextLayerData({ text: 'A', x: 1, y: 1, color: RED, scale: 1 });
    const layer = createTextLayer(16, 16, data, 'Editable');

    expect(layer.kind).toBe('raster');
    expect(layer.textData).toEqual(data);
    expect(layer.pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(layer.pixels).toHaveLength(16 * 16 * 4);
    expect(hasPaintedPixel(layer.pixels)).toBe(true);
  });

  it('adds and selects an editable raster text layer above the active layer', () => {
    const before = useStore.getState().doc;
    const activeIndex = before.layers.findIndex((layer) => layer.id === before.activeLayerId);

    useStore.getState().createTextLayerAt(2, 3, 'A');

    const after = useStore.getState().doc;
    const active = after.layers.find((layer) => layer.id === after.activeLayerId);
    expect(after.layers).toHaveLength(before.layers.length + 1);
    expect(after.layers[activeIndex + 1]).toBe(active);
    expect(active?.kind).toBe('raster');
    expect(active?.textData?.text).toBe('A');
    expect(active?.textData?.scale).toBe(2);
    expect(hasPaintedPixel(active?.pixels)).toBe(true);
  });

  it('updates textData text and regenerates pixels for the active text layer', () => {
    useStore.getState().createTextLayerAt(0, 0, 'I');
    const beforeLayer = useStore.getState().doc.layers.find((layer) => layer.id === useStore.getState().doc.activeLayerId);
    const beforePixels = beforeLayer?.pixels?.slice();

    useStore.getState().updateActiveTextLayer({ text: 'L' });

    const afterLayer = useStore.getState().doc.layers.find((layer) => layer.id === useStore.getState().doc.activeLayerId);
    expect(afterLayer?.textData?.text).toBe('L');
    expect(pixelsEqual(beforePixels, afterLayer?.pixels)).toBe(false);
  });

  it('does nothing when the active layer has no textData', () => {
    const before = useStore.getState();
    const beforeLayer = before.doc.layers.find((layer) => layer.id === before.doc.activeLayerId);
    const beforePixels = beforeLayer?.pixels?.slice();

    useStore.getState().updateActiveTextLayer({ text: 'ignored', color: BLUE });

    const after = useStore.getState();
    const afterLayer = after.doc.layers.find((layer) => layer.id === after.doc.activeLayerId);
    expect(after.rev).toBe(before.rev);
    expect(afterLayer?.textData).toBeUndefined();
    expect(pixelsEqual(beforePixels, afterLayer?.pixels)).toBe(true);
  });

  it('undoes an active text layer edit back to the previous pixels', () => {
    useStore.getState().createTextLayerAt(0, 0, 'I');
    const originalLayer = useStore.getState().doc.layers.find((layer) => layer.id === useStore.getState().doc.activeLayerId);
    const originalPixels = originalLayer?.pixels?.slice();

    useStore.getState().updateActiveTextLayer({ text: 'L' });
    const editedLayer = useStore.getState().doc.layers.find((layer) => layer.id === useStore.getState().doc.activeLayerId);
    expect(pixelsEqual(originalPixels, editedLayer?.pixels)).toBe(false);

    useStore.getState().undo();

    const undoneLayer = useStore.getState().doc.layers.find((layer) => layer.id === useStore.getState().doc.activeLayerId);
    expect(undoneLayer?.textData?.text).toBe('I');
    expect(pixelsEqual(originalPixels, undoneLayer?.pixels)).toBe(true);
  });
});
