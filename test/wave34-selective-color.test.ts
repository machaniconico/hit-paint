import { describe, expect, it } from 'vitest';
import { selectiveColor } from '../src/filters/selective-color';

type RGBA = [number, number, number, number];

function rgbaBuffer(colors: RGBA[]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flat());
}

function pixelAt(pixels: Uint8ClampedArray, pixel: number): RGBA {
  const i = pixel * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

describe('selectiveColor', () => {
  it("range='reds', hueShift=120 rotates a red pixel toward green and keeps blue nearly unchanged", () => {
    const pixels = rgbaBuffer([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);

    selectiveColor(pixels, 2, 1, { range: 'reds', hueShift: 120 });

    expect(pixelAt(pixels, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(pixels, 1)).toEqual([0, 0, 255, 255]);
  });

  it('satScale=0 on target range makes that pixel grayscale', () => {
    const pixels = rgbaBuffer([[255, 0, 0, 255]]);

    selectiveColor(pixels, 1, 1, { range: 'reds', satScale: 0 });

    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[1]).toBe(pixels[2]);
  });

  it('no-op settings keep output bytes identical to input', () => {
    const pixels = rgbaBuffer([
      [211, 42, 67, 255],
      [18, 90, 220, 128],
      [140, 140, 140, 64],
    ]);
    const before = Array.from(pixels);

    selectiveColor(pixels, 3, 1, {
      range: 'reds',
      hueShift: 0,
      satScale: 1,
      lightScale: 1,
    });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('preserves alpha values for all processed pixels', () => {
    const pixels = rgbaBuffer([
      [255, 0, 0, 0],
      [255, 0, 0, 64],
      [255, 0, 0, 128],
      [255, 0, 0, 255],
    ]);
    const beforeAlpha = [pixels[3], pixels[7], pixels[11], pixels[15]];

    selectiveColor(pixels, 4, 1, { range: 'reds', hueShift: 120, lightScale: 0.5 });

    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual(beforeAlpha);
  });

  it('mask coverage=0 leaves pixel bytes unchanged', () => {
    const pixels = rgbaBuffer([[255, 0, 0, 123]]);
    const before = Array.from(pixels);

    selectiveColor(pixels, 1, 1, {
      range: 'reds',
      hueShift: 120,
      mask: new Uint8ClampedArray([0]),
    });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('w=0 or h=0 does not crash and does not change pixels', () => {
    const pixels = rgbaBuffer([[255, 0, 0, 255]]);
    const before = Array.from(pixels);

    expect(() => selectiveColor(pixels, 0, 1, { range: 'reds', hueShift: 120 })).not.toThrow();
    expect(() => selectiveColor(pixels, 1, 0, { range: 'reds', hueShift: 120 })).not.toThrow();
    expect(Array.from(pixels)).toEqual(before);
  });
});
