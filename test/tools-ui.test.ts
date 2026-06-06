import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';

function activePixels(): Uint8ClampedArray {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer?.pixels) throw new Error('active raster layer not found');
  return layer.pixels;
}

function rgbaAt(x: number, y: number): number[] {
  const { doc } = useStore.getState();
  const pixels = activePixels();
  const offset = (y * doc.width + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}

function selectedCount(): number {
  const selection = useStore.getState().doc.selection;
  if (!selection) return 0;
  return Array.from(selection.mask).filter((value) => value > 0).length;
}

describe('tool store wiring', () => {
  beforeEach(() => {
    useStore.getState().newDocument(6, 4, 'tools-ui');
    useStore.getState().setPrimary({ r: 255, g: 0, b: 0, a: 255 });
    useStore.getState().setSecondary({ r: 0, g: 0, b: 255, a: 255 });
    useStore.getState().clearSelection();
  });

  it('applyGradient changes pixels on the active layer', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyGradient(0, 0, 5, 0);

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(rgbaAt(0, 0)).toEqual([255, 0, 0, 255]);
    expect(rgbaAt(5, 0)).toEqual([0, 0, 255, 255]);
  });

  it('magicWandSelectAt sets a selection from the active layer color', () => {
    const pixels = activePixels();
    pixels.set([
      10, 10, 10, 255,
      10, 10, 10, 255,
      200, 200, 200, 255,
      200, 200, 200, 255,
    ], 0);

    useStore.getState().magicWandSelectAt(0, 0, 0, true);

    expect(useStore.getState().doc.selection).not.toBeNull();
    expect(selectedCount()).toBe(2);
  });

  it('selectEllipse creates an ellipse selection mask', () => {
    useStore.getState().selectEllipse({ x: 1, y: 0, w: 4, h: 4 });

    const selection = useStore.getState().doc.selection;
    expect(selection).not.toBeNull();
    expect(selection?.mask[2 * 6 + 3]).toBe(255);
    expect(selection?.mask[0]).toBe(0);
    expect(selectedCount()).toBeGreaterThan(0);
  });

  it('undo restores pixels after applyGradient', () => {
    const before = Array.from(activePixels());

    useStore.getState().applyGradient(0, 0, 5, 0);
    expect(Array.from(activePixels())).not.toEqual(before);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyGradient respects the current selection mask', () => {
    useStore.getState().selectRect({ x: 0, y: 0, w: 3, h: 4 });

    useStore.getState().applyGradient(0, 0, 5, 0);

    expect(rgbaAt(0, 0)).toEqual([255, 0, 0, 255]);
    expect(rgbaAt(5, 0)).toEqual([0, 0, 0, 0]);
  });
});
