/**
 * HIT Paint — CLIP STUDIO .sut 筆圧カーブ(PressureGraph/Effector)デコード。
 *
 * 実 .sut で解読済みのカーブブロック署名(ビッグエンディアン):
 *   [u32BE = 12][u32BE = 点数N][u32BE = 16][N × float64BE(各 0..1)]
 * 先頭 12 と 16 はマーカー。N は点数。続く N*8 バイトが制御点列。
 *
 * すべて純粋関数。Canvas/DOM に依存しないので jsdom テストから検証できる。
 */

/** N個の制御値(0..1)。0..1ドメインに等間隔配置されたカーブ。 */
export interface PressureCurve {
  points: number[];
}

/** カーブ署名のマーカー値。 */
const MARKER_HEAD = 12;
const MARKER_TAIL = 16;

/** ヘッダ部 (3 × u32BE) のバイト数。 */
const HEADER_BYTES = 12;

/**
 * offset 位置がカーブ署名に一致すれば points をデコードして返す。
 * 一致しない / 長さ不足なら null。
 * NaN は 0 として格納する(値自体のクランプは sample 側で行う)。
 */
export function decodePressureCurve(blob: Uint8Array, offset = 0): PressureCurve | null {
  if (offset < 0 || offset + HEADER_BYTES > blob.length) return null;

  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);

  // ヘッダ署名チェック: [12][N][16]
  if (view.getUint32(offset, false) !== MARKER_HEAD) return null;
  const count = view.getUint32(offset + 4, false);
  if (view.getUint32(offset + 8, false) !== MARKER_TAIL) return null;

  // 点数の健全性チェック(暴走防止)とバイト長チェック。
  if (count < 0 || count > 0xffff) return null;
  const dataStart = offset + HEADER_BYTES;
  if (dataStart + count * 8 > blob.length) return null;

  const points: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = view.getFloat64(dataStart + i * 8, false);
    points.push(Number.isNaN(v) ? 0 : v);
  }
  return { points };
}

/**
 * blob 全体を走査し、署名に一致する全ブロックを抽出して返す。
 * 間にジャンクがあってもよい。素直な前方走査(マッチしたらブロック末尾まで進む)。
 */
export function findPressureCurves(blob: Uint8Array): PressureCurve[] {
  const curves: PressureCurve[] = [];
  if (blob.length < HEADER_BYTES) return curves;

  for (let i = 0; i + HEADER_BYTES <= blob.length; ) {
    const curve = decodePressureCurve(blob, i);
    if (curve) {
      curves.push(curve);
      // ブロック末尾まで進める(ヘッダ + 制御点)。
      i += HEADER_BYTES + curve.points.length * 8;
    } else {
      i += 1;
    }
  }
  return curves;
}

/**
 * input(筆圧 0..1, 範囲外はクランプ)を、points を 0..1 等間隔の制御点とみなして
 * 線形補間した値(0..1)を返す。
 * - points 空なら input をそのまま返す。
 * - points 1個ならその値。
 */
export function samplePressureCurve(curve: PressureCurve, input: number): number {
  const pts = curve.points;
  if (pts.length === 0) return input;
  if (pts.length === 1) return pts[0];

  // 入力を 0..1 にクランプ。
  const t = input < 0 ? 0 : input > 1 ? 1 : input;

  // points[0] が t=0, points[last] が t=1 に対応する等間隔配置。
  const last = pts.length - 1;
  const scaled = t * last;
  const i0 = Math.floor(scaled);
  if (i0 >= last) return pts[last];
  const i1 = i0 + 1;
  const frac = scaled - i0;
  return pts[i0] + (pts[i1] - pts[i0]) * frac;
}

/**
 * 全点が value(既定1.0)に eps(既定1e-3)以内なら true(=効果なし)。
 * points 空も「効果なし」とみなして true。
 */
export function curveIsFlat(curve: PressureCurve, value = 1.0, eps = 1e-3): boolean {
  for (const p of curve.points) {
    if (Math.abs(p - value) > eps) return false;
  }
  return true;
}

