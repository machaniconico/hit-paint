import { flattenPath, type VectorPath } from './path';

/**
 * パス測定(弧長パラメータ化) — US-4501。
 *
 * 設計判断:
 * - 全て純粋関数・決定論(Date.now/Math.random を一切使わない)。
 * - ベジェ曲線は flattenPath で折れ線化してから弧長を積算する。曲線そのものの
 *   解析的弧長は閉形式が無いため、折れ線近似が現実的かつ既存ラスタライザと整合する。
 * - cumulative[i] は「頂点 i までの累積弧長」で先頭は必ず 0。total は最後の累積値。
 * - 退化(点 0/1 個・総長 0)は安全に扱う:座標が無ければ空、1 点なら始点へ落とす。
 * - 既存 src/vector/path.ts の flattenPath/VectorPath のみに依存する(兄弟 Wave43 ファイル非依存)。
 */

interface XY {
  x: number;
  y: number;
}

interface Tangent {
  x: number;
  y: number;
  angle: number;
}

interface MeasureResult {
  points: XY[];
  cumulative: number[];
  total: number;
}

/**
 * パスを折れ線化し、各頂点までの累積弧長と総長を返す。
 * - points: 折れ線の頂点列(flattenPath の結果)。
 * - cumulative: points と同じ長さ。cumulative[0]=0、cumulative[i]=頂点 i までの距離。
 * - total: 折れ線の総長(= cumulative の末尾、退化時は 0)。
 */
export function measurePath(path: VectorPath, steps?: number): MeasureResult {
  const points = flattenPath(path, steps);
  if (points.length === 0) {
    return { points: [], cumulative: [], total: 0 };
  }

  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
    cumulative.push(total);
  }

  return { points, cumulative, total };
}

/** 折れ線総長(measurePath の total と同値の薄いラッパ)。 */
export function pathLength(path: VectorPath, steps?: number): number {
  return measurePath(path, steps).total;
}

/**
 * 弧長 len の座標を隣接頂点間の線形補間で返す。
 * - len <= 0 は始点、len >= total は終点へクランプ。
 * - 退化(頂点 0 個)は (0,0) を返す安全値。
 */
export function pointAtLength(path: VectorPath, len: number, steps?: number): XY {
  const { points, cumulative, total } = measurePath(path, steps);
  return locate(points, cumulative, total, len).point;
}

/**
 * 弧長 len 地点の進行方向単位ベクトル(dx,dy)と angle=atan2(dy,dx) を返す。
 * - 進行方向は len が属する区間(頂点 i→i+1)の向き。クランプ端では端の区間の向き。
 * - 退化や総長 0 では angle=0 の零ベクトルを返す。
 */
export function tangentAtLength(path: VectorPath, len: number, steps?: number): Tangent {
  const { points, cumulative, total } = measurePath(path, steps);
  const located = locate(points, cumulative, total, len);
  return tangentAt(points, located.segment);
}

/**
 * offset から spacing 間隔で並ぶ点列(各 angle 付き)を返す。
 * - offset(既定 0)が開始弧長。offset から total まで spacing ずつ進む。
 * - spacing <= 0 は空配列(無限ループ防止のガード)。
 * - 総長 0(退化)は、offset<=0 のとき始点 1 点のみ返す。
 */
export function pointsAlong(path: VectorPath, spacing: number, offset = 0): Tangent[] {
  if (!(spacing > 0)) return [];

  const { points, cumulative, total } = measurePath(path, undefined);
  const result: Tangent[] = [];

  if (points.length === 0) return result;

  if (total <= 0) {
    // 総長 0(全頂点が同一座標):offset が範囲内(<=0)なら始点 1 点のみ。
    if (offset <= 0) {
      const tan = tangentAt(points, 0);
      result.push({ x: points[0].x, y: points[0].y, angle: tan.angle });
    }
    return result;
  }

  // 浮動小数の誤差で末尾点を取りこぼさないよう微小許容を持たせる。
  const epsilon = total * 1e-9;
  for (let len = offset; len <= total + epsilon; len += spacing) {
    const clamped = Math.max(0, Math.min(total, len));
    const located = locate(points, cumulative, total, clamped);
    const tan = tangentAt(points, located.segment);
    result.push({ x: located.point.x, y: located.point.y, angle: tan.angle });
  }

  return result;
}

/**
 * 弧長 len から座標と所属区間インデックスを求める内部ヘルパ。
 * segment は頂点 segment→segment+1 の区間(端では最後の有効区間)。
 */
function locate(
  points: XY[],
  cumulative: number[],
  total: number,
  len: number,
): { point: XY; segment: number } {
  if (points.length === 0) {
    return { point: { x: 0, y: 0 }, segment: 0 };
  }
  if (points.length === 1 || total <= 0) {
    return { point: { x: points[0].x, y: points[0].y }, segment: 0 };
  }

  if (len <= 0) {
    return { point: { x: points[0].x, y: points[0].y }, segment: 0 };
  }
  if (len >= total) {
    const last = points.length - 1;
    return { point: { x: points[last].x, y: points[last].y }, segment: last - 1 };
  }

  // cumulative は単調増加。len を含む区間を線形探索で特定する。
  for (let i = 1; i < cumulative.length; i++) {
    if (len <= cumulative[i]) {
      const segmentStart = cumulative[i - 1];
      const segmentLength = cumulative[i] - segmentStart;
      const t = segmentLength > 0 ? (len - segmentStart) / segmentLength : 0;
      const a = points[i - 1];
      const b = points[i];
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        segment: i - 1,
      };
    }
  }

  const last = points.length - 1;
  return { point: { x: points[last].x, y: points[last].y }, segment: last - 1 };
}

/** 指定区間 segment(頂点 segment→segment+1)の単位接線と角度を返す。 */
function tangentAt(points: XY[], segment: number): Tangent {
  if (points.length < 2) {
    return { x: 0, y: 0, angle: 0 };
  }

  const i = Math.max(0, Math.min(points.length - 2, segment));
  const a = points[i];
  const b = points[i + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) {
    return { x: 0, y: 0, angle: 0 };
  }

  return { x: dx / length, y: dy / length, angle: Math.atan2(dy, dx) };
}
