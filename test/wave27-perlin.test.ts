import { describe, expect, it } from 'vitest';
import { fbm2D, generateNoiseField, noiseToGrayscale, valueNoise2D } from '../src/engine/perlin';

function expectUnitRange(value: number): void {
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThan(1);
}

function sampleX(index: number): number {
  return (((index * 37) % 53) - 26) / 9;
}

function sampleY(index: number): number {
  return (((index * 41 + 7) % 59) - 29) / 11;
}

function sampleSeed(index: number): number {
  return (index * 2654435761) >>> 0;
}

describe('wave27 perlin noise', () => {
  it('returns deterministic valueNoise2D samples for the same input', () => {
    const first = valueNoise2D(1.25, -3.5, 12345);
    const second = valueNoise2D(1.25, -3.5, 12345);

    expect(first).toBe(second);
  });

  it('keeps valueNoise2D samples in the unit range', () => {
    for (let i = 0; i < 100; i++) {
      expectUnitRange(valueNoise2D(sampleX(i), sampleY(i), sampleSeed(i)));
    }
  });

  it('returns deterministic fbm2D samples for the same input', () => {
    const first = fbm2D(0.33, 0.77, 9090, 5, 0.6);
    const second = fbm2D(0.33, 0.77, 9090, 5, 0.6);

    expect(first).toBe(second);
  });

  it('keeps fbm2D samples in the unit range', () => {
    for (let i = 0; i < 100; i++) {
      expectUnitRange(fbm2D(sampleX(i) * 0.5, sampleY(i) * 0.5, sampleSeed(i), 6, 0.5));
    }
  });

  it('produces different fields for different seeds', () => {
    const first = generateNoiseField(5, 4, { seed: 11, scale: 0.8 });
    const second = generateNoiseField(5, 4, { seed: 12, scale: 0.8 });
    const sampleIndexes = [0, 3, 7, 11, 19];
    const differences = sampleIndexes.filter((index) => first[index] !== second[index]);

    expect(differences.length).toBeGreaterThan(0);
  });

  it('keeps adjacent integer valueNoise2D grid points continuous', () => {
    for (let y = -3; y <= 3; y++) {
      for (let x = -3; x <= 3; x++) {
        const current = valueNoise2D(x, y, 777);

        expect(Math.abs(current - valueNoise2D(x + 1, y, 777))).toBeLessThan(0.5);
        expect(Math.abs(current - valueNoise2D(x, y + 1, 777))).toBeLessThan(0.5);
      }
    }
  });

  it('generates a unit-range noise field with one value per pixel', () => {
    const width = 8;
    const height = 6;
    const field = generateNoiseField(width, height, { seed: 42, scale: 0.75, octaves: 4, persistence: 0.55 });

    expect(field.length).toBe(width * height);
    for (const value of field) {
      expectUnitRange(value);
    }
  });

  it('converts noise fields to opaque grayscale pixels', () => {
    const width = 4;
    const height = 3;
    const field = generateNoiseField(width, height, { seed: 99, scale: 0.5 });
    const pixels = noiseToGrayscale(field, width, height);

    expect(pixels.length).toBe(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(pixels[i + 1]);
      expect(pixels[i + 1]).toBe(pixels[i + 2]);
      expect(pixels[i + 3]).toBe(255);
    }
  });
});
