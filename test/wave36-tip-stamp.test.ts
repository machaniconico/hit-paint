import { describe, expect, it } from 'vitest';
import { pngRgbaToTipAlpha, stampTip } from '../src/engine/tip-stamp';
import type { TipAlpha } from '../src/engine/tip-stamp';

/** width*height のストレート RGBA を組み立てるヘルパ。 */
function makeRgba(width: number, height: number, px: (i: number) => [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const [r, g, b, a] = px(i);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

describe('pngRgbaToTipAlpha', () => {
  it('normalizes alpha channel to 0..1 with source:alpha', () => {
    const rgba = makeRgba(2, 1, (i) => (i === 0 ? [0, 0, 0, 0] : [0, 0, 0, 255]));
    const tip = pngRgbaToTipAlpha(rgba, 2, 1, { source: 'alpha' });

    expect(tip.width).toBe(2);
    expect(tip.height).toBe(1);
    expect(tip.data[0]).toBeCloseTo(0, 6);
    expect(tip.data[1]).toBeCloseTo(1, 6);
  });

  it('maps black->~1 and white->~0 with source:luminance', () => {
    const rgba = makeRgba(2, 1, (i) => (i === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const tip = pngRgbaToTipAlpha(rgba, 2, 1, { source: 'luminance' });

    expect(tip.data[0]).toBeCloseTo(1, 6); // 黒=インク
    expect(tip.data[1]).toBeCloseTo(0, 6); // 白=透明
  });

  it('auto picks luminance for fully opaque grayscale', () => {
    // 全画素 alpha=255 のグレースケール → luminance 採用 → 黒が ~1。
    const rgba = makeRgba(2, 1, (i) => (i === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const tip = pngRgbaToTipAlpha(rgba, 2, 1, { source: 'auto' });

    expect(tip.data[0]).toBeCloseTo(1, 6);
    expect(tip.data[1]).toBeCloseTo(0, 6);
  });

  it('auto picks alpha when any pixel is semi-transparent', () => {
    // 黒(=luminance なら1)だが alpha=128 の画素を含む → alpha 採用 → ~0.5。
    const rgba = makeRgba(2, 1, (i) => (i === 0 ? [0, 0, 0, 128] : [0, 0, 0, 255]));
    const tip = pngRgbaToTipAlpha(rgba, 2, 1, { source: 'auto' });

    expect(tip.data[0]).toBeCloseTo(128 / 255, 6);
    expect(tip.data[1]).toBeCloseTo(1, 6);
  });

  it('inverts final data when invert:true', () => {
    const rgba = makeRgba(2, 1, (i) => (i === 0 ? [0, 0, 0, 0] : [0, 0, 0, 255]));
    const tip = pngRgbaToTipAlpha(rgba, 2, 1, { source: 'alpha', invert: true });

    expect(tip.data[0]).toBeCloseTo(1, 6);
    expect(tip.data[1]).toBeCloseTo(0, 6);
  });
});

/** 全画素 1.0 の不透明 tip を作る。 */
function opaqueTip(w: number, h: number): TipAlpha {
  return { width: w, height: h, data: new Float32Array(w * h).fill(1) };
}

describe('stampTip', () => {
  it('stamps a fully opaque tip so center coverage ~= flow', () => {
    const cw = 21;
    const ch = 21;
    const tip = opaqueTip(8, 8);

    const cov1 = new Float32Array(cw * ch);
    stampTip(cov1, cw, ch, tip, { x: 10, y: 10, size: 8 });
    expect(cov1[10 * cw + 10]).toBeCloseTo(1, 5);

    const covHalf = new Float32Array(cw * ch);
    stampTip(covHalf, cw, ch, tip, { x: 10, y: 10, size: 8, flow: 0.5 });
    expect(covHalf[10 * cw + 10]).toBeCloseTo(0.5, 5);
  });

  it('max-combines: stamping twice never exceeds tip*flow', () => {
    const cw = 21;
    const ch = 21;
    const tip = opaqueTip(8, 8);
    const cov = new Float32Array(cw * ch);

    stampTip(cov, cw, ch, tip, { x: 10, y: 10, size: 8, flow: 0.6 });
    stampTip(cov, cw, ch, tip, { x: 10, y: 10, size: 8, flow: 0.6 });

    for (let i = 0; i < cov.length; i += 1) {
      expect(cov[i]).toBeLessThanOrEqual(0.6 + 1e-5);
    }
    expect(cov[10 * cw + 10]).toBeCloseTo(0.6, 5);
  });

  it('honors rotation: a left-opaque tip becomes top/bottom-opaque after 90deg', () => {
    // 8x8 tip。左半分(x<4)のみ不透明、右半分は透明。
    const w = 8;
    const h = 8;
    const data = new Float32Array(w * h);
    for (let yy = 0; yy < h; yy += 1) {
      for (let xx = 0; xx < w; xx += 1) {
        data[yy * w + xx] = xx < w / 2 ? 1 : 0;
      }
    }
    const tip: TipAlpha = { width: w, height: h, data };

    const cw = 31;
    const ch = 31;
    const cx = 15;
    const cy = 15;
    const cov = new Float32Array(cw * ch);
    stampTip(cov, cw, ch, tip, { x: cx, y: cy, size: 12, rotation: Math.PI / 2 });

    // 中心からオフセットした上/下のどちらか一方が不透明、左右はほぼ透明。
    const sample = (ox: number, oy: number) => cov[(cy + oy) * cw + (cx + ox)];
    const up = sample(0, -4);
    const down = sample(0, 4);
    const left = sample(-4, 0);
    const right = sample(4, 0);

    // 回転が効いていれば縦方向に偏る(左右はほぼ0)。
    expect(Math.max(up, down)).toBeGreaterThan(0.8);
    expect(Math.max(left, right)).toBeLessThan(0.2);
  });

  it('does not throw or write OOB at/beyond canvas edges', () => {
    const cw = 16;
    const ch = 16;
    const tip = opaqueTip(8, 8);

    // 番兵付きバッファで OOB 書き込みを検出(末尾8要素を番兵 -7 に)。
    const padded = new Float32Array(cw * ch + 8);
    for (let i = cw * ch; i < padded.length; i += 1) padded[i] = -7;
    const cov = padded.subarray(0, cw * ch);

    expect(() => {
      stampTip(cov, cw, ch, tip, { x: 0, y: 0, size: 8 }); // 左上隅
      stampTip(cov, cw, ch, tip, { x: cw, y: ch, size: 8 }); // 右下隅外
      stampTip(cov, cw, ch, tip, { x: 100, y: 100, size: 8 }); // 完全に範囲外
      stampTip(cov, cw, ch, tip, { x: -50, y: -50, size: 8 }); // 完全に範囲外(負)
      stampTip(cov, cw, ch, tip, { x: 8, y: 8, size: 0 }); // size<=0 no-op
      stampTip(cov, cw, ch, tip, { x: 8, y: 8, size: 8, flow: 0 }); // flow<=0 no-op
    }).not.toThrow();

    // 番兵領域は不変。
    for (let i = cw * ch; i < padded.length; i += 1) {
      expect(padded[i]).toBe(-7);
    }
    // すべての coverage は 0..1 に収まる(OOB 由来の異常値が無い)。
    for (let i = 0; i < cov.length; i += 1) {
      expect(cov[i]).toBeGreaterThanOrEqual(0);
      expect(cov[i]).toBeLessThanOrEqual(1);
    }
  });
});
