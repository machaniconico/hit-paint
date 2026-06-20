import { describe, it, expect } from 'vitest';
import { layoutTextOnPath } from '../src/text/text-on-path';
import { pointAtLength, tangentAtLength } from '../src/vector/path-measure';
import type { VectorPath } from '../src/vector/path';

/**
 * US-4602 テキストをパスに沿わせる(text-on-path)の純粋ロジック検証。
 * - canvas 非依存。全て layoutTextOnPath / path-measure の数値照合で検証する。
 * - advance = GLYPH_WIDTH(5)*scale + letterSpacing。既定 scale=1, letterSpacing=1 → advance=6。
 * - グリフ中心弧長 = startOffset + Σ前のadvance + advance/2。
 */

// テスト用の直線パス生成ヘルパ(制御点なし=折れ線)。
function line(x0: number, y0: number, x1: number, y1: number): VectorPath {
  return { points: [{ x: x0, y: y0 }, { x: x1, y: y1 }], closed: false };
}

describe('layoutTextOnPath: 水平直線パス', () => {
  it('angle≈0 で各グリフ x が累積 advance 中心に配置される', () => {
    const path = line(0, 0, 100, 0);
    const glyphs = layoutTextOnPath('AB', path); // 既定 advance=6

    expect(glyphs).toHaveLength(2);
    expect(glyphs[0].char).toBe('A');
    expect(glyphs[1].char).toBe('B');

    // 中心弧長: A=3, B=9。水平パスでは x=弧長, y=0, angle=0。
    expect(glyphs[0].x).toBeCloseTo(3, 6);
    expect(glyphs[0].y).toBeCloseTo(0, 6);
    expect(glyphs[0].angle).toBeCloseTo(0, 6);

    expect(glyphs[1].x).toBeCloseTo(9, 6);
    expect(glyphs[1].y).toBeCloseTo(0, 6);
    expect(glyphs[1].angle).toBeCloseTo(0, 6);
  });

  it('path-measure の pointAtLength/tangentAtLength と直接一致する', () => {
    const path = line(0, 0, 100, 0);
    const glyphs = layoutTextOnPath('ABC', path);

    const centers = [3, 9, 15]; // advance=6, 中心=3,9,15
    glyphs.forEach((g, i) => {
      const p = pointAtLength(path, centers[i]);
      const t = tangentAtLength(path, centers[i]);
      expect(g.x).toBeCloseTo(p.x, 6);
      expect(g.y).toBeCloseTo(p.y, 6);
      expect(g.angle).toBeCloseTo(t.angle, 6);
    });
  });

  it('letterSpacing/scale を反映した advance で配置される', () => {
    const path = line(0, 0, 200, 0);
    // scale=2 → glyph幅=10, letterSpacing=4 → advance=14。中心=7,21
    const glyphs = layoutTextOnPath('AB', path, { scale: 2, letterSpacing: 4 });
    expect(glyphs[0].x).toBeCloseTo(7, 6);
    expect(glyphs[1].x).toBeCloseTo(21, 6);
  });
});

describe('layoutTextOnPath: 垂直直線パス', () => {
  it('angle≈π/2 で y が累積 advance 中心に配置される', () => {
    const path = line(0, 0, 0, 100);
    const glyphs = layoutTextOnPath('AB', path);

    expect(glyphs[0].x).toBeCloseTo(0, 6);
    expect(glyphs[0].y).toBeCloseTo(3, 6);
    expect(glyphs[0].angle).toBeCloseTo(Math.PI / 2, 6);

    expect(glyphs[1].y).toBeCloseTo(9, 6);
    expect(glyphs[1].angle).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('layoutTextOnPath: startOffset', () => {
  it('startOffset でグリフ位置が弧長分ずれる', () => {
    const path = line(0, 0, 100, 0);
    const base = layoutTextOnPath('A', path);
    const shifted = layoutTextOnPath('A', path, { startOffset: 10 });
    // 中心 3 → 13 へずれる。
    expect(base[0].x).toBeCloseTo(3, 6);
    expect(shifted[0].x).toBeCloseTo(13, 6);
  });
});

describe('layoutTextOnPath: overflow', () => {
  it("'drop' は総長を超えるグリフを除外する", () => {
    // 総長 10。advance=6 → 中心 3,9,15,21... → 3,9 のみ <=10。
    const path = line(0, 0, 10, 0);
    const glyphs = layoutTextOnPath('ABCD', path, { overflow: 'drop' });
    expect(glyphs.map((g) => g.char)).toEqual(['A', 'B']);
    expect(glyphs[0].x).toBeCloseTo(3, 6);
    expect(glyphs[1].x).toBeCloseTo(9, 6);
  });

  it("'clamp'(既定) は総長を超えるグリフを末尾へ張り付ける", () => {
    const path = line(0, 0, 10, 0);
    const glyphs = layoutTextOnPath('ABCD', path, { overflow: 'clamp' });
    expect(glyphs).toHaveLength(4);
    // C,D は中心 15,21 > 10 → 末尾 (10,0) へクランプ。
    expect(glyphs[2].x).toBeCloseTo(10, 6);
    expect(glyphs[3].x).toBeCloseTo(10, 6);
    expect(glyphs[2].y).toBeCloseTo(0, 6);
  });

  it('overflow 既定は clamp(末尾に集まる)', () => {
    const path = line(0, 0, 10, 0);
    const glyphs = layoutTextOnPath('ABCD', path);
    expect(glyphs).toHaveLength(4);
    expect(glyphs[3].x).toBeCloseTo(10, 6);
  });
});

describe('layoutTextOnPath: 空白・改行も advance を消費', () => {
  it('空白文字も送り幅を消費して後続が前進する', () => {
    const path = line(0, 0, 100, 0);
    const glyphs = layoutTextOnPath('A B', path);
    // A=中心3, ' '=中心9, B=中心15
    expect(glyphs.map((g) => g.char)).toEqual(['A', ' ', 'B']);
    expect(glyphs[0].x).toBeCloseTo(3, 6);
    expect(glyphs[1].x).toBeCloseTo(9, 6);
    expect(glyphs[2].x).toBeCloseTo(15, 6);
  });
});

describe('layoutTextOnPath: 退化', () => {
  it('空文字は空配列', () => {
    const path = line(0, 0, 100, 0);
    expect(layoutTextOnPath('', path)).toEqual([]);
  });
});
