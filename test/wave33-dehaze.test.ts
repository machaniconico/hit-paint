import { describe, expect, it } from 'vitest';
import { dehaze } from '../src/filters/dehaze';

type RGBA = [number, number, number, number];

function rgbaBuffer(colors: RGBA[]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flat());
}

function pixelAt(pixels: Uint8ClampedArray, pixel: number): RGBA {
  const i = pixel * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

describe('wave33 dehaze', () => {
  it('strength=0 yields byte-identical output', () => {
    const pixels = rgbaBuffer([
      [140, 150, 160, 255],
      [220, 225, 230, 128],
      [170, 180, 190, 64],
    ]);
    const before = Array.from(pixels);

    dehaze(pixels, 3, 1, { strength: 0, patch: 1 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('hazy low-contrast image gains contrast and dark pixels become darker', () => {
    const pixels = rgbaBuffer([
      [140, 150, 160, 255],
      [220, 225, 230, 255],
      [170, 180, 190, 255],
      [200, 205, 210, 255],
    ]);

    dehaze(pixels, 2, 2, { strength: 0.75, patch: 1 });

    expect(pixelAt(pixels, 0)).toEqual([69, 84, 98, 255]);
    expect(pixelAt(pixels, 1)).toEqual([220, 225, 230, 255]);
    expect(pixelAt(pixels, 2)).toEqual([104, 121, 137, 255]);
    expect(pixels[0]).toBeLessThan(140);
    expect(pixels[8]).toBeLessThan(170);
    expect(pixels[4] - pixels[0]).toBeGreaterThan(220 - 140);
  });

  it('preserves alpha channel', () => {
    const pixels = rgbaBuffer([
      [140, 150, 160, 0],
      [220, 225, 230, 77],
      [170, 180, 190, 128],
      [200, 205, 210, 255],
    ]);

    dehaze(pixels, 2, 2, { strength: 0.75, patch: 1 });

    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual([0, 77, 128, 255]);
  });

  it('mask coverage=0 leaves pixel unchanged', () => {
    const pixels = rgbaBuffer([
      [140, 150, 160, 255],
      [220, 225, 230, 255],
    ]);
    const before = new Uint8ClampedArray(pixels);

    dehaze(pixels, 2, 1, {
      strength: 0.75,
      patch: 1,
      mask: new Uint8ClampedArray([0, 255]),
    });

    expect(pixelAt(pixels, 0)).toEqual(pixelAt(before, 0));
    expect(pixelAt(pixels, 1)).toEqual([220, 225, 230, 255]);
  });

  it('w<=0 and h<=0 are safe', () => {
    const pixels = rgbaBuffer([
      [140, 150, 160, 255],
    ]);
    const before = Array.from(pixels);

    expect(() => dehaze(pixels, 0, 1, { strength: 0.75 })).not.toThrow();
    expect(() => dehaze(pixels, 1, 0, { strength: 0.75 })).not.toThrow();
    expect(() => dehaze(pixels, -1, 1, { strength: 0.75 })).not.toThrow();
    expect(() => dehaze(pixels, 1, -1, { strength: 0.75 })).not.toThrow();
    expect(Array.from(pixels)).toEqual(before);
  });
});
