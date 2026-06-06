import { describe, expect, it } from 'vitest';
import { worleyField, worleyToGrayscale } from '../src/engine/cellular';

function hash2(seed: number, cx: number, cy: number): [number, number] {
  let h = (Math.imul(seed | 0, 1664525) + Math.imul(cx | 0, 1013904223) + Math.imul(cy | 0, 22695477)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  const fx = (h >>> 0) / 0x100000000;

  let h2 = (Math.imul(h, 1664525) + 1013904223) | 0;
  h2 ^= h2 >>> 16;
  h2 = Math.imul(h2, 0x45d9f3b);
  h2 ^= h2 >>> 16;
  const fy = (h2 >>> 0) / 0x100000000;

  return [fx, fy];
}

function featurePoint(seed: number, cellX: number, cellY: number, cellSize: number): [number, number] {
  const [fx, fy] = hash2(seed, cellX, cellY);
  return [(cellX + fx) * cellSize, (cellY + fy) * cellSize];
}

function clampedRound(value: number, max: number): number {
  return Math.max(0, Math.min(max - 1, Math.round(value)));
}

function fieldIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

function hasDifference(first: Float32Array, second: Float32Array): boolean {
  for (let i = 0; i < first.length; i++) {
    if (first[i] !== second[i]) return true;
  }
  return false;
}

describe('wave29 cellular noise', () => {
  it('worleyField is deterministic for identical options', () => {
    const opts = { width: 24, height: 18, cellSize: 8, seed: 3102 };
    const first = worleyField(opts);
    const second = worleyField(opts);

    expect(first).toEqual(second);
  });

  it('worleyField keeps every value in the unit range', () => {
    const field = worleyField({ width: 31, height: 29, cellSize: 7, seed: 77 });

    for (const value of field) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('worleyField returns a near-zero value beside a known feature point', () => {
    const width = 96;
    const height = 96;
    const cellSize = 32;
    const seed = 123;
    const [featureX, featureY] = featurePoint(seed, 1, 1, cellSize);
    const x = clampedRound(featureX, width);
    const y = clampedRound(featureY, height);
    const field = worleyField({ width, height, cellSize, seed });

    expect(field[fieldIndex(width, x, y)]).toBeLessThan(0.1);
  });

  it('worleyField gives a large-cell center a higher F1 than a nearby feature point', () => {
    const width = 192;
    const height = 192;
    const cellSize = 64;
    const seed = 42;
    const [featureX, featureY] = featurePoint(seed, 0, 0, cellSize);
    const featurePixelX = clampedRound(featureX, width);
    const featurePixelY = clampedRound(featureY, height);
    const centerX = Math.round(cellSize * 0.5);
    const centerY = Math.round(cellSize * 0.5);
    const field = worleyField({ width, height, cellSize, seed });

    expect(field[fieldIndex(width, centerX, centerY)]).toBeGreaterThan(
      field[fieldIndex(width, featurePixelX, featurePixelY)],
    );
  });

  it('worleyField produces different fields for different seeds', () => {
    const first = worleyField({ width: 20, height: 16, cellSize: 6, seed: 11 });
    const second = worleyField({ width: 20, height: 16, cellSize: 6, seed: 12 });

    expect(hasDifference(first, second)).toBe(true);
  });

  it('worleyField produces different fields for manhattan and euclidean metrics', () => {
    const euclidean = worleyField({ width: 20, height: 16, cellSize: 6, seed: 99, metric: 'euclidean' });
    const manhattan = worleyField({ width: 20, height: 16, cellSize: 6, seed: 99, metric: 'manhattan' });

    expect(hasDifference(euclidean, manhattan)).toBe(true);
  });

  it('worleyToGrayscale returns RGBA pixels with width * height * 4 length', () => {
    const width = 3;
    const height = 2;
    const pixels = worleyToGrayscale(new Float32Array(width * height), width, height);

    expect(pixels.length).toBe(width * height * 4);
  });

  it('worleyToGrayscale writes opaque alpha for every pixel', () => {
    const width = 2;
    const height = 2;
    const pixels = worleyToGrayscale(new Float32Array([0, 0.25, 0.5, 0.75]), width, height);

    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i + 3]).toBe(255);
    }
  });

  it('worleyToGrayscale writes equal R, G, and B channels', () => {
    const width = 2;
    const height = 2;
    const pixels = worleyToGrayscale(new Float32Array([0, 0.25, 0.5, 0.75]), width, height);

    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(pixels[i + 1]);
      expect(pixels[i + 1]).toBe(pixels[i + 2]);
    }
  });

  it('worleyField returns an empty field when width or height is zero', () => {
    expect(worleyField({ width: 0, height: 4, cellSize: 4, seed: 1 }).length).toBe(0);
    expect(worleyField({ width: 4, height: 0, cellSize: 4, seed: 1 }).length).toBe(0);
  });
});
