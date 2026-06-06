import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';
import type { PointerSample } from '../src/types';

function seedActiveLayer(width: number, height: number, values: number[]): void {
  useStore.getState().newDocument(width, height, 'wave22');
  const { doc } = useStore.getState();
  useStore.setState({
    doc: {
      ...doc,
      layers: doc.layers.map((layer) => (
        layer.id === doc.activeLayerId
          ? { ...layer, pixels: new Uint8ClampedArray(values) }
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

function rgbaAt(x: number, y: number): number[] {
  const { doc } = useStore.getState();
  const offset = (y * doc.width + x) * 4;
  return Array.from(activePixels().slice(offset, offset + 4));
}

function sample(x: number, y: number, t: number): PointerSample {
  return { x, y, pressure: 1, t };
}

function gradientPixels(width: number, height: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out.push(x * 40, y * 40, 128, 255);
    }
  }
  return out;
}

describe('wave22 store wiring', () => {
  beforeEach(() => {
    seedActiveLayer(1, 1, [0, 0, 0, 0]);
  });

  it('applyFilter("unsharp") changes active raster layer pixels', () => {
    seedActiveLayer(5, 1, [
      20, 20, 20, 255,
      70, 70, 70, 255,
      160, 160, 160, 255,
      70, 70, 70, 255,
      20, 20, 20, 255,
    ]);
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('unsharp', { amount: 1, radius: 1 });

    expect(Array.from(activePixels())).not.toEqual(before);
  });

  it('applyFilter("replace-color") replaces matching colors', () => {
    seedActiveLayer(2, 1, [
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]);

    useStore.getState().applyFilter('replace-color', {
      from: { r: 255, g: 0, b: 0, a: 255 },
      to: { r: 0, g: 255, b: 0, a: 255 },
      tolerance: 0,
    });

    expect(rgbaAt(0, 0)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(1, 0)).toEqual([0, 0, 255, 255]);
  });

  it('replace-color respects the current selection mask', () => {
    seedActiveLayer(2, 1, [
      255, 0, 0, 255,
      255, 0, 0, 255,
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

    useStore.getState().applyFilter('replace-color', {
      from: { r: 255, g: 0, b: 0, a: 255 },
      to: { r: 0, g: 255, b: 0, a: 255 },
      tolerance: 0,
    });

    expect(rgbaAt(0, 0)).toEqual([0, 255, 0, 255]);
    expect(rgbaAt(1, 0)).toEqual([255, 0, 0, 255]);
  });

  it('ToolId liquify and setLiquifyMode update store state', () => {
    useStore.getState().setTool('liquify');
    useStore.getState().setLiquifyMode('pinch');

    expect(useStore.getState().tool).toBe('liquify');
    expect(useStore.getState().liquifyMode).toBe('pinch');
  });

  it('liquify beginStroke to endStroke warps the active layer', () => {
    seedActiveLayer(5, 5, gradientPixels(5, 5));
    useStore.getState().setTool('liquify');
    useStore.getState().setLiquifyMode('push');
    useStore.getState().setBrush({ size: 6, opacity: 1, flow: 1 });
    const before = Array.from(activePixels());

    useStore.getState().beginStroke(sample(2, 2, 0));
    useStore.getState().extendStroke(sample(3, 2, 16));
    useStore.getState().endStroke();

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);
  });

  it('undo restores pixels after a liquify stroke', () => {
    seedActiveLayer(5, 5, gradientPixels(5, 5));
    useStore.getState().setTool('liquify');
    useStore.getState().setLiquifyMode('push');
    useStore.getState().setBrush({ size: 6, opacity: 1, flow: 1 });
    const before = Array.from(activePixels());

    useStore.getState().beginStroke(sample(2, 2, 0));
    useStore.getState().extendStroke(sample(3, 2, 16));
    useStore.getState().endStroke();
    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });
});
