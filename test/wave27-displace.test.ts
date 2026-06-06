import { describe, expect, it } from 'vitest';
import { displace } from '../src/filters/displace';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function testImage(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = x * 20 + y * 3;
      pixels[i + 1] = x * 7 + y * 30;
      pixels[i + 2] = x * 11 + y * 13;
      pixels[i + 3] = 200 + x + y;
    }
  }
  return pixels;
}

function displacementMap(width: number, height: number, r: number, g: number): Uint8ClampedArray {
  const map = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < map.length; i += 4) {
    map[i] = r;
    map[i + 1] = g;
    map[i + 2] = 128;
    map[i + 3] = 255;
  }
  return map;
}

describe('wave27 displace', () => {
  it('all-128 map is byte-identical no-op', () => {
    const width = 4;
    const height = 4;
    const pixels = testImage(width, height);
    const before = Array.from(pixels);
    const map = displacementMap(width, height, 128, 128);

    displace(pixels, width, height, { map, scaleX: 4, scaleY: 4 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('R=255 with scaleX=4 samples from x+4', () => {
    const width = 8;
    const height = 2;
    const pixels = testImage(width, height);
    const before = new Uint8ClampedArray(pixels);
    const map = displacementMap(width, height, 255, 128);

    displace(pixels, width, height, { map, scaleX: 4, scaleY: 0 });

    expect(pixelAt(pixels, 0, 1, width)).toEqual(pixelAt(before, 4, 1, width));
  });

  it('clamps large positive bilinear coordinates to the edge', () => {
    const width = 4;
    const height = 4;
    const pixels = testImage(width, height);
    const before = new Uint8ClampedArray(pixels);
    const map = displacementMap(width, height, 128, 128);
    const edge = ((height - 1) * width + (width - 1)) * 4;
    map[edge] = 255;
    map[edge + 1] = 255;

    displace(pixels, width, height, { map, scaleX: 100, scaleY: 100 });

    expect(pixelAt(pixels, width - 1, height - 1, width)).toEqual(
      pixelAt(before, width - 1, height - 1, width),
    );
  });

  it('scaleX=scaleY=0 is byte-identical no-op regardless of map values', () => {
    const width = 4;
    const height = 4;
    const pixels = testImage(width, height);
    const before = Array.from(pixels);
    const map = displacementMap(width, height, 255, 0);

    displace(pixels, width, height, { map, scaleX: 0, scaleY: 0 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('mask coverage=0 leaves that output pixel unchanged', () => {
    const width = 4;
    const height = 1;
    const pixels = testImage(width, height);
    const before = new Uint8ClampedArray(pixels);
    const map = displacementMap(width, height, 255, 128);
    const mask = new Uint8ClampedArray([0, 255, 255, 255]);

    displace(pixels, width, height, { map, scaleX: 1, scaleY: 0, mask });

    expect(pixelAt(pixels, 0, 0, width)).toEqual(pixelAt(before, 0, 0, width));
    expect(pixelAt(pixels, 1, 0, width)).toEqual(pixelAt(before, 2, 0, width));
  });

  it('missing map entries use zero displacement', () => {
    const width = 4;
    const height = 1;
    const pixels = testImage(width, height);
    const before = new Uint8ClampedArray(pixels);
    const map = displacementMap(1, 1, 255, 128);

    displace(pixels, width, height, { map, scaleX: 1, scaleY: 0 });

    expect(pixelAt(pixels, 0, 0, width)).toEqual(pixelAt(before, 1, 0, width));
    expect(pixelAt(pixels, 1, 0, width)).toEqual(pixelAt(before, 1, 0, width));
    expect(pixelAt(pixels, 3, 0, width)).toEqual(pixelAt(before, 3, 0, width));
  });
});
