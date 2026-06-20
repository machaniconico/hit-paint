import type { Layer } from '../types';
import type { Frame } from './timeline';

/**
 * Wave40 US-4201 — アニメ補間: イージング関数群 + キーフレーム中割り(tween)。
 *
 * 設計判断:
 * - イージング関数は全て (t:number)=>number で定義域 t∈[0,1]。f(0)=0, f(1)=1 を満たす
 *   (back 系は途中でオーバーシュート/アンダーシュートするが端点は厳密に 0/1)。
 * - 決定論厳守: Date.now()/Math.random() は使わない。純粋な数式のみ。
 * - tween 系は元の Frame/Layer を一切変更しない(layers をディープ複製して返す)。
 */

/** 線形(イージング無し)。 */
export function easeLinear(t: number): number {
  return t;
}

// --- Quad (2次) ---
export function easeInQuad(t: number): number {
  return t * t;
}
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// --- Cubic (3次) ---
export function easeInCubic(t: number): number {
  return t * t * t;
}
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// --- Sine (正弦) ---
export function easeInSine(t: number): number {
  return 1 - Math.cos((t * Math.PI) / 2);
}
export function easeOutSine(t: number): number {
  return Math.sin((t * Math.PI) / 2);
}
export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// --- Back (オーバーシュート) ---
const BACK_C1 = 1.70158;
const BACK_C2 = BACK_C1 * 1.525;
const BACK_C3 = BACK_C1 + 1;

export function easeInBack(t: number): number {
  return BACK_C3 * t * t * t - BACK_C1 * t * t;
}
export function easeOutBack(t: number): number {
  return 1 + BACK_C3 * Math.pow(t - 1, 3) + BACK_C1 * Math.pow(t - 1, 2);
}
export function easeInOutBack(t: number): number {
  return t < 0.5
    ? (Math.pow(2 * t, 2) * ((BACK_C2 + 1) * 2 * t - BACK_C2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((BACK_C2 + 1) * (t * 2 - 2) + BACK_C2) + 2) / 2;
}

/** 名前 → イージング関数の Record。UI のドロップダウン等から決定論的に引ける。 */
export const EASINGS = {
  linear: easeLinear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInSine,
  easeOutSine,
  easeInOutSine,
  easeInBack,
  easeOutBack,
  easeInOutBack,
} as const;

export type Easing = keyof typeof EASINGS;

/** 名前 or 関数のどちらでも受けられるイージング指定。 */
export type EasingLike = Easing | ((t: number) => number);

/** EasingLike を実関数へ解決(未知名は linear フォールバック)。 */
function resolveEasing(easing: EasingLike | undefined): (t: number) => number {
  if (typeof easing === 'function') return easing;
  if (easing && easing in EASINGS) return EASINGS[easing];
  return easeLinear;
}

/** 線形補間。t は clamp しない(外挿を許す)。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** t を [0,1] にクランプしてから線形補間。 */
export function lerpClamped(a: number, b: number, t: number): number {
  const ct = t < 0 ? 0 : t > 1 ? 1 : t;
  return a + (b - a) * ct;
}

export interface Point {
  x: number;
  y: number;
}

/** 2D 点の線形補間。t は clamp しない。 */
export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/**
 * from→to を steps 個の中割り(内部フレームのみ)で返す。
 *
 * 端点の扱い: 端点 from / to は **含めない**。返すのは i=1..steps に対する
 * t = i/(steps+1) を easing 適用した補間値のみ(中割り=内部フレーム)。
 * steps<=0 では空配列を返す。
 */
export function tweenValue(
  from: number,
  to: number,
  steps: number,
  easing?: EasingLike,
): number[] {
  const count = Math.max(0, Math.trunc(steps));
  if (count <= 0) return [];
  const fn = resolveEasing(easing);
  const out: number[] = [];
  for (let i = 1; i <= count; i += 1) {
    const t = i / (count + 1);
    out.push(lerp(from, to, fn(t)));
  }
  return out;
}

/** Layer をディープ複製(pixels/mask 等の参照も含めて非共有化)。 */
function cloneLayer(layer: Layer): Layer {
  const next: Layer = { ...layer };
  if (layer.pixels) next.pixels = new Uint8ClampedArray(layer.pixels);
  if (layer.mask) next.mask = new Uint8ClampedArray(layer.mask);
  if (layer.children) next.children = [...layer.children];
  return next;
}

/** clamp ヘルパ(0..1)。 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * フレーム a と b の間に count 枚の中割り Frame を生成する。
 *
 * - 各中割りフレームは a.layers を基底にディープ複製し、b 側に対応する
 *   レイヤー(同一 id 優先・無ければ同 index)があれば opacity を easing 補間する。
 *   対応が取れないレイヤーは a 側をそのまま複製(フォールバック)。
 * - durationMs は a.durationMs と b.durationMs を線形補間。
 * - id は 'tween_<n>'(n=1..count)で決定論的に命名。
 * - 端点 a / b は返さない(中割りのみ)。count<=0 で空配列。
 * - a/b の Frame・Layer は一切変更しない(参照非共有)。
 */
export function tweenFrames(
  a: Frame,
  b: Frame,
  count: number,
  easing?: EasingLike,
): Frame[] {
  const n = Math.max(0, Math.trunc(count));
  if (n <= 0) return [];
  const fn = resolveEasing(easing);

  // b 側を id → Layer で索けるようにしておく(同 id 対応を優先)。
  const bById = new Map<string, Layer>();
  for (const layer of b.layers) bById.set(layer.id, layer);

  const out: Frame[] = [];
  for (let i = 1; i <= n; i += 1) {
    const t = i / (n + 1);
    const e = fn(t);

    const layers = a.layers.map((aLayer, index) => {
      const target = bById.get(aLayer.id) ?? b.layers[index];
      const cloned = cloneLayer(aLayer);
      if (target) {
        cloned.opacity = clamp01(lerp(aLayer.opacity, target.opacity, e));
      }
      return cloned;
    });

    out.push({
      id: `tween_${i}`,
      layers,
      durationMs: lerp(a.durationMs, b.durationMs, e),
    });
  }
  return out;
}