/**
 * カーブが「筆圧応答らしい」かを判定する。
 *
 * findPressureCurves は .sut(SQLite)ファイル全体を署名走査するため、
 * SQLite のページデータ等に偶然 [12][N][16]+float64BE 構造が一致する
 * 「偽陽性」を拾うことがある(実サンプルでは全ファイル共通で非単調な
 * [0,0,0.077,0.028,0.23,…] が観測された)。これを size/flow 倍率カーブとして
 * 適用すると、筆圧でブラシ径が erratic に歪む実害が出る。
 *
 * 本物の筆圧応答カーブは概ね単調非減少で、最小〜最大に有意なスパンを持つ。
 * その2条件を満たすカーブのみ「適用してよい」と判定する。
 * - 点数 2 未満は適用不可(false)。
 * - tol: 単調性の許容ゆらぎ(微小な逆行は許す)。
 * - minSpan: max-min がこの値未満なら、ほぼ平坦とみなし適用しない。
 */
export function curveLooksLikePressureResponse(
  curve: PressureCurve,
  { tol = 1e-3, minSpan = 0.1 }: { tol?: number; minSpan?: number } = {},
): boolean {
  const pts = curve.points;
  if (pts.length < 2) return false;

  let min = pts[0];
  let max = pts[0];
  for (let i = 1; i < pts.length; i++) {
    // 単調非減少(tol を超える逆行があれば偽陽性とみなす)。
    if (pts[i] < pts[i - 1] - tol) return false;
    if (pts[i] < min) min = pts[i];
    if (pts[i] > max) max = pts[i];
  }
  return max - min >= minSpan;
}

/* ------------------------------------------------------------------ */
/* Effector 厳密抽出(Wave38 / US-4003)                                 */
/* ------------------------------------------------------------------ */

/**
 * .sut の Effector レコードレイアウト(実5ファイル assetpass/*.sut の
 * 全カーブ署名位置の前段 32 バイトを u32BE/i32BE でダンプして確定した知見):
 *
 *   相対位置  型      観測値             意味(推定)
 *   -32      i32BE   100 / 0            効果量/有効度(0=無効) → enabled
 *   -28      u32BE   0 / 80             入力源様の値 → inputSource(生値保持)
 *   -24      i32BE   0/-100/70/80/90    符号付き最小値/オフセット様 → offset
 *   -20      u32BE   0(全観測で一定)     予約/ゼロ
 *   -16      u32BE   12 + 16*N          カーブ1ブロックのバイト長 ★主判定
 *   -12      u32BE   0 or 12 + 16*M     随伴カーブ2のバイト長(無ければ 0)
 *    -8      u32BE   100/400/500        パラメータ範囲上限様 → range
 *    -4      u32BE   0(全観測で一定)     予約/ゼロ
 *     0      [u32=12][u32=N][u32=16] + カーブ本体
 *
 * 重要知見: 長さフィールドが 12+16*N(8*N ではない)であることから、カーブ
 * 本体は実際には N 個の (x,y) float64BE ペア(計 2N float, x は 0→1 昇順)で
 * あることが確定した(例: N=2 で (0,0),(1,1) の恒等カーブ、N=5 で x 昇順の
 * 減衰カーブを実ファイルで確認)。curve フィールドは現行パイプライン
 * (decodePressureCurve / store.importSutBrush)互換のため「先頭 N float」表現を
 * 維持する一方、Wave39(US-4101)で pairs フィールド((x,y) ペア列)と
 * resampleEffectorCurve((x,y) 解釈での等間隔再サンプル)を追加した。
 * selectBrushPressureCurves は { normalize: true } 指定時にこの再サンプル済み
 * カーブを返す(既定 false は従来の先頭 N float 表現=バイト同一で後方互換)。
 *
 * 一方、SQLite ページ由来の偽陽性(全実ファイル共通 offset 8067 の非単調列)は
 * 前段がランダムな大値(例 1785410533)で、この長さ整合を満たさないため
 * 構造的に除外できる。
 */
