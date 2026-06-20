/**
 * ストロークアウトライン化(US-4502)
 *
 * 折れ線(open polyline)を太さ width で囲み、塗り可能な閉ポリゴン(外周リング)に変換する。
 * ベクター線を「面」に変換して塗りつぶし対象にしたり、SVG path の輪郭として書き出すための純粋関数群。
 *
 * 【設計判断】
 * - jsdom では canvas API が使えないため、描画には一切依存せず純粋な配列ロジックのみで完結させる。
 * - 決定論を厳守(Date.now()/Math.random() 不使用、round 系は固定分割数で点近似)。
 * - 既存 path.ts の Point 型(={x;y})のみに依存し、兄弟ファイルは import しない。
 *
 * 【リング向き規約(重要)】
 * 返すリングは「進行方向に対して左側(法線 +n 側)を順方向にたどり、終端の cap を経由して
 * 右側(法線 -n 側)を逆順にたどって始端へ戻る」単一の閉リングである。
 * 画面座標(y 下向き=スクリーン座標系)では、この巡回は時計回り(CW)になる。
 *   - 法線 n は進行方向ベクトル d=(dx,dy) を +90度(画面上での右回り)回した (dy, -dx) を正規化したもの…
 *     ではなく、本実装では「左法線」を n=(-dy, dx)/|d| と定義し、+width/2 側を左、-width/2 側を右とする。
 *   - 左側(+n)を始端→終端に進み、終端 cap、右側(-n)を終端→始端に戻り、始端 cap で閉じる。
 * リングは閉じている(最初の点と最後の点は同一座標にならないよう、重複は付加しない)。
 * 呼び出し側は rasterizeFill / SVG polygon にそのまま渡せる頂点列として扱える。
 */

export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

export interface StrokeOutlineOptions {
  /** ストロークの太さ(直径)。半径は width/2。 */
  width: number;
  /** 端点の形状。既定 'butt'。 */
  cap?: LineCap;
  /** 角の接続形状。既定 'miter'。 */
  join?: LineJoin;
  /** miter の許容比率(超えると bevel にフォールバック)。既定 4。 */
  miterLimit?: number;
  /** round の円弧分割数。既定 8。 */
  arcSteps?: number;
}

interface Pt {
  x: number;
  y: number;
}

const EPS = 1e-9;

function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

