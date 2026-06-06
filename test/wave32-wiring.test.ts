import { beforeEach, describe, expect, it } from 'vitest';

import { useStore, type FilterName } from '../src/state/store';
import type { Layer, PaintDocument, RGBA } from '../src/types';
import type { ShapeData } from '../src/vector/shape';
import type { VectorLayerData } from '../src/vector/vector-layer';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

const whiteBalanceFilterName: FilterName = 'white-balance';

function castPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 180;
    pixels[i + 1] = 90;
    pixels[i + 2] = 60;
    pixels[i + 3] = 255;
  }

  return pixels;
}

function solidPixels(width: number, height: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgba[0];
    pixels[i + 1] = rgba[1];
    pixels[i + 2] = rgba[2];
    pixels[i + 3] = rgba[3];
  }

  return pixels;
}

function seedActiveLayer(width: number, height: number, pixels: Uint8ClampedArray): void {
  useStore.getState().newDocument(width, height, 'wave32 wiring');
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

function channelSpread(pixels: Uint8ClampedArray): number {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    sumR += pixels[i];
    sumG += pixels[i + 1];
    sumB += pixels[i + 2];
    count++;
  }

  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  return Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB);
}

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const offset = (y * width + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}

function layer(partial: Partial<Layer>): Layer {
  return {
    id: partial.id ?? 'layer',
    name: partial.name ?? 'layer',
    kind: partial.kind ?? 'raster',
    visible: partial.visible ?? true,
    opacity: partial.opacity ?? 1,
    blendMode: partial.blendMode ?? 'normal',
    locked: partial.locked ?? false,
    clipping: partial.clipping ?? false,
    ...partial,
  };
}

describe('wave32 wiring', () => {
  beforeEach(() => {
    seedActiveLayer(4, 2, castPixels(4, 2));
  });

  it('FilterName includes white-balance', () => {
    expect(whiteBalanceFilterName).toBe('white-balance');
  });

  it('applyFilter("white-balance", { strength: 1 }) corrects a color-cast image and undo restores original', () => {
    const before = Array.from(activePixels());
    const beforeSpread = channelSpread(activePixels());

    useStore.getState().applyFilter('white-balance', { strength: 1 });

    expect(Array.from(activePixels())).not.toEqual(before);
    expect(channelSpread(activePixels())).toBeLessThan(beforeSpread);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });

  it('exportSvg() returns SVG text for a document with shapeData and vectorData', () => {
    const shapeData: ShapeData = {
      shape: 'rect',
      x: 1,
      y: 2,
      width: 6,
      height: 4,
      style: { fill: RED },
    };
    const vectorData: VectorLayerData = {
      subpaths: [{
        path: {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 8 },
          ],
        },
        stroke: { color: BLUE, width: 1 },
      }],
    };
    const doc: PaintDocument = {
      id: 'wave32-doc',
      name: 'wave32 svg',
      width: 12,
      height: 10,
      dpi: 72,
      layers: [
        layer({ id: 'shape', name: 'shape', shapeData }),
        layer({ id: 'vector', name: 'vector', vectorData }),
      ],
      activeLayerId: 'vector',
      selection: null,
    };

    useStore.getState().loadDocument(doc);

    const svg = useStore.getState().exportSvg();

    expect(svg).toContain('<svg');
    expect(svg).toContain('<rect ');
    expect(svg).toContain('<path d=');
  });

  it('fillWithGradient() changes active layer pixels to a gradient and undo restores original', () => {
    seedActiveLayer(4, 1, solidPixels(4, 1, [20, 40, 60, 255]));
    const before = Array.from(activePixels());

    useStore.getState().fillWithGradient();

    const after = activePixels();
    expect(Array.from(after)).not.toEqual(before);
    expect(pixelAt(after, 0, 0, 4)).not.toEqual(pixelAt(after, 3, 0, 4));
    expect(pixelAt(after, 0, 0, 4)[0]).toBeLessThan(pixelAt(after, 3, 0, 4)[0]);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();

    expect(Array.from(activePixels())).toEqual(before);
  });
});
