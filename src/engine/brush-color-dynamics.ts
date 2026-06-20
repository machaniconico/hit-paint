/**
 * HIT Paint — ブラシ カラーダイナミクス (US-4401)。
 *
 * 1打点ごとに前景色を HSV 空間で決定論的にジッタさせ、さらに前景/背景の
 * 線形ブレンドを混ぜることで、手描き的な色のばらつき(色相揺らぎ・彩度/明度の
 * ゆらぎ・前景背景の混色)を作る。Photoshop の「カラーの変化(ジッター)」相当。
 *
 * 乱数は組み込み Math.random() を一切使わず、seed + step + チャンネル salt から
 * 整数ハッシュで生成する(同入力 → 必ず同出力)。step を変えれば打点ごとに
 * 決定論的に色が変わる。canvas/DOM 非依存の純粋関数。
 *
 * 後方互換: 全ジッタ 0 かつ fgBgJitter 0 のとき、入力 base をバイト同一で返す
 * (HSV 往復による微小誤差すら起こさないよう、振幅0なら早期 return する)。
 */

import { rgbToHsv, hsvToRgb } from '../color/color';
import type { RGBA } from '../types';

/**
 * カラーダイナミクス設定。各値 0..1。
 * - hueJitter:   色相を ±hueJitter*180°(=最大全周片側180°)振る度合い。
 * - satJitter:   彩度を ±satJitter 振る度合い(HSV s, 0..1 クランプ)。
 * - valueJitter: 明度を ±valueJitter 振る度合い(HSV v, 0..1 クランプ)。
 * - fgBgJitter:  前景(base)と背景(opts.bg)を混ぜる最大混合率。
 */
export interface ColorDynamicsConfig {
  hueJitter: number;
  satJitter: number;
  valueJitter: number;
  fgBgJitter: number;
}

/** applyColorDynamics の追加オプション。 */
export interface ColorDynamicsOpts {
  /**
   * 筆圧 0..1(既定1)。低いほどジッタ振幅と fgBg 混合率を弱める
   * (pressure を係数として全ジッタ・混合へ乗算する。pressure=1 で従来どおり)。
   */
  pressure?: number;
  /** 背景色。fgBgJitter>0 のときのみ使用。未指定ならブレンドしない。 */
  bg?: RGBA;
}

/** 0..1 にクランプ。 */
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * seed/step/salt を avalanche 撹拌して 0..1 未満の決定論 float を返す。
 * salt でチャンネル(hue/sat/value/blend)ごとに独立な乱数列を得る。
 * tip-scatter.ts の mixSeed と同系の整数ハッシュ。
 */
function hash01(seed: number, step: number, salt: number): number {
  let state =
    (Math.imul(seed | 0, 0x9e3779b9) ^
      Math.imul((step | 0) + 1, 0x85ebca6b) ^
      Math.imul((salt | 0) + 1, 0xc2b2ae35)) |
    0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b);
  state ^= state >>> 16;
  return (state >>> 0) / 0x100000000;
}

/** hash01 を [-1,1) の対称乱数へ写す。 */
function signed(seed: number, step: number, salt: number): number {
  return hash01(seed, step, salt) * 2 - 1;
}

// チャンネルごとの salt(衝突しない任意の固定値)。
const SALT_HUE = 0x11;
const SALT_SAT = 0x22;
const SALT_VAL = 0x33;
const SALT_BLEND = 0x44;

/**
 * base 色に決定論的なカラーダイナミクスを適用して返す。
 *
 * 手順:
 *  1. 全振幅が 0(hue/sat/value/fgBg いずれも 0)なら base をコピーして即返す
 *     → 後方互換でバイト同一を保証。
 *  2. base を HSV へ変換し、
 *     - h += signed * hueJitter * 180 * p  → (h%360+360)%360 で循環。
 *     - s += signed * satJitter * p         → 0..1 クランプ。
 *     - v += signed * valueJitter * p       → 0..1 クランプ。
 *     (p = pressure, 既定1。各チャンネルは独立 salt の符号付き乱数。)
 *  3. HSV→RGB に戻す。
 *  4. fgBgJitter>0 かつ bg があれば、混合率
 *        mix = u * fgBgJitter * p   (u = hash01(blend) の 0..1 一様乱数)
 *     で out = out*(1-mix) + bg*mix を各 RGB チャンネルに適用(線形ブレンド)。
 *     mix=0 で前景、mix=1 で背景。端(fgBgJitter=1, p=1, u→1)で背景へ最大限寄る。
 *  5. α は常に base.a を保持。
 *
 * 決定論: 同 (seed, step) は同出力。step を変えると各 salt 経由で色が変わる。
 */
export function applyColorDynamics(
  base: RGBA,
  cfg: ColorDynamicsConfig,
  seed: number,
  step: number,
  opts?: ColorDynamicsOpts,
): RGBA {
  const hueJitter = Number.isFinite(cfg.hueJitter) ? cfg.hueJitter : 0;
  const satJitter = Number.isFinite(cfg.satJitter) ? cfg.satJitter : 0;
  const valueJitter = Number.isFinite(cfg.valueJitter) ? cfg.valueJitter : 0;
  const fgBgJitter = Number.isFinite(cfg.fgBgJitter) ? cfg.fgBgJitter : 0;

  // 後方互換: 全振幅0 → base をバイト同一でコピー(HSV 往復誤差を回避)。
  if (hueJitter === 0 && satJitter === 0 && valueJitter === 0 && fgBgJitter === 0) {
    return { r: base.r, g: base.g, b: base.b, a: base.a };
  }

  const p = clamp01(opts?.pressure ?? 1);

  // --- HSV ジッタ ---
  const hsv = rgbToHsv(base);
  let h = hsv.h;
  let s = hsv.s;
  let v = hsv.v;

  if (hueJitter !== 0) {
    h += signed(seed, step, SALT_HUE) * hueJitter * 180 * p;
    h = ((h % 360) + 360) % 360; // 0..360 へ循環 wrap。
  }
  if (satJitter !== 0) {
    s = clamp01(s + signed(seed, step, SALT_SAT) * satJitter * p);
  }
  if (valueJitter !== 0) {
    v = clamp01(v + signed(seed, step, SALT_VAL) * valueJitter * p);
  }

  const rgb = hsvToRgb({ h, s, v });
  let r = rgb.r;
  let g = rgb.g;
  let b = rgb.b;

  // --- 前景/背景ブレンド ---
  const bg = opts?.bg;
  if (fgBgJitter > 0 && bg) {
    const u = hash01(seed, step, SALT_BLEND); // 0..1 一様。
    const mix = clamp01(u * fgBgJitter * p);
    r = r * (1 - mix) + bg.r * mix;
    g = g * (1 - mix) + bg.g * mix;
    b = b * (1 - mix) + bg.b * mix;
  }

  return {
    r: Math.round(clamp01(r / 255) * 255),
    g: Math.round(clamp01(g / 255) * 255),
    b: Math.round(clamp01(b / 255) * 255),
    a: base.a,
  };
}
