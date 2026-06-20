import { describe, it, expect } from 'vitest';
import { layoutVerticalText } from '../src/text/text-vertical';

// 寸法定数(src/text/font5x7.ts 由来): GLYPH_WIDTH=5, GLYPH_HEIGHT=7
// 既定 lineGap=2, columnGap=2 → 行送り=7+2=9, 列幅=5+2=7
const LINE_STEP = 9;
const COLUMN_STEP = 7;

describe('US-4603 縦書きレイアウト', () => {
  it('"AB" は1列に A(上) B(下) を縦に積む(y=0, 9)', () => {
    const r = layoutVerticalText('AB', { maxHeight: 1000 });
    expect(r.columns).toHaveLength(1);
    expect(r.glyphs).toEqual([
      { char: 'A', x: 0, y: 0 },
      { char: 'B', x: 0, y: LINE_STEP },
    ]);
  });

  it('改行で2列目が前列より左(x が小さい)になり, 最右列に先頭文字が入る', () => {
    const r = layoutVerticalText('A\nB');
    expect(r.columns).toHaveLength(2);
    // 先頭文字 A は最右列(x 最大)
    const colA = r.columns[0];
    const colB = r.columns[1];
    expect(colA.chars).toBe('A');
    expect(colB.chars).toBe('B');
    expect(colA.x).toBe(COLUMN_STEP); // 最右列 = (2-1)*7
    expect(colB.x).toBe(0); // 左列
    expect(colB.x).toBeLessThan(colA.x);
  });

  it('maxHeight 超で次の列(左)へ折り返す', () => {
    // 1列に2文字まで入る高さ: 2文字=7+2+7=16 → maxHeight=16 はOK, 3文字目=25 で折り返し
    const r = layoutVerticalText('ABC', { maxHeight: 16 });
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0].chars).toBe('AB');
    expect(r.columns[1].chars).toBe('C');
    expect(r.columns[0].x).toBeGreaterThan(r.columns[1].x);
  });

  it('columns の chars/x/height が正しい', () => {
    const r = layoutVerticalText('AB\nC');
    expect(r.columns).toEqual([
      { chars: 'AB', x: COLUMN_STEP, height: 7 + 2 + 7 }, // 2文字列
      { chars: 'C', x: 0, height: 7 }, // 1文字列
    ]);
  });

  it('width = 列数*列幅 - columnGap, height = 最長列', () => {
    const r = layoutVerticalText('AB\nC'); // 2列, 最長列=2文字
    expect(r.width).toBe(2 * COLUMN_STEP - 2); // 14-2=12
    expect(r.height).toBe(7 + 2 + 7); // 16
  });

  it('scale を反映する(行送り/列幅/高さが scale 倍寸法になる)', () => {
    const r = layoutVerticalText('A\nB', { scale: 2 });
    const lineStep2 = 7 * 2 + 2; // 16
    const colStep2 = 5 * 2 + 2; // 12
    expect(r.columns[0].x).toBe(colStep2); // 最右列
    expect(r.columns[1].x).toBe(0);
    expect(r.height).toBe(7 * 2); // 1文字列の高さ
    expect(r.width).toBe(2 * colStep2 - 2);
    // y は行送り(ここでは各列1文字なので y=0 のみ)
    expect(r.glyphs.every((g) => g.y === 0)).toBe(true);
    expect(lineStep2).toBe(16);
  });

  it('空文字は glyphs/columns 空, width=height=0', () => {
    const r = layoutVerticalText('');
    expect(r.glyphs).toEqual([]);
    expect(r.columns).toEqual([]);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });

  it('改行のみ(空列だけ)も退化扱いで glyphs 空', () => {
    const r = layoutVerticalText('\n\n');
    expect(r.glyphs).toEqual([]);
    expect(r.columns).toEqual([]);
  });
});
