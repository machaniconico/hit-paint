/**
 * テキストレイアウト(行折り返し + 整列 + 均等割付) — US-4601 / Wave44
 *
 * 設計判断:
 * - 純粋・決定論なレイアウト計算のみを担う。canvas/DOM/乱数/時刻に一切依存しない
 *   (jsdom テスト制約への適合)。実際のピクセル描画は呼び出し側 (renderText 等) が
 *   この結果の glyph 座標を使って行う。
 * - 文字メトリクスは src/text/font5x7.ts / src/text/index.ts の固定 5x7 ビットマップ前提。
 *   GLYPH_WIDTH/HEIGHT・LINE_GAP・既定 letterSpacing は index.ts 内の private 定数のため、
 *   ここでは同値を自前定義する(font5x7 / index.ts 由来であることを明記)。
 * - 兄弟 Wave44 ファイルは import しない(並列実装の独立性のため)。
 */

// --- 文字メトリクス定数 (src/text/font5x7.ts: GLYPH_WIDTH=5, GLYPH_HEIGHT=7 由来) ---
/** グリフ1文字の論理幅(px, scale=1)。font5x7.ts の GLYPH_WIDTH と同値。 */
const GLYPH_WIDTH = 5;
/** グリフ1文字の論理高(px, scale=1)。font5x7.ts の GLYPH_HEIGHT と同値。 */
const GLYPH_HEIGHT = 7;
/** 既定の字間(px)。src/text/index.ts の DEFAULT_LETTER_SPACING と同値。 */
const DEFAULT_LETTER_SPACING = 1;
/** 既定の行間(px)。src/text/index.ts の LINE_GAP と同値。 */
const DEFAULT_LINE_GAP = 2;

/**
 * 1文字進めるごとの送り量(次のグリフ原点までの距離)。
 * 行内に N 文字あるとき行幅 = N*GLYPH_WIDTH*scale + (N-1)*letterSpacing
 *                        = N*advance - letterSpacing。
 */
function advance(scale: number, letterSpacing: number): number {
  return GLYPH_WIDTH * scale + letterSpacing;
}

