/**
 * PSD round-trip tests.
 *
 * Pure array logic only — no canvas, no getContext, no toBlob.
 * ImageData is polyfilled by test/setup.ts via the global ImageDataPolyfill.
 */

import { describe, it, expect } from 'vitest';
import { createDocument } from '../src/core/document';
import { exportPSD, importPSD } from '../src/io/psd';

describe('PSD import/export round-trip', () => {
  it('preserves document dimensions', async () => {
    const doc = createDocument(16, 16);
    const buf = exportPSD(doc);
    const result = await importPSD(buf);
    expect(result.doc.width).toBe(16);
    expect(result.doc.height).toBe(16);
  });

  it('round-trips at least 2 layers', async () => {
    const doc = createDocument(16, 16);
    // createDocument produces 2 layers (背景 + レイヤー 1)
    expect(doc.layers.length).toBe(2);
    const buf = exportPSD(doc);
    const result = await importPSD(buf);
    expect(result.doc.layers.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves painted pixel RGBA within tolerance', async () => {
    const doc = createDocument(16, 16);

    // Paint a known pixel into layers[1] (the draw layer, index=1 = top in our list)
    const drawLayer = doc.layers[1];
    expect(drawLayer.pixels).toBeDefined();

    // Pixel at (3, 5) in a 16-wide image: index = (5 * 16 + 3) * 4
    const pixelIdx = (5 * 16 + 3) * 4;
    drawLayer.pixels![pixelIdx] = 200;     // R
    drawLayer.pixels![pixelIdx + 1] = 100; // G
    drawLayer.pixels![pixelIdx + 2] = 50;  // B
    drawLayer.pixels![pixelIdx + 3] = 255; // A

    const buf = exportPSD(doc);
    const result = await importPSD(buf);

    // After round-trip, find the layer that was originally layers[1].
    // Our export reverses (top-first) then import reverses back (bottom-first),
    // so layers[1] in the original corresponds to layers[1] in the result.
    const roundTrippedLayer = result.doc.layers[1];
    expect(roundTrippedLayer).toBeDefined();
    expect(roundTrippedLayer.pixels).toBeDefined();

    const px = roundTrippedLayer.pixels!;
    const tolerance = 2; // allow minor codec rounding
    expect(Math.abs(px[pixelIdx] - 200)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(px[pixelIdx + 1] - 100)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(px[pixelIdx + 2] - 50)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(px[pixelIdx + 3] - 255)).toBeLessThanOrEqual(tolerance);
  });

  it('emits no fatal warnings for a clean document', async () => {
    const doc = createDocument(16, 16);
    const buf = exportPSD(doc);
    const result = await importPSD(buf);
    // A clean doc should have no warnings (blend modes are all 'normal')
    expect(result.warnings.length).toBe(0);
  });

  it('preserves layer visibility and opacity', async () => {
    const doc = createDocument(16, 16);
    doc.layers[1].visible = false;
    doc.layers[1].opacity = 0.5;

    const buf = exportPSD(doc);
    const result = await importPSD(buf);

    const layer = result.doc.layers[1];
    expect(layer.visible).toBe(false);
    // Opacity round-trips through 0-255 integer; allow up to 1/255 (~0.004) of rounding error.
    expect(Math.abs(layer.opacity - 0.5)).toBeLessThan(0.01);
  });

  it('exportPSD returns an ArrayBuffer', () => {
    const doc = createDocument(16, 16);
    const buf = exportPSD(doc);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
