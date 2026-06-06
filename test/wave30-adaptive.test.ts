import { describe, expect, it } from 'vitest';
import { adaptiveThreshold } from '../src/filters/adaptive-threshold';

type RGBA = [number, number, number, number];

function rgbaBuffer(colors: RGBA[]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flat());
}

function grayBuffer(values: number[], alpha = 255): Uint8ClampedArray {
  return rgbaBuffer(values.map((value) => [value, value, value, alpha]));
}

function pixelAt(pixels: Uint8ClampedArray, pixel: number): RGBA {
  const i = pixel * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

function blackCount(pixels: Uint8ClampedArray): number {
  let count = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] === 0) count++;
  }

  return count;
}

function localMean(values: number[], x: number, width: number, height: number, radius: number): number {
  const y = Math.floor(x / width);
  const px = x % width;
  const x0 = Math.max(0, px - radius);
  const y0 = Math.max(0, y - radius);
  const x1 = Math.min(width - 1, px + radius);
  const y1 = Math.min(height - 1, y + radius);
  let sum = 0;
  let count = 0;

  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      sum += values[yy * width + xx];
      count++;
    }
  }

  return sum / count;
}

function expectBinaryRgb(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    expect([0, 255]).toContain(pixels[i]);
    expect([0, 255]).toContain(pixels[i + 1]);
    expect([0, 255]).toContain(pixels[i + 2]);
    expect(pixels[i]).toBe(pixels[i + 1]);
    expect(pixels[i]).toBe(pixels[i + 2]);
  }
}

describe('wave30 adaptive threshold', () => {
  it('グラデーション背景で暗部→黒・明部→白に2値化', () => {
    const width = 8;
    const height = 1;
    const values = Array.from({ length: width }, (_, x) => Math.round(30 + (170 * x) / (width - 1)));
    const pixels = grayBuffer(values);

    adaptiveThreshold(pixels, width, height, { radius: 2, bias: 0 });

    expectBinaryRgb(pixels);

    for (let x = 0; x < width; x++) {
      const expected = values[x] > localMean(values, x, width, height, 2) ? 255 : 0;
      expect(pixelAt(pixels, x).slice(0, 3)).toEqual([expected, expected, expected]);
    }
  });

  it('出力は0か255のみ(R=G=B)', () => {
    const pixels = grayBuffer([
      0, 255, 12, 240,
      250, 5, 245, 10,
      8, 248, 2, 252,
      235, 20, 255, 0,
    ]);

    adaptiveThreshold(pixels, 4, 4, { radius: 1, bias: 0 });

    expectBinaryRgb(pixels);
  });

  it('biasを上げると黒が増える', () => {
    const values = [
      0, 255, 12, 240,
      250, 5, 245, 10,
      8, 248, 2, 252,
      235, 20, 255, 0,
    ];
    const bias0 = grayBuffer(values);
    const bias20 = grayBuffer(values);

    adaptiveThreshold(bias0, 4, 4, { radius: 1, bias: 0 });
    adaptiveThreshold(bias20, 4, 4, { radius: 1, bias: 20 });

    expect(blackCount(bias20)).toBeGreaterThanOrEqual(blackCount(bias0));
  });

  it('alpha保持', () => {
    const pixels = rgbaBuffer([
      [20, 20, 20, 128],
      [120, 120, 120, 200],
      [200, 200, 200, 255],
      [80, 80, 80, 64],
    ]);

    adaptiveThreshold(pixels, 2, 2, { radius: 1, bias: 0 });

    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual([128, 200, 255, 64]);
  });

  it('mask coverage=0の画素は不変', () => {
    const pixels = grayBuffer([30, 180, 60, 220]);
    const original = new Uint8ClampedArray(pixels);
    const mask = new Uint8ClampedArray(4 * 4);
    mask[0 * 4 + 3] = 0;
    mask[1 * 4 + 3] = 255;
    mask[2 * 4 + 3] = 255;
    mask[3 * 4 + 3] = 255;

    adaptiveThreshold(pixels, 4, 1, { radius: 1, bias: 0, mask });

    expect(pixelAt(pixels, 0)).toEqual(pixelAt(original, 0));
    expect([0, 255]).toContain(pixels[4]);
    expect(pixels[4]).toBe(pixels[5]);
    expect(pixels[4]).toBe(pixels[6]);
  });

  it('w=0またはh=0で安全', () => {
    expect(() => adaptiveThreshold(new Uint8ClampedArray(), 0, 1, { radius: 1 })).not.toThrow();
    expect(() => adaptiveThreshold(new Uint8ClampedArray(), 1, 0, { radius: 1 })).not.toThrow();
  });

  it('radius=0で安全(ほぼ全白)', () => {
    const pixels = grayBuffer([20, 100, 180]);

    adaptiveThreshold(pixels, 3, 1, { radius: 0, bias: 0 });

    expectBinaryRgb(pixels);
    expect([pixels[0], pixels[4], pixels[8]]).toEqual([0, 0, 0]);
  });
});
