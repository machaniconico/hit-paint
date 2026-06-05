/**
 * HIT Paint — バケツ（塗りつぶし）ツール
 *
 * floodFill : 4近傍スキャンライン洪水塗りつぶし
 * fillRegion: 選択範囲全体または全バッファの一括塗りつぶし
 *
 * 距離判定: max-channel absolute difference (RGBA 各チャンネルの最大絶対差)
 *   distance = max(|Δr|, |Δg|, |Δb|, |Δa|)
 * tolerance 0 = 完全一致のみ塗りつぶす, 255 = すべて塗りつぶす
 */

import type { RGBA } from '../types';

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/** ピクセルインデックス (row-major) を返す */
const idx = (x: number, y: number, w: number): number => (y * w + x) * 4;

/**
 * max-channel 絶対差距離。
 * seed の RGBA と対象ピクセルの RGBA を比較し 0-255 の距離を返す。
 */
function maxChannelDist(
  pixels: Uint8ClampedArray,
  i: number,
  sr: number, sg: number, sb: number, sa: number,
): number {
  return Math.max(
    Math.abs(pixels[i]     - sr),
    Math.abs(pixels[i + 1] - sg),
    Math.abs(pixels[i + 2] - sb),
    Math.abs(pixels[i + 3] - sa),
  );
}

/** pixels の位置 i に color を書き込む */
function writeColor(pixels: Uint8ClampedArray, i: number, color: RGBA): void {
  pixels[i]     = color.r;
  pixels[i + 1] = color.g;
  pixels[i + 2] = color.b;
  pixels[i + 3] = color.a;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 4近傍スキャンライン洪水塗りつぶし。
 *
 * @param pixels    - 変更対象の RGBA バッファ (row-major, length = w*h*4)
 * @param width     - キャンバス幅 (px)
 * @param height    - キャンバス高さ (px)
 * @param sx        - 塗りつぶし開始 X 座標
 * @param sy        - 塗りつぶし開始 Y 座標
 * @param color     - 塗りつぶし色 (straight RGBA)
 * @param tolerance - 許容距離 0-255 (max-channel 絶対差)
 * @param selection - 選択マスク (length = w*h, >0 のみ塗りつぶし対象) または null/undefined
 * @returns 1 ピクセル以上変更された場合 true
 */
export function floodFill(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  color: RGBA,
  tolerance: number,
  selection?: Uint8ClampedArray | null,
): boolean {
  // 座標境界チェック
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return false;

  const seedIdx = idx(sx, sy, width);
  const sr = pixels[seedIdx];
  const sg = pixels[seedIdx + 1];
  const sb = pixels[seedIdx + 2];
  const sa = pixels[seedIdx + 3];

  // シード色が塗り色と同一かつ tolerance 0 の場合は何もしない (無限ループ防止)
  if (
    tolerance === 0 &&
    sr === color.r && sg === color.g && sb === color.b && sa === color.a
  ) {
    return false;
  }

  const total = width * height;
  // 訪問済みフラグ (Uint8Array でメモリ節約)
  const visited = new Uint8Array(total);

  // スタックベース BFS: [x, y] ペアのキュー
  // 大きなキャンバスに備えて Int32Array ベースのリングバッファを使用
  const stack: Array<[number, number]> = [[sx, sy]];
  let changed = false;

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    const pi = cy * width + cx; // flat pixel index (without *4)

    // 訪問済みまたは選択外はスキップ
    if (visited[pi]) continue;
    if (selection && selection[pi] === 0) continue;

    const bi = pi * 4;

    // 距離チェック: シード色との差が tolerance 以下かどうか
    if (maxChannelDist(pixels, bi, sr, sg, sb, sa) > tolerance) continue;

    visited[pi] = 1;
    writeColor(pixels, bi, color);
    changed = true;

    // 4近傍を追加
    if (cx > 0)         stack.push([cx - 1, cy]);
    if (cx < width - 1) stack.push([cx + 1, cy]);
    if (cy > 0)         stack.push([cx, cy - 1]);
    if (cy < height - 1) stack.push([cx, cy + 1]);
  }

  return changed;
}

/**
 * 選択範囲全体または全バッファを color で塗りつぶす。
 *
 * @param pixels    - 変更対象の RGBA バッファ
 * @param width     - キャンバス幅 (px)
 * @param height    - キャンバス高さ (px)
 * @param color     - 塗りつぶし色 (straight RGBA)
 * @param selection - 選択マスク (>0 のみ対象) または null/undefined (全体対象)
 */
export function fillRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  color: RGBA,
  selection?: Uint8ClampedArray | null,
): void {
  const total = width * height;
  for (let i = 0; i < total; i++) {
    if (selection && selection[i] === 0) continue;
    writeColor(pixels, i * 4, color);
  }
}
