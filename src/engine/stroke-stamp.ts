/**
 * HIT Paint — tip ストロークの spacing 連打(US-3803)。
 *
 * 既存 StoreStrokeEngine の dab spacing ロジックの tip 版。
 * tip(任意形状アルファ)を spacing 間隔でストローク経路に沿って連打する純粋関数。
 *
 * 既存 engine と同じ歩進ロジック(step = max(0.5, spacing * effSize))を踏襲し、
 * セグメントを traveled で歩進して stampTip を呼ぶ。residual を次セグメントへ
 * 繰り越し、複数回呼び出し(ストローク分割)でも連続描画と一致するよう設計する。
 * angleJitter>0 のときは打点通し番号もずれてはいけないため、戻り値の
 * nextStepIndex を次回呼び出しの stepIndexStart に渡すこと(US-4001)。
 * residual と nextStepIndex の両方を引き継げば、分割呼び出しは一括呼び出しと
 * バイト同一の coverage を生成する。
 *
 * すべて純粋・決定論的(乱数なし。ジッタは seed 付き整数ハッシュ PRNG)。
 * Canvas/DOM に依存しない。
 */

import type { PointerSample } from '../types';
import { stampTip, type TipAlpha } from './tip-stamp';
import { samplePressureCurve, type PressureCurve } from '../io/sut-pressure';

/**
 * seed と step から決定論的に 0..1 未満の値を返す整数ハッシュ(US-3901)。
 *
 * mulberry32 系の 1 ショット版。同じ (seed, step) は必ず同じ値を返す。
 * Math.random は使わない(テストの決定論性のため)。
 */
