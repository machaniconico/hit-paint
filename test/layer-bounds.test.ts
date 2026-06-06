import { describe, expect, it } from 'vitest';
import { alignOffset, opaqueBounds, translatePixels } from '../src/core/layer-bounds';

function pixelsFromAlpha(width: number, alphas: number[]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(alphas.length * 4);
  for (let i = 0; i < alphas.length; i += 1) {
    if (alphas[i] > 0) {
      pixels[i * 4] = i + 1;
      pixels[i * 4 + 1] = i + 2;
      pixels[i * 4 + 2] = i + 3;
    }
    pixels[i * 4 + 3] = alphas[i];
  }

  expect(alphas.length % width).toBe(0);
  return pixels;
}

function idsFromBuffer(pixels: Uint8ClampedArray): number[] {
  const ids: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    ids.push(pixels[i]);
  }
  return ids;
}

describe('layer bounds', () => {
  it('中央の不透明矩形を囲む最小 bounds を返す', () => {
    const pixels = pixelsFromAlpha(5, [
      0, 0, 0, 0, 0,
      0, 255, 255, 255, 0,
      0, 255, 255, 255, 0,
      0, 0, 0, 0, 0,
    ]);

    expect(opaqueBounds(pixels, 5, 4)).toEqual({ x: 1, y: 1, w: 3, h: 2 });
  });

  it('全透明なら null を返す', () => {
    const pixels = new Uint8ClampedArray(3 * 2 * 4);

    expect(opaqueBounds(pixels, 3, 2)).toBeNull();
  });

  it('threshold より大きい alpha のみ bounds 対象にする', () => {
    const pixels = pixelsFromAlpha(4, [
      0, 10, 0, 0,
      0, 64, 65, 0,
      0, 0, 200, 0,
    ]);

    expect(opaqueBounds(pixels, 4, 3, { threshold: 64 })).toEqual({ x: 2, y: 1, w: 1, h: 2 });
  });

  it('translatePixels は画素を整数移動し空き領域を透明にする', () => {
    const pixels = pixelsFromAlpha(3, [
      255, 0, 0,
      0, 255, 0,
      0, 0, 0,
    ]);

    const out = translatePixels(pixels, 3, 3, 1, 1);

    expect(idsFromBuffer(out)).toEqual([
      0, 0, 0,
      0, 1, 0,
      0, 0, 5,
    ]);
    expect(out[3]).toBe(0);
  });

  it('translatePixels は範囲外へ出る画素を切り捨てる', () => {
    const pixels = pixelsFromAlpha(3, [
      255, 255, 255,
      255, 255, 255,
    ]);

    const out = translatePixels(pixels, 3, 2, -2, 0);

    expect(idsFromBuffer(out)).toEqual([
      3, 0, 0,
      6, 0, 0,
    ]);
  });

  it('hcenter/vcenter のキャンバス中央寄せ移動量を返す', () => {
    const bounds = { x: 1, y: 2, w: 4, h: 2 };

    expect(alignOffset(bounds, { w: 10, h: 8 }, 'hcenter')).toEqual({ dx: 2, dy: 0 });
    expect(alignOffset(bounds, { w: 10, h: 8 }, 'vcenter')).toEqual({ dx: 0, dy: 1 });
  });

  it('left/top は境界をキャンバス端へ寄せる移動量を返す', () => {
    const bounds = { x: 3, y: 4, w: 2, h: 2 };

    expect(alignOffset(bounds, { w: 10, h: 8 }, 'left')).toEqual({ dx: -3, dy: 0 });
    expect(alignOffset(bounds, { w: 10, h: 8 }, 'top')).toEqual({ dx: 0, dy: -4 });
  });

  it('right/bottom は境界をキャンバス終端へ寄せる移動量を返す', () => {
    const bounds = { x: 3, y: 2, w: 2, h: 3 };

    expect(alignOffset(bounds, { w: 10, h: 8 }, 'right')).toEqual({ dx: 5, dy: 0 });
    expect(alignOffset(bounds, { w: 10, h: 8 }, 'bottom')).toEqual({ dx: 0, dy: 3 });
  });
});