export interface EffectorCurve {
  /** カーブ(現行互換: 署名直後の先頭 N float。実体は (x,y) ペアの前半)。 */
  curve: PressureCurve;
  /**
   * カーブ本体の (x,y) ペア列(x 昇順 0..1)。Wave39(US-4101)で追加。
   * resampleEffectorCurve に渡すことで形状を歪めない等間隔カーブが得られる。
   */
  pairs: Array<{ x: number; y: number }>;
  /** 有効フラグ(前段 -32 の効果量様 i32 が非 0 かどうか)。 */
  enabled: boolean;
  /** 入力源様の u32(前段 -28)。意味は未確定なので生値を保持する。 */
  inputSource: number;
  /** パラメータ範囲上限様の u32(前段 -8。観測値 100/400/500)。 */
  range: number;
  /** 符号付きオフセット/最小値様の i32(前段 -24。観測値 -100..90)。 */
  offset: number;
}

/** Effector 前段(8 × u32BE)のバイト数。 */
const EFFECTOR_PREFIX_BYTES = 32;

/** ペア表現でのカーブ1ブロックのバイト長(ヘッダ 12 + N × 16)。 */
function effectorBlockBytes(count: number): number {
  return HEADER_BYTES + count * 16;
}

/**
 * offset 位置のカーブ署名が「Effector レコードの本体」として妥当かを前段
 * u32 群で検証し、妥当なら EffectorCurve を返す。妥当でなければ null。
 *
 * 検証条件(上記レイアウトの全観測不変条件):
 * - 前段 -16 の長さフィールドが 12+16*N に一致(主判定。SQLite ページ等の
 *   ゴミが偶然満たす確率は実質ゼロ)。
 * - 前段 -20 / -4 の予約フィールドが 0。
 * - 前段 -8 の range が正。
 * - ペア本体(2N float)が全て有限かつ 0..1。
 * - 前段 -12 の len2 が 0、または直後に [12][M][16] ヘッダを持つ随伴カーブの
 *   長さ 12+16*M に一致。
 */
function decodeEffectorAt(blob: Uint8Array, offset: number): EffectorCurve | null {
  if (offset < EFFECTOR_PREFIX_BYTES) return null;
  const curve = decodePressureCurve(blob, offset);
  if (!curve || curve.points.length === 0) return null;

  const n = curve.points.length;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);

  // 主判定: 長さフィールド = 12 + 16*N(ペア本体)。
  if (view.getUint32(offset - 16, false) !== effectorBlockBytes(n)) return null;
  // 予約フィールド(全観測で 0)。
  if (view.getUint32(offset - 20, false) !== 0) return null;
  if (view.getUint32(offset - 4, false) !== 0) return null;
  // 範囲上限は正値。
  const range = view.getUint32(offset - 8, false);
  if (range <= 0) return null;

  // ペア本体(2N float)が blob に収まり、全値が有限な 0..1 であること。
  // 併せて (x,y) ペア列を構築する(Wave39: pairs フィールド)。
  const bodyStart = offset + HEADER_BYTES;
  if (bodyStart + n * 16 > blob.length) return null;
  const pairs: Array<{ x: number; y: number }> = [];
  for (let p = 0; p < n; p++) {
    const x = view.getFloat64(bodyStart + p * 16, false);
    const y = view.getFloat64(bodyStart + p * 16 + 8, false);
    if (!Number.isFinite(x) || x < 0 || x > 1) return null;
    if (!Number.isFinite(y) || y < 0 || y > 1) return null;
    pairs.push({ x, y });
  }

  // 随伴カーブ2の長さ整合(存在する場合)。
  const len2 = view.getUint32(offset - 12, false);
  if (len2 !== 0) {
    const c2 = offset + effectorBlockBytes(n);
    if (c2 + HEADER_BYTES > blob.length) return null;
    if (view.getUint32(c2, false) !== MARKER_HEAD) return null;
    if (len2 !== effectorBlockBytes(view.getUint32(c2 + 4, false))) return null;
  }

  return {
    curve,
    pairs,
    enabled: view.getInt32(offset - 32, false) !== 0,
    inputSource: view.getUint32(offset - 28, false),
    range,
    offset: view.getInt32(offset - 24, false),
  };
}

