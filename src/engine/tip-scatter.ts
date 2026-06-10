/**
 * HIT Paint — tip スキャッタ(散布)/スプレー (US-3902)。
 *
 * tip スタンプを打点中心の周囲へ決定論的に散布し、スプレー/チョーク的な
 * 粒状の描き味を作る。乱数は組み込み random() を使わず、seed 付き
 * 整数ハッシュ PRNG のみで生成する(同入力 → 必ず同出力)。
 *
 * すべて純粋配列(Float32Array)操作のみで完結し、canvas/DOM に依存しない。
 */

import { stampTip } from './tip-stamp';
import type { TipAlpha } from './tip-stamp';

/** 散布オフセット(打点中心からの相対 px)。 */
export interface ScatterOffset {
  dx: number;
  dy: number;
}

/** seed を avalanche 撹拌して初期状態を作る(brush-texture.ts と同系)。 */
function mixSeed(seed: number): number {
  let state = Number.isFinite(seed) ? seed | 0 : 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b);
  state ^= state >>> 16;
  return (state || 0x9e3779b9) >>> 0;
}

/** xorshift32 ベースの決定論 PRNG。0..1 未満の float を返す。 */
function createPrng(seed: number): () => number {
  let state = mixSeed(seed);

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

/**
 * count 個の散布オフセットを seed から決定論的に生成する。
 *
 * - 半径 radius の円盤内に面積一様分布(角度=2πu, 半径=radius*sqrt(u))。
 * - radius<=0 または count<=1 のときは [{dx:0,dy:0}] を1個返す(散布なし)。
 * - 同 seed+count+radius → 必ず同じ配列。
 */
export function scatterOffsets(seed: number, count: number, radius: number): ScatterOffset[] {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  const r = Number.isFinite(radius) ? radius : 0;

  // 散布なし条件: 中心1点のみ。
  if (r <= 0 || n <= 1) {
    return [{ dx: 0, dy: 0 }];
  }

  const nextFloat = createPrng(seed);
  const offsets: ScatterOffset[] = [];

  for (let i = 0; i < n; i += 1) {
    // 面積一様: r = radius * sqrt(u)。角度は 0..2π 一様。
    const angle = nextFloat() * Math.PI * 2;
    const dist = r * Math.sqrt(nextFloat());
    offsets.push({
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
    });
  }

  return offsets;
}

/** stampScatteredTip のオプション。 */
export interface ScatteredTipOptions {
  x: number;
  y: number;
  size: number;
  /** tip の回転(ラジアン, 既定0)。散布スタンプ全てに同じ回転を適用。 */
  rotation?: number;
  /** 不透明度係数(0..1, 既定1)。 */
  flow?: number;
  /** 散布半径(px, 既定0)。0 以下なら散布しない。 */
  scatter?: number;
  /** 散布数(既定1)。1 以下なら散布しない。 */
  density?: number;
  /** 散布 PRNG の seed(既定0)。 */
  seed?: number;
  /** ストローク内の打点番号(既定0)。seed と組み合わせて打点ごとに散布を変える。 */
  step?: number;
}

/**
 * tip を coverage バッファへ散布スタンプする。
 *
 * - scatter>0 かつ density>1 のとき、scatterOffsets で density 個の
 *   オフセットを生成し、各位置へ stampTip する(max-combine/境界クリップは
 *   stampTip 側で担保)。
 * - そうでなければ (x,y) に1回だけスタンプ(従来の stampTip と同等)。
 * - seed/step から散布が決定論的に決まる(同入力 → 同 coverage)。
 */
export function stampScatteredTip(
  coverage: Float32Array,
  cw: number,
  ch: number,
  tip: TipAlpha,
  opts: ScatteredTipOptions,
): void {
  const { x, y, size } = opts;
  const rotation = opts.rotation ?? 0;
  const flow = opts.flow ?? 1;
  const scatter = opts.scatter ?? 0;
  const density = opts.density ?? 1;
  const seed = opts.seed ?? 0;
  const step = opts.step ?? 0;

  // 散布条件を満たさなければ従来同等の単発スタンプ。
  if (scatter <= 0 || density <= 1) {
    stampTip(coverage, cw, ch, tip, { x, y, size, rotation, flow });
    return;
  }

  // seed と step を整数ハッシュで合成し、打点ごとに散布パターンを変える。
  const stepSeed = (Math.imul(seed | 0, 0x9e3779b9) ^ Math.imul((step | 0) + 1, 0x85ebca6b)) | 0;
  const offsets = scatterOffsets(stepSeed, density, scatter);

  for (const { dx, dy } of offsets) {
    stampTip(coverage, cw, ch, tip, { x: x + dx, y: y + dy, size, rotation, flow });
  }
}
