import { describe, expect, it } from 'vitest';
import { blurDab, burnDab, dodgeDab, sharpenDab } from '../src/engine/effect-brush';

function px(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
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

describe('effect brush dabs', () => {
  it('blurDab は円形領域内を3x3平均へブレンドして平滑化する', () => {
    const pixels = grayGrid([
      0, 0, 0,
      0, 255, 0,
      0, 0, 0,
    ]);

    blurDab(pixels, 3, 3, { x: 1, y: 1, radius: 1.5, strength: 1, hardness: 1 });

    expect(px(pixels, 1, 1, 3)).toEqual([28, 28, 28, 255]);
    expect(px(pixels, 0, 1, 3)[0]).toBeGreaterThan(0);
    expect(px(pixels, 0, 1, 3)[0]).toBeLessThan(255);
  });

  it('sharpenDab はアンシャープ的に中心差分を強調する', () => {
    const pixels = grayGrid([
      100, 100, 100,
      100, 150, 100,
      100, 100, 100,
    ]);

    sharpenDab(pixels, 3, 3, { x: 1, y: 1, radius: 1.5, strength: 1, hardness: 1 });

    expect(px(pixels, 1, 1, 3)).toEqual([194, 194, 194, 255]);
  });

  it('dodgeDab はブラシ被覆率に応じて明度を上げ、burnDab は下げる', () => {
    const dodged = grayGrid([
      100, 100, 100,
      100, 100, 100,
      100, 100, 100,
    ]);
    const burned = new Uint8ClampedArray(dodged);

    dodgeDab(dodged, 3, 3, { x: 1, y: 1, radius: 2, strength: 0.5, hardness: 0 });
    burnDab(burned, 3, 3, { x: 1, y: 1, radius: 2, strength: 0.5, hardness: 0 });

    expect(px(dodged, 1, 1, 3)).toEqual([150, 150, 150, 255]);
    expect(px(burned, 1, 1, 3)).toEqual([50, 50, 50, 255]);
    expect(px(dodged, 0, 1, 3)[0]).toBeGreaterThan(100);
    expect(px(dodged, 0, 1, 3)[0]).toBeLessThan(150);
    expect(px(burned, 0, 1, 3)[0]).toBeLessThan(100);
    expect(px(burned, 0, 1, 3)[0]).toBeGreaterThan(50);
  });

  it('範囲外の画素は変更せず、画像外へはみ出したブラシをクリップする', () => {
    const pixels = grayGrid([
      100, 100, 100,
      100, 100, 100,
      100, 100, 100,
    ]);

    dodgeDab(pixels, 3, 3, { x: -0.5, y: -0.5, radius: 1, strength: 1, hardness: 1 });

    expect(px(pixels, 0, 0, 3)).toEqual([200, 200, 200, 255]);
    expect(px(pixels, 1, 0, 3)).toEqual([100, 100, 100, 255]);
    expect(px(pixels, 2, 2, 3)).toEqual([100, 100, 100, 255]);
  });

  it('strength=0 では変更しない', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      90, 100, 110, 120,
      200, 210, 220, 230,
    ]);
    const before = Array.from(pixels);

    blurDab(pixels, 3, 1, { x: 1, y: 0, radius: 5, strength: 0, hardness: 1 });
    sharpenDab(pixels, 3, 1, { x: 1, y: 0, radius: 5, strength: 0, hardness: 1 });
    dodgeDab(pixels, 3, 1, { x: 1, y: 0, radius: 5, strength: 0, hardness: 1 });
    burnDab(pixels, 3, 1, { x: 1, y: 0, radius: 5, strength: 0, hardness: 1 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('各ダブは alpha を変更しない', () => {
    const pixels = new Uint8ClampedArray([
      100, 120, 140, 11,
      130, 150, 170, 22,
      160, 180, 200, 33,
      90, 80, 70, 44,
    ]);

    blurDab(pixels, 2, 2, { x: 0, y: 0, radius: 2, strength: 1, hardness: 1 });
    sharpenDab(pixels, 2, 2, { x: 1, y: 0, radius: 2, strength: 1, hardness: 1 });
    dodgeDab(pixels, 2, 2, { x: 0, y: 1, radius: 2, strength: 1, hardness: 1 });
    burnDab(pixels, 2, 2, { x: 1, y: 1, radius: 2, strength: 1, hardness: 1 });

    expect([px(pixels, 0, 0, 2)[3], px(pixels, 1, 0, 2)[3], px(pixels, 0, 1, 2)[3], px(pixels, 1, 1, 2)[3]])
      .toEqual([11, 22, 33, 44]);
  });
});