function hash01(seed: number, step: number): number {
  let h = (seed | 0) ^ Math.imul((step | 0) + 0x6d2b79f5, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * tip スタンプ 1 打点分の回転角を算出する純粋関数(US-3901)。
 *
 * 戻り値 = (followStroke && segmentAngle 指定 ? segmentAngle : 0)
 *        + (baseAngle ?? 0)
 *        + ジッタ(angleJitter>0 のとき seed+step から決定論的に半開区間 [-angleJitter, +angleJitter))。
 */
export function tipStampAngle(opts: {
  /** ストローク進行方向(ラジアン, atan2(dy,dx))。未指定なら方向追従しない。 */
  segmentAngle?: number;
  /** true かつ segmentAngle 指定時のみ進行方向を加える。 */
  followStroke?: boolean;
  /** ブラシ固有の基準角(ラジアン, 既定0)。 */
  baseAngle?: number;
  /** ジッタ振幅(ラジアン, 既定0)。 */
  angleJitter?: number;
  /** ジッタ用 seed(既定1)。 */
  seed?: number;
  /** 打点インデックス(既定0)。seed と合わせてジッタを決定。 */
  step?: number;
}): number {
  const follow =
    opts.followStroke === true && opts.segmentAngle != null ? opts.segmentAngle : 0;
  const base = opts.baseAngle ?? 0;

  const jitterAmp = opts.angleJitter ?? 0;
  let jitter = 0;
  if (jitterAmp > 0) {
    const r = hash01(opts.seed ?? 1, opts.step ?? 0);
    jitter = (r * 2 - 1) * jitterAmp;
  }

  return follow + base + jitter;
}

export interface StampStrokeParams {
  /** 基準サイズ(px, tip の最長辺)。 */
  size: number;
  /** size に対する割合(既存 engine と同じ意味)。 */
  spacing: number;
  /** 0..1 既定 1。 */
  flow?: number;
  /** ラジアン 既定 0。 */
  rotation?: number;
  /** 筆圧→サイズ倍率カーブ。 */
  pressureSize?: PressureCurve | null;
  /** 筆圧→flow 倍率カーブ。 */
  pressureFlow?: PressureCurve | null;
  /** 継続用(既定 0)。前回呼び出しの返り residual を渡す。 */
  residualStart?: number;
  /** true ならストローク進行方向(atan2)を回転に加える(US-3901, 既定 false)。 */
  followStroke?: boolean;
  /** ブラシ固有の基準角(ラジアン, 既定 0)。rotation に加算される。 */
  baseAngle?: number;
  /** 角度ジッタ振幅(ラジアン, 既定 0)。seed+打点番号から決定論的に付与。 */
  angleJitter?: number;
  /** 角度ジッタ用 seed(既定 1)。 */
  seed?: number;
  /**
   * 打点通し番号の開始値(既定 0)。ストロークを分割して呼ぶときに前回の
   * 戻り値 nextStepIndex を渡すと、angleJitter>0 でもジッタ列が一括呼び出しと
   * 一致する(US-4001)。0 のままなら従来挙動と完全同一。
   */
  stepIndexStart?: number;
}

/**
 * tip を spacing 間隔でストローク経路に連打する。
 *
 * - samples 空 → no-op、residual は residualStart のまま返す。
 * - samples 1点(移動なし) → その点に 1 スタンプ。
 * - 各スタンプの筆圧 pr は線形補間。
 *   effSize = size * (pressureSize ? samplePressureCurve(pressureSize, pr) : 1)。
 *   effFlow = (flow??1) * (pressureFlow ? samplePressureCurve(pressureFlow, pr) : 1)。
 * - step = max(0.5, spacing * effSize)。effSize はそのスタンプ点の筆圧から算出。
 * - residual を次セグメントへ繰り越し、最後に { residual, nextStepIndex } を返す。
 *   nextStepIndex は stepIndexStart + 今回の打点数。分割呼び出し時は residual と
 *   合わせて次回へ渡すこと(US-4001)。
 */
export function stampStroke(
  coverage: Float32Array,
  cw: number,
  ch: number,
  tip: TipAlpha,
  samples: PointerSample[],
  params: StampStrokeParams,
): { residual: number; nextStepIndex: number } {
  const size = params.size;
  const spacing = params.spacing;
  const baseFlow = params.flow ?? 1;
  const rotation = params.rotation ?? 0;
  const pressureSize = params.pressureSize ?? null;
  const pressureFlow = params.pressureFlow ?? null;

  let residual = params.residualStart ?? 0;

  // 打点通し番号(全セグメント通算)。角度ジッタの決定論に使う(US-3901)。
  // 分割呼び出し時は stepIndexStart で前回からの続きを指定できる(US-4001)。
  let stepIndex = params.stepIndexStart ?? 0;

  if (samples.length === 0) {
    return { residual, nextStepIndex: stepIndex };
  }

  // 指定筆圧でのスタンプを 1 発打つ。segmentAngle はそのセグメントの進行方向
  // (atan2(dy,dx))。単一サンプル時など方向が無いときは undefined。
  const stampAt = (x: number, y: number, pr: number, segmentAngle?: number): number => {
    const effSize = size * (pressureSize ? samplePressureCurve(pressureSize, pr) : 1);
    const effFlow = baseFlow * (pressureFlow ? samplePressureCurve(pressureFlow, pr) : 1);
    // 従来の rotation に方向追従/基準角/ジッタを加算する。新オプション未指定なら
    // tipStampAngle は 0 を返し、従来(rotation のみ)と完全に同一結果になる。
    const effRotation =
      rotation +
      tipStampAngle({
        segmentAngle,
        followStroke: params.followStroke,
        baseAngle: params.baseAngle,
        angleJitter: params.angleJitter,
        seed: params.seed,
        step: stepIndex,
      });
    stepIndex += 1;
    stampTip(coverage, cw, ch, tip, { x, y, size: effSize, rotation: effRotation, flow: effFlow });
    return effSize;
  };

  // 単一サンプル(移動なし) → その点に 1 スタンプ(方向なし)。
  if (samples.length === 1) {
    const s = samples[0];
    stampAt(s.x, s.y, s.pressure ?? 0);
    return { residual, nextStepIndex: stepIndex };
  }

  // 各セグメントを spacing 間隔で歩進する。
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);

    if (segLen <= 0) {
      // 移動なしセグメントはスキップ(residual はそのまま)。
      continue;
    }

    const ux = dx / segLen;
    const uy = dy / segLen;
    // このセグメントの進行方向(方向追従回転に使う)。
    const segmentAngle = Math.atan2(dy, dx);

    // セグメント内を traveled で歩進。residual はセグメント先頭までの距離余り。
    let traveled = residual;
    while (traveled <= segLen) {
      // この打点の補間位置と筆圧。
      const t = traveled / segLen;
      const x = a.x + ux * traveled;
      const y = a.y + uy * traveled;
      const pr = (a.pressure ?? 0) + ((b.pressure ?? 0) - (a.pressure ?? 0)) * t;

      const effSize = stampAt(x, y, pr, segmentAngle);
      const step = Math.max(0.5, spacing * effSize);
      traveled += step;
    }

    // セグメントを越えた分を次セグメントへ繰り越す。
    residual = traveled - segLen;
  }

  return { residual, nextStepIndex: stepIndex };
}
