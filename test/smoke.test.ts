import { describe, it, expect } from 'vitest';
import { createDocument, createRasterLayer } from '../src/core/document';
import { composite } from '../src/core/compositor';
import { StrokeEngine } from '../src/engine/brush';
import { rgbToHsv, hsvToRgb } from '../src/color/color';
import { DEFAULT_BRUSH } from '../src/types';

describe('environment + spine smoke', () => {
  it('has ImageData global', () => {
    expect(typeof ImageData).toBe('function');
    const img = new ImageData(2, 2);
    expect(img.data.length).toBe(16);
  });

  it('composites a document', () => {
    const doc = createDocument(8, 8);
    const img = composite(doc);
    expect(img.width).toBe(8);
    // background is white opaque
    expect(img.data[3]).toBe(255);
  });

  it('brush engine paints coverage and commits', () => {
    const doc = createDocument(32, 32);
    const layer = doc.layers[1];
    const eng = new StrokeEngine(32, 32, { ...DEFAULT_BRUSH, size: 10 }, false);
    eng.addSample({ x: 16, y: 16, pressure: 1, t: 0 });
    eng.addSample({ x: 20, y: 16, pressure: 1, t: 10 });
    const painted = eng.coverage.some((c) => c > 0);
    expect(painted).toBe(true);
    eng.commit(layer.pixels!, { r: 255, g: 0, b: 0, a: 255 }, null);
    const center = (16 * 32 + 16) * 4;
    expect(layer.pixels![center + 3]).toBeGreaterThan(0);
  });

  it('round-trips color through HSV', () => {
    const rgb = hsvToRgb(rgbToHsv({ r: 200, g: 100, b: 50 }));
    expect(Math.abs(rgb.r - 200)).toBeLessThan(2);
    expect(Math.abs(rgb.g - 100)).toBeLessThan(2);
    expect(Math.abs(rgb.b - 50)).toBeLessThan(2);
  });
});
