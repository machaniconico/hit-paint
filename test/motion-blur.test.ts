import { describe, expect, it } from 'vitest';
import { motionBlur, zoomBlur } from '../src/filters/motion-blur';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function grayGrid(values: number[], alpha = 255): Uint8ClampedArray {
  const raw: number[] = [];
  for (const value of values) {
    raw.push(value, value, value, alpha);
  }
  return new Uint8ClampedArray(raw);
}

describe('motion blur filters', () => {
  it('motionBlur は指定角度方向の隣接画素を混ぜてエッジを伸ばす', () => {
    const pixels = grayGrid([0, 0, 255, 0, 0]);

    motionBlur(pixels, 5, 1, { angle: 0, distance: 1 });

    expect(pixelAt(pixels, 1, 0, 5)).toEqual([85, 85, 85, 255]);
    expect(pixelAt(pixels, 2, 0, 5)).toEqual([85, 85, 85, 255]);
    expect(pixelAt(pixels, 3, 0, 5)).toEqual([85, 85, 85, 255]);
  });

  it('motionBlur は端のサンプル座標をクランプする', () => {
    const pixels = grayGrid([0, 255]);

    motionBlur(pixels, 2, 1, { angle: 0, distance: 1 });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([85, 85, 85, 255]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([170, 170, 170, 255]);
  });

  it('motionBlur は distance=0 で不変にする', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      100, 110, 120, 130,
    ]);
    const before = Array.from(pixels);

    motionBlur(pixels, 2, 1, { angle: 45, distance: 0 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('zoomBlur は中心から放射状に画素を滲ませる', () => {
    const pixels = grayGrid([255, 0, 0, 0, 0]);

    zoomBlur(pixels, 5, 1, { cx: 0, cy: 0, strength: 1 });

    expect(pixelAt(pixels, 0, 0, 5)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(pixels, 2, 0, 5)).toEqual([85, 85, 85, 255]);
    expect(pixelAt(pixels, 4, 0, 5)).toEqual([51, 51, 51, 255]);
  });

  it('zoomBlur は strength=0 で不変にする', () => {
    const pixels = grayGrid([255, 0, 0]);
    const before = Array.from(pixels);

    zoomBlur(pixels, 3, 1, { cx: 0, cy: 0, strength: 0 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('mask=0 の画素は不変にし中間 mask は効果をブレンドする', () => {
    const pixels = grayGrid([0, 255, 0]);
    const mask = new Uint8ClampedArray([0, 128, 255]);

    motionBlur(pixels, 3, 1, { angle: 0, distance: 1 }, mask);

    expect(pixelAt(pixels, 0, 0, 3)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(pixels, 1, 0, 3)).toEqual([170, 170, 170, 255]);
    expect(pixelAt(pixels, 2, 0, 3)).toEqual([85, 85, 85, 255]);
  });

  it('RGBA をストレートアルファとして平均する', () => {
    const pixels = new Uint8ClampedArray([
      30, 60, 90, 30,
      90, 120, 150, 90,
      210, 240, 255, 210,
    ]);

    motionBlur(pixels, 3, 1, { angle: 0, distance: 1 });

    expect(pixelAt(pixels, 1, 0, 3)).toEqual([110, 140, 165, 110]);
  });
});
