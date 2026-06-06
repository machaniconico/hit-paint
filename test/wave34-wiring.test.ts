import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';
import type { Layer, PaintDocument, RGBA } from '../src/types';

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };

function rasterLayer(id: string, pixels: Uint8ClampedArray): Layer {
  return {
    id,
    name: id,
    kind: 'raster',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    clipping: false,
    pixels,
  };
}

function docWith(width: number, height: number, pixels: Uint8ClampedArray): PaintDocument {
  return {
    id: 'wave34-doc',
    name: 'Wave34',
    width,
    height,
    dpi: 72,
    layers: [rasterLayer('paint', new Uint8ClampedArray(pixels))],
    activeLayerId: 'paint',
    selection: null,
  };
}

function setPixel(pixels: Uint8ClampedArray, width: number, x: number, y: number, color: RGBA): void {
  const offset = (y * width + x) * 4;
  pixels[offset] = color.r;
  pixels[offset + 1] = color.g;
  pixels[offset + 2] = color.b;
  pixels[offset + 3] = color.a;
}

function pixelAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}

function activePixels(): Uint8ClampedArray {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer?.pixels) throw new Error('active raster layer is missing pixels');
  return layer.pixels;
}

function dehazePixels(): Uint8ClampedArray {
  return new Uint8ClampedArray([
    100, 100, 100, 255,
    200, 200, 200, 255,
    120, 130, 140, 255,
  ]);
}

function clonePixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(pixels, width, x, y, BLACK);
    }
  }
  setPixel(pixels, width, 1, 1, RED);
  setPixel(pixels, width, 4, 1, BLUE);
  return pixels;
}

describe('wave34 wiring', () => {
  beforeEach(() => {
    useStore.getState().loadDocument(docWith(1, 1, new Uint8ClampedArray([0, 0, 0, 0])));
  });

  it('applyFilter("dehaze") changes pixels and undo restores original', () => {
    useStore.getState().loadDocument(docWith(3, 1, dehazePixels()));
    const before = Array.from(activePixels());

    useStore.getState().applyFilter('dehaze', { strength: 0.6 });

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('setCloneSource() then applyCloneStamp() copies source color to destination and undo restores', () => {
    useStore.getState().loadDocument(docWith(6, 3, clonePixels(6, 3)));
    const before = Array.from(activePixels());

    useStore.getState().setCloneSource(1, 1);
    useStore.getState().applyCloneStamp(4, 1, 1);

    expect(pixelAt(activePixels(), 6, 4, 1)).toEqual([RED.r, RED.g, RED.b, RED.a]);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('applyCloneStamp() without prior setCloneSource() leaves pixels unchanged', () => {
    useStore.getState().loadDocument(docWith(6, 3, clonePixels(6, 3)));
    const before = Array.from(activePixels());

    useStore.getState().applyCloneStamp(4, 1, 1);

    expect(Array.from(activePixels())).toEqual(before);
    expect(useStore.getState().canUndo).toBe(false);
  });
});
