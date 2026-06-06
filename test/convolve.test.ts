import { describe, expect, it } from 'vitest';
import { convolve, emboss, sharpen, sobelEdge } from '../src/filters/convolve';

function px(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function solidGrid(values: number[], alpha = 255): Uint8ClampedArray {
  const raw: number[] = [];
  for (const value of values) {
    raw.push(value, value, value, alpha);
  }
  return new Uint8ClampedArray(raw);
}

describe('convolution filters', () => {
  it('convolve は恒等カーネルで RGB/alpha を変更しない', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      90, 100, 110, 120,
      200, 210, 220, 230,
      1, 2, 3, 4,
    ]);
    const before = Array.from(pixels);

    convolve(pixels, 2, 2, {
      kernel: [
        0, 0, 0,
        0, 1, 0,
        0, 0, 0,
      ],
    });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('convolve は平均化カーネルで局所値をフラット化し alpha を保つ', () => {
    const pixels = solidGrid([
      10, 10, 10,
      10, 100, 10,
      10, 10, 10,
    ], 77);

    convolve(pixels, 3, 3, {
      kernel: [
        1, 1, 1,
        1, 1, 1,
        1, 1, 1,
      ],
      divisor: 9,
    });

    for (let i = 0; i < 9; i++) {
      expect(px(pixels, i % 3, Math.floor(i / 3), 3)).toEqual([20, 20, 20, 77]);
    }
  });

  it('convolve は端をクランプし divisor/offset を適用する', () => {
    const pixels = solidGrid([
      20, 80,
      140, 200,
    ]);

    convolve(pixels, 2, 2, {
      kernel: [
        1, 0, 0,
        0, 0, 0,
        0, 0, 0,
      ],
      divisor: 2,
      offset: 5,
    });

    expect(px(pixels, 0, 0, 2)).toEqual([15, 15, 15, 255]);
    expect(px(pixels, 1, 1, 2)).toEqual([15, 15, 15, 255]);
  });

  it('sobelEdge はエッジで高出力、平坦部で低出力にし alpha を保つ', () => {
    const pixels = solidGrid([0, 0, 255, 255, 255], 123);

    sobelEdge(pixels, 5, 1);

    expect(px(pixels, 0, 0, 5)).toEqual([0, 0, 0, 123]);
    expect(px(pixels, 1, 0, 5)[0]).toBeGreaterThan(200);
    expect(px(pixels, 2, 0, 5)[0]).toBeGreaterThan(200);
    expect(px(pixels, 4, 0, 5)).toEqual([0, 0, 0, 123]);
  });

  it('emboss は方向付きカーネルと offset で画像を変化させる', () => {
    const pixels = solidGrid([
      10, 20, 30,
      40, 50, 60,
      70, 80, 90,
    ], 201);

    emboss(pixels, 3, 3);

    expect(px(pixels, 1, 1, 3)).toEqual([255, 255, 255, 201]);
    expect(px(pixels, 0, 0, 3)[0]).toBeGreaterThan(128);
    expect(px(pixels, 2, 2, 3)[3]).toBe(201);
  });

  it('sharpen は平坦領域を変更せず alpha を保つ', () => {
    const pixels = new Uint8ClampedArray([
      40, 80, 120, 11,
      40, 80, 120, 22,
      40, 80, 120, 33,
      40, 80, 120, 44,
    ]);
    const before = Array.from(pixels);

    sharpen(pixels, 2, 2, { amount: 2 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('mask=0 の画素は convolve と sobelEdge で不変にする', () => {
    const original = solidGrid([0, 0, 255, 255, 255], 88);
    const mask = new Uint8ClampedArray([0, 255, 255, 255, 255]);

    const convolved = new Uint8ClampedArray(original);
    convolve(convolved, 5, 1, {
      kernel: [
        1, 1, 1,
        1, 1, 1,
        1, 1, 1,
      ],
      divisor: 9,
      mask,
    });
    expect(px(convolved, 0, 0, 5)).toEqual(px(original, 0, 0, 5));

    const edged = new Uint8ClampedArray(original);
    sobelEdge(edged, 5, 1, { mask });
    expect(px(edged, 0, 0, 5)).toEqual(px(original, 0, 0, 5));
  });
});
