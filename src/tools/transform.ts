/**
 * HIT Paint — 変形ツール
 *
 * レイヤーピクセルバッファに対する移動・アフィン変換ユーティリティ。
 * すべての関数は元のバッファを変更せず、新しい Uint8ClampedArray を返す。
 * ピクセルフォーマット: 幅×高さ×4 バイト (R,G,B,A)、行優先、ストレート RGBA。
 */

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** ピクセル座標を 4 バイトインデックスに変換する。 */
function idx(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

// ---------------------------------------------------------------------------
// 整数シフト（移動）
// ---------------------------------------------------------------------------

/**
 * ピクセルバッファを整数ピクセル (dx, dy) だけシフトする。
 * 範囲外に出た領域は透明 (0,0,0,0) になる。
 * dx/dy は小数部を切り捨てて整数化する。
 */
export function moveLayerPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length); // 既定でゼロ（透明）
  const sx = Math.trunc(dx);
  const sy = Math.trunc(dy);

  for (let y = 0; y < height; y++) {
    const srcY = y - sy;
    if (srcY < 0 || srcY >= height) continue;

    for (let x = 0; x < width; x++) {
      const srcX = x - sx;
      if (srcX < 0 || srcX >= width) continue;

      const srcIdx = idx(srcX, srcY, width);
      const dstIdx = idx(x, y, width);
      out[dstIdx] = pixels[srcIdx];
      out[dstIdx + 1] = pixels[srcIdx + 1];
      out[dstIdx + 2] = pixels[srcIdx + 2];
      out[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// アフィン変換（バイリニアサンプリング）
// ---------------------------------------------------------------------------

/**
 * ソース→デスト方向のアフィン行列 m を受け取り、
 * 逆写像（デスト→ソース）でバイリニアサンプリングを行う。
 *
 * 行列の適用式（canvas-style）:
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 *
 * 逆行列を計算してデスト座標からソース座標を求め、補間する。
 * ソース範囲外のピクセルは透明 (0,0,0,0) になる。
 */
export function affineTransformPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  m: { a: number; b: number; c: number; d: number; e: number; f: number },
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length); // 既定で透明

  // アフィン行列の逆行列を計算
  // | a  c | の逆行列 = 1/det * | d  -c |
  // | b  d |                   | -b  a |
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return out; // 特異行列（変換不能）

  const inv_a = m.d / det;
  const inv_b = -m.b / det;
  const inv_c = -m.c / det;
  const inv_d = m.a / det;
  // 並進部分: 逆行列 * (-e, -f)
  const inv_e = (m.c * m.f - m.d * m.e) / det;
  const inv_f = (m.b * m.e - m.a * m.f) / det;

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      // デスト座標 (dx, dy) をソース座標 (sx, sy) に逆写像
      const sx = inv_a * dx + inv_c * dy + inv_e;
      const sy = inv_b * dx + inv_d * dy + inv_f;

      // バイリニアサンプリング
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      // ソース範囲チェック
      if (x0 < -1 || x1 > width || y0 < -1 || y1 > height) continue;

      const fx = sx - x0; // 小数部（補間ウェイト）
      const fy = sy - y0;

      // 4 隣接ピクセルのサンプリング（境界外は透明とみなす）
      const sample = (px: number, py: number, ch: number): number => {
        if (px < 0 || px >= width || py < 0 || py >= height) return 0;
        return pixels[(py * width + px) * 4 + ch];
      };

      const dstIdx = idx(dx, dy, width);
      for (let ch = 0; ch < 4; ch++) {
        const tl = sample(x0, y0, ch);
        const tr = sample(x1, y0, ch);
        const bl = sample(x0, y1, ch);
        const br = sample(x1, y1, ch);
        // 双線形補間
        const top = tl + (tr - tl) * fx;
        const bot = bl + (br - bl) * fx;
        out[dstIdx + ch] = Math.round(top + (bot - top) * fy);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// スケール + 回転行列の生成
// ---------------------------------------------------------------------------

/**
 * ピボット (cx, cy) を中心とした拡縮・回転の 2D アフィン行列を返す。
 *
 * 変換順序: 平行移動でピボットを原点へ → スケール+回転 → ピボットを戻す。
 *
 * rotation は時計回りのラジアン。
 */
export function scaleRotateMatrix(
  cx: number,
  cy: number,
  scale: number,
  rotation: number,
): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const a = scale * cos;
  const b = scale * sin;
  const c = -scale * sin;
  const d = scale * cos;
  // 並進: pivot を原点に戻す変換を合成
  // T(cx,cy) * R * S * T(-cx,-cy) を展開した e, f
  const e = cx - a * cx - c * cy;
  const f = cy - b * cx - d * cy;
  return { a, b, c, d, e, f };
}
