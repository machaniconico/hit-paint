/**
 * HIT Paint — エアブラシ滞留ビルドアップ蓄積 (US-4403)。
 *
 * エアブラシは1点に留まる(滞留する)ほど塗りが濃くなる描き味を持つ。本モジュールは
 * その「ビルドアップ(build-up)蓄積」を純粋関数・決定論で表現する。Date.now() や
 * Math.random() は一切使わず、入力(現在α・flow・dt・ceiling)のみから次のαを決める。
 *
 * 【飽和モデル — 指数飽和(exponential saturation)】
 *   next = current + (ceiling - current) * (1 - exp(-flow * dt))
 *
 *   これは一次遅れ系(RC 充電)と同型で、滞留時間が増えるほど ceiling へ
 *   指数関数的に漸近する。1ステップで進む割合 k = 1 - exp(-flow*dt) は
 *   0..1 に収まり(flow,dt>=0 のとき)、残り (ceiling - current) に乗じるため
 *   next が ceiling を超えることはない。flow*dt → ∞ で k → 1(= ceiling 到達)、
 *   flow*dt → 0 で k → 0(= current 不変)。
 *
 * すべて純粋な数値演算のみで完結し、canvas/DOM に依存しない。
 */

/**
 * 1ステップ分のビルドアップ蓄積を計算し、次のαを返す。
 *
 * 数式: next = current + (ceiling - current) * (1 - exp(-flow * dt))
 *
 * 性質:
 * - next は ceiling を超えない(残り分に 0..1 の係数を乗じるため)。
 * - next は current 未満にならない(ceiling > current のとき単調増加)。
 * - flow <= 0 または dt <= 0 のとき蓄積は起きず current を返す。
 * - ceiling <= current(既に天井以上)のとき current を返す。
 * - dt が大きいほど next は単調増加し ceiling へ漸近する。
 *
 * @param current 現在の蓄積α(0..1 を想定)。
 * @param flow    流量レート(>0 で蓄積)。大きいほど速く ceiling へ近づく。
 * @param dt      滞留時間ステップ(>0 で蓄積)。負値は 0 として扱う。
 * @param ceiling 蓄積の上限α(0..1 を想定)。これを超えない。
 * @returns 蓄積後のα。
 */
export function buildupAlpha(
  current: number,
  flow: number,
  dt: number,
  ceiling: number,
): number {
  // 負 dt は 0 扱い(時間が遡らない)。NaN/非有限も安全側へ。
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const safeFlow = Number.isFinite(flow) ? flow : 0;

  // 蓄積が起きない条件: 流量なし・時間なし・既に天井以上。
  if (safeFlow <= 0 || safeDt <= 0 || ceiling <= current) {
    return current;
  }

  // 1ステップで進む割合(0..1)。flow*dt が大きいほど 1 に近づく。
  const k = 1 - Math.exp(-safeFlow * safeDt);
  const next = current + (ceiling - current) * k;

  // 数値誤差で ceiling を僅かに超える/current を下回るのを防ぐ。
  if (next > ceiling) return ceiling;
  if (next < current) return current;
  return next;
}

/** accumulateDwell が受け取る滞留サンプル(時間ステップのみ)。 */
export interface DwellSample {
  /** このサンプル区間の滞留時間。負値は buildupAlpha 内で 0 扱い。 */
  dt: number;
}

/**
 * 滞留サンプル列を start から順に buildupAlpha で積み上げ、最終αを返す。
 *
 * 各サンプルの dt を1ステップとして buildupAlpha を連鎖適用する。指数飽和の
 * 加法性により、合計滞留時間 Σdt が長いほど最終αは ceiling へ漸近する
 * (単調増加・飽和)。サンプルを増やしても/dt を増やしても ceiling を超えない。
 *
 * - 空配列のときは start をそのまま返す。
 * - start 既定は 0。
 *
 * @param samples 滞留サンプル列(各 {dt})。
 * @param flow    流量レート(buildupAlpha と同義)。
 * @param ceiling 蓄積上限α。
 * @param start   初期α(既定 0)。
 * @returns 全サンプル適用後の蓄積α。
 */
export function accumulateDwell(
  samples: DwellSample[],
  flow: number,
  ceiling: number,
  start = 0,
): number {
  let acc = start;
  for (const sample of samples) {
    acc = buildupAlpha(acc, flow, sample.dt, ceiling);
  }
  return acc;
}