function length(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 単位左法線。進行方向 d=(dx,dy) に対し n=(-dy,dx)/|d|。
 * 画面座標(y 下向き)では進行方向の左側を指す。
 */
function leftNormal(ax: number, ay: number, bx: number, by: number): Pt {
  const dx = bx - ax;
  const dy = by - ay;
  const len = length(dx, dy);
  if (len < EPS) return { x: 0, y: 0 };
  return { x: -dy / len, y: dx / len };
}

/**
 * 中心 c のまわりに、from 角から to 角まで CW 方向(角度減少方向)に円弧点を生成する。
 * 始端 from・終端 to は含めない(呼び出し側が別途追加する前提)。
 * arcSteps は半周(π)あたりの分割数の目安として用い、実際の角度差に比例した分割数にする。
 */
function arcPointsCW(c: Pt, radius: number, fromAng: number, toAng: number, arcSteps: number): Pt[] {
  // CW(角度減少)で from→to へ。差を [0, 2π) に正規化(減少量)。
  let delta = fromAng - toAng;
  while (delta < 0) delta += Math.PI * 2;
  while (delta >= Math.PI * 2) delta -= Math.PI * 2;
  if (delta < EPS) return [];

  const stepsPerPi = Math.max(1, Math.floor(arcSteps));
  const count = Math.max(1, Math.ceil((delta / Math.PI) * stepsPerPi));
  const out: Pt[] = [];
  for (let i = 1; i < count; i++) {
    const ang = fromAng - (delta * i) / count;
    out.push({ x: c.x + Math.cos(ang) * radius, y: c.y + Math.sin(ang) * radius });
  }
  return out;
}

/** 中心 c の半径 radius の完全な円(CW)を arcSteps*2 分割で生成。 */
function circleCW(c: Pt, radius: number, arcSteps: number): Pt[] {
  const count = Math.max(3, Math.floor(arcSteps) * 2);
  const out: Pt[] = [];
  // y 下向き座標で CW にするため角度を減少方向に回す。
  for (let i = 0; i < count; i++) {
    const ang = -(i / count) * Math.PI * 2;
    out.push({ x: c.x + Math.cos(ang) * radius, y: c.y + Math.sin(ang) * radius });
  }
  return out;
}

/** 点 c を中心とした退化ドット(point 1個)用の正方形(CW)を生成。 */
function squareCW(c: Pt, radius: number): Pt[] {
  // CW(画面座標 y 下向き): 左上→右上→右下→左下。
  return [
    { x: c.x - radius, y: c.y - radius },
    { x: c.x + radius, y: c.y - radius },
    { x: c.x + radius, y: c.y + radius },
    { x: c.x - radius, y: c.y + radius },
  ];
}

/**
 * 退化(有効点が1個)の場合のドットアウトラインを生成。
 * round → 円近似、それ以外 → 正方形(width/2 を半径とする)。
 */
function dotOutline(c: Pt, radius: number, cap: LineCap, arcSteps: number): Pt[] {
  if (cap === 'round') return circleCW(c, radius, arcSteps);
  return squareCW(c, radius);
}

/**
 * 端点 cap の点列を生成して push する。
 * @param tip  端点中心
 * @param leftPt  端点における左側(+n)輪郭点
 * @param rightPt 端点における右側(-n)輪郭点
 * @param dir  端点から外側へ向かう単位方向(進行方向 or その逆)
 * @param normal 単位左法線
 *
 * butt: 何も足さない(leftPt→rightPt を直線で結ぶ)。
 * square: leftPt と rightPt を dir 方向に radius だけ押し出した2点を挟む。
 * round: leftPt から rightPt へ外側へ膨らむ半円(CW)。
 */
function appendCap(
  ring: Pt[],
  tip: Pt,
  leftPt: Pt,
  rightPt: Pt,
  dir: Pt,
  normal: Pt,
  radius: number,
  cap: LineCap,
  arcSteps: number,
): void {
  if (cap === 'square') {
    ring.push({ x: leftPt.x + dir.x * radius, y: leftPt.y + dir.y * radius });
    ring.push({ x: rightPt.x + dir.x * radius, y: rightPt.y + dir.y * radius });
    return;
  }
  if (cap === 'round') {
    // leftPt(角度 = atan2(normal)) から rightPt(角度 = atan2(-normal)) へ
    // 外側(dir 方向)を通る半円。CW で結ぶ。
    const fromAng = Math.atan2(normal.y, normal.x);
    const toAng = Math.atan2(-normal.y, -normal.x);
    // dir 方向を通る半円になるよう CW/CCW を選ぶ。
    // 左輪郭→外側→右輪郭 が CW になるのは leftNormal の定義より、
    // 始端 cap(dir=逆向き)と終端 cap(dir=順向き)で巡回向きが揃う。
    const pts = arcPointsCW(tip, radius, fromAng, toAng, arcSteps);
    for (const p of pts) ring.push(p);
    return;
  }
  // butt: 追加なし。
}

/**
 * 折れ線を太さ width で囲むアウトライン外周リングを返す。
 *
 * 規約: 返り値は単一の閉リング(頂点配列)。画面座標(y 下向き)で時計回り(CW)。
 * 最初/最後の頂点は重複させない(閉路は暗黙)。
 *
 * @param points 折れ線(open)の頂点列
 * @param opts   width/cap/join/miterLimit/arcSteps
 */
export function strokeToOutline(points: { x: number; y: number }[], opts: StrokeOutlineOptions): { x: number; y: number }[] {
  const radius = opts.width / 2;
  const cap: LineCap = opts.cap ?? 'butt';
  const join: LineJoin = opts.join ?? 'miter';
  const miterLimit = opts.miterLimit ?? 4;
  const arcSteps = Math.max(1, Math.floor(opts.arcSteps ?? 8));

  if (radius <= 0) return [];

  const pts = dedupe(points.map((p) => ({ x: p.x, y: p.y })));
  if (pts.length === 0) return [];
  if (pts.length === 1) return dotOutline(pts[0], radius, cap, arcSteps);

  // 各セグメントの単位左法線を事前計算。
  const segCount = pts.length - 1;
  const normals: Pt[] = [];
  for (let i = 0; i < segCount; i++) {
    normals.push(leftNormal(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y));
  }

  // ---- 左側(+n)を始端→終端へたどる ----
  const ring: Pt[] = [];

  // 始端 cap: 始端では進行方向の逆向き(始端から外側)に押し出す。
  const startDir: Pt = {
    x: pts[0].x - pts[1].x,
    y: pts[0].y - pts[1].y,
  };
  const startLen = length(startDir.x, startDir.y);
  const startDirUnit: Pt = startLen < EPS ? { x: 0, y: 0 } : { x: startDir.x / startLen, y: startDir.y / startLen };
  const n0 = normals[0];

  // 始端左点 / 始端右点。
  const startLeft: Pt = { x: pts[0].x + n0.x * radius, y: pts[0].y + n0.y * radius };
  const startRight: Pt = { x: pts[0].x - n0.x * radius, y: pts[0].y - n0.y * radius };

  // 始端 cap は「右→左」の向きで巡回に入る前に置く。
  // リング構築順序: [始端cap] 左側(始端→終端) [終端cap] 右側(終端→始端)。
  // 始端 cap は右輪郭の最後(右側終わり=始端右)から左側の最初(始端左)へつなぐ位置に来る。
  // ここでは先に左側を積み、最後に始端 cap を積む構成にする。

  // 左側オフセット点(各頂点で join 処理)。
  ring.push(startLeft);
  for (let i = 1; i < segCount; i++) {
    appendJoin(ring, pts[i], normals[i - 1], normals[i], radius, join, miterLimit, arcSteps, false);
  }
  // 終端左点。
  const nLast = normals[segCount - 1];
  const endLeft: Pt = { x: pts[segCount].x + nLast.x * radius, y: pts[segCount].y + nLast.y * radius };
  const endRight: Pt = { x: pts[segCount].x - nLast.x * radius, y: pts[segCount].y - nLast.y * radius };
  ring.push(endLeft);

  // 終端 cap: 終端では進行方向(終端から外側)に押し出す。
  const endDir: Pt = {
    x: pts[segCount].x - pts[segCount - 1].x,
    y: pts[segCount].y - pts[segCount - 1].y,
  };
  const endLen = length(endDir.x, endDir.y);
  const endDirUnit: Pt = endLen < EPS ? { x: 0, y: 0 } : { x: endDir.x / endLen, y: endDir.y / endLen };
  appendCap(ring, pts[segCount], endLeft, endRight, endDirUnit, nLast, radius, cap, arcSteps);

  // ---- 右側(-n)を終端→始端へ逆順にたどる ----
  ring.push(endRight);
  for (let i = segCount - 1; i >= 1; i--) {
    appendJoin(ring, pts[i], normals[i], normals[i - 1], radius, join, miterLimit, arcSteps, true);
  }
  ring.push(startRight);

  // 始端 cap。
  appendCap(ring, pts[0], startRight, startLeft, startDirUnit, { x: -n0.x, y: -n0.y }, radius, cap, arcSteps);

  return dedupeRing(ring);
}

/**
 * 角(join)の輪郭点を ring へ追加する。
 * @param vertex  角の頂点
 * @param nPrev   入ってくるセグメントの単位左法線
 * @param nNext   出ていくセグメントの単位左法線
 * @param rightSide false=左側(+n)を進む / true=右側(-n)を進む(逆順走査)
 *
 * 凸側(外側)では miter/round/bevel の差が出る。凹側(内側)では単純に2点を結ぶ。
 */
function appendJoin(
  ring: Pt[],
  vertex: Pt,
  nPrev: Pt,
  nNext: Pt,
  radius: number,
  join: LineJoin,
  miterLimit: number,
  arcSteps: number,
  rightSide: boolean,
): void {
  const sign = rightSide ? -1 : 1;
  const pPrev: Pt = { x: vertex.x + sign * nPrev.x * radius, y: vertex.y + sign * nPrev.y * radius };
  const pNext: Pt = { x: vertex.x + sign * nNext.x * radius, y: vertex.y + sign * nNext.y * radius };

  // 2法線がほぼ同方向なら直線(join 不要)。
  const dot = nPrev.x * nNext.x + nPrev.y * nNext.y;
  if (dot > 1 - EPS) {
    ring.push(pPrev);
    return;
  }

  if (join === 'round') {
    ring.push(pPrev);
    const fromAng = Math.atan2(sign * nPrev.y, sign * nPrev.x);
    const toAng = Math.atan2(sign * nNext.y, sign * nNext.x);
    // この側で外側に膨らむ向き(CW)を選ぶ。両方向のうち short arc を CW で結ぶ。
    const pts = arcShort(vertex, radius, fromAng, toAng, arcSteps);
    for (const p of pts) ring.push(p);
    return;
  }

  if (join === 'miter') {
    // miter 点 = 2オフセット線の交点。法線和方向に伸ばす。
    const mx = sign * (nPrev.x + nNext.x);
    const my = sign * (nPrev.y + nNext.y);
    const mLen = length(mx, my);
    if (mLen > EPS) {
      // half-angle: cos(theta/2)= mLen/2(単位法線和の長さの半分)。
      const halfCos = mLen / 2;
      const miterRatio = 1 / Math.max(EPS, halfCos);
      if (miterRatio <= miterLimit) {
        // miter は両エッジが交わる単一の尖り(apex)1点で角を表現する
        // (bevel が pPrev/pNext の2点で角を切り落とすのと対比的に頂点数が1少ない)。
        const miterLen = radius * miterRatio;
        ring.push({ x: vertex.x + (mx / mLen) * miterLen, y: vertex.y + (my / mLen) * miterLen });
        return;
      }
    }
    // miterLimit 超 → bevel フォールバック。
    ring.push(pPrev);
    ring.push(pNext);
    return;
  }

  // bevel: 2オフセット点を直線で結ぶ。
  ring.push(pPrev);
  ring.push(pNext);
}

/**
 * 中心 c まわりで from→to を「短い方の弧」に沿って CW(画面座標)で結ぶ中間点。
 * 始端・終端は含めない。
 */
function arcShort(c: Pt, radius: number, fromAng: number, toAng: number, arcSteps: number): Pt[] {
  let delta = toAng - fromAng;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) < EPS) return [];

  const stepsPerPi = Math.max(1, Math.floor(arcSteps));
  const count = Math.max(1, Math.ceil((Math.abs(delta) / Math.PI) * stepsPerPi));
  const out: Pt[] = [];
  for (let i = 1; i < count; i++) {
    const ang = fromAng + (delta * i) / count;
    out.push({ x: c.x + Math.cos(ang) * radius, y: c.y + Math.sin(ang) * radius });
  }
  return out;
}

/** リングの隣接重複点と、先頭=末尾の重複を除去する。 */
function dedupeRing(ring: Pt[]): Pt[] {
  const out = dedupe(ring);
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.abs(first.x - last.x) < EPS && Math.abs(first.y - last.y) < EPS) {
      out.pop();
    } else {
      break;
    }
  }
  return out;
}
