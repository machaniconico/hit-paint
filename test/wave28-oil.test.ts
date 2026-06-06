import { describe, expect, it } from 'vitest';
import { oilPaint, type OilPaintOptions } from '../src/filters/oil';

type RGBA = [number, number, number, number];

function rgbaBuffer(colors: RGBA[]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flat());
}

function filled(width: number, height: number, color: RGBA): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = color[3];
  }

  return pixels;
}

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): RGBA {
  const i = (y * width + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

function setPixel(pixels: Uint8ClampedArray, x: number, y: number, width: number, color: RGBA): void {
  const i = (y * width + x) * 4;
  pixels[i] = color[0];
  pixels[i + 1] = color[1];
  pixels[i + 2] = color[2];
  pixels[i + 3] = color[3];
}

function grayGrid(values: number[]): Uint8ClampedArray {
  const pixels: RGBA[] = values.map((value) => [value, value, value, 255]);
  return rgbaBuffer(pixels);
}

describe('wave28 oil paint', () => {
  it('radius=0 is a byte-identical no-op', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      200, 180, 160, 140,
      0, 128, 255, 64,
    ]);
    const before = Array.from(pixels);
    const opts: OilPaintOptions = { radius: 0 };

    oilPaint(pixels, 3, 1, opts);

    expect(Array.from(pixels)).toEqual(before);
  });

  it('flat-color regions remain the same flat color', () => {
    const color: RGBA = [45, 90, 135, 210];
    const pixels = filled(4, 3, color);

    oilPaint(pixels, 4, 3, { radius: 2 });

    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        expect(pixelAt(pixels, x, y, 4)).toEqual(color);
      }
    }
  });

  it('preserves a sharp red-blue step away from and across the edge', () => {
    const red: RGBA = [255, 0, 0, 255];
    const blue: RGBA = [0, 0, 255, 255];
    const pixels = filled(6, 3, red);

    for (let y = 0; y < 3; y++) {
      for (let x = 3; x < 6; x++) {
        setPixel(pixels, x, y, 6, blue);
      }
    }

    oilPaint(pixels, 6, 3, { radius: 1 });

    expect(pixelAt(pixels, 0, 1, 6)).toEqual(red);
    expect(pixelAt(pixels, 5, 1, 6)).toEqual(blue);
    expect(pixelAt(pixels, 2, 1, 6)[0]).toBeGreaterThan(pixelAt(pixels, 2, 1, 6)[2]);
    expect(pixelAt(pixels, 3, 1, 6)[2]).toBeGreaterThan(pixelAt(pixels, 3, 1, 6)[0]);
  });

  it('smooths isolated noise by moving the center pixel toward the neighborhood mean', () => {
    const pixels = grayGrid([
      100, 100, 100,
      100, 220, 100,
      100, 100, 100,
    ]);
    const beforeCenter = pixelAt(pixels, 1, 1, 3)[0];
    const neighborhoodMean = (100 * 8 + 220) / 9;

    oilPaint(pixels, 3, 3, { radius: 1 });

    const afterCenter = pixelAt(pixels, 1, 1, 3)[0];
    expect(afterCenter).toBeLessThan(beforeCenter);
    expect(Math.abs(afterCenter - neighborhoodMean)).toBeLessThan(
      Math.abs(beforeCenter - neighborhoodMean),
    );
  });

  it('mask coverage=0 leaves that pixel byte-identical after filtering', () => {
    const pixels = grayGrid([
      100, 100, 100,
      100, 220, 100,
      100, 100, 100,
    ]);
    const before = new Uint8ClampedArray(pixels);
    const mask = new Uint8ClampedArray(9);
    mask.fill(255);
    mask[4] = 0;

    oilPaint(pixels, 3, 3, { radius: 1, mask });

    expect(pixelAt(pixels, 1, 1, 3)).toEqual(pixelAt(before, 1, 1, 3));
  });
});
