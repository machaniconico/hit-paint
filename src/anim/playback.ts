import type { Frame, Timeline } from './timeline';

/**
 * Wave40 US-4203 — アニメ再生タイミング(累積/ループ/ピンポン)。
 *
 * すべて純粋関数。Date.now()/Math.random() は使わず、入力(timeline, timeMs, mode)
 * から決定論的に frame index を導出する。jsdom の canvas 制約を避けるため、
 * 描画には一切触れず「時刻 → フレーム番号」のスケジューリングのみを扱う。
 */

/**
 * 再生モード。
 * - once: 一度だけ再生。総時間を超えた時刻は最終フレームに張り付く。
 * - loop: 総時間で剰余を取り先頭へ巻き戻して無限ループ。
 * - pingpong: 往路→復路を反射して往復再生。
 */
export type PlaybackMode = 'once' | 'loop' | 'pingpong';

/** 累積タイミング1フレーム分。startMs <= t < endMs がそのフレームの表示区間。 */
export interface FrameTiming {
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
}

const DEFAULT_FPS = 12;

/** fps を正規化(非有限/0以下は 12 にフォールバック)。 */
function normalizeFps(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
}

/**
 * 1フレームの表示時間(ms)。
 * frame.durationMs が正の有限値ならそれを採用、無ければ 1000/fps。
 * fps<=0(非有限含む)は 12 にフォールバックする。
 */
export function frameDurationMs(frame: Frame, fps: number): number {
  const explicit = frame.durationMs;
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  return 1000 / normalizeFps(fps);
}

/**
 * 各フレームの累積タイミング配列を返す。
 * startMs は直前フレームの endMs から連続し、空 frames では空配列。
 */
export function frameTimings(timeline: Timeline): FrameTiming[] {
  const { frames, fps } = timeline;
  const timings: FrameTiming[] = [];
  let cursor = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const durationMs = frameDurationMs(frames[index], fps);
    const startMs = cursor;
    const endMs = startMs + durationMs;
    timings.push({ index, startMs, endMs, durationMs });
    cursor = endMs;
  }
  return timings;
}

/** 全フレーム長の合計(ms)。空 frames は 0。 */
export function totalDurationMs(timeline: Timeline): number {
  const { frames, fps } = timeline;
  let total = 0;
  for (let index = 0; index < frames.length; index += 1) {
    total += frameDurationMs(frames[index], fps);
  }
  return total;
}

/**
 * 累積タイミングから「時刻 t(ms)が属するフレーム index」を線形探索で求める。
 * t は [0, total) を想定(呼び出し側でモード別に正規化済み)。
 * 端点 t=total や浮動小数の累積誤差で最後の区間からこぼれた場合は最終フレームに張り付ける。
 */
function indexForElapsed(timings: FrameTiming[], t: number): number {
  for (let i = 0; i < timings.length; i += 1) {
    if (t < timings[i].endMs) {
      return timings[i].index;
    }
  }
  return timings[timings.length - 1].index;
}

/**
 * 時刻 timeMs に対応するフレーム index をモード別に決定論的に返す。
 *
 * 負の timeMs は 0 として扱う(決定論ガード)。空 frames は 0。
 *
 * pingpong の周期定義:
 *   period = 2*total - (先頭と末尾フレームの「折り返し点での二重カウント」を避ける補正)。
 *   ここでは時刻軸ではなくフレーム軸で反射させる方式を採る:
 *   往路で 0..(n-1) を進み、復路で (n-2)..1 を戻る。先頭フレーム(0)と
 *   末尾フレーム(n-1)は折り返し点なので復路で重複表示しない。
 *   よってフレーム列の論理長 cycleFrames = 2*n - 2(n>=2)、n==1 では常に 0。
 *   時刻はまず loop と同じく total で剰余して [0,total) の往路位置 p を得てから、
 *   往路フレーム idx を求め、サイクル前半/後半で idx を反射する。
 */
export function resolveFrameAt(timeline: Timeline, timeMs: number, mode: PlaybackMode): number {
  const timings = frameTimings(timeline);
  const n = timings.length;
  if (n === 0) return 0;
  if (n === 1) return 0;

  const total = timings[n - 1].endMs;
  const t = Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0;

  if (mode === 'once') {
    if (t >= total) return n - 1;
    return indexForElapsed(timings, t);
  }

  if (total <= 0) return 0;

  if (mode === 'loop') {
    const wrapped = t % total;
    return indexForElapsed(timings, wrapped);
  }

  // pingpong: 時刻ベースで往復させる。
  // 1サイクル = 往路(total) + 復路(total)。復路は時刻軸を反転して同じ
  // timings を引き直し、得られた往路 index を (n-1-idx) ではなく
  // 「復路の進行時刻」で評価することで先頭/末尾の二重表示を避ける。
  const cyclePos = t % (2 * total);
  if (cyclePos < total) {
    // 往路: 0 → n-1
    return indexForElapsed(timings, cyclePos);
  }
  // 復路: total → 2*total を [0, total) の残り時間に写像し、末尾から先頭へ。
  const backElapsed = cyclePos - total;
  // 復路の残り時間 = total - backElapsed を往路時刻として引くと、
  // backElapsed=0(復路開始=末尾到達直後)で末尾、backElapsed→total で先頭になる。
  const mirrored = total - backElapsed;
  // mirrored は (0, total]。total ちょうど(backElapsed=0)は末尾フレームへ。
  if (mirrored >= total) return n - 1;
  return indexForElapsed(timings, mirrored);
}
