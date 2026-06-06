import { describe, expect, it } from 'vitest';
import {
  flipHorizontal,
  flipVertical,
  rotate180,
  rotate90CCW,
  rotate90CW,
} from '../src/tools/layer-transform';

function px(id: number): number[] {
  return [id, id + 10, id + 20, 255 - id];
}

function bufferFromIds(ids: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(ids.flatMap(px));
}

function idsFromBuffer(pixels: Uint8ClampedArray): number[] {
  const ids: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    ids.push(pixels[i]);
  }
  return ids;
}

describe('layer geometry transforms', () => {
  it('flipHorizontal は左右を反転しRGBA画素を保持する', () => {
    const pixels = bufferFromIds([
      1, 2,
      3, 4,
      5, 6,
    ]);

    const result = flipHorizontal(pixels, 2, 3);

    expect(result).not.toBe(pixels);
    expect(idsFromBuffer(result)).toEqual([
      2, 1,
      4, 3,
      6, 5,
    ]);
    expect(Array.from(result.slice(0, 4))).toEqual(px(2));
  });

  it('flipVertical は上下を反転する', () => {
    const pixels = bufferFromIds([
      1, 2,
      3, 4,
      5, 6,
    ]);

    const result = flipVertical(pixels, 2, 3);

    expect(idsFromBuffer(result)).toEqual([
      5, 6,
      3, 4,
      1, 2,
    ]);
  });

  it('rotate90CW は寸法を入れ替え時計回りの位置へ画素を移す', () => {
    const pixels = bufferFromIds([
      1, 2,
      3, 4,
      5, 6,
    ]);

    const result = rotate90CW(pixels, 2, 3);

    expect(result.width).toBe(3);
    expect(result.height).toBe(2);
    expect(idsFromBuffer(result.pixels)).toEqual([
      5, 3, 1,
      6, 4, 2,
    ]);
  });

  it('rotate90CCW は寸法を入れ替え反時計回りの位置へ画素を移す', () => {
    const pixels = bufferFromIds([
      1, 2,
      3, 4,
      5, 6,
    ]);

    const result = rotate90CCW(pixels, 2, 3);

    expect(result.width).toBe(3);
    expect(result.height).toBe(2);
    expect(idsFromBuffer(result.pixels)).toEqual([
      2, 4, 6,
      1, 3, 5,
    ]);
  });

  it('rotate180 は flipH と flipV の合成と一致する', () => {
    const pixels = bufferFromIds([
      1, 2,
      3, 4,
      5, 6,
    ]);

    const rotated = rotate180(pixels, 2, 3);
    const flipped = flipHorizontal(flipVertical(pixels, 2, 3), 2, 3);

    expect(rotated.width).toBe(2);
    expect(rotated.height).toBe(3);
    expect(Array.from(rotated.pixels)).toEqual(Array.from(flipped));
    expect(idsFromBuffer(rotated.pixels)).toEqual([
      6, 5,
      4, 3,
      2, 1,
    ]);
  });

  it('rotate90CW を4回適用すると元の配置と寸法に戻る', () => {
    const pixels = bufferFromIds([
      1, 2,
      3, 4,
      5, 6,
    ]);

    const r1 = rotate90CW(pixels, 2, 3);
    const r2 = rotate90CW(r1.pixels, r1.width, r1.height);
    const r3 = rotate90CW(r2.pixels, r2.width, r2.height);
    const r4 = rotate90CW(r3.pixels, r3.width, r3.height);

    expect(r4.width).toBe(2);
    expect(r4.height).toBe(3);
    expect(Array.from(r4.pixels)).toEqual(Array.from(pixels));
  });

  it('すべての変換は元バッファを変更しない', () => {
    const pixels = bufferFromIds([
      1, 2,
      3, 4,
      5, 6,
    ]);
    const original = Array.from(pixels);

    flipHorizontal(pixels, 2, 3);
    flipVertical(pixels, 2, 3);
    rotate90CW(pixels, 2, 3);
    rotate90CCW(pixels, 2, 3);
    rotate180(pixels, 2, 3);

    expect(Array.from(pixels)).toEqual(original);
  });
});
