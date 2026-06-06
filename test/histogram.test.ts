import { describe, expect, it } from 'vitest';
import { autoContrast, autoLevels, computeHistogram } from '../src/filters/histogram';

function px(pixels: Uint8ClampedArray, index: number): number[] {
  const i = index * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function channelValues(pixels: Uint8ClampedArray, channel: number): number[] {
  const values: number[] = [];
  for (let i = channel; i < pixels.length; i += 4) {
    values.push(pixels[i]);
  }
  return values;
}

function range(values: number[]): { min: number; max: number } {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

describe('histogram filters', () => {
  it('computeHistogram は alpha=0 を除外し不透明画素数と度数合計が一致する', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 255,
      10, 30, 50, 0,
      100, 100, 100, 128,
      200, 150, 100, 255,
    ]);

    const histogram = computeHistogram(pixels, 4, 1);

    expect(histogram.r.reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(histogram.g.reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(histogram.b.reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(histogram.luma.reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(histogram.r[10]).toBe(1);
    expect(histogram.r[100]).toBe(1);
    expect(histogram.r[200]).toBe(1);
    expect(histogram.g[30]).toBe(0);
    expect(histogram.luma[18]).toBe(1);
    expect(histogram.luma[159]).toBe(1);
  });

  it('autoLevels は低コントラスト画像の RGB レンジを各チャンネル独立に拡張する', () => {
    const pixels = new Uint8ClampedArray([
      50, 60, 70, 255,
      60, 70, 80, 255,
      70, 80, 90, 255,
      80, 90, 100, 255,
    ]);

    autoLevels(pixels, 4, 1, { clipPercent: 0 });

    expect(range(channelValues(pixels, 0))).toEqual({ min: 0, max: 255 });
    expect(range(channelValues(pixels, 1))).toEqual({ min: 0, max: 255 });
    expect(range(channelValues(pixels, 2))).toEqual({ min: 0, max: 255 });
    expect(channelValues(pixels, 3)).toEqual([255, 255, 255, 255]);
  });

  it('autoLevels は clipPercent で上下の外れ値を無視する', () => {
    const raw: number[] = [];
    raw.push(0, 0, 0, 255);
    for (let value = 100; value < 110; value++) {
      raw.push(value, value, value, 255);
    }
    raw.push(255, 255, 255, 255);
    const pixels = new Uint8ClampedArray(raw);

    autoLevels(pixels, 12, 1, { clipPercent: 10 });

    expect(px(pixels, 0)).toEqual([0, 0, 0, 255]);
    expect(px(pixels, 1)).toEqual([0, 0, 0, 255]);
    expect(px(pixels, 10)).toEqual([255, 255, 255, 255]);
    expect(px(pixels, 11)).toEqual([255, 255, 255, 255]);
  });

  it('autoContrast は luma 基準の共通ストレッチで色比を概ね保つ', () => {
    const pixels = new Uint8ClampedArray([
      40, 20, 10, 255,
      80, 40, 20, 255,
      120, 60, 30, 255,
      160, 80, 40, 255,
    ]);

    autoContrast(pixels, 4, 1, { clipPercent: 0 });

    expect(px(pixels, 0)).toEqual([0, 0, 0, 255]);
    expect(px(pixels, 3)[0]).toBe(255);
    for (let pixel = 1; pixel < 2; pixel++) {
      const [r, g, b, a] = px(pixels, pixel);
      expect(a).toBe(255);
      expect(r / g).toBeCloseTo(2, 1);
      expect(r / b).toBeCloseTo(4, 0);
    }
  });

  it('autoContrast は mask=0 の画素を変更せず alpha を保つ', () => {
    const pixels = new Uint8ClampedArray([
      20, 20, 20, 11,
      40, 40, 40, 22,
      80, 80, 80, 33,
      120, 120, 120, 44,
    ]);
    const before = Array.from(pixels);
    const mask = new Uint8ClampedArray([0, 255, 255, 255]);

    autoContrast(pixels, 4, 1, { clipPercent: 0, mask });

    expect(px(pixels, 0)).toEqual(before.slice(0, 4));
    expect(channelValues(pixels, 3)).toEqual([11, 22, 33, 44]);
    expect(px(pixels, 1)).toEqual([0, 0, 0, 22]);
    expect(px(pixels, 3)).toEqual([255, 255, 255, 44]);
  });
});
