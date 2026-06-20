/**
 * Wave43 US-4504 — store/App 配線(等間隔配置/アウトライン化/パス変換)の検証。
 *
 * jsdom では canvas API が使えないため、store のベクター操作から切り出した
 * 副作用無しの純粋ヘルパ(pointsAlongPath / strokeToOutlinePath / outlineVectorData /
 * transformVectorData / rotateVectorData / skewVectorData / mirrorVectorData)を、
 * 委譲先の単体 export(US-4501/4502/4503)と完全一致するかで検証する。
 *
 * 主眼:
 *  - 各ヘルパが path-measure / stroke-outline / path-transform 単体と一致すること。
 *  - 既存ベクター操作(updateVectorLayerData 委譲)の回帰が無いこと(最小1ケース)。
 */

import { describe, it, expect } from 'vitest';
import {
  pointsAlongPath,
  strokeToOutlinePath,
  outlineVectorData,
  transformVectorData,
  rotateVectorData,
  skewVectorData,
  mirrorVectorData,
} from '../src/state/store';
import type { VectorPath } from '../src/vector/path';
import { flattenPath } from '../src/vector/path';
import { pointsAlong } from '../src/vector/path-measure';
import { strokeToOutline } from '../src/vector/stroke-outline';
import {
  applyMatrixToPath,
  rotatePath,
  skewPath,
  mirrorPath,
  rotationMat,
} from '../src/vector/path-transform';
import { createVectorLayerData, type VectorLayerData } from '../src/vector/vector-layer';
import type { RGBA } from '../src/types';

const RED: RGBA = { r: 200, g: 40, b: 40, a: 255 };
const BLUE: RGBA = { r: 20, g: 30, b: 220, a: 255 };

// 直線 L 字パス(0,0)-(10,0)-(10,10):制御点なしの折れ線。総長 20。
const lShape: VectorPath = {
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  closed: false,
};

// ---------------------------------------------------------------------------
// pointsAlongPath — 等間隔点取得(US-4501 pointsAlong 委譲)
// ---------------------------------------------------------------------------

