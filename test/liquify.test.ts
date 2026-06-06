import { describe, expect, it } from 'vitest';
import { bloatDab, pinchDab, pushDab } from '../src/tools/liquify';

function rgbaGrid(values: number[], width: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    pixels[i * 4] = values[i];
    pixels[i * 4 + 1] = values[i] + 1;
    pixels[i * 4 + 2] = values[i] + 2;
    pixels[i * 4 + 3] = 200 + (i % width);
  }
  return pixels;
}

function channel(pixels: Uint8ClampedArray, x: number, y: number, width: number, c = 0): number {
  return pixels[(y * width + x) * 4 + c];
}

describe('liquify tools', () => {
  it('pushDab は半径内の画素を移動方向へ押し流す', () => {
    const pixels = rgbaGrid([
      0, 50, 100, 150, 200,
      0, 50, 100, 150, 200,
      0, 50, 100, 150, 200,
      0, 50, 100, 150, 200,
      0, 50, 100, 150, 200,
    ], 5);

    pushDab(pixels, 5, 5, { x: 2, y: 2, radius: 2, dx: 1, dy: 0, strength: 1 });

    expect(channel(pixels, 2, 2, 5)).toBe(50);
    expect(channel(pixels, 3, 2, 5)).toBe(125);
    expect(channel(pixels, 1, 2, 5)).toBe(25);
  });

  it('pushDab はスナップショットからサンプルして読み書き干渉しない', () => {
    const pixels = rgbaGrid([0, 40, 80, 120, 160], 5);

    pushDab(pixels, 5, 1, { x: 2, y: 0, radius: 3, dx: 2, dy: 0, strength: 1 });

    expect([
      channel(pixels, 0, 0, 5),
      channel(pixels, 1, 0, 5),
      channel(pixels, 2, 0, 5),
      channel(pixels, 3, 0, 5),
      channel(pixels, 4, 0, 5),
    ]).toEqual([0, 0, 0, 67, 133]);
  });

  it('範囲外画素は不変で、画像端のサンプル座標はクランプされる', () => {
    const pixels = rgbaGrid([
      10, 40, 70,
      20, 50, 80,
      30, 60, 90,
    ], 3);

    pushDab(pixels, 3, 3, { x: 0, y: 0, radius: 1.5, dx: 10, dy: 10, strength: 1 });

    expect(channel(pixels, 0, 0, 3)).toBe(10);
    expect(channel(pixels, 2, 0, 3)).toBe(70);
    expect(channel(pixels, 2, 2, 3)).toBe(90);
  });

  it('中心座標が範囲外なら不変にする', () => {
    const pixels = rgbaGrid([
      0, 50, 100,
      20, 70, 120,
      40, 90, 140,
    ], 3);
    const before = Array.from(pixels);

    pushDab(pixels, 3, 3, { x: -1, y: 1, radius: 5, dx: 3, dy: 0, strength: 1 });
    bloatDab(pixels, 3, 3, { x: 1, y: 3, radius: 5, strength: 1 });
    pinchDab(pixels, 3, 3, { x: 3, y: 1, radius: 5, strength: 1 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('strength=0 では不変にする', () => {
    const pixels = rgbaGrid([
      0, 50, 100,
      20, 70, 120,
      40, 90, 140,
    ], 3);
    const before = Array.from(pixels);

    pushDab(pixels, 3, 3, { x: 1, y: 1, radius: 5, dx: 3, dy: 3, strength: 0 });
    bloatDab(pixels, 3, 3, { x: 1, y: 1, radius: 5, strength: 0 });
    pinchDab(pixels, 3, 3, { x: 1, y: 1, radius: 5, strength: 0 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('radius<=0 では不変にする', () => {
    const pixels = rgbaGrid([
      0, 50, 100,
      20, 70, 120,
      40, 90, 140,
    ], 3);
    const before = Array.from(pixels);

    pushDab(pixels, 3, 3, { x: 1, y: 1, radius: 0, dx: 3, dy: 3, strength: 1 });
    bloatDab(pixels, 3, 3, { x: 1, y: 1, radius: -1, strength: 1 });
    pinchDab(pixels, 3, 3, { x: 1, y: 1, radius: 0, strength: 1 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('bloatDab は中心から外へ膨張するよう周辺画素を動かす', () => {
    const pixels = rgbaGrid([
      0, 40, 80, 120, 160,
      0, 40, 80, 120, 160,
      0, 40, 80, 120, 160,
      0, 40, 80, 120, 160,
      0, 40, 80, 120, 160,
    ], 5);

    bloatDab(pixels, 5, 5, { x: 2, y: 2, radius: 3, strength: 1 });

    expect(channel(pixels, 3, 2, 5)).toBe(40);
    expect(channel(pixels, 4, 2, 5)).toBe(120);
  });

  it('pinchDab は中心へ収縮するよう周辺画素を動かす', () => {
    const pixels = rgbaGrid([
      0, 40, 80, 120, 160,
      0, 40, 80, 120, 160,
      0, 40, 80, 120, 160,
      0, 40, 80, 120, 160,
      0, 40, 80, 120, 160,
    ], 5);

    pinchDab(pixels, 5, 5, { x: 2, y: 2, radius: 3, strength: 1 });

    expect(channel(pixels, 1, 2, 5)).toBe(0);
    expect(channel(pixels, 3, 2, 5)).toBe(160);
  });
});
