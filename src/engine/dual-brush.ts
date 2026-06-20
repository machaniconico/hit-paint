/**
 * HIT Paint — デュアルブラシ(二次テクスチャによる α 変調)(US-4402)。
 *
 * 主ブラシのアルファ形状(primaryAlpha)に対し、二次テクスチャ(secondary)を
 * 各画素でブレンドして「掠れ」「テクスチャ感」を与える純粋関数群。
 * Photoshop の "デュアルブラシ" 相当: 主スタンプのαを二次パターンで間引く/強める。
 *
 * すべて純粋配列(Float32Array)操作のみで完結し、canvas/DOM に依存しない。
 * 決定論: 乱数を一切使わず、入力のみから出力が一意に定まる。
 */

/**
 * 二次テクスチャと主αの合成方法。
 * - 'multiply': combined = a*s — 二次が暗い(s小)所で主αを削る(掠れ)。
 * - 'subtract': combined = clamp01(a - s) — 二次の値だけ主αを引く(より強い間引き)。
 * - 'min'     : combined = min(a, s) — 二次でαに上限(マスク)をかける。
 * - 'screen'  : combined = 1-(1-a)(1-s) — 二次が明るい所で主αを足す(盛る)。
 */
export type DualBlendMode = 'multiply' | 'subtract' | 'min' | 'screen';

/** 0..1 にクランプ。 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 主αと二次サンプル s を mode に従って合成(結果は 0..1)。 */
function blend(a: number, s: number, mode: DualBlendMode): number {
  switch (mode) {
    case 'multiply':
      return a * s;
    // subtract は採用式として「a - s」を 0..1 クランプ(a*(1-s) ではなく差分式)。
    case 'subtract':
      return clamp01(a - s);
    case 'min':
      return a < s ? a : s;
    case 'screen':
      return 1 - (1 - a) * (1 - s);
    default: {
      // 未知モードは安全側で主αを素通し(網羅性チェック用)。
      const _never: never = mode;
      void _never;
      return a;
    }
  }
}

/**
 * 主ブラシのαを二次テクスチャで変調した「新しい」Float32Array を返す(非破壊)。
 * primaryAlpha は一切変更しない。
 *
 * 各画素 i(座標 x,y)について:
 *   a = primaryAlpha[i]
 *   s = 二次テクスチャのサンプル値(0..1)
 *   combined = blend(a, s, mode)
 *   out = a + (combined - a) * clamp01(strength)
 * を計算し、最終的に 0..1 へクランプする。
 *
 * - strength=0 のとき out===a(primary と全要素一致。ただし返り値は新配列)。
 * - strength=1 のとき out===combined(完全に合成結果)。
 *
 * 二次が主と異寸法の場合のサンプリング規則(タイル / wrap):
 *   sx = x % secondaryWidth, sy = y % secondaryHeight で参照する(繰り返しタイル)。
 *   secondaryWidth/Height が主より小さくても大きくても同じ規則。決定論。
 *   secondary の長さは secondaryWidth*secondaryHeight 前提(行優先 row-major)。
 *
 * @param primaryAlpha 主ブラシα(length=width*height、各 0..1)。変更しない。
 * @param width        主αの幅。
 * @param height       主αの高さ。
 * @param secondary    二次テクスチャ(length=secondaryWidth*secondaryHeight、各 0..1)。
 * @param secondaryWidth  二次テクスチャの幅。
 * @param secondaryHeight 二次テクスチャの高さ。
 * @param mode         合成方法。
 * @param strength     変調の強さ(0..1 にクランプ)。0=無変調、1=完全合成。
 * @returns 変調後の新しい Float32Array(length=width*height、各 0..1)。
 */
export function applyDualBrush(
  primaryAlpha: Float32Array,
  width: number,
  height: number,
  secondary: Float32Array,
  secondaryWidth: number,
  secondaryHeight: number,
  mode: DualBlendMode,
  strength: number,
): Float32Array {
  const count = width * height;
  const out = new Float32Array(count);
  const t = clamp01(strength);

  // secondaryWidth/Height が 0 以下だと wrap で 0 除算になるため、その場合は
  // 二次を無効化し primary をそのまま複製する(防御的・決定論)。
  const sw = secondaryWidth;
  const sh = secondaryHeight;
  if (sw <= 0 || sh <= 0 || secondary.length === 0) {
    out.set(primaryAlpha.subarray(0, count));
    return out;
  }

  for (let y = 0; y < height; y += 1) {
    const sy = y % sh;
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const a = primaryAlpha[i];
      const sx = x % sw;
      const s = secondary[sy * sw + sx];
      const combined = blend(a, s, mode);
      out[i] = clamp01(a + (combined - a) * t);
    }
  }

  return out;
}
