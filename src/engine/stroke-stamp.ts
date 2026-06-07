/**
 * HIT Paint — tip ストロークの spacing 連打(US-3803)。
 *
 * 既存 StoreStrokeEngine の dab spacing ロジックの tip 版。
 * tip(任意形状アルファ)を spacing 間隔でストローク経路に沿って連打する純粋関数。
 *
 * 既存 engine と同じ歩進ロジック(step = max(0.5, spacing * effSize))を踏襲し、
 * セグメントを traveled で歩進して stampTip を呼ぶ。residual を次セグメントへ
 * 繰り越し、複数回呼び出し(ストローク分割)でも連続描画と一致するよう設計する。
 *
 * すべて純粋・決定論的(乱数なし)。Canvas/DOM に依存しない。
 */

import type { PointerSample } from '../types';
import { stampTip, type TipAlpha } from './tip-stamp';
import { samplePressureCurve, type PressureCurve } from '../io/sut-pressure';

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
 * - residual を次セグメントへ繰り越し、最後に { residual } を返す。
 */
export function stampStroke(
  coverage: Float32Array,
  cw: number,
  ch: number,
  tip: TipAlpha,
  samples: PointerSample[],
  params: StampStrokeParams,
): { residual: number } {
  const size = params.size;
  const spacing = params.spacing;
  const baseFlow = params.flow ?? 1;
  const rotation = params.rotation ?? 0;
  const pressureSize = params.pressureSize ?? null;
  const pressureFlow = params.pressureFlow ?? null;

  let residual = params.residualStart ?? 0;

  if (samples.length === 0) {
    return { residual };
  }

  // 指定筆圧でのスタンプを 1 発打つ。
  const stampAt = (x: number, y: number, pr: number): number => {
    const effSize = size * (pressureSize ? samplePressureCurve(pressureSize, pr) : 1);
    const effFlow = baseFlow * (pressureFlow ? samplePressureCurve(pressureFlow, pr) : 1);
    stampTip(coverage, cw, ch, tip, { x, y, size: effSize, rotation, flow: effFlow });
    return effSize;
  };

  // 単一サンプル(移動なし) → その点に 1 スタンプ。
  if (samples.length === 1) {
    const s = samples[0];
    stampAt(s.x, s.y, s.pressure ?? 0);
    return { residual };
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

    // セグメント内を traveled で歩進。residual はセグメント先頭までの距離余り。
    let traveled = residual;
    while (traveled <= segLen) {
      // この打点の補間位置と筆圧。
      const t = traveled / segLen;
      const x = a.x + ux * traveled;
      const y = a.y + uy * traveled;
      const pr = (a.pressure ?? 0) + ((b.pressure ?? 0) - (a.pressure ?? 0)) * t;

      const effSize = stampAt(x, y, pr);
      const step = Math.max(0.5, spacing * effSize);
      traveled += step;
    }

    // セグメントを越えた分を次セグメントへ繰り越す。
    residual = traveled - segLen;
  }

  return { residual };
}