/** 文字数から行幅を求める(0 文字は 0)。 */
function lineWidthOf(charCount: number, scale: number, letterSpacing: number): number {
  if (charCount <= 0) return 0;
  return charCount * GLYPH_WIDTH * scale + (charCount - 1) * letterSpacing;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

export interface LayoutOptions {
  /** グリフ拡大率(整数想定, 既定 1)。 */
  scale?: number;
  /** 字間(px, 既定 1)。 */
  letterSpacing?: number;
  /** 折り返し基準幅(px)。未指定なら折り返し無し(改行のみ)。 */
  maxWidth?: number;
  /** 水平整列(既定 'left')。 */
  align?: TextAlign;
  /** 行間(px, 既定 2)。 */
  lineGap?: number;
}

export interface PositionedGlyph {
  char: string;
  /** グリフ左上 x(px)。 */
  x: number;
  /** グリフ左上 y(px)。 */
  y: number;
}

export interface TextLayoutResult {
  glyphs: PositionedGlyph[];
  /** レイアウト全体幅(px)。 */
  width: number;
  /** レイアウト全体高(px)。 */
  height: number;
  lines: { text: string; width: number; y: number }[];
}

/** 折り返し前の1論理行(\n 区切り)の中身を保持する内部表現。 */
interface WrappedLine {
  /** この行の文字列(空白含む, 整列計算用)。 */
  text: string;
}

/**
 * 1論理行を maxWidth に収まるように空白境界で語折り返しする。
 * - 単語(連続する非空白)単位で詰め、行が maxWidth を超えるなら改行する。
 * - 1単語だけで maxWidth を超える場合は文字単位で強制分割する。
 * - 空白は単語間の区切りとしてのみ扱い、行頭の余分な空白は落とす。
 */
function wrapLogicalLine(
  line: string,
  scale: number,
  letterSpacing: number,
  maxWidth: number,
): WrappedLine[] {
  const result: WrappedLine[] = [];
  // 空白(スペース)で分割しつつ区切りを保持。半角スペースのみを語境界とする。
  const tokens = splitWords(line);

  let current = '';
  let currentLen = 0; // current の文字数

  const flush = () => {
    result.push({ text: current });
    current = '';
    currentLen = 0;
  };

  for (const token of tokens) {
    const tokenLen = [...token].length;
    if (token === ' ') {
      // 空白: 行頭(currentLen===0)なら捨てる。それ以外は暫定追加。
      if (currentLen === 0) continue;
      current += ' ';
      currentLen += 1;
      continue;
    }

    // 単語そのものが maxWidth を超える → 文字単位で割る必要がある。
    if (lineWidthOf(tokenLen, scale, letterSpacing) > maxWidth) {
      // まず現在行に末尾空白があればトリムして確定。
      if (currentLen > 0) {
        const trimmed = trimTrailingSpace(current);
        result.push({ text: trimmed });
        current = '';
        currentLen = 0;
      }
      breakLongWord(token, scale, letterSpacing, maxWidth, result);
      // breakLongWord は最後の端数を current として持ち越すために戻り値を使う。
      const tail = result.pop();
      if (tail) {
        current = tail.text;
        currentLen = [...current].length;
      }
      continue;
    }

    // 通常単語: 現在行(末尾空白込み)に足して幅判定。
    const candidateLen = currentLen + tokenLen;
    if (currentLen > 0 && lineWidthOf(candidateLen, scale, letterSpacing) > maxWidth) {
      // 入り切らない → 現在行を確定(末尾空白トリム)して新しい行へ。
      result.push({ text: trimTrailingSpace(current) });
      current = token;
      currentLen = tokenLen;
    } else {
      current += token;
      currentLen = candidateLen;
    }
  }

  flush();
  // トリム: 各行の末尾空白を除去(行頭は wrap 中に処理済み)。
  return result.map((l) => ({ text: trimTrailingSpace(l.text) }));
}

/**
 * 長すぎる単語を maxWidth に収まる範囲で文字単位に分割し result に push する。
 * 最後の端数も1つの行として push する(呼び出し側で持ち越す)。
 */
function breakLongWord(
  word: string,
  scale: number,
  letterSpacing: number,
  maxWidth: number,
  result: WrappedLine[],
): void {
  const chars = [...word];
  let chunk = '';
  let chunkLen = 0;
  for (const ch of chars) {
    const nextLen = chunkLen + 1;
    if (chunkLen > 0 && lineWidthOf(nextLen, scale, letterSpacing) > maxWidth) {
      result.push({ text: chunk });
      chunk = ch;
      chunkLen = 1;
    } else {
      chunk += ch;
      chunkLen = nextLen;
    }
  }
  result.push({ text: chunk });
}

/** 半角スペースを区切りとして残しつつ単語列に分割する(連続空白は個々の ' ' トークンになる)。 */
function splitWords(line: string): string[] {
  const tokens: string[] = [];
  let word = '';
  for (const ch of line) {
    if (ch === ' ') {
      if (word.length > 0) {
        tokens.push(word);
        word = '';
      }
      tokens.push(' ');
    } else {
      word += ch;
    }
  }
  if (word.length > 0) tokens.push(word);
  return tokens;
}

function trimTrailingSpace(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === ' ') end--;
  return s.slice(0, end);
}

/**
 * テキストをレイアウトしてグリフ座標・行情報を返す。
 *
 * @param text  対象文字列(\n で強制改行)
 * @param opts  scale / letterSpacing / maxWidth / align / lineGap
 *
 * 整列規約:
 * - 基準幅 refWidth = maxWidth 指定時はその値、未指定時は全行の最大行幅。
 * - left  : x オフセット 0。
 * - center: (refWidth - lineWidth) / 2。
 * - right : refWidth - lineWidth。
 * - justify: 行内の空白を均等に広げて lineWidth を refWidth に揃える。
 *            ただし「最終行」「空白が無い(単語1個以下の)行」は left 扱い。
 *
 * 行送り: 各行のトップ y は index * (GLYPH_HEIGHT*scale + lineGap)。
 */
