import type { Layer, PaintDocument, Selection } from '../types';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResizeCanvasOptions {
  w: number;
  h: number;
  anchor?: 'top-left' | 'center';
}

function finiteInteger(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
  return Math.trunc(value);
}

function positiveSize(value: number, name: string): number {
  const size = finiteInteger(value, name);
  if (size <= 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
  return size;
}

function copyMappedBuffer(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
  channels: number,
  offsetX: number,
  offsetY: number,
): Uint8ClampedArray {
  const dest = new Uint8ClampedArray(destWidth * destHeight * channels);
  const startSourceX = Math.max(0, -offsetX);
  const startSourceY = Math.max(0, -offsetY);
  const endSourceX = Math.min(sourceWidth, destWidth - offsetX);
  const endSourceY = Math.min(sourceHeight, destHeight - offsetY);

  if (startSourceX >= endSourceX || startSourceY >= endSourceY) {
    return dest;
  }

  const rowLength = (endSourceX - startSourceX) * channels;
  for (let sy = startSourceY; sy < endSourceY; sy += 1) {
    const dy = sy + offsetY;
    const sourceStart = (sy * sourceWidth + startSourceX) * channels;
    const destStart = (dy * destWidth + startSourceX + offsetX) * channels;
    dest.set(source.subarray(sourceStart, sourceStart + rowLength), destStart);
  }

  return dest;
}

function mapLayer(
  layer: Layer,
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
  offsetX: number,
  offsetY: number,
): Layer {
  return {
    ...layer,
    pixels:
      layer.kind === 'raster' && layer.pixels
        ? copyMappedBuffer(layer.pixels, sourceWidth, sourceHeight, destWidth, destHeight, 4, offsetX, offsetY)
        : layer.pixels,
    mask: layer.mask
      ? copyMappedBuffer(layer.mask, sourceWidth, sourceHeight, destWidth, destHeight, 1, offsetX, offsetY)
      : undefined,
    children: layer.children ? [...layer.children] : undefined,
  };
}

function mapSelection(
  selection: Selection | null,
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
  offsetX: number,
  offsetY: number,
): Selection | null {
  if (!selection) return null;
  return {
    width: destWidth,
    height: destHeight,
    mask: copyMappedBuffer(selection.mask, sourceWidth, sourceHeight, destWidth, destHeight, 1, offsetX, offsetY),
  };
}

function mappedDocument(
  doc: PaintDocument,
  destWidth: number,
  destHeight: number,
  offsetX: number,
  offsetY: number,
): PaintDocument {
  return {
    ...doc,
    width: destWidth,
    height: destHeight,
    layers: doc.layers.map((layer) =>
      mapLayer(layer, doc.width, doc.height, destWidth, destHeight, offsetX, offsetY),
    ),
    selection: mapSelection(doc.selection, doc.width, doc.height, destWidth, destHeight, offsetX, offsetY),
  };
}

export function cropDocument(doc: PaintDocument, rect: CropRect): PaintDocument {
  const x = finiteInteger(rect.x, 'x');
  const y = finiteInteger(rect.y, 'y');
  const width = positiveSize(rect.w, 'w');
  const height = positiveSize(rect.h, 'h');
  return mappedDocument(doc, width, height, -x, -y);
}

export function resizeCanvas(doc: PaintDocument, opts: ResizeCanvasOptions): PaintDocument {
  const width = positiveSize(opts.w, 'w');
  const height = positiveSize(opts.h, 'h');
  const anchor = opts.anchor ?? 'top-left';
  const offsetX = anchor === 'center' ? Math.floor((width - doc.width) / 2) : 0;
  const offsetY = anchor === 'center' ? Math.floor((height - doc.height) / 2) : 0;

  return mappedDocument(doc, width, height, offsetX, offsetY);
}
