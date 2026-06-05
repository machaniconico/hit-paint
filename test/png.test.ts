/**
 * Tests for src/io/png.ts — pure flattenRGBA only.
 * No canvas / getContext / toBlob is touched here.
 */

import { describe, it, expect } from 'vitest';
import { createDocument } from '../src/core/document';
import { flattenRGBA } from '../src/io/png';

describe('flattenRGBA', () => {
  it('returns the correct width and height', () => {
    const doc = createDocument(8, 8);
    const result = flattenRGBA(doc);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
  });

  it('returns a buffer of length width * height * 4', () => {
    const doc = createDocument(8, 8);
    const result = flattenRGBA(doc);
    expect(result.data.length).toBe(8 * 8 * 4);
  });

  it('background pixel has alpha 255 (opaque white background layer)', () => {
    const doc = createDocument(8, 8);
    const result = flattenRGBA(doc);
    // Pixel at (0,0): index 0 = R, 1 = G, 2 = B, 3 = A
    expect(result.data[3]).toBe(255);
  });

  it('returns a Uint8ClampedArray', () => {
    const doc = createDocument(8, 8);
    const result = flattenRGBA(doc);
    expect(result.data).toBeInstanceOf(Uint8ClampedArray);
  });
});