export function layoutText(text: string, opts: LayoutOptions = {}): TextLayoutResult {
  const scale = normalizeScale(opts.scale);
  const letterSpacing = normalizeSpacing(opts.letterSpacing);
  const lineGap = normalizeGap(opts.lineGap);
  const align: TextAlign = opts.align ?? 'left';
  const hasMaxWidth = opts.maxWidth !== undefined && Number.isFinite(opts.maxWidth);
  const maxWidth = hasMaxWidth ? Math.max(0, opts.maxWidth as number) : 0;

  // 退化: 空文字。
  if (text.length === 0) {
    return { glyphs: [], width: 0, height: 0, lines: [] };
  }

  // 1. \n で強制改行 → 各論理行を必要なら語折り返し。
  const logicalLines = text.split('\n');
  const wrapped: WrappedLine[] = [];
  for (const logical of logicalLines) {
    if (hasMaxWidth) {
      const parts = wrapLogicalLine(logical, scale, letterSpacing, maxWidth);
      // 空行(\n\n 等)は1つの空行として保持。
      if (parts.length === 0) wrapped.push({ text: '' });
      else wrapped.push(...parts);
    } else {
      wrapped.push({ text: logical });
    }
  }

  // 2. 各行の素の幅を計算。
  const lineInfos = wrapped.map((l) => {
    const count = [...l.text].length;
    return { text: l.text, rawWidth: lineWidthOf(count, scale, letterSpacing) };
  });

  // 3. 基準幅 refWidth。
  const maxLineWidth = lineInfos.reduce((m, l) => Math.max(m, l.rawWidth), 0);
  const refWidth = hasMaxWidth ? maxWidth : maxLineWidth;

  const lineHeight = GLYPH_HEIGHT * scale + lineGap;
  const glyphs: PositionedGlyph[] = [];
  const lines: { text: string; width: number; y: number }[] = [];

  for (let li = 0; li < lineInfos.length; li++) {
    const info = lineInfos[li];
    const y = li * lineHeight;
    const isLast = li === lineInfos.length - 1;
    const chars = [...info.text];

    // justify 判定: 最終行 / 空白を含まない(=単語1個以下の)行は left。
    const spaceCount = chars.filter((c) => c === ' ').length;
    const useJustify = align === 'justify' && !isLast && spaceCount > 0;

    let xOffset = 0;
    let extraPerSpace = 0;
    if (useJustify) {
      // 行内空白へ均等配分する余剰幅。
      const slack = refWidth - info.rawWidth;
      extraPerSpace = slack / spaceCount;
    } else {
      xOffset = alignOffset(align, refWidth, info.rawWidth);
    }

    // グリフを配置。空白は描画しないが送り幅は進める。
    let penX = xOffset;
    for (const ch of chars) {
      if (ch !== ' ') {
        glyphs.push({ char: ch, x: penX, y });
      }
      // 次グリフ原点へ。advance + (justify の空白なら追加スラック)。
      penX += GLYPH_WIDTH * scale + letterSpacing;
      if (ch === ' ' && useJustify) penX += extraPerSpace;
    }

    // 行幅: justify ならば refWidth、それ以外は素の幅。
    const renderedWidth = useJustify ? refWidth : info.rawWidth;
    lines.push({ text: info.text, width: renderedWidth, y });
  }

  // 全体幅: justify があれば refWidth まで広がる。基準は max(行描画幅)。
  const width = lines.reduce((m, l) => Math.max(m, l.width), 0);
  const height = lineInfos.length === 0 ? 0 : (lineInfos.length - 1) * lineHeight + GLYPH_HEIGHT * scale;

  return { glyphs, width, height, lines };
}

/** align に応じた行頭 x オフセット(justify 以外)。 */
function alignOffset(align: TextAlign, refWidth: number, lineWidth: number): number {
  switch (align) {
    case 'center':
      return (refWidth - lineWidth) / 2;
    case 'right':
      return refWidth - lineWidth;
    case 'left':
    case 'justify':
    default:
      return 0;
  }
}

function normalizeScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

function normalizeSpacing(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LETTER_SPACING;
  return Math.trunc(value);
}

function normalizeGap(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LINE_GAP;
  return Math.trunc(value);
}
