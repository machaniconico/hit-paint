import type { Layer, LayerId, PaintDocument, RGBA } from '../types';

let _counter = 0;
/** Deterministic-ish unique id (avoids Math.random for testability). */
export function uid(prefix = 'id'): string {
  _counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${_counter}`;
}

export function createRasterLayer(
  width: number,
  height: number,
  name = 'レイヤー',
  fill?: RGBA,
): Layer {
  const pixels = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = fill.r;
      pixels[i + 1] = fill.g;
      pixels[i + 2] = fill.b;
      pixels[i + 3] = fill.a;
    }
  }
  return {
    id: uid('layer'),
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

export function createDocument(
  width = 1280,
  height = 720,
  name = '無題',
  dpi = 72,
): PaintDocument {
  const bg = createRasterLayer(width, height, '背景', { r: 255, g: 255, b: 255, a: 255 });
  const draw = createRasterLayer(width, height, 'レイヤー 1');
  return {
    id: uid('doc'),
    name,
    width,
    height,
    dpi,
    layers: [bg, draw],
    activeLayerId: draw.id,
    selection: null,
  };
}

export function findLayer(doc: PaintDocument, id: LayerId | null): Layer | undefined {
  if (!id) return undefined;
  return doc.layers.find((l) => l.id === id);
}

export function activeLayer(doc: PaintDocument): Layer | undefined {
  return findLayer(doc, doc.activeLayerId);
}

export function layerIndex(doc: PaintDocument, id: LayerId): number {
  return doc.layers.findIndex((l) => l.id === id);
}
