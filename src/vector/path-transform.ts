import type { VectorPath, PathPoint } from './path';

/**
 * 2x3 アフィン変換行列。
 *
 * [a, b, c, d, e, f] で次の写像を表す:
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 *
 * これは Canvas 2D / SVG の transform(a,b,c,d,e,f) と同じ列優先のレイアウト。
 * 3x3 で書くと:
 *   | a c e |   | x |
 *   | b d f | * | y |
 *   | 0 0 1 |   | 1 |
 */
export type Mat2x3 = [number, number, number, number, number, number];

/** 恒等変換(何もしない)。 */
export function identityMat(): Mat2x3 {
  return [1, 0, 0, 1, 0, 0];
}

/** 平行移動行列。点を (tx, ty) だけ動かす。 */
export function translationMat(tx: number, ty: number): Mat2x3 {
  return [1, 0, 0, 1, tx, ty];
}

/**
 * 原点周りの回転行列。angle はラジアン。
 * 標準的な数学規約(反時計回りが正、y 軸下向きの画面座標では時計回りに見える)。
 *   x' = cos*x - sin*y
 *   y' = sin*x + cos*y
 * したがって a=cos, b=sin, c=-sin, d=cos。
 */
export function rotationMat(angle: number): Mat2x3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, 0, 0];
}

/** 原点周りの拡大縮小行列。 */
export function scaleMat(sx: number, sy: number): Mat2x3 {
  return [sx, 0, 0, sy, 0, 0];
}

/**
 * 行列の合成。multiplyMat(m1, m2) は「先に m2、後から m1 を適用」する合成
 * (= m1 ∘ m2)を返す。すなわち applyMatToPoint(multiplyMat(m1, m2), p)
 * === applyMatToPoint(m1, applyMatToPoint(m2, p))。
 *
 * 3x3 行列としての通常の行列積 M1 * M2 に等しい。
 */
export function multiplyMat(m1: Mat2x3, m2: Mat2x3): Mat2x3 {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2, // a
    b1 * a2 + d1 * b2, // b
    a1 * c2 + c1 * d2, // c
    b1 * c2 + d1 * d2, // d
    a1 * e2 + c1 * f2 + e1, // e
    b1 * e2 + d1 * f2 + f1, // f
  ];
}

/** 行列を 1 点に適用する。 */
export function applyMatToPoint(mat: Mat2x3, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = mat;
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
}

/**
 * パス全体に行列を適用し、新しい VectorPath を返す(不変)。
 *
 * アンカー点 (x, y) に加え、制御点 outX/outY・inX/inY も「絶対座標の点」として
 * 同じ行列で変換する(方向ベクトルではないので平行移動成分も効かせる)。
 * outX 等が undefined の点はそのまま欠落させる。closed は保持。
 */
export function applyMatrixToPath(path: VectorPath, mat: Mat2x3): VectorPath {
  return {
    closed: path.closed,
    points: path.points.map((point) => {
      const moved = applyMatToPoint(mat, point.x, point.y);
      const result: PathPoint = { x: moved.x, y: moved.y };

      if (point.outX !== undefined && point.outY !== undefined) {
        const out = applyMatToPoint(mat, point.outX, point.outY);
        result.outX = out.x;
        result.outY = out.y;
      } else {
        if (point.outX !== undefined) result.outX = point.outX;
        if (point.outY !== undefined) result.outY = point.outY;
      }

      if (point.inX !== undefined && point.inY !== undefined) {
        const inp = applyMatToPoint(mat, point.inX, point.inY);
        result.inX = inp.x;
        result.inY = inp.y;
      } else {
        if (point.inX !== undefined) result.inX = point.inX;
        if (point.inY !== undefined) result.inY = point.inY;
      }

      return result;
    }),
  };
}

/**
 * パスのアンカー点重心(制御点は含めない)。中心の既定値に使う。
 * 点が無ければ原点 (0, 0)。
 */
function pathCentroid(path: VectorPath): { x: number; y: number } {
  if (path.points.length === 0) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const point of path.points) {
    sumX += point.x;
    sumY += point.y;
  }
  return { x: sumX / path.points.length, y: sumY / path.points.length };
}

/**
 * 中心 (cx, cy) 周りで core 変換を適用する行列を合成する。
 * translation(c) ∘ core ∘ translation(-c) の順(中心を原点へ寄せ→core→戻す)。
 */
function aroundPivot(core: Mat2x3, cx: number, cy: number): Mat2x3 {
  return multiplyMat(translationMat(cx, cy), multiplyMat(core, translationMat(-cx, -cy)));
}

/**
 * 中心 (cx, cy) 周りでパスを回転する。angle はラジアン。
 * cx/cy 既定はアンカー点重心。
 */
export function rotatePath(path: VectorPath, angle: number, cx?: number, cy?: number): VectorPath {
  const centroid = pathCentroid(path);
  const px = cx ?? centroid.x;
  const py = cy ?? centroid.y;
  return applyMatrixToPath(path, aroundPivot(rotationMat(angle), px, py));
}

/**
 * 中心 (cx, cy) 周りでパスをスキュー(せん断)する。
 *   x' = x + kx * y
 *   y' = y + ky * x
 * (中心を原点に寄せた座標系で)。kx は x 方向、ky は y 方向のせん断係数。
 * cx/cy 既定はアンカー点重心。
 */
export function skewPath(path: VectorPath, kx: number, ky: number, cx?: number, cy?: number): VectorPath {
  const centroid = pathCentroid(path);
  const px = cx ?? centroid.x;
  const py = cy ?? centroid.y;
  // x' = x + kx*y → a=1, c=kx ; y' = ky*x + y → b=ky, d=1
  const core: Mat2x3 = [1, ky, kx, 1, 0, 0];
  return applyMatrixToPath(path, aroundPivot(core, px, py));
}

/**
 * パスを軸に対して鏡映する。
 *   axis='x': pivot.y を境に y を反転(上下反転)。x はそのまま。
 *   axis='y': pivot.x を境に x を反転(左右反転)。y はそのまま。
 * pivot 既定はアンカー点重心。
 */
export function mirrorPath(
  path: VectorPath,
  axis: 'x' | 'y',
  pivot?: { x: number; y: number },
): VectorPath {
  const centroid = pathCentroid(path);
  const px = pivot?.x ?? centroid.x;
  const py = pivot?.y ?? centroid.y;
  // axis='x' は y を反転(sy=-1)、axis='y' は x を反転(sx=-1)。
  const core: Mat2x3 = axis === 'x' ? scaleMat(1, -1) : scaleMat(-1, 1);
  return applyMatrixToPath(path, aroundPivot(core, px, py));
}
