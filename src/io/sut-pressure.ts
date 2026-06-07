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
