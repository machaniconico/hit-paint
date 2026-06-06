import { describe, expect, it } from 'vitest';
import { lensDistort } from '../src/filters/lens';

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

describe('lensDistort', () => {
  it('amount>0 は中心付近を拡大方向へ動かす', () => {
    const pixels = grayGrid([0, 50, 100, 150, 200]);

    lensDistort(pixels, 5, 1, { amount: 0.5 });

    expect(pixelAt(pixels, 2, 0, 5)).toEqual([100, 100, 100, 255]);
    expect(pixelAt(pixels, 3, 0, 5)[0]).toBeLessThan(150);
    expect(pixelAt(pixels, 3, 0, 5)[0]).toBeGreaterThan(100);
    expect(pixelAt(pixels, 1, 0, 5)[0]).toBeGreaterThan(50);
    expect(pixelAt(pixels, 1, 0, 5)[0]).toBeLessThan(100);
  });

  it('amount<0(糸巻き型) は外寄りから滑らかにサンプルする(端クランプに潰れない)', () => {
    const pixels = grayGrid([0, 50, 100, 150, 200]);

    lensDistort(pixels, 5, 1, { amount: -0.5 });

    // 中心(x=2)は不変
    expect(pixelAt(pixels, 2, 0, 5)).toEqual([100, 100, 100, 255]);
    // x=3 は factor>1 で外寄り(x>3)から補間サンプル → 元の150より外側の値、ただし端値200に潰れない
    const v3 = pixelAt(pixels, 3, 0, 5)[0];
    expect(v3).toBeGreaterThan(150);
    expect(v3).toBeLessThan(200);
  });

  it('amount=0 は不変にする', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      50, 60, 70, 80,
      90, 100, 110, 120,
      130, 140, 150, 160,
    ]);
    const before = Array.from(pixels);

    lensDistort(pixels, 2, 2, { amount: 0 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('中心画素はほぼ不変にする', () => {
    const pixels = grayGrid([
      10, 20, 30,
      40, 200, 60,
      70, 80, 90,
    ]);

    lensDistort(pixels, 3, 3, { amount: 1 });

    expect(pixelAt(pixels, 1, 1, 3)).toEqual([200, 200, 200, 255]);
  });

  it('端クランプにより範囲外参照せず端の値からサンプルする', () => {
    const clampRight = grayGrid([0, 100, 200]);
    const clampLeft = grayGrid([0, 100, 200]);

    lensDistort(clampRight, 3, 1, { amount: -1, cx: 0, cy: 0 });
    lensDistort(clampLeft, 3, 1, { amount: -1, cx: 2, cy: 0 });

    expect(pixelAt(clampRight, 2, 0, 3)).toEqual([200, 200, 200, 255]);
    expect(pixelAt(clampLeft, 0, 0, 3)).toEqual([0, 0, 0, 255]);
  });

  it('mask=0 の画素は不変にする', () => {
    const pixels = grayGrid([0, 50, 100, 150, 200]);
    const before = Array.from(pixels);
    const mask = new Uint8ClampedArray([0, 0, 0, 0, 0]);

    lensDistort(pixels, 5, 1, { amount: 0.75 }, mask);

    expect(Array.from(pixels)).toEqual(before);
  });

  it('mask 被覆率で歪み結果をブレンドする', () => {
    const full = grayGrid([0, 50, 100, 150, 200]);
    const half = new Uint8ClampedArray(full);

    lensDistort(full, 5, 1, { amount: 0.5 });
    lensDistort(half, 5, 1, { amount: 0.5 }, new Uint8ClampedArray([255, 255, 255, 128, 255]));

    expect(pixelAt(half, 3, 0, 5)[0]).toBeGreaterThan(pixelAt(full, 3, 0, 5)[0]);
    expect(pixelAt(half, 3, 0, 5)[0]).toBeLessThan(150);
  });
});
