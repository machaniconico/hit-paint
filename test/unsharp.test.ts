import { describe, expect, it } from 'vitest';
import { unsharpMask } from '../src/filters/unsharp';

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

describe('unsharpMask', () => {
  it('エッジ近傍のコントラストを増やす', () => {
    const pixels = grayGrid([24, 24, 96, 208, 208]);
    const before = Array.from(pixels);

    unsharpMask(pixels, 5, 1, { amount: 1, radius: 1 });

    expect(pixelAt(pixels, 1, 0, 5)[0]).toBeLessThan(before[4]);
    expect(pixelAt(pixels, 2, 0, 5)[0]).toBeLessThan(before[8]);
    expect(pixelAt(pixels, 3, 0, 5)[0]).toBeGreaterThan(before[12]);
    expect(pixelAt(pixels, 4, 0, 5)[0]).toBeGreaterThan(before[16]);
  });

  it('threshold 未満の微小差は加えず平坦寄りの領域を不変にする', () => {
    const pixels = grayGrid([
      100, 102, 101,
      102, 103, 101,
      101, 102, 100,
    ]);
    const before = Array.from(pixels);

    unsharpMask(pixels, 3, 3, { amount: 8, radius: 1, threshold: 10 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('amount=0 で不変にする', () => {
    const pixels = grayGrid([0, 64, 192, 255]);
    const before = Array.from(pixels);

    unsharpMask(pixels, 4, 1, { amount: 0, radius: 1 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('radius<=0 で不変にする', () => {
    const pixels = grayGrid([0, 64, 192, 255]);
    const before = Array.from(pixels);

    unsharpMask(pixels, 4, 1, { amount: 2, radius: 0 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('mask=0 の画素は不変にし中間 mask は効果量を減らす', () => {
    const original = grayGrid([24, 96, 208]);
    const masked = new Uint8ClampedArray(original);
    const halfMasked = new Uint8ClampedArray(original);
    const unmasked = new Uint8ClampedArray(original);

    unsharpMask(masked, 3, 1, { amount: 1, radius: 1 }, new Uint8ClampedArray([0, 0, 255]));
    unsharpMask(halfMasked, 3, 1, { amount: 1, radius: 1 }, new Uint8ClampedArray([255, 128, 255]));
    unsharpMask(unmasked, 3, 1, { amount: 1, radius: 1 });

    expect(pixelAt(masked, 0, 0, 3)).toEqual(pixelAt(original, 0, 0, 3));
    expect(pixelAt(masked, 1, 0, 3)).toEqual(pixelAt(original, 1, 0, 3));
    expect(pixelAt(halfMasked, 1, 0, 3)[0]).toBeLessThan(pixelAt(original, 1, 0, 3)[0]);
    expect(pixelAt(halfMasked, 1, 0, 3)[0]).toBeGreaterThan(pixelAt(unmasked, 1, 0, 3)[0]);
  });

  it('alpha を変更しない', () => {
    const pixels = new Uint8ClampedArray([
      24, 30, 36, 10,
      96, 110, 120, 80,
      208, 220, 230, 200,
    ]);
    const alphas = [pixels[3], pixels[7], pixels[11]];

    unsharpMask(pixels, 3, 1, { amount: 2, radius: 1 });

    expect([pixels[3], pixels[7], pixels[11]]).toEqual(alphas);
  });

  it('端サンプルをクランプするため 1x1 画像は変化しない', () => {
    const pixels = new Uint8ClampedArray([12, 128, 240, 77]);
    const before = Array.from(pixels);

    unsharpMask(pixels, 1, 1, { amount: 10, radius: 3 });

    expect(Array.from(pixels)).toEqual(before);
  });
});
