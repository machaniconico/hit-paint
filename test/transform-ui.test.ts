import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';
import type { Selection } from '../src/types';

function pixel(id: number): number[] {
  return [id, id + 10, id + 20, 255];
}

function pixelsFromIds(ids: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(ids.flatMap(pixel));
}

function idsFromPixels(pixels: Uint8ClampedArray): number[] {
  const ids: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    ids.push(pixels[i]);
  }
  return ids;
}

function activePixels(): Uint8ClampedArray {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer?.pixels) throw new Error('active raster layer is missing');
  return layer.pixels;
}

function selection(width: number, height: number, selected: Array<[number, number]>): Selection {
  const mask = new Uint8ClampedArray(width * height);
  for (const [x, y] of selected) {
    mask[y * width + x] = 255;
  }
  return { width, height, mask };
}

describe('transform and document store wiring', () => {
  beforeEach(() => {
    useStore.getState().newDocument(2, 2, 'transform ui');
    activePixels().set(pixelsFromIds([
      1, 2,
      3, 4,
    ]));
  });

  it("flipActiveLayer('h') flips active raster pixels horizontally", () => {
    useStore.getState().flipActiveLayer('h');

    expect(idsFromPixels(activePixels())).toEqual([
      2, 1,
      4, 3,
    ]);
  });

  it('cropToSelection changes document dimensions to the selection bounds', () => {
    useStore.getState().newDocument(4, 3, 'crop selection');
    useStore.getState().setSelection(selection(4, 3, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]));

    useStore.getState().cropToSelection();

    const { doc } = useStore.getState();
    expect(doc.width).toBe(2);
    expect(doc.height).toBe(2);
    expect(doc.selection?.width).toBe(2);
    expect(doc.selection?.height).toBe(2);
  });

  it('resizeCanvasTo changes document dimensions', () => {
    useStore.getState().resizeCanvasTo(4, 3);

    const { doc } = useStore.getState();
    expect(doc.width).toBe(4);
    expect(doc.height).toBe(3);
    expect(activePixels()).toHaveLength(4 * 3 * 4);
  });

  it('undo restores active raster pixels after flipActiveLayer', () => {
    const before = Array.from(activePixels());

    useStore.getState().flipActiveLayer('h');
    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('rotateActiveLayer keeps document dimensions fixed', () => {
    useStore.getState().rotateActiveLayer('cw');

    const { doc } = useStore.getState();
    expect(doc.width).toBe(2);
    expect(doc.height).toBe(2);
    expect(activePixels()).toHaveLength(2 * 2 * 4);
  });
});
