/**
 * PSD Import / Export
 *
 * Uses ag-psd (v21) for binary parsing/serialisation.
 * All pixel data is kept as plain Uint8ClampedArray (useImageData:true) to
 * avoid premultiplied-alpha corruption and to stay headless-friendly.
 */

import { readPsd, writePsd, initializeCanvas } from 'ag-psd';
import type { Layer as AgLayer, Psd } from 'ag-psd';
import { createDocument, createRasterLayer, uid } from '../core/document';
import type { BlendMode, ImportResult, Layer, PaintDocument } from '../types';

// ---------------------------------------------------------------------------
// Headless canvas initialisation
//
// ag-psd's default createImageData() calls canvas.getContext('2d').createImageData()
// which fails under jsdom (no canvas). We override it here so that the module
// works both headlessly (tests/Node) and in the browser (where globalThis.ImageData
// is the real DOM class).
// ---------------------------------------------------------------------------
initializeCanvas(
  // createCanvas stub — only used for canvas-based export paths, not our code path
  (w, h) => {
    const el = typeof document !== 'undefined'
      ? document.createElement('canvas')
      : ({ width: w, height: h, getContext: () => null } as unknown as HTMLCanvasElement);
    el.width = w;
    el.height = h;
    return el;
  },
  // createCanvasFromData stub — not used in our code path
  undefined,
  // createImageData override — uses the global ImageData (polyfilled in tests)
  (w, h) => new ImageData(w, h),
);

// ---------------------------------------------------------------------------
// Blend-mode look-up tables
// ---------------------------------------------------------------------------

/** ag-psd blend-mode string → our BlendMode */
const AG_TO_OUR: Record<string, BlendMode> = {
  'normal': 'normal',
  'multiply': 'multiply',
  'screen': 'screen',
  'overlay': 'overlay',
  'darken': 'darken',
  'lighten': 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  'difference': 'difference',
  'exclusion': 'exclusion',
  'linear dodge': 'add',     // "Add" in PS
  'subtract': 'subtract',    // PS "Subtract" (fsub)
  'linear burn': 'subtract', // lossy: our model has no Linear Burn — nearest is subtract
};

