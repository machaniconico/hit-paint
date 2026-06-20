import { describe, it, expect } from 'vitest';
import { layoutText } from '../src/text/text-layout';
import type { TextLayoutResult } from '../src/text/text-layout';

// 文字メトリクス前提(font5x7): GLYPH_WIDTH=5, GLYPH_HEIGHT=7, letterSpacing 既定 1, lineGap 既定 2。
// 行幅 = N*5 + (N-1)*1。1文字進む送り = 5+1 = 6。行送り = 7+2 = 9。

/** glyph を char で引く補助。 */
function findGlyph(r: TextLayoutResult, char: string, nth = 0) {
  return r.glyphs.filter((g) => g.char === char)[nth];
}

describe('layoutText: 単一行の基本配置', () => {
  it('"AB"(scale=1, spacing=1) は x=0,6 / width=11', () => {
    const r = layoutText('AB');
    expect(r.glyphs).toEqual([
      { char: 'A', x: 0, y: 0 },
      { char: 'B', x: 6, y: 0 },
    ]);
    expect(r.width).toBe(11); // 2*5 + 1
    expect(r.height).toBe(7); // 1行
    expect(r.lines).toEqual([{ text: 'AB', width: 11, y: 0 }]);
  });
});

describe('layoutText: 改行', () => {
  it('\\n を含む2行は各行 y=0,9', () => {
    const r = layoutText('A\nB');
    expect(findGlyph(r, 'A').y).toBe(0);
    expect(findGlyph(r, 'B').y).toBe(9); // 7+2
    expect(r.lines.map((l) => l.y)).toEqual([0, 9]);
    expect(r.height).toBe(16); // 9 + 7
  });

  it('空行(\\n\\n)を保持する', () => {
    const r = layoutText('A\n\nB');
    expect(r.lines.map((l) => l.text)).toEqual(['A', '', 'B']);
    expect(r.lines.map((l) => l.y)).toEqual([0, 9, 18]);
  });
});

describe('layoutText: 語折り返し(maxWidth)', () => {
  it('空白境界で折り返す', () => {
    // "AA BB" 各単語 2文字=11px。maxWidth=11 なら1行に1単語ずつ。
    const r = layoutText('AA BB', { maxWidth: 11 });
    expect(r.lines.map((l) => l.text)).toEqual(['AA', 'BB']);
    expect(r.lines.map((l) => l.y)).toEqual([0, 9]);
  });

  it('入り切るなら同一行に保つ', () => {
    // "AA BB" を maxWidth=30 (>=17=5*5+4) なら1行。"AA BB"=5文字=29px。
    const r = layoutText('AA BB', { maxWidth: 30 });
    expect(r.lines.map((l) => l.text)).toEqual(['AA BB']);
  });

  it('1単語が maxWidth 超なら文字単位で折る', () => {
    // "AAAA" 4文字=23px。maxWidth=11 → 2文字ずつ(11px)に割る。
    const r = layoutText('AAAA', { maxWidth: 11 });
    expect(r.lines.map((l) => l.text)).toEqual(['AA', 'AA']);
  });

  it('maxWidth 未指定は折り返さない(改行のみ)', () => {
    const r = layoutText('AA BB CC DD');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].text).toBe('AA BB CC DD');
  });
});

describe('layoutText: 整列(center/right)', () => {
  it('center は (refWidth - lineWidth)/2 だけオフセット', () => {
    // 行 "A"(width=5)を refWidth=11 の中で center。offset=(11-5)/2=3。
    const r = layoutText('A\nAB', { align: 'center' });
    // 基準幅=最大行幅=11("AB")。"A" 行は offset 3。
    expect(findGlyph(r, 'A', 0).x).toBe(3);
    // "AB" 行はぴったりなので 0,6。
    expect(findGlyph(r, 'A', 1).x).toBe(0);
    expect(findGlyph(r, 'B').x).toBe(6);
  });

  it('right は refWidth - lineWidth だけオフセット', () => {
    const r = layoutText('A\nAB', { align: 'right' });
    // "A" 行(5px)は offset 11-5=6。
    expect(findGlyph(r, 'A', 0).x).toBe(6);
  });

  it('maxWidth を基準幅として center 計算', () => {
    const r = layoutText('A', { align: 'center', maxWidth: 25 });
    // offset=(25-5)/2=10。
    expect(findGlyph(r, 'A').x).toBe(10);
  });
});

describe('layoutText: 均等割付(justify)', () => {
  it('行内空白を均等配分し最終行は left', () => {
    // 2行: "A A"(空白1個, width=5+1+5? -> "A A"=3文字=17px) と最終行 "A"。
    // maxWidth=25。1行目 justify: slack=25-17=8 を空白1個へ。
    const r = layoutText('A A\nA', { align: 'justify', maxWidth: 25 });
    const line0 = r.glyphs.filter((g) => g.y === 0);
    expect(line0[0].x).toBe(0); // 先頭 A
    // penX: A(0) -> +6 -> 空白(6) -> +6+slack8 -> 2文字目 A=20。
    expect(line0[1].x).toBe(20);
    // justify 行の width は refWidth に揃う。
    expect(r.lines[0].width).toBe(25);
    // 最終行は left(offset 0)。
    const lastA = r.glyphs.filter((g) => g.y === 9)[0];
    expect(lastA.x).toBe(0);
    expect(r.lines[1].width).toBe(5);
  });

  it('空白の無い行(単語1個)は justify でも left', () => {
    const r = layoutText('AB\nCC', { align: 'justify', maxWidth: 30 });
    // 1行目 "AB" は空白無し → left。x=0,6。
    expect(findGlyph(r, 'A').x).toBe(0);
    expect(r.lines[0].width).toBe(11);
  });
});

describe('layoutText: 退化', () => {
  it('空文字は glyphs 空 / width=height=0', () => {
    const r = layoutText('');
    expect(r.glyphs).toEqual([]);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it('scale を反映した送り/行送り', () => {
    // scale=2: advance=5*2+1=11, lineHeight=7*2+2=16。
    const r = layoutText('A\nB', { scale: 2 });
    expect(findGlyph(r, 'B').y).toBe(16);
    expect(r.height).toBe(7 * 2 + 16); // (2-1)*16 + 14
  });
});
