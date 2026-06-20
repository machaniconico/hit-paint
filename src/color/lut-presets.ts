/**
 * HIT Paint — 組み込み 3D LUT プリセットの手続き生成 (US-4303)。
 *
 * 各プリセットは「ノードの正規化色 {r,g,b}(0..1)を受け取り変換後の色を返す純粋関数」
 * (transform)を generateLut に渡して手続き的に構築する。LUT データを静的に持たず関数から
 * 生成するため、任意の size で同じトーンカーブを再現でき、テーブルの保守も不要。
 *
 * 【インデックス規約】src/color/lut.ts の Lut3D と完全一致させる:
 *   offset = ((bi * size + gi) * size + ri) * 3   (R 最速・blue 最外、.cube 規約)
 * identityLut と同じ三重ループ順でノードを列挙するため、generateLut(size, 恒等変換) は
 * identityLut(size) と data がビット一致する。
 *
 * 設計判断:
 * - 変換関数は入力 0..1 / 出力 0..1 を約束する単調(あるいは区分単調)な写像とし、
 *   トーンカーブとして破綻しないようにする。data は clamp01 で 0..1 に収める。
 * - 決定論厳守: Date.now()/Math.random() を一切使わない。
 * - jsdom では canvas API が使えないため、本ファイルは純粋な配列ロジックのみで構成し
 *   テストから data を直接検証できるようにする(他 wave と同じ作法)。
 */

import type { Lut3D } from '../color/lut';

/** プリセットの既定分割数。中間調のカーブ表現と LUT サイズのバランスで 17 を採用。 */
export const DEFAULT_LUT_SIZE = 17;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Rec.709 系の知覚輝度(0..1 入力 → 0..1 輝度)。 */
function luma({ r, g, b }: { r: number; g: number; b: number }): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * ノード (ri, gi, bi) の data 先頭オフセット。lut.ts の nodeOffset と同一規約。
 */
function nodeOffset(size: number, ri: number, gi: number, bi: number): number {
  return ((bi * size + gi) * size + ri) * 3;
}

/**
 * 変換関数 transform から 3D LUT を手続き生成する。
 *
 * 各格子ノード (ri, gi, bi) の正規化色 (ri/(size-1), gi/(size-1), bi/(size-1)) に transform を
 * 適用し、結果を 0..1 にクランプして data へ書き込む。ループ順・オフセット規約は
 * identityLut と一致するため、transform が恒等なら identityLut(size) と data が一致する。
 *
 * @param size 各軸の分割数(>=2 の整数)。
 * @param transform 正規化ノード色 → 変換後色 の純粋関数。
 */
export function generateLut(
  size: number,
  transform: (rgb: { r: number; g: number; b: number }) => {
    r: number;
    g: number;
    b: number;
  },
): Lut3D {
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`generateLut: size は 2 以上の整数が必要です (受領: ${size})`);
  }
  const data = new Float32Array(size * size * size * 3);
  const denom = size - 1;
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const out = transform({
          r: ri / denom,
          g: gi / denom,
          b: bi / denom,
        });
        const o = nodeOffset(size, ri, gi, bi);
        data[o] = clamp01(out.r);
        data[o + 1] = clamp01(out.g);
        data[o + 2] = clamp01(out.b);
      }
    }
  }
  return { size, data };
}

// ---------------------------------------------------------------------------
// 個別の変換関数(純粋・決定論)。いずれも 0..1 入力 → 0..1 近傍出力。
// ---------------------------------------------------------------------------

/** 暖色シフト: R を上げ B を下げる。中間グレーで R>B になる加算オフセット方式。 */
export function warmTransform(rgb: {
  r: number;
  g: number;
  b: number;
}): { r: number; g: number; b: number } {
  const SHIFT = 0.08;
  return {
    r: clamp01(rgb.r + SHIFT),
    g: rgb.g,
    b: clamp01(rgb.b - SHIFT),
  };
}

/** 寒色シフト: B を上げ R を下げる。中間グレーで B>R になる。warm の鏡映。 */
export function coolTransform(rgb: {
  r: number;
  g: number;
  b: number;
}): { r: number; g: number; b: number } {
  const SHIFT = 0.08;
  return {
    r: clamp01(rgb.r - SHIFT),
    g: rgb.g,
    b: clamp01(rgb.b + SHIFT),
  };
}

/**
 * セピア調: 入力輝度を基準に茶系へ着色する。
 * グレースケール輝度 y を取り、温かみのある係数(R>G>B)で色付けする古典的セピア行列の近似。
 */
export function sepiaTransform(rgb: {
  r: number;
  g: number;
  b: number;
}): { r: number; g: number; b: number } {
  const y = luma(rgb);
  // R>G>B の係数で茶系に。係数は 0..1 出力を保つよう調整。
  return {
    r: clamp01(y * 1.07 + 0.05),
    g: clamp01(y * 0.92 + 0.02),
    b: clamp01(y * 0.66),
  };
}

/**
 * S 字トーン: 中間調を保ちつつ両端を引き締めるコントラスト強調。
 * smoothstep の連続強調版(各チャンネル独立)。0→0, 1→1 を厳密に保ち、単調増加。
 * 中間 0.5 付近の傾きが線形(=1)より急になる。
 */
export function contrastSTransform(rgb: {
  r: number;
  g: number;
  b: number;
}): { r: number; g: number; b: number } {
  return {
    r: sCurve(rgb.r),
    g: sCurve(rgb.g),
    b: sCurve(rgb.b),
  };
}

/**
 * 1 次元 S 字カーブ。smoothstep x^2(3-2x) を線形成分とブレンドし、
 * 端点固定(0→0,1→1)・単調増加・中央付近で線形超えの傾きを満たす。
 */
function sCurve(x: number): number {
  const t = clamp01(x);
  const smooth = t * t * (3 - 2 * t); // smoothstep: 0→0,1→1,端で平坦・中央急
  const STRENGTH = 0.6; // 0=線形, 1=純 smoothstep。0.6 で中央の傾き>1 を確保。
  return clamp01(t * (1 - STRENGTH) + smooth * STRENGTH);
}

/** モノクロ: 輝度グレースケール。R=G=B となる。 */
export function monochromeTransform(rgb: {
  r: number;
  g: number;
  b: number;
}): { r: number; g: number; b: number } {
  const y = clamp01(luma(rgb));
  return { r: y, g: y, b: y };
}

// ---------------------------------------------------------------------------
// プリセットレジストリ。size 省略時は DEFAULT_LUT_SIZE。
// ---------------------------------------------------------------------------

/** size を受け取り対応するプリセット LUT を生成するファクトリ。 */
export type LutPresetFactory = (size?: number) => Lut3D;

/** 組み込み LUT プリセット名 → 生成関数。 */
export const LUT_PRESETS: Record<string, LutPresetFactory> = {
  warm: (size = DEFAULT_LUT_SIZE) => generateLut(size, warmTransform),
  cool: (size = DEFAULT_LUT_SIZE) => generateLut(size, coolTransform),
  sepia: (size = DEFAULT_LUT_SIZE) => generateLut(size, sepiaTransform),
  contrastS: (size = DEFAULT_LUT_SIZE) => generateLut(size, contrastSTransform),
  monochrome: (size = DEFAULT_LUT_SIZE) =>
    generateLut(size, monochromeTransform),
};

/** 組み込みプリセット名のユニオン型。 */
export type LutPresetName = keyof typeof LUT_PRESETS;

/** 全プリセット名(UI のドロップダウン列挙などに使用)。 */
export const LUT_PRESET_NAMES = Object.keys(LUT_PRESETS) as LutPresetName[];
