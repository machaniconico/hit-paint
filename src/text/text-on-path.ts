import type { VectorPath } from '../vector/path';
import { pathLength, pointAtLength, tangentAtLength } from '../vector/path-measure';

/**
 * テキストをパスに沿わせる(text-on-path) — US-4602。
 *
 * 設計判断:
 * - 全て純粋関数・決定論(Date.now/Math.random を一切使わない)。
 * - グリフの advance(送り幅)は src/text/index.ts の通常配置と同一規約:
 *   advance = GLYPH_WIDTH * scale + letterSpacing。\n や空白も advance を消費し
 *   (描画は呼び出し側で空にする想定)、配置だけは前進させる。
 * - GLYPH_WIDTH/GLYPH_HEIGHT/DEFAULT_LETTER_SPACING は font5x7 / index.ts 由来の定数
 *   だが、それらは export されていない private 定数のため、ここで同値(5/7/1)を
 *   自前定義し由来をコメントで明記する。
 *
 * 弧長配置規約(重要):
 * - 各グリフは「グリフ中心」をパス上の累積弧長に配置する。
 *   center_len(i) = startOffset + Σ_{j<i} advance(j) + advance(i)/2
 *   すなわち i 番目のグリフは、それまでの送り幅の合計に自身の半幅を足した位置を
 *   中心とする。x,y = pointAtLength(center_len), angle = tangentAtLength(center_len).angle。
 * - これにより直線(水平)パスでは中心が advance 通りに進み、通常配置と整合する。
 * - パス総長を超えるグリフ(center_len > total)は overflow で扱う:
 *   - 'clamp'(既定): center_len を total にクランプして末尾へ張り付ける。
 *   - 'drop'        : そのグリフを結果から除外する。
 */

// font5x7 / text/index.ts 由来の定数(export されていないため同値を再定義)。
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7; // 参考(高さ): 現状の配置計算では未使用だが規約として明記。
const DEFAULT_LETTER_SPACING = 1;

void GLYPH_HEIGHT;

export interface TextOnPathOptions {
  scale?: number;
  letterSpacing?: number;
  startOffset?: number;
  overflow?: 'clamp' | 'drop';
}

export interface PathGlyph {
  char: string;
  /** グリフ中心の x 座標(パス上)。 */
  x: number;
  /** グリフ中心の y 座標(パス上)。 */
  y: number;
  /** 接線方向(ラジアン, atan2(dy,dx))。 */
  angle: number;
}

/** scale を 1 以上の整数へ正規化(index.ts の normalizeInteger と同規約)。 */
function normalizeScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

/** letterSpacing を整数へ正規化(index.ts の normalizeSpacing と同規約, 既定 1)。 */
function normalizeSpacing(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LETTER_SPACING;
  return Math.trunc(value);
}

/**
 * text の各グリフをパス path に沿って配置し、グリフ中心の座標と接線角を返す。
 * - opts.scale(既定 1) / opts.letterSpacing(既定 1) は通常配置と同一規約。
 * - opts.startOffset(既定 0) は先頭グリフ手前のオフセット弧長。
 * - opts.overflow(既定 'clamp'): 総長超過グリフを末尾へクランプ('clamp')か除外('drop')。
 * - 退化(空文字)は空配列。advance<=0(scale*GLYPH_WIDTH+letterSpacing<=0)でも
 *   各グリフは順に同位置へ並ぶ(無限ループ等は起きない)。
 */
export function layoutTextOnPath(
  text: string,
  path: VectorPath,
  opts: TextOnPathOptions = {},
): PathGlyph[] {
  const scale = normalizeScale(opts.scale);
  const letterSpacing = normalizeSpacing(opts.letterSpacing);
  const startOffset = Number.isFinite(opts.startOffset ?? 0) ? (opts.startOffset ?? 0) : 0;
  const overflow: 'clamp' | 'drop' = opts.overflow ?? 'clamp';

  const advance = GLYPH_WIDTH * scale + letterSpacing;
  const total = pathLength(path);

  const result: PathGlyph[] = [];
  // それまでのグリフの送り幅の累積(現グリフの左端弧長)。
  let cursor = startOffset;

  for (const char of text) {
    // 現グリフ中心の弧長 = 左端 + 半幅。
    const centerLen = cursor + advance / 2;
    cursor += advance;

    if (centerLen > total) {
      if (overflow === 'drop') {
        continue;
      }
      // 'clamp': 末尾(total)へ張り付ける。
      const point = pointAtLength(path, total);
      const tan = tangentAtLength(path, total);
      result.push({ char, x: point.x, y: point.y, angle: tan.angle });
      continue;
    }

    const sampleLen = Math.max(0, centerLen);
    const point = pointAtLength(path, sampleLen);
    const tan = tangentAtLength(path, sampleLen);
    result.push({ char, x: point.x, y: point.y, angle: tan.angle });
  }

  return result;
}