describe('pointsAlongPath(等間隔点取得)', () => {
  it('US-4501 pointsAlong と完全一致する(spacing/offset 各種)', () => {
    for (const spacing of [2, 3, 5, 7]) {
      for (const offset of [0, 1, 4]) {
        expect(pointsAlongPath(lShape, spacing, offset)).toEqual(
          pointsAlong(lShape, spacing, offset),
        );
      }
    }
  });

  it('offset 既定 0 でも単体と一致', () => {
    expect(pointsAlongPath(lShape, 4)).toEqual(pointsAlong(lShape, 4, 0));
  });

  it('spacing<=0 は空配列(無限ループガード)', () => {
    expect(pointsAlongPath(lShape, 0)).toEqual([]);
    expect(pointsAlongPath(lShape, -1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// strokeToOutlinePath — アウトライン化(US-4502 strokeToOutline 委譲)
// ---------------------------------------------------------------------------

describe('strokeToOutlinePath(アウトライン化)', () => {
  it('flattenPath→strokeToOutline 単体と同一の点列を持つ closed VectorPath を返す', () => {
    const opts = { width: 4, cap: 'round' as const, join: 'round' as const };
    const polyline = flattenPath(lShape);
    const ring = strokeToOutline(polyline, opts);
    const result = strokeToOutlinePath(lShape, opts);
    expect(result).not.toBeNull();
    expect(result!.closed).toBe(true);
    expect(result!.points).toEqual(ring.map((p) => ({ x: p.x, y: p.y })));
  });

  it('width<=0(リング退化)は null', () => {
    expect(strokeToOutlinePath(lShape, { width: 0 })).toBeNull();
  });

  it('点が無いパスは null', () => {
    expect(strokeToOutlinePath({ points: [], closed: false }, { width: 4 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// outlineVectorData — レイヤー全体のアウトライン化
// ---------------------------------------------------------------------------

describe('outlineVectorData(レイヤーアウトライン化)', () => {
  const data: VectorLayerData = createVectorLayerData({
    subpaths: [
      { path: lShape, fill: null, stroke: { color: RED, width: 6 } },
    ],
  });

  it('元 subpath を保持しつつアウトライン subpath を追加(stroke 色を塗りに)', () => {
    const out = outlineVectorData(data);
    expect(out.subpaths.length).toBe(2);
    // 1つ目は元のまま。
    expect(out.subpaths[0].stroke?.width).toBe(6);
    // 2つ目はアウトライン:closed・塗りは元 stroke 色・stroke は null。
    const outline = out.subpaths[1];
    expect(outline.path.closed).toBe(true);
    expect(outline.fill).toEqual(RED);
    expect(outline.stroke).toBeNull();
    // 点列は単体ヘルパと一致。
    const expected = strokeToOutlinePath(lShape, { width: 6 });
    expect(outline.path.points).toEqual(expected!.points);
  });

  it('replace=true は元 subpath を置き換える', () => {
    const out = outlineVectorData(data, { replace: true });
    expect(out.subpaths.length).toBe(1);
    expect(out.subpaths[0].path.closed).toBe(true);
    expect(out.subpaths[0].stroke).toBeNull();
  });

  it('入力データは不変(参照非破壊)', () => {
    const before = JSON.stringify(data);
    outlineVectorData(data);
    expect(JSON.stringify(data)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// transformVectorData / rotate / skew / mirror — パス変換(US-4503 委譲)
// ---------------------------------------------------------------------------

describe('パス変換ヘルパ(US-4503 委譲)', () => {
  const data: VectorLayerData = createVectorLayerData({
    subpaths: [
      { path: lShape, fill: BLUE, stroke: null },
      {
        path: { points: [{ x: 2, y: 2 }, { x: 8, y: 4 }], closed: false },
        fill: null,
        stroke: { color: RED, width: 2 },
      },
    ],
  });

  it('transformVectorData は全 subpath に applyMatrixToPath 単体と同一適用', () => {
    const mat = rotationMat(0.5);
    const out = transformVectorData(data, mat);
    out.subpaths.forEach((sub, i) => {
      expect(sub.path).toEqual(applyMatrixToPath(data.subpaths[i].path, mat));
    });
  });

  it('rotateVectorData は各 subpath で rotatePath 単体と一致(中心既定=各重心)', () => {
    const out = rotateVectorData(data, 0.3);
    out.subpaths.forEach((sub, i) => {
      expect(sub.path).toEqual(rotatePath(data.subpaths[i].path, 0.3));
    });
  });

  it('rotateVectorData は明示中心でも rotatePath 単体と一致', () => {
    const out = rotateVectorData(data, 0.3, 5, 5);
    out.subpaths.forEach((sub, i) => {
      expect(sub.path).toEqual(rotatePath(data.subpaths[i].path, 0.3, 5, 5));
    });
  });

  it('skewVectorData は各 subpath で skewPath 単体と一致', () => {
    const out = skewVectorData(data, 0.4, -0.2);
    out.subpaths.forEach((sub, i) => {
      expect(sub.path).toEqual(skewPath(data.subpaths[i].path, 0.4, -0.2));
    });
  });

  it('mirrorVectorData(axis=y) は各 subpath で mirrorPath 単体と一致', () => {
    const out = mirrorVectorData(data, 'y');
    out.subpaths.forEach((sub, i) => {
      expect(sub.path).toEqual(mirrorPath(data.subpaths[i].path, 'y'));
    });
  });

  it('mirrorVectorData(axis=x, pivot指定) も一致', () => {
    const pivot = { x: 0, y: 0 };
    const out = mirrorVectorData(data, 'x', pivot);
    out.subpaths.forEach((sub, i) => {
      expect(sub.path).toEqual(mirrorPath(data.subpaths[i].path, 'x', pivot));
    });
  });

  it('変換は fill/stroke メタを保持しパスのみ更新', () => {
    const out = transformVectorData(data, rotationMat(0.1));
    expect(out.subpaths[0].fill).toEqual(BLUE);
    expect(out.subpaths[1].stroke?.color).toEqual(RED);
  });

  it('入力データは不変(参照非破壊)', () => {
    const before = JSON.stringify(data);
    rotateVectorData(data, 0.7);
    mirrorVectorData(data, 'y');
    expect(JSON.stringify(data)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 既存ベクター操作の回帰(最小)
// ---------------------------------------------------------------------------

describe('既存ベクター操作の回帰', () => {
  it('createVectorLayerData は subpath を保持しつつ独立クローンを返す', () => {
    const data = createVectorLayerData({
      subpaths: [{ path: lShape, fill: RED, stroke: null }],
    });
    expect(data.subpaths.length).toBe(1);
    expect(data.subpaths[0].fill).toEqual(RED);
    // クローン独立性:元 lShape を変更してもデータに波及しない。
    expect(data.subpaths[0].path).not.toBe(lShape);
    expect(data.subpaths[0].path.points).toEqual(lShape.points);
  });
});
