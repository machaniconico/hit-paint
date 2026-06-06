import { describe, expect, it } from 'vitest';
import { composeSpriteSheet, type SpriteFrame } from '../src/anim/sprite-sheet';

type RGBA = [number, number, number, number];

function frame(width: number, height: number, colors: RGBA[]): SpriteFrame {
  return {
    pixels: new Uint8ClampedArray(colors.flat()),
    width,
    height,
  };
}

function solidFrame(color: RGBA): SpriteFrame {
  return frame(2, 2, [color, color, color, color]);
}

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): RGBA {
  const i = (y * width + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

describe('composeSpriteSheet', () => {
  it('places four 2x2 frames into a 2x2 grid when cols=2', () => {
    const red: RGBA = [255, 0, 0, 255];
    const green: RGBA = [0, 255, 0, 255];
    const blue: RGBA = [0, 0, 255, 255];
    const yellow: RGBA = [255, 255, 0, 255];
    const sheet = composeSpriteSheet([
      solidFrame(red),
      solidFrame(green),
      solidFrame(blue),
      solidFrame(yellow),
    ], 2);

    expect(sheet.width).toBe(4);
    expect(sheet.height).toBe(4);
    expect(sheet.cols).toBe(2);
    expect(sheet.rows).toBe(2);
    expect(sheet.frameWidth).toBe(2);
    expect(sheet.frameHeight).toBe(2);
    expect(pixelAt(sheet.pixels, 0, 0, sheet.width)).toEqual(red);
    expect(pixelAt(sheet.pixels, 2, 0, sheet.width)).toEqual(green);
    expect(pixelAt(sheet.pixels, 0, 2, sheet.width)).toEqual(blue);
    expect(pixelAt(sheet.pixels, 2, 2, sheet.width)).toEqual(yellow);
  });

  it('uses a square-ish grid when cols is omitted', () => {
    const sheet = composeSpriteSheet([
      solidFrame([10, 0, 0, 255]),
      solidFrame([20, 0, 0, 255]),
      solidFrame([30, 0, 0, 255]),
      solidFrame([40, 0, 0, 255]),
    ]);

    expect(sheet.cols).toBe(2);
    expect(sheet.rows).toBe(2);
  });

  it('keeps unused cells transparent', () => {
    const sheet = composeSpriteSheet([
      solidFrame([10, 20, 30, 255]),
      solidFrame([40, 50, 60, 255]),
      solidFrame([70, 80, 90, 255]),
    ], 2);

    expect(sheet.rows).toBe(2);
    expect(pixelAt(sheet.pixels, 2, 2, sheet.width)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(sheet.pixels, 3, 3, sheet.width)).toEqual([0, 0, 0, 0]);
  });

  it('returns an empty sheet for empty frames', () => {
    const sheet = composeSpriteSheet([]);

    expect(sheet.pixels).toHaveLength(0);
    expect(sheet.width).toBe(0);
    expect(sheet.height).toBe(0);
    expect(sheet.cols).toBe(0);
    expect(sheet.rows).toBe(0);
    expect(sheet.frameWidth).toBe(0);
    expect(sheet.frameHeight).toBe(0);
  });

  it('does not mutate input frames and copies smaller frames top-left', () => {
    const small = frame(1, 1, [[255, 0, 0, 255]]);
    const wide = frame(2, 1, [
      [0, 255, 0, 255],
      [0, 0, 255, 255],
    ]);
    const beforeSmall = new Uint8ClampedArray(small.pixels);
    const beforeWide = new Uint8ClampedArray(wide.pixels);

    const sheet = composeSpriteSheet([small, wide], 2);

    expect(sheet.frameWidth).toBe(2);
    expect(sheet.frameHeight).toBe(1);
    expect(pixelAt(sheet.pixels, 0, 0, sheet.width)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(sheet.pixels, 1, 0, sheet.width)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(sheet.pixels, 2, 0, sheet.width)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(sheet.pixels, 3, 0, sheet.width)).toEqual([0, 0, 255, 255]);
    expect(Array.from(small.pixels)).toEqual(Array.from(beforeSmall));
    expect(Array.from(wide.pixels)).toEqual(Array.from(beforeWide));
  });
});
