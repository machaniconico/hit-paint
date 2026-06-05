/**
 * HIT Paint — PNG import / export.
 *
 * flattenRGBA is pure (testable without a browser).
 * exportPNG / importImageFile are runtime-only and require a real browser
 * DOM (canvas, Image, createImageBitmap).
 */

import type { ImportResult, PaintDocument } from '../types';
import { composite, flattenToRGBA } from '../core/compositor';
import { createDocument, createRasterLayer } from '../core/document';

// ---------------------------------------------------------------------------
// Pure helper — testable
// ---------------------------------------------------------------------------

/**
 * Flatten all layers of `doc` into a single contiguous RGBA buffer.
 * Delegates to compositor's flattenToRGBA which composites bottom→top.
 * Returns the same data the PNG encoder will ultimately write.
 */
export function flattenRGBA(doc: PaintDocument): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  return {
    data: flattenToRGBA(doc),
    width: doc.width,
    height: doc.height,
  };
}

// ---------------------------------------------------------------------------
// Runtime helpers (browser only)
// ---------------------------------------------------------------------------

/** Guard: throw a clear error when the browser document object is missing. */
function requireDocument(): void {
  if (typeof document === 'undefined') {
    throw new Error(
      'exportPNG はブラウザ環境でのみ使用できます (document が存在しません)。',
    );
  }
}

/**
 * Export a PaintDocument as a PNG Blob by compositing all visible layers onto
 * an offscreen canvas and encoding via the native canvas API.
 *
 * RUNTIME ONLY — do not call from tests.
 */
export async function exportPNG(doc: PaintDocument): Promise<Blob> {
  requireDocument();

  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('PNG エクスポート: 2D コンテキストを取得できませんでした。');
  }

  // Composite all layers, then paint the result onto the canvas.
  const imageData = composite(doc);
  ctx.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('PNG エクスポート: Blob の生成に失敗しました。'));
      }
    }, 'image/png');
  });
}

/**
 * Import a raster image (PNG, JPEG, …) from an ArrayBuffer, decode it via a
 * browser Image / createImageBitmap onto a canvas, read back the pixel data,
 * and return a PaintDocument whose top layer holds those pixels.
 *
 * RUNTIME ONLY — do not call from tests.
 */
export async function importImageFile(
  buffer: ArrayBuffer,
  mime: string,
  name: string,
): Promise<ImportResult> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error(
      '画像のインポートはブラウザ環境でのみ使用できます。',
    );
  }

  const warnings: string[] = [];

  // Decode the image via createImageBitmap (spec-standard, avoids an Image
  // element's asynchronous onload dance).
  const blob = new Blob([buffer], { type: mime });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error(
      `画像のデコードに失敗しました (MIME: ${mime})。対応フォーマットか確認してください。`,
    );
  }

  const { width, height } = bitmap;

  // Draw onto an offscreen canvas to read raw RGBA pixels.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('画像インポート: 2D コンテキストを取得できませんでした。');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close(); // free GPU memory

  const imageData = ctx.getImageData(0, 0, width, height);

  // Build a document with a single raster layer containing the decoded pixels.
  // createDocument adds a white background + blank layer; we replace them.
  const doc = createDocument(width, height, name);

  // Replace the two default layers with a single "インポート" layer.
  const importedLayer = createRasterLayer(width, height, 'インポート');
  importedLayer.pixels!.set(imageData.data);

  doc.layers = [importedLayer];
  doc.activeLayerId = importedLayer.id;

  // Warn if the image dimensions are unusually large (informational only).
  if (width * height > 4096 * 4096) {
    warnings.push(
      `画像サイズ (${width}×${height}) が大きいため、処理に時間がかかる場合があります。`,
    );
  }

  return { doc, warnings };
}
