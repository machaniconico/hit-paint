/**
 * HIT Paint — magic-wand.ts のユニットテスト
 * jsdom 環境; canvas は使用しない (純粋な配列操作のみ)
 */

import { describe, expect, it } from 'vitest';
import { selectionMaskFromColor } from '../src/tools/magic-wand';

type RGBA = [number, number, number, number];

function rgbaBuffer(colors: RGBA[]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flat());
}

function maskValues(mask: Uint8ClampedArray): number[] {
  return Array.from(mask);
}

describe('selectionMaskFromColor', () => {
  it('単色領域が全選択され、length は width * height になる', () => {
    const pixels = rgbaBuffer([
      [40, 80, 120, 255], [40, 80, 120, 255], [40, 80, 120, 255],
      [40, 80, 120, 255], [40, 80, 120, 255], [40, 80, 120, 255],
    ]);

    const mask = selectionMaskFromColor(pixels, 3, 2, 1, 1, {
      tolerance: 0,
      contiguous: true,
    });

    expect(mask).toBeInstanceOf(Uint8ClampedArray);
    expect(mask).toHaveLength(6);
    expect(maskValues(mask)).toEqual([255, 255, 255, 255, 255, 255]);
  });

  it('tolerance 内の類似色を含み、境界を超える色は含まない', () => {
    const pixels = rgbaBuffer([
      [100, 100, 100, 255],
      [110, 95, 105, 250],
      [121, 100, 100, 255],
      [100, 85, 100, 255],
    ]);

    const mask = selectionMaskFromColor(pixels, 4, 1, 0, 0, {
      tolerance: 15,
      contiguous: false,
    });

    expect(maskValues(mask)).toEqual([255, 255, 0, 255]);
  });

  it('tolerance=0 では完全一致だけを選択する', () => {
    const pixels = rgbaBuffer([
      [8, 9, 10, 255],
      [8, 9, 10, 254],
      [8, 9, 10, 255],
    ]);

    const mask = selectionMaskFromColor(pixels, 3, 1, 0, 0, {
      tolerance: 0,
      contiguous: false,
    });

    expect(maskValues(mask)).toEqual([255, 0, 255]);
  });

  it('contiguous=true は非連結の同色を除外する', () => {
    const pixels = rgbaBuffer([
      [200, 0, 0, 255], [200, 0, 0, 255], [0, 0, 0, 255], [200, 0, 0, 255],
      [200, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [200, 0, 0, 255],
    ]);

    const mask = selectionMaskFromColor(pixels, 4, 2, 0, 0, {
      tolerance: 0,
      contiguous: true,
    });

    expect(maskValues(mask)).toEqual([
      255, 255, 0, 0,
      255, 0, 0, 0,
    ]);
  });

  it('contiguous=false は全画面の同色を選択する', () => {
    const pixels = rgbaBuffer([
      [200, 0, 0, 255], [200, 0, 0, 255], [0, 0, 0, 255], [200, 0, 0, 255],
      [200, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [200, 0, 0, 255],
    ]);

    const mask = selectionMaskFromColor(pixels, 4, 2, 0, 0, {
      tolerance: 0,
      contiguous: false,
    });

    expect(maskValues(mask)).toEqual([
      255, 255, 0, 255,
      255, 0, 0, 255,
    ]);
  });

  it('範囲外の基準点は空マスクを返す', () => {
    const pixels = rgbaBuffer([
      [1, 2, 3, 4], [1, 2, 3, 4],
      [1, 2, 3, 4], [1, 2, 3, 4],
    ]);

    expect(maskValues(selectionMaskFromColor(pixels, 2, 2, -1, 0, {
      tolerance: 255,
      contiguous: false,
    }))).toEqual([0, 0, 0, 0]);
    expect(maskValues(selectionMaskFromColor(pixels, 2, 2, 0, 2, {
      tolerance: 255,
      contiguous: true,
    }))).toEqual([0, 0, 0, 0]);
  });
});
