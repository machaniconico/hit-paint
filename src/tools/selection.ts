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

function cloneSelection(sel: Selection): Selection {
  return {
    mask: new Uint8ClampedArray(sel.mask),
    width: sel.width,
    height: sel.height,
  };
}

function normalizeRadius(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  return Math.floor(radius);
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
// 選択範囲の精製
// ---------------------------------------------------------------------------

/** 8 近傍（チェビシェフ距離 radius）で選択範囲を膨張する。 */
export function growSelection(sel: Selection, radius: number): Selection {
  const r = normalizeRadius(radius);
  if (r === 0) return cloneSelection(sel);

  const { width, height } = sel;
  const mask = makeMask(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0;
      for (let dy = -r; dy <= r && max < 255; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const sx = x + dx;
          if (sx < 0 || sx >= width) continue;
          const value = sel.mask[sy * width + sx];
          if (value > max) {
            max = value;
            if (max === 255) break;
          }
        }
      }
      mask[y * width + x] = max;
    }
  }

  return { mask, width, height };
}

/** 8 近傍（チェビシェフ距離 radius）で選択範囲を収縮する。 */
export function shrinkSelection(sel: Selection, radius: number): Selection {
  const r = normalizeRadius(radius);
  if (r === 0) return cloneSelection(sel);

  const { width, height } = sel;
  const mask = makeMask(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 255;
      for (let dy = -r; dy <= r && min > 0; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= height) {
          min = 0;
          break;
        }
        for (let dx = -r; dx <= r; dx++) {
          const sx = x + dx;
          if (sx < 0 || sx >= width) {
            min = 0;
            break;
          }
          const value = sel.mask[sy * width + sx];
          if (value < min) min = value;
        }
      }
      mask[y * width + x] = min;
    }
  }

  return { mask, width, height };
}

/** 分離可能ボックスぼかしで選択範囲をフェザーする。 */
export function featherSelection(sel: Selection, radius: number): Selection {
  const r = normalizeRadius(radius);
  if (r === 0) return cloneSelection(sel);

  const { width, height } = sel;
  const kernelSize = r * 2 + 1;
  const temp = new Float64Array(width * height);
  const mask = makeMask(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dx = -r; dx <= r; dx++) {
        const sx = x + dx;
        if (sx >= 0 && sx < width) {
          sum += sel.mask[y * width + sx];
        }
      }
      temp[y * width + x] = sum / kernelSize;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) {
        const sy = y + dy;
        if (sy >= 0 && sy < height) {
          sum += temp[sy * width + x];
        }
      }
      mask[y * width + x] = sum / kernelSize;
    }
  }

  return { mask, width, height };
}

// ---------------------------------------------------------------------------
// 選択範囲の合成
// ---------------------------------------------------------------------------

export type SelectionCombineMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** 2 つの選択範囲を指定モードで合成する。 */
export function combineSelection(
  a: Selection,
  b: Selection,
  mode: SelectionCombineMode,
): Selection {
  if (a.width !== b.width || a.height !== b.height) {
    return cloneSelection(a);
  }

  if (mode === 'replace') {
    return cloneSelection(b);
  }

  const mask = makeMask(a.width, a.height);
  for (let i = 0; i < mask.length; i++) {
    const av = a.mask[i];
    const bv = b.mask[i];
    switch (mode) {
      case 'add':
        mask[i] = Math.max(av, bv);
        break;
      case 'subtract':
        mask[i] = Math.min(av, 255 - bv);
        break;
      case 'intersect':
        mask[i] = Math.min(av, bv);
        break;
      default:
        mask[i] = av;
        break;
    }
  }

  return { mask, width: a.width, height: a.height };
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
