import { describe, expect, it } from 'vitest';
import { clarity } from '../src/filters/clarity';

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

function redValues(pixels: Uint8ClampedArray): number[] {
  const values: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    values.push(pixels[i]);
  }
  return values;
}

describe('clarity', () => {
  it('amount=0 で完全にバイト不変にする', () => {
    const pixels = new Uint8ClampedArray([
      12, 34, 56, 10,
      96, 112, 128, 64,
      240, 230, 220, 255,
      18, 28, 38, 0,
    ]);
    const before = Array.from(pixels);

    clarity(pixels, 2, 2, { amount: 0, radius: 1 });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('中間調の明暗境界で amount>0 によりローカルコントラストを増幅する', () => {
    const pixels = grayGrid([112, 112, 112, 144, 144]);

    clarity(pixels, 5, 1, { amount: 1, radius: 1 });

    expect(redValues(pixels)).toEqual([112, 112, 103, 153, 144]);
    expect(pixelAt(pixels, 2, 0, 5)[0]).toBeLessThan(112);
    expect(pixelAt(pixels, 3, 0, 5)[0]).toBeGreaterThan(144);
    expect(pixelAt(pixels, 3, 0, 5)[0] - pixelAt(pixels, 2, 0, 5)[0]).toBeGreaterThan(144 - 112);
  });

  it('純シャドウと純ハイライトの領域は中間調保護によりほぼ不変にする', () => {
    const pixels = grayGrid([0, 0, 0, 255, 255, 255]);
    const before = Array.from(pixels);

    clarity(pixels, 6, 1, { amount: 4, radius: 1 });

    for (let i = 0; i < pixels.length; i += 4) {
      expect(Math.abs(pixels[i] - before[i])).toBeLessThanOrEqual(3);
      expect(Math.abs(pixels[i + 1] - before[i + 1])).toBeLessThanOrEqual(3);
      expect(Math.abs(pixels[i + 2] - before[i + 2])).toBeLessThanOrEqual(3);
    }
  });

  it('mask coverage=0 の画素を不変にする', () => {
    const pixels = grayGrid([112, 112, 112, 144, 144]);
    const before = new Uint8ClampedArray(pixels);

    clarity(pixels, 5, 1, {
      amount: 1,
      radius: 1,
      mask: new Uint8ClampedArray([255, 255, 0, 255, 255]),
    });

    expect(pixelAt(pixels, 2, 0, 5)).toEqual(pixelAt(before, 2, 0, 5));
    expect(pixelAt(pixels, 3, 0, 5)[0]).toBeGreaterThan(pixelAt(before, 3, 0, 5)[0]);
  });

  it('alpha チャンネルを保持する', () => {
    const pixels = new Uint8ClampedArray([
      112, 116, 120, 0,
      112, 116, 120, 64,
      144, 148, 152, 128,
      144, 148, 152, 255,
    ]);
    const alphas = [pixels[3], pixels[7], pixels[11], pixels[15]];

    clarity(pixels, 4, 1, { amount: 2, radius: 1 });

    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual(alphas);
  });
});
