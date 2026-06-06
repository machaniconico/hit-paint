// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';
import type { Layer, RGBA } from '../src/types';
import type { ShapeData } from '../src/vector/shape';
import type { VectorLayerData } from '../src/vector/vector-layer';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

function resetStore(): void {
  useStore.getState().newDocument(16, 16, 'wave25 layers core');
  useStore.getState().setPrimary(RED);
}

function activeLayer(): Layer {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer) throw new Error('active layer not found');
  return layer;
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

function cloneData<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

function rectShape(fill: RGBA): Partial<ShapeData> {
  return {
    shape: 'rect',
    x: 2,
    y: 2,
    width: 6,
    height: 6,
    style: { fill },
  };
}

function triangleVector(fill: RGBA): VectorLayerData {
  return {
    subpaths: [{
      path: {
        closed: true,
        points: [
          { x: 1, y: 1 },
          { x: 10, y: 1 },
          { x: 1, y: 10 },
        ],
      },
      fill,
    }],
  };
}

describe('wave25 editable layer store wiring', () => {
  beforeEach(() => {
    resetStore();
  });

  it('adds a raster shape layer with editable data and rasterized pixels above the active layer', () => {
    const before = useStore.getState().doc;
    const activeIndex = before.layers.findIndex((layer) => layer.id === before.activeLayerId);

    useStore.getState().addShapeLayer(rectShape(RED));

    const after = useStore.getState().doc;
    const layer = activeLayer();
    expect(after.layers).toHaveLength(before.layers.length + 1);
    expect(after.layers[activeIndex + 1]).toBe(layer);
    expect(layer.kind).toBe('raster');
    expect(layer.shapeData?.style.fill).toEqual(RED);
    expect(hasPaintedPixel(layer.pixels)).toBe(true);
  });

  it('updates shape data, regenerates pixels, and restores both through undo and redo', () => {
    useStore.getState().addShapeLayer(rectShape(RED));
    const beforeLayer = activeLayer();
    const beforePixels = beforeLayer.pixels?.slice();
    const beforeShapeData = cloneData(beforeLayer.shapeData);

    useStore.getState().updateActiveShapeLayer({ style: { fill: BLUE } });

    const editedLayer = activeLayer();
    const editedPixels = editedLayer.pixels?.slice();
    const editedShapeData = cloneData(editedLayer.shapeData);
    expect(editedLayer.shapeData?.style.fill).toEqual(BLUE);
    expect(pixelsEqual(beforePixels, editedPixels)).toBe(false);

    useStore.getState().undo();

    const undoneLayer = activeLayer();
    expect(undoneLayer.shapeData).toEqual(beforeShapeData);
    expect(pixelsEqual(beforePixels, undoneLayer.pixels)).toBe(true);

    useStore.getState().redo();

    const redoneLayer = activeLayer();
    expect(redoneLayer.shapeData).toEqual(editedShapeData);
    expect(pixelsEqual(editedPixels, redoneLayer.pixels)).toBe(true);
  });

  it('adds a raster vector layer with editable data and rasterized pixels above the active layer', () => {
    const before = useStore.getState().doc;
    const activeIndex = before.layers.findIndex((layer) => layer.id === before.activeLayerId);

    useStore.getState().addVectorLayer(triangleVector(RED));

    const after = useStore.getState().doc;
    const layer = activeLayer();
    expect(after.layers).toHaveLength(before.layers.length + 1);
    expect(after.layers[activeIndex + 1]).toBe(layer);
    expect(layer.kind).toBe('raster');
    expect(layer.vectorData?.subpaths).toHaveLength(1);
    expect(hasPaintedPixel(layer.pixels)).toBe(true);
  });

  it('updates vector data, regenerates pixels, and restores both through undo and redo', () => {
    useStore.getState().addVectorLayer(triangleVector(RED));
    const beforeLayer = activeLayer();
    const beforePixels = beforeLayer.pixels?.slice();
    const beforeVectorData = cloneData(beforeLayer.vectorData);

    useStore.getState().updateActiveVectorLayer(triangleVector(BLUE));

    const editedLayer = activeLayer();
    const editedPixels = editedLayer.pixels?.slice();
    const editedVectorData = cloneData(editedLayer.vectorData);
    expect(editedLayer.vectorData?.subpaths[0].fill).toEqual(BLUE);
    expect(pixelsEqual(beforePixels, editedPixels)).toBe(false);

    useStore.getState().undo();

    const undoneLayer = activeLayer();
    expect(undoneLayer.vectorData).toEqual(beforeVectorData);
    expect(pixelsEqual(beforePixels, undoneLayer.pixels)).toBe(true);

    useStore.getState().redo();

    const redoneLayer = activeLayer();
    expect(redoneLayer.vectorData).toEqual(editedVectorData);
    expect(pixelsEqual(editedPixels, redoneLayer.pixels)).toBe(true);
  });

  it('keeps text edit undo metadata compatible with the existing commitEdit signature', () => {
    useStore.getState().createTextLayerAt(0, 0, 'I');
    const beforeLayer = activeLayer();
    const beforePixels = beforeLayer.pixels?.slice();

    useStore.getState().updateActiveTextLayer({ text: 'L' });

    const editedLayer = activeLayer();
    const editedPixels = editedLayer.pixels?.slice();
    expect(editedLayer.textData?.text).toBe('L');
    expect(pixelsEqual(beforePixels, editedPixels)).toBe(false);

    useStore.getState().undo();

    const undoneLayer = activeLayer();
    expect(undoneLayer.textData?.text).toBe('I');
    expect(pixelsEqual(beforePixels, undoneLayer.pixels)).toBe(true);

    useStore.getState().redo();

    const redoneLayer = activeLayer();
    expect(redoneLayer.textData?.text).toBe('L');
    expect(pixelsEqual(editedPixels, redoneLayer.pixels)).toBe(true);
  });
});