/**
 * (x,y) ペア列(x 昇順 0..1 想定)を線形補間で等間隔 M サンプルの
 * PressureCurve{points}(t = i/(M-1), i=0..M-1)に再サンプルする。
 *
 * 「先頭 N float」表現(=x 列をそのまま points にする)は x が非一様なカーブで
 * 形状を歪めるため、本関数は (x,y) 解釈で y を t=x 上に正しく配置し直す。
 *
 * 決定論的な規則:
 * - pairs 空なら空 points。1 個ならその y を M 個複製。
 * - 入力ペアは x 昇順に安定ソートする(元の順序を壊さない)。
 * - x が範囲外(t<先頭x / t>末尾x)は端点 y にクランプ。
 * - x 重複(|x_a - x_b| が極小)は「後者優先」: ソート後、同一 x の区間に
 *   サンプル点 t が一致したら、その x を持つ最後のペアの y を採用する。
 *   補間は「t 以下で最大の x を持つ最後のペア」と「t 超で最小の x を持つ
 *   最初のペア」の間で行う。
 *
 * @param pairs (x,y) ペア列。
 * @param sampleCount 出力サンプル数 M(既定 16, 最低 2)。
 */
export function resampleEffectorCurve(
  pairs: Array<{ x: number; y: number }>,
  sampleCount = 16,
): PressureCurve {
  const m = Math.max(2, Math.floor(sampleCount));
  if (pairs.length === 0) return { points: [] };
  if (pairs.length === 1) {
    return { points: new Array(m).fill(pairs[0].y) };
  }

  // x 昇順に安定ソート(同一 x は元の順序を保持 → 後者優先の判定に使える)。
  const sorted = pairs
    .map((p, i) => ({ x: p.x, y: p.y, i }))
    .sort((a, b) => (a.x === b.x ? a.i - b.i : a.x - b.x));

  const firstX = sorted[0].x;
  const lastX = sorted[sorted.length - 1].x;

  const points: number[] = [];
  for (let s = 0; s < m; s++) {
    const t = s / (m - 1);
    // 端点クランプ。
    if (t <= firstX) {
      points.push(sorted[0].y);
      continue;
    }
    if (t >= lastX) {
      points.push(sorted[sorted.length - 1].y);
      continue;
    }
    // t を挟む区間 [lo, hi] を探す。
    // lo = x <= t を満たす「最後の」ペア(後者優先 = 重複 x の末尾)。
    // hi = x > t を満たす「最初の」ペア。
    let lo = 0;
    for (let k = 0; k < sorted.length; k++) {
      if (sorted[k].x <= t) lo = k;
      else break;
    }
    // t がちょうど lo の x に一致し、同一 x が複数あるなら末尾を採用済み。
    if (sorted[lo].x === t) {
      points.push(sorted[lo].y);
      continue;
    }
    const hi = lo + 1; // sorted[hi].x > t が保証される(t<lastX のため)。
    const x0 = sorted[lo].x;
    const x1 = sorted[hi].x;
    const span = x1 - x0;
    const frac = span <= 0 ? 0 : (t - x0) / span;
    points.push(sorted[lo].y + (sorted[hi].y - sorted[lo].y) * frac);
  }
  return { points };
}

/**
 * blob 全体を走査し、前段 u32 群の検証を通った Effector カーブのみ返す。
 * 前段が SQLite ページ等のゴミである署名(=findPressureCurves が拾う偽陽性)は
 * 返さない。決定論的・純粋。
 */
export function findEffectorCurves(blob: Uint8Array): EffectorCurve[] {
  const found: EffectorCurve[] = [];
  if (blob.length < EFFECTOR_PREFIX_BYTES + HEADER_BYTES) return found;

  for (let i = EFFECTOR_PREFIX_BYTES; i + HEADER_BYTES <= blob.length; ) {
    const eff = decodeEffectorAt(blob, i);
    if (eff) {
      found.push(eff);
      // レコード全体(カーブ1のペア本体 + 随伴カーブ2)を読み飛ばす。
      const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
      const len2 = view.getUint32(i - 12, false);
      i += effectorBlockBytes(eff.curve.points.length) + len2;
    } else {
      // 妥当な前段を持つレコードを取りこぼさないよう 1 バイトずつ進める。
      i += 1;
    }
  }
  return found;
}

/** 厳密経路で使う再サンプル数(M)。実カーブの形状を保つ十分な解像度。 */
const EFFECTOR_RESAMPLE_COUNT = 16;

