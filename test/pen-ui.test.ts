import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';
import type { Selection } from '../src/types';

const primary = { r: 12, g: 120, b: 240, a: 255 };

function activePixels(): Uint8ClampedArray {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer?.pixels) throw new Error('active raster layer not found');
  return layer.pixels;
}

function rgbaAt(x: number, y: number): number[] {
  const { doc } = useStore.getState();
  const offset = (y * doc.width + x) * 4;
  return Array.from(activePixels().slice(offset, offset + 4));
}

function selection(width: number, height: number, selected: Array<[number, number]>): Selection {
  const mask = new Uint8ClampedArray(width * height);
  for (const [x, y] of selected) {
    mask[y * width + x] = 255;
  }
  return { width, height, mask };
}

function trianglePath(): void {
  useStore.getState().addPenPoint(1, 1);
  useStore.getState().addPenPoint(5, 1);
  useStore.getState().addPenPoint(3, 5);
  useStore.getState().closePenPath();
}

describe('pen tool store wiring', () => {
  beforeEach(() => {
    useStore.getState().newDocument(7, 7, 'pen-ui');
    useStore.getState().setPrimary(primary);
    useStore.getState().clearSelection();
    useStore.setState({ penPath: null });
  });

  it('addPenPoint starts a penPath and appends anchors', () => {
    useStore.getState().addPenPoint(1, 2);
    useStore.getState().addPenPoint(3, 4);

    expect(useStore.getState().penPath?.points).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it("commitPenPath('fill') paints the path interior on the active layer with primary", () => {
    trianglePath();

    useStore.getState().commitPenPath('fill');

    expect(rgbaAt(3, 2)).toEqual([primary.r, primary.g, primary.b, primary.a]);
    expect(rgbaAt(0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('commitPenPath clears penPath after committing', () => {
    trianglePath();

    useStore.getState().commitPenPath('fill');

    expect(useStore.getState().penPath).toBeNull();
  });

  it('undo restores pixels changed by commitPenPath', () => {
    const before = Array.from(activePixels());
    trianglePath();

    useStore.getState().commitPenPath('fill');
    expect(Array.from(activePixels())).not.toEqual(before);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('commitPenPath respects the current selection mask', () => {
    useStore.getState().setSelection(selection(7, 7, [[3, 2]]));
    trianglePath();

    useStore.getState().commitPenPath('fill');

    expect(rgbaAt(3, 2)).toEqual([primary.r, primary.g, primary.b, primary.a]);
    expect(rgbaAt(2, 2)).toEqual([0, 0, 0, 0]);
  });
});
