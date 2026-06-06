import { describe, expect, it } from 'vitest';
import { extractPalette, sortByLuma, toHex, type Swatch } from '../src/color/swatches';
import type { RGBA } from '../src/types';

const red: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const green: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const blue: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const black: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const white: RGBA = { r: 255, g: 255, b: 255, a: 255 };

function pixels(colors: RGBA[]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(colors.length * 4);
  colors.forEach((color, pixel) => {
    const index = pixel * 4;
    px[index] = color.r;
    px[index + 1] = color.g;
    px[index + 2] = color.b;
    px[index + 3] = color.a;
  });
  return px;
}

function luma(color: RGBA): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

describe('wave32 swatches', () => {
  it('extracts equal red and blue swatches from a half-red half-blue image', () => {
    const px = pixels([red, red, blue, blue]);
    const result = extractPalette(px, 4, 1, 2);

    expect(result).toHaveLength(2);
    expect(result[0].color).toEqual(red);
    expect(result[1].color).toEqual(blue);
    expect(result[0].weight).toBeCloseTo(0.5);
    expect(result[1].weight).toBeCloseTo(0.5);
  });

  it('returns one full-weight swatch for a single-color image', () => {
    const color: RGBA = { r: 24, g: 80, b: 176, a: 255 };
    const result = extractPalette(pixels([color, color, color]), 3, 1, 4);

    expect(result).toEqual([{ color, weight: 1 }]);
  });

  it('returns only existing colors when count is larger than distinct colors', () => {
    const result = extractPalette(pixels([red, green, green]), 3, 1, 8);

    expect(result).toHaveLength(2);
    expect(result.map((swatch) => swatch.color)).toEqual([green, red]);
  });

  it('ignores transparent pixels', () => {
    const transparentGreen: RGBA = { ...green, a: 0 };
    const result = extractPalette(pixels([transparentGreen, red]), 2, 1, 2);

    expect(result).toEqual([{ color: red, weight: 1 }]);
  });

  it('returns an empty palette for non-positive count and zero opaque pixels', () => {
    expect(extractPalette(pixels([red]), 1, 1, 0)).toEqual([]);
    expect(extractPalette(pixels([{ ...blue, a: 0 }]), 1, 1, 3)).toEqual([]);
  });

  it('sortByLuma returns swatches in ascending luma order without mutation', () => {
    const swatches: Swatch[] = [
      { color: white, weight: 0.25 },
      { color: green, weight: 0.25 },
      { color: black, weight: 0.25 },
      { color: red, weight: 0.25 },
    ];
    const result = sortByLuma(swatches);

    expect(result.map((swatch) => swatch.color)).toEqual([black, red, green, white]);
    expect(result.map((swatch) => luma(swatch.color))).toEqual([...result].map((swatch) => luma(swatch.color)).sort((a, b) => a - b));
    expect(swatches.map((swatch) => swatch.color)).toEqual([white, green, black, red]);
  });

  it('toHex returns lowercase #rrggbb strings', () => {
    expect(toHex({ r: 15, g: 160, b: 255, a: 64 })).toBe('#0fa0ff');
  });
});
