import { describe, expect, it } from 'vitest';
import { adjustTemperature, hslToRgb, rgbToHsl } from '../src/color/convert';
import type { RGBA } from '../src/types';

const expectCloseRgb = (actual: RGBA, expected: RGBA, tolerance = 2): void => {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(tolerance);
  expect(actual.a).toBe(expected.a);
};

describe('HSL conversion', () => {
  it('rgbToHsl returns the known value for pure red', () => {
    const hsl = rgbToHsl({ r: 255, g: 0, b: 0, a: 255 });

    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(1);
    expect(hsl.l).toBe(0.5);
  });

  it('hslToRgb round-trips representative colors within small integer error', () => {
    const colors: RGBA[] = [
      { r: 200, g: 100, b: 50, a: 77 },
      { r: 12, g: 180, b: 220, a: 255 },
      { r: 90, g: 40, b: 210, a: 128 },
    ];

    for (const color of colors) {
      const hsl = rgbToHsl(color);
      expectCloseRgb(hslToRgb(hsl.h, hsl.s, hsl.l, color.a), color);
    }
  });

  it('reports zero saturation for gray', () => {
    const hsl = rgbToHsl({ r: 128, g: 128, b: 128, a: 255 });

    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(0);
    expect(hsl.l).toBeCloseTo(128 / 255, 6);
  });
});

describe('adjustTemperature', () => {
  it('positive temperature warms by increasing red and decreasing blue', () => {
    const pixels = new Uint8ClampedArray([100, 100, 100, 222]);

    adjustTemperature(pixels, 1, 1, { temperature: 50 });

    expect(pixels[0]).toBeGreaterThan(100);
    expect(pixels[1]).toBe(100);
    expect(pixels[2]).toBeLessThan(100);
    expect(pixels[3]).toBe(222);
  });

  it('positive tint shifts toward magenta', () => {
    const pixels = new Uint8ClampedArray([100, 100, 100, 123]);

    adjustTemperature(pixels, 1, 1, { temperature: 0, tint: 50 });

    expect(pixels[0]).toBeGreaterThan(100);
    expect(pixels[1]).toBeLessThan(100);
    expect(pixels[2]).toBeGreaterThan(100);
    expect(pixels[3]).toBe(123);
  });

  it('negative tint shifts toward green', () => {
    const pixels = new Uint8ClampedArray([100, 100, 100, 200]);

    adjustTemperature(pixels, 1, 1, { temperature: 0, tint: -50 });

    expect(pixels[0]).toBeLessThan(100);
    expect(pixels[1]).toBeGreaterThan(100);
    expect(pixels[2]).toBeLessThan(100);
    expect(pixels[3]).toBe(200);
  });

  it('leaves masked-out pixels unchanged', () => {
    const pixels = new Uint8ClampedArray([80, 90, 100, 111]);
    const before = Array.from(pixels);

    adjustTemperature(pixels, 1, 1, { temperature: 100, tint: 100 }, new Uint8ClampedArray([0]));

    expect(Array.from(pixels)).toEqual(before);
  });

  it('applies mask coverage proportionally and preserves alpha', () => {
    const full = new Uint8ClampedArray([100, 100, 100, 77]);
    const half = new Uint8ClampedArray([100, 100, 100, 77]);

    adjustTemperature(full, 1, 1, { temperature: 100 }, new Uint8ClampedArray([255]));
    adjustTemperature(half, 1, 1, { temperature: 100 }, new Uint8ClampedArray([128]));

    expect(half[0]).toBeGreaterThan(100);
    expect(half[0]).toBeLessThan(full[0]);
    expect(half[2]).toBeLessThan(100);
    expect(half[2]).toBeGreaterThan(full[2]);
    expect(half[3]).toBe(77);
  });
});
