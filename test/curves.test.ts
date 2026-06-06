import { describe, expect, it } from 'vitest';
import { applyCurves, buildLut } from '../src/filters/curves';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

describe('curves', () => {
  it('buildLut は制御点を x 昇順にソートして区間線形補間する', () => {
    const lut = buildLut([
      { x: 255, y: 255 },
      { x: 128, y: 64 },
      { x: 0, y: 0 },
    ]);

    expect(lut).toHaveLength(256);
    expect(lut[0]).toBe(0);
    expect(lut[64]).toBe(32);
    expect(lut[128]).toBe(64);
    expect(lut[192]).toBe(160);
    expect(lut[255]).toBe(255);
  });

  it('buildLut は端点外を端点値でクランプする', () => {
    const lut = buildLut([
      { x: 64, y: 10 },
      { x: 192, y: 240 },
    ]);

    expect(lut[0]).toBe(10);
    expect(lut[63]).toBe(10);
    expect(lut[64]).toBe(10);
    expect(lut[192]).toBe(240);
    expect(lut[193]).toBe(240);
    expect(lut[255]).toBe(240);
  });

  it('恒等カーブは RGB と alpha を不変にする', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      128, 129, 130, 131,
      255, 0, 64, 200,
    ]);
    const original = Array.from(pixels);

    applyCurves(pixels, 3, 1, { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }] });

    expect(Array.from(pixels)).toEqual(original);
  });

  it('反転カーブは RGB を 255-v にし alpha を保つ', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 77,
      200, 150, 100, 201,
    ]);

    applyCurves(pixels, 2, 1, { rgb: [{ x: 0, y: 255 }, { x: 255, y: 0 }] });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([245, 235, 225, 77]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([55, 105, 155, 201]);
  });

  it('個別チャンネルカーブは他チャンネルへ影響しない', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 99,
    ]);

    applyCurves(pixels, 1, 1, { r: [{ x: 0, y: 255 }, { x: 255, y: 0 }] });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([245, 20, 30, 99]);
  });

  it('mask=0 の画素は不変にし中間 mask は効果をブレンドする', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      100, 100, 100, 50,
    ]);
    const mask = new Uint8ClampedArray([0, 128]);

    applyCurves(pixels, 2, 1, {
      rgb: [{ x: 0, y: 255 }, { x: 255, y: 0 }],
      mask,
    });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([128, 128, 128, 50]);
  });
});
