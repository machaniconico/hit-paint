/**
 * HIT Paint — 選択ツール
 *
 * 選択範囲の生成・操作ユーティリティ。
 * Selection.mask は 0=未選択 / 255=完全選択 の 8-bit グレースケール（幅×高さ）。
 */

import type { Selection } from '../types';

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function makeMask(width: number, height: number, fill = 0): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  if (fill !== 0) mask.fill(fill);
  return mask;
}

// ---------------------------------------------------------------------------
// 全選択
// ---------------------------------------------------------------------------

/** キャンバス全体を選択する。 */
export function selectAll(width: number, height: number): Selection {
  return { mask: makeMask(width, height, 255), width, height };
}

// ---------------------------------------------------------------------------
// 矩形選択
// ---------------------------------------------------------------------------

/**
 * 矩形選択。(x0,y0)-(x1,y1) の内側を 255、外側を 0 にする。
 * 座標は正規化（順序不問）される。
 */
export function rectSelection(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Selection {
  const mask = makeMask(width, height);
  const left = Math.max(0, Math.min(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const right = Math.min(width, Math.max(x0, x1));
  const bottom = Math.min(height, Math.max(y0, y1));

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      mask[y * width + x] = 255;
    }
  }
  return { mask, width, height };
}

// ---------------------------------------------------------------------------
// ラッソ（多角形）選択 — 偶奇ルール
// ---------------------------------------------------------------------------

/**
 * 多角形の頂点リストからラッソ選択を生成する。
 * 偶奇ルール（even-odd）でポリゴン内側のピクセルを 255 にする。
 *
 * アルゴリズム: 各ピクセルの中心 (px+0.5, py+0.5) から右方向へ
 * 水平レイを飛ばし、ポリゴン辺との交差回数が奇数なら内側と判定する。
 */
export function lassoSelection(
  width: number,
  height: number,
  points: { x: number; y: number }[],
): Selection {
  const mask = makeMask(width, height);
  if (points.length < 3) return { mask, width, height };

  const n = points.length;

  for (let py = 0; py < height; py++) {
    const cy = py + 0.5; // ピクセル中心の y 座標

    // 行ごとに x 座標の交差点を集めてソートし、偶奇ルールで塗る
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const ay = a.y;
      const by = b.y;
      // 辺が cy をまたいでいる場合のみ（端点の重複を避けるため半開区間）
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
        const t = (cy - ay) / (by - ay);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);

    // 偶奇塗りつぶし: [xs[0]..xs[1]], [xs[2]..xs[3]], ...
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Half-open span [xs[k], xs[k+1]): ceil on both ends so an edge that
      // crosses exactly on an integer x does not over-fill by one column.
      const startX = Math.max(0, Math.ceil(xs[k]));
      const endX = Math.min(width, Math.ceil(xs[k + 1]));
      for (let px = startX; px < endX; px++) {
        mask[py * width + px] = 255;
      }
    }
  }
  return { mask, width, height };
}

// ---------------------------------------------------------------------------
// 選択反転
// ---------------------------------------------------------------------------

/** 選択範囲を反転する（255 → 0、0 → 255）。 */
export function invertSelection(sel: Selection): Selection {
  const mask = new Uint8ClampedArray(sel.mask.length);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = 255 - sel.mask[i];
  }
  return { mask, width: sel.width, height: sel.height };
}

// ---------------------------------------------------------------------------
// 空判定
// ---------------------------------------------------------------------------

/** 選択範囲が空（すべて 0）かどうかを返す。 */
export function isEmpty(sel: Selection): boolean {
  for (let i = 0; i < sel.mask.length; i++) {
    if (sel.mask[i] > 0) return false;
  }
  return true;
}