/** our BlendMode → ag-psd blend-mode string */
const OUR_TO_AG: Record<BlendMode, string> = {
  'normal': 'normal',
  'multiply': 'multiply',
  'screen': 'screen',
  'overlay': 'overlay',
  'darken': 'darken',
  'lighten': 'lighten',
  'color-dodge': 'color dodge',
  'color-burn': 'color burn',
  'hard-light': 'hard light',
  'soft-light': 'soft light',
  'difference': 'difference',
  'exclusion': 'exclusion',
  'add': 'linear dodge',
  'subtract': 'subtract',
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Parse a PSD ArrayBuffer and return a PaintDocument.
 *
 * Layer ordering: ag-psd children[0] is the TOP layer (same as the PS panel).
 * Our doc.layers is bottom=index 0. So we reverse the children array during import.
 */
export async function importPSD(buffer: ArrayBuffer): Promise<ImportResult> {
  const warnings: string[] = [];

  const psd = readPsd(buffer, {
    useImageData: true,
    skipCompositeImageData: false,
    skipThumbnail: true,
  });

  const docWidth = psd.width;
  const docHeight = psd.height;

  // Resolve DPI from image resources when available.
  const dpi =
    psd.imageResources?.resolutionInfo?.horizontalResolution ?? 72;

  // Start with a minimal document so we inherit id/selection scaffolding.
  const doc = createDocument(docWidth, docHeight, psd.name ?? '無題', dpi);
  // Remove the two default layers; we will build our own from PSD data.
  doc.layers = [];
  doc.activeLayerId = null;

  const agChildren: AgLayer[] = psd.children ?? [];

  // ag-psd: children[0] = top of panel → reverse to get bottom-first order.
  const bottomFirst = [...agChildren].reverse();

  for (const agLayer of bottomFirst) {
    const layerName = agLayer.name ?? 'レイヤー';

    // Map blend mode; fall back to 'normal' with a warning on unknown values.
    let blendMode: BlendMode = 'normal';
    if (agLayer.blendMode) {
      if (agLayer.blendMode in AG_TO_OUR) {
        blendMode = AG_TO_OUR[agLayer.blendMode];
      } else {
        warnings.push(
          `レイヤー「${layerName}」のブレンドモード「${agLayer.blendMode}」は未対応です。通常に変換しました。`,
        );
      }
    }

    // ag-psd returns opacity already normalised to 0-1 (divides by 0xff internally).
    const opacity = agLayer.opacity !== undefined ? agLayer.opacity : 1;
    const visible = !agLayer.hidden;
    const clipping = agLayer.clipping ?? false;

    // Layers without imageData (group or empty) get an empty raster + warning.
    if (!agLayer.imageData) {
      warnings.push(
        `レイヤー「${layerName}」に画像データがありません（グループまたは空レイヤー）。空のラスターレイヤーとして読み込みました。`,
      );
      const emptyLayer = createRasterLayer(docWidth, docHeight, layerName);
      emptyLayer.blendMode = blendMode;
      emptyLayer.opacity = opacity;
      emptyLayer.visible = visible;
      emptyLayer.clipping = clipping;
      doc.layers.push(emptyLayer);
      continue;
    }

    // Blit the (potentially smaller) layer image data into a doc-sized buffer.
    const pixels = new Uint8ClampedArray(docWidth * docHeight * 4);
    const layerLeft = agLayer.left ?? 0;
    const layerTop = agLayer.top ?? 0;
    const layerWidth = agLayer.imageData.width;
    const layerHeight = agLayer.imageData.height;
    const src = agLayer.imageData.data as Uint8ClampedArray;

    for (let row = 0; row < layerHeight; row++) {
      const dstY = layerTop + row;
      if (dstY < 0 || dstY >= docHeight) continue;

      for (let col = 0; col < layerWidth; col++) {
        const dstX = layerLeft + col;
        if (dstX < 0 || dstX >= docWidth) continue;

        const srcIdx = (row * layerWidth + col) * 4;
        const dstIdx = (dstY * docWidth + dstX) * 4;

        pixels[dstIdx] = src[srcIdx];
        pixels[dstIdx + 1] = src[srcIdx + 1];
        pixels[dstIdx + 2] = src[srcIdx + 2];
        pixels[dstIdx + 3] = src[srcIdx + 3];
      }
    }

    const layer: Layer = {
      id: uid('layer'),
      name: layerName,
      kind: 'raster',
      visible,
      opacity,
      blendMode,
      locked: false,
      clipping,
      pixels,
    };

    doc.layers.push(layer);
  }

  // Make sure there is always at least one layer, and set an active layer.
  if (doc.layers.length === 0) {
    doc.layers.push(createRasterLayer(docWidth, docHeight));
    warnings.push('PSDにレイヤーが見つかりませんでした。空のレイヤーを作成しました。');
  }

  doc.activeLayerId = doc.layers[doc.layers.length - 1].id;

  return { doc, warnings };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Serialise a PaintDocument to a PSD ArrayBuffer.
 *
 * Layer ordering: our doc.layers[0] is the BOTTOM layer.
 * ag-psd children[0] is the TOP layer.  So we reverse on export.
 */
export function exportPSD(doc: PaintDocument): ArrayBuffer {
  const { width, height, layers } = doc;

  // Build ag-psd Layer objects in top-first order (reverse of our bottom-first).
  const children: AgLayer[] = [...layers].reverse().map((layer) => {
    const agBlendMode = OUR_TO_AG[layer.blendMode] ?? 'normal';

    // Build an ImageData-compatible object for ag-psd (works headlessly).
    const pixelData = layer.pixels
      ? {
          data: layer.pixels,
          width,
          height,
        }
      : undefined;

    return {
      name: layer.name,
      imageData: pixelData,
      // ag-psd expects opacity 0-1 (it converts to 0-255 internally).
      opacity: layer.opacity,
      hidden: !layer.visible,
      blendMode: agBlendMode as AgLayer['blendMode'],
      clipping: layer.clipping,
    } as AgLayer;
  });

  const psd: Psd = {
    width,
    height,
    children,
  };

  return writePsd(psd, { generateThumbnail: false });
}
