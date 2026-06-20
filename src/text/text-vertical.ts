/**
 * US-4603 縦書きレイアウト(上→下に文字を積み, 列は右→左へ送る)
 *
 * 設計判断:
 * - 純粋・決定論的な配列ロジックのみ。canvas/Date.now()/Math.random() 非依存=jsdom でテスト可能。
 * - 兄弟 Wave44 ファイル(text-horizontal 等)は import しない。font5x7 由来の寸法定数は
 *   src/text/index.ts 内の private 定数(export されていない)ため、ここで同値を自前定義する。
 *
 * グリフ寸法は src/text/font5x7.ts の GLYPH_WIDTH=5 / GLYPH_HEIGHT=7、
 * 行間 LINE_GAP=2 は src/text/index.ts と同値。
 */

/** 1グリフの横幅(px)。src/text/font5x7.ts の GLYPH_WIDTH 由来。 */
const GLYPH_WIDTH = 5;
/** 1グリフの縦幅(px)。src/text/font5x7.ts の GLYPH_HEIGHT 由来。 */
const GLYPH_HEIGHT = 7;
/** 縦方向の行間(px)。src/text/index.ts の LINE_GAP 既定値と同値。 */
const DEFAULT_LINE_GAP = 2;
/** 列間(px)の既定値。横方向の隣接列とのすき間。 */
const DEFAULT_COLUMN_GAP = 2;

export interface VerticalLayoutOptions {
  /** 拡大率(整数, 最小1)。既定 1。 */
  scale?: number;
  /** 縦方向の行間(px)。既定 2。 */
  lineGap?: number;
  /** 横方向の列間(px)。既定 2。 */
  columnGap?: number;
  /** この縦長(px)を超えると次の列(左)へ折り返す。未指定なら折り返さない。 */
  maxHeight?: number;
}

export interface PositionedGlyph {
  char: string;
  x: number;
  y: number;
}

export interface VerticalLayoutResult {
  glyphs: PositionedGlyph[];
  width: number;
  height: number;
  columns: { chars: string; x: number; height: number }[];
}

/**
 * 縦書きレイアウトを計算する。
 *
 * レイアウト規約:
 * - グリフは縦に積む。1グリフごとの行送り = GLYPH_HEIGHT*scale + lineGap、y が増える方向(下)へ。
 * - 列は右から左へ送る。列幅 = GLYPH_WIDTH*scale + columnGap。
 *   文字は最も右の列(x が最大)から書き始め、改行/maxHeight 超で1つ左の列へ移る。
 * - x 座標は 0 基準へ正規化する: 最左列 x=0、最右列 x=(列数-1)*列幅。
 *   よって計算順(右→左)とは逆に、最初の列ほど x が大きい値を持つ。
 * - height = 最も長い列の縦長。width = 列数 * 列幅 - columnGap(末尾列の右余白を除く)。
 *
 * 退化: 空文字や有効グリフ無しのときは glyphs/columns 空、width=height=0。
 */
export function layoutVerticalText(text: string, opts: VerticalLayoutOptions = {}): VerticalLayoutResult {
  const scale = normalizeScale(opts.scale);
  const lineGap = normalizeGap(opts.lineGap, DEFAULT_LINE_GAP);
  const columnGap = normalizeGap(opts.columnGap, DEFAULT_COLUMN_GAP);
  const lineStep = GLYPH_HEIGHT * scale + lineGap;
  const columnStep = GLYPH_WIDTH * scale + columnGap;
  const maxHeight = opts.maxHeight !== undefined && Number.isFinite(opts.maxHeight) ? opts.maxHeight : undefined;

  // まず文字を列(charsの配列)へ振り分ける。列は書き出し順(右→左)に並ぶ。
  const columnChars: string[][] = [];
  let current: string[] = [];

  const pushColumn = (): void => {
    columnChars.push(current);
    current = [];
  };

  for (const ch of text) {
    if (ch === '\n') {
      // 明示改行: 現在の列を確定して次の列へ(空列も維持し列位置を進める)。
      pushColumn();
      continue;
    }

    // maxHeight 折り返し: この文字を足すと縦長が maxHeight を超える かつ
    // 既にその列に1文字以上あるなら、先に列を切り替える。
    if (maxHeight !== undefined && current.length > 0) {
      const usedHeight = current.length * GLYPH_HEIGHT * scale + (current.length - 1) * lineGap;
      const nextHeight = usedHeight + lineGap + GLYPH_HEIGHT * scale;
      if (nextHeight > maxHeight) {
        pushColumn();
      }
    }

    current.push(ch);
  }
  // 末尾の列を確定。末尾が \n のときは current が空なので追加しない(空の末尾列を作らない)。
  // 空文字('')のときは current 空・columnChars 空のまま → 後段の退化判定で空結果になる。
  if (current.length > 0) pushColumn();

  // 有効な(1文字以上の)列が無ければ退化。
  const nonEmpty = columnChars.filter((c) => c.length > 0);
  if (nonEmpty.length === 0) {
    return { glyphs: [], width: 0, height: 0, columns: [] };
  }

  const columnCount = nonEmpty.length;
  // x 正規化: 書き出し順(右→左)で index 0 が最右列。最右列 x = (columnCount-1)*columnStep。
  // index i の列の x = (columnCount-1-i)*columnStep。
  const glyphs: PositionedGlyph[] = [];
  const columns: { chars: string; x: number; height: number }[] = [];
  let maxColumnHeight = 0;

  for (let i = 0; i < columnCount; i++) {
    const chars = nonEmpty[i];
    const x = (columnCount - 1 - i) * columnStep;
    const count = chars.length;
    const colHeight = count * GLYPH_HEIGHT * scale + (count - 1) * lineGap;
    if (colHeight > maxColumnHeight) maxColumnHeight = colHeight;

    for (let j = 0; j < count; j++) {
      glyphs.push({ char: chars[j], x, y: j * lineStep });
    }

    columns.push({ chars: chars.join(''), x, height: colHeight });
  }

  const width = columnCount * columnStep - columnGap;

  return { glyphs, width, height: maxColumnHeight, columns };
}

function normalizeScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

function normalizeGap(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}