/**
 * 再サンプル済みカーブが恒等ランプ(y = t、点 i が i/(M-1))かを判定する。
 *
 * ペア解釈で恒等カーブ (0,0)-(1,1) を再サンプルすると points は線形ランプ
 * [0 … 1] になり、curveIsFlat(span 0 でない)/ curveLooksLikePressureResponse
 * (単調・span 1)では除外できない。だが恒等カーブは「筆圧を素通し」=効果なし
 * なので、従来の「先頭 N float」表現と同様に除外する必要がある。
 * そのための専用ガード。
 */
function curveIsIdentityRamp(curve: PressureCurve, eps = 1e-3): boolean {
  const pts = curve.points;
  if (pts.length < 2) return false;
  const last = pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(pts[i] - i / last) > eps) return false;
  }
  return true;
}

/** selectBrushPressureCurves のオプション。 */
export interface SelectBrushPressureCurvesOptions {
  /**
   * 厳密経路(findEffectorCurves 由来)で (x,y) ペアを resampleEffectorCurve で
   * 等間隔再サンプルした「正規化後のカーブ」を返すか。
   *
   * - false(既定): 従来の「先頭 N float」表現(eff.curve)をそのまま返す。
   *   Wave38 以前とバイト同一(後方互換が最重要のため既定)。
   * - true: (x,y) ペア解釈で正規化したカーブを返す。非一様 x 配置のカーブ
   *   (例: (0,0),(0.991,0),(1,1) のような高しきい値応答)で形状を歪めない。
   *   store.importSutBrush 側が新挙動へ移行する際に明示的に有効化する
   *   (US-4102/4103 の配線で利用)。
   *
   * フォールバック経路(findPressureCurves)は normalize の値に関わらず挙動不変。
   */
  normalize?: boolean;
  /** 正規化時の再サンプル数 M(既定 16)。normalize=false では無視。 */
  resampleCount?: number;
}

/**
 * ブラシに適用すべき筆圧カーブ列を選ぶ(store.importSutBrush 用の上位 API)。
 *
 * 1. 厳密抽出(findEffectorCurves)で enabled な Effector カーブを集める。
 *    - normalize=false(既定): eff.curve(先頭 N float)を従来どおり返す。
 *      ガードは curveIsFlat / curveLooksLikePressureResponse(従来同値)。
 *    - normalize=true: (x,y) ペアを resampleEffectorCurve で等間隔再サンプルした
 *      正規化カーブを返す。ガードは正規化後カーブに適用し、恒等カーブ
 *      (0,0)-(1,1) の再サンプル結果(線形ランプ)は curveIsIdentityRamp で除外
 *      (筆圧素通し=効果なし。従来「先頭 N float」表現の span 0 と同義)。
 * 2. 厳密側がガード後 0 件なら、従来の findPressureCurves + 同フィルタへ
 *    フォールバック(store.ts の現行フィルタと完全同値・normalize に依らず挙動不変)。
 */
export function selectBrushPressureCurves(
  blob: Uint8Array,
  options: SelectBrushPressureCurvesOptions = {},
): PressureCurve[] {
  const { normalize = false, resampleCount = EFFECTOR_RESAMPLE_COUNT } = options;

  const strict: PressureCurve[] = [];
  for (const eff of findEffectorCurves(blob)) {
    if (!eff.enabled) continue;
    if (normalize) {
      // (x,y) ペア解釈で正規化(等間隔再サンプル)してからガードを適用する。
      const norm = resampleEffectorCurve(eff.pairs, resampleCount);
      if (curveIsFlat(norm)) continue;
      if (curveIsIdentityRamp(norm)) continue;
      if (!curveLooksLikePressureResponse(norm)) continue;
      strict.push(norm);
    } else {
      // 従来挙動: 先頭 N float 表現をそのまま使う(バイト同一)。
      if (curveIsFlat(eff.curve)) continue;
      if (!curveLooksLikePressureResponse(eff.curve)) continue;
      strict.push(eff.curve);
    }
  }
  if (strict.length > 0) return strict;

  // フォールバック: store.ts L1014-1021 の現行フィルタと同値(挙動不変)。
  return findPressureCurves(blob).filter(
    (curve) => !curveIsFlat(curve) && curveLooksLikePressureResponse(curve),
  );
}
