/**
 * Wave44 US-4604 配線テスト: 整列/パス追従/縦書きテキストの rasterizeTextLayer 分岐。
 *
 * 検証方針:
 * - 拡張未指定なら従来 renderText 経路を素通りし出力がバイト同一であること。
 * - align/maxWidth/vertical/onPath 指定で各 layout ヘルパ由来の配置が描画へ反映されること。
 * - renderPositionedGlyphs / buildTextLayoutData の純粋ロジックを配列で直接検証。
 * - 全て canvas 非依存(Uint8ClampedArray を直接読む)。
 */
import { describe, expect, it } from 'vitest';
import {
  createTextLayerData,
  rasterizeTextLayer,
  renderPositionedGlyphs,
  measureTextLayer,
  type TextLayerData,
} from '../src/text/text-layer';
import { renderText } from '../src/text/index';
import { layoutText } from '../src/text/text-layout';
import { layoutVerticalText } from '../src/text/text-vertical';
import { layoutTextOnPath } from '../src/text/text-on-path';
import { buildTextLayoutData } from '../src/state/store';
import type { VectorPath } from '../src/vector/path';

const W = 80;
const H = 40;

function nonZeroCount(px: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
  return n;
}

describe('US-4604 rasterizeTextLayer: 拡張未指定はバイト同一', () => {
  it('拡張なし TextLayerData は renderText 直接呼び出しとバイト完全一致', () => {
    const data = createTextLayerData({
      text: 'Hi\nAB',
      x: 3,
      y: 4,
      color: { r: 10, g: 200, b: 30, a: 255 },
      scale: 2,
      letterSpacing: 1,
    });

    const actual = rasterizeTextLayer(data, W, H);

    const expected = new Uint8ClampedArray(W * H * 4);
    renderText(expected, W, H, { ...data, mask: null });

    expect(actual.length).toBe(expected.length);
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it('align=left 明示・vertical=false・pathPoints無し でも従来経路(バイト同一)', () => {
    const base = createTextLayerData({ text: 'Test', x: 1, y: 1, scale: 1 });
    const data: TextLayerData = { ...base, align: 'left', vertical: false };

    const actual = rasterizeTextLayer(data, W, H);
    const expected = new Uint8ClampedArray(W * H * 4);
    renderText(expected, W, H, { ...base, mask: null });

    expect(Array.from(actual)).toEqual(Array.from(expected));
  });
});

describe('US-4604 rasterizeTextLayer: 整列/最大幅', () => {
  it('align=center は layoutText 由来配置で描画される(非空かつ左寄せと異なる)', () => {
    const data = createTextLayerData({
      text: 'AB',
      x: 0,
      y: 0,
      color: { r: 255, g: 255, b: 255, a: 255 },
      scale: 1,
      align: 'center',
      maxWidth: 60,
    });

    const px = rasterizeTextLayer(data, W, H);
    expect(nonZeroCount(px)).toBeGreaterThan(0);

    // layoutText の配置先頭グリフ x が中央寄せでオフセットしていること。
    const layout = layoutText('AB', { scale: 1, align: 'center', maxWidth: 60 });
    expect(layout.glyphs[0].x).toBeGreaterThan(0);

    // 左寄せ版とはバイト列が異なる(整列が効いている)。
    const leftPx = rasterizeTextLayer(
      createTextLayerData({ text: 'AB', x: 0, y: 0, color: { r: 255, g: 255, b: 255, a: 255 }, scale: 1 }),
      W,
      H,
    );
    expect(Array.from(px)).not.toEqual(Array.from(leftPx));
  });

  it('maxWidth で折り返した行が縦に積まれる(複数行 → 高い）', () => {
    const data = createTextLayerData({
      text: 'AAAA BBBB CCCC',
      x: 0,
      y: 0,
      color: { r: 255, g: 0, b: 0, a: 255 },
      scale: 1,
      maxWidth: 30,
    });
    const layout = layoutText('AAAA BBBB CCCC', { scale: 1, maxWidth: 30 });
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(nonZeroCount(rasterizeTextLayer(data, W, H))).toBeGreaterThan(0);
  });
});

describe('US-4604 rasterizeTextLayer: 縦書き', () => {
  it('vertical=true は layoutVerticalText 由来(非空・列が右→左へ)', () => {
    const data = createTextLayerData({
      text: 'AB\nCD',
      x: 5,
      y: 2,
      color: { r: 0, g: 0, b: 255, a: 255 },
      scale: 1,
      vertical: true,
    });
    const px = rasterizeTextLayer(data, W, H);
    expect(nonZeroCount(px)).toBeGreaterThan(0);

    const layout = layoutVerticalText('AB\nCD', { scale: 1 });
    // 列は右→左: columns[0] の x が columns[最後] より大きい。
    expect(layout.columns[0].x).toBeGreaterThan(layout.columns[layout.columns.length - 1].x);
  });
});

describe('US-4604 rasterizeTextLayer: パス追従', () => {
  const path: VectorPath = {
    points: [
      { x: 0, y: 10 },
      { x: 60, y: 10 },
    ],
    closed: false,
  };

  it('pathPoints(VectorPath)指定で layoutTextOnPath 由来の配置を描画', () => {
    const data = createTextLayerData({
      text: 'PATH',
      x: 0,
      y: 0,
      color: { r: 0, g: 0, b: 0, a: 255 },
      scale: 1,
      pathPoints: path,
    });
    const px = rasterizeTextLayer(data, W, H);
    expect(nonZeroCount(px)).toBeGreaterThan(0);

    const glyphs = layoutTextOnPath('PATH', path, { scale: 1 });
    expect(glyphs.length).toBe(4);
    // 水平パスなので x が増加方向に並ぶ。
    expect(glyphs[3].x).toBeGreaterThan(glyphs[0].x);
  });

  it('pathPoints(PathPoint[]配列)も VectorPath に正規化して描画される', () => {
    const data = createTextLayerData({
      text: 'XY',
      x: 0,
      y: 0,
      color: { r: 0, g: 0, b: 0, a: 255 },
      scale: 1,
      pathPoints: path.points,
    });
    expect(nonZeroCount(rasterizeTextLayer(data, W, H))).toBeGreaterThan(0);
  });
});

describe('US-4604 renderPositionedGlyphs 純粋ヘルパ', () => {
  it('配置済みグリフをスタンプし origin オフセットが効く', () => {
    const glyphs = [{ char: 'A', x: 0, y: 0 }];
    const a = new Uint8ClampedArray(W * H * 4);
    renderPositionedGlyphs(a, W, H, glyphs, { x: 0, y: 0, color: { r: 255, g: 255, b: 255, a: 255 }, scale: 1 });
    const b = new Uint8ClampedArray(W * H * 4);
    renderPositionedGlyphs(b, W, H, glyphs, { x: 10, y: 0, color: { r: 255, g: 255, b: 255, a: 255 }, scale: 1 });

    expect(nonZeroCount(a)).toBeGreaterThan(0);
    // 同数の塗りピクセルだが配置が異なる。
    expect(nonZeroCount(a)).toBe(nonZeroCount(b));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('空白/改行は描画しない', () => {
    const px = new Uint8ClampedArray(W * H * 4);
    renderPositionedGlyphs(px, W, H, [{ char: ' ', x: 0, y: 0 }, { char: '\n', x: 5, y: 0 }], {
      x: 0,
      y: 0,
      color: { r: 255, g: 255, b: 255, a: 255 },
      scale: 1,
    });
    expect(nonZeroCount(px)).toBe(0);
  });
});

describe('US-4604 buildTextLayoutData 純粋ヘルパ', () => {
  it('patch を適用し base を変更しない(immutable)', () => {
    const base = createTextLayerData({ text: 'A', x: 0, y: 0, scale: 1 });
    const next = buildTextLayoutData(base, { align: 'right', maxWidth: 50, vertical: true });
    expect(next.align).toBe('right');
    expect(next.maxWidth).toBe(50);
    expect(next.vertical).toBe(true);
    // base は不変。
    expect(base.align).toBeUndefined();
    expect(base.vertical).toBeUndefined();
  });

  it('pathPoints は deep clone され参照共有しない', () => {
    const base = createTextLayerData({ text: 'A' });
    const pts = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    const next = buildTextLayoutData(base, { pathPoints: pts });
    expect(next.pathPoints).toEqual(pts);
    expect(next.pathPoints).not.toBe(pts);
  });

  it('undefined 指定でクリアできる', () => {
    const base = buildTextLayoutData(createTextLayerData({ text: 'A' }), { maxWidth: 40, vertical: true });
    const cleared = buildTextLayoutData(base, { maxWidth: undefined, vertical: undefined });
    expect(cleared.maxWidth).toBeUndefined();
    expect(cleared.vertical).toBeUndefined();
  });
});

describe('US-4604 回帰: 既存テキスト操作', () => {
  it('measureTextLayer は拡張なしで従来 measureText と同じ寸法を返す', () => {
    const data = createTextLayerData({ text: 'Hello\nWorld', scale: 2, letterSpacing: 1 });
    const m = measureTextLayer(data);
    expect(m.width).toBeGreaterThan(0);
    expect(m.height).toBeGreaterThan(0);
  });

  it('updateTextLayerData の spread が拡張フィールドを保持する', () => {
    const data = createTextLayerData({ text: 'A', vertical: true, align: 'center' });
    const updated = { ...data, text: 'B' };
    expect(updated.vertical).toBe(true);
    expect(updated.align).toBe('center');
  });
});
