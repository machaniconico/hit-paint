import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';
import type { Layer, PaintDocument, RGBA } from '../src/types';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };

function rasterLayer(id: string, pixels: Uint8ClampedArray, name = id): Layer {
  return {
    id,
    name,
    kind: 'raster',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    clipping: false,
    pixels,
  };
}

function docWith(
  width: number,
  height: number,
  layers: Layer[],
  activeLayerId = layers[0]?.id ?? null,
): PaintDocument {
  return {
    id: 'wave33-doc',
    name: 'Wave33',
    width,
    height,
    dpi: 72,
    layers,
    activeLayerId,
    selection: null,
  };
}

function solidPixels(width: number, height: number, color: RGBA): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = color.r;
    pixels[i + 1] = color.g;
    pixels[i + 2] = color.b;
    pixels[i + 3] = color.a;
  }
  return pixels;
}

function halfRedBluePixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const color = x < width / 2 ? RED : BLUE;
      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = color.a;
    }
  }
  return pixels;
}

function asymmetricPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = (x * 31 + y * 7) % 256;
      pixels[offset + 1] = (x * 5 + y * 41) % 256;
      pixels[offset + 2] = (x * 19 + y * 13) % 256;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function seedDoc(width: number, height: number, pixels: Uint8ClampedArray): void {
  useStore.getState().loadDocument(docWith(width, height, [
    rasterLayer('paint', new Uint8ClampedArray(pixels), 'Paint'),
  ], 'paint'));
}

function activePixels(): Uint8ClampedArray {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer?.pixels) throw new Error('active raster layer is missing pixels');
  return layer.pixels;
}

function colorKey(color: RGBA): string {
  return `${color.r},${color.g},${color.b},${color.a}`;
}

describe('wave33 wiring', () => {
  beforeEach(() => {
    seedDoc(4, 4, solidPixels(4, 4, GREEN));
  });

  it('saveProjectJson() returns a string and loadProjectJson() restores layer count and pixels', () => {
    const paintPixels = asymmetricPixels(4, 4);
    const maskPixels = halfRedBluePixels(4, 4);
    const sourceDoc = docWith(4, 4, [
      rasterLayer('background', maskPixels, 'Background'),
      rasterLayer('paint', paintPixels, 'Paint'),
    ], 'paint');
    useStore.getState().loadDocument(sourceDoc);

    const json = useStore.getState().saveProjectJson();

    expect(typeof json).toBe('string');

    seedDoc(2, 2, solidPixels(2, 2, GREEN));
    useStore.getState().loadProjectJson(json);

    const restored = useStore.getState().doc;
    expect(restored.layers).toHaveLength(sourceDoc.layers.length);
    expect(Array.from(restored.layers[0].pixels ?? [])).toEqual(Array.from(maskPixels));
    expect(Array.from(restored.layers[1].pixels ?? [])).toEqual(Array.from(paintPixels));
  });

  it('activeLayerSwatches() extracts at least two swatches from a red and blue image', () => {
    seedDoc(4, 4, halfRedBluePixels(4, 4));

    const swatches = useStore.getState().activeLayerSwatches();
    const keys = swatches.map((swatch) => colorKey(swatch.color));

    expect(swatches.length).toBeGreaterThanOrEqual(2);
    expect(keys).toContain(colorKey(RED));
    expect(keys).toContain(colorKey(BLUE));
  });

  it('applyKaleidoscope({ segments: 4 }) changes pixels and undo restores them', () => {
    seedDoc(8, 8, asymmetricPixels(8, 8));
    const before = Array.from(activePixels());

    useStore.getState().applyKaleidoscope({ segments: 4 });

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });
});
