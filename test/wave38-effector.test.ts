import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  curveIsFlat,
  curveLooksLikePressureResponse,
  findEffectorCurves,
  findPressureCurves,
  selectBrushPressureCurves,
} from '../src/io/sut-pressure';

/* ------------------------------------------------------------------ */
/* fixture ビルダ                                                       */
/* ------------------------------------------------------------------ */

/** 前段なしのカーブブロック([12][N][16] + N×f64BE)。wave36 と同形。 */
function makeCurveBlock(values: number[]): Uint8Array {
  const bytes = new Uint8Array(12 + values.length * 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 12, false);
  view.setUint32(4, values.length, false);
  view.setUint32(8, 16, false);
  values.forEach((v, i) => view.setFloat64(12 + i * 8, v, false));
  return bytes;
}

/**
 * Effector レコード([前段32B][12][N][16][N×(x,y) f64BE ペア])を組み立てる。
 * 実 .sut で確定したレイアウト(src/io/sut-pressure.ts のコメント参照)に従う。
 */
function makeEffectorRecord(opts: {
  amount?: number;
  inputSource?: number;
  offset?: number;
  range?: number;
  pairs: Array<[number, number]>;
}): Uint8Array {
  const { amount = 100, inputSource = 0, offset = 0, range = 500, pairs } = opts;
  const n = pairs.length;
  const bytes = new Uint8Array(32 + 12 + n * 16);
  const view = new DataView(bytes.buffer);
  // 前段 8 × u32BE/i32BE。
  view.setInt32(0, amount, false); // -32: 効果量(enabled 判定)
  view.setUint32(4, inputSource, false); // -28: 入力源様
  view.setInt32(8, offset, false); // -24: オフセット様(符号付き)
  view.setUint32(12, 0, false); // -20: 予約 0
  view.setUint32(16, 12 + 16 * n, false); // -16: カーブ1 長さ = 12+16N
  view.setUint32(20, 0, false); // -12: 随伴カーブ2なし
  view.setUint32(24, range, false); // -8: 範囲上限様
  view.setUint32(28, 0, false); // -4: 予約 0
  // カーブ署名 + ペア本体。
  view.setUint32(32, 12, false);
  view.setUint32(36, n, false);
  view.setUint32(40, 16, false);
  pairs.forEach(([x, y], i) => {
    view.setFloat64(44 + i * 16, x, false);
    view.setFloat64(44 + i * 16 + 8, y, false);
  });
  return bytes;
}

/** 複数チャンクを 0xAA パディングで連結する(偶発的な署名一致を作らない)。 */
function concatWithJunk(...chunks: Uint8Array[]): Uint8Array {
  const pad = new Uint8Array(24).fill(0xaa);
  const parts: Uint8Array[] = [pad];
  for (const c of chunks) {
    parts.push(c, new Uint8Array(24).fill(0xaa));
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** store.ts L1014-1021 の現行フィルタの再現(比較基準)。 */
function currentStoreFilter(blob: Uint8Array) {
  return findPressureCurves(blob).filter(
    (curve) => !curveIsFlat(curve) && curveLooksLikePressureResponse(curve),
  );
}

/* ------------------------------------------------------------------ */
/* (1) 前段フラグの復元                                                 */
/* ------------------------------------------------------------------ */

describe('findEffectorCurves', () => {
  it('restores enabled/inputSource/range/offset from a synthetic effector record', () => {
    // ペア (0,0),(0.5,0.7),(1,1): 先頭 N float 表現では [0, 0, 0.5]。
    const blob = concatWithJunk(
      makeEffectorRecord({
        amount: 100,
        inputSource: 3,
        offset: -100,
        range: 500,
        pairs: [
          [0, 0],
          [0.5, 0.7],
          [1, 1],
        ],
      }),
    );

    const effectors = findEffectorCurves(blob);
    expect(effectors).toHaveLength(1);
    const eff = effectors[0];
    expect(eff.enabled).toBe(true);
    expect(eff.inputSource).toBe(3);
    expect(eff.offset).toBe(-100);
    expect(eff.range).toBe(500);
    expect(eff.curve.points).toHaveLength(3);
    expect(eff.curve.points[0]).toBeCloseTo(0, 6);
    expect(eff.curve.points[1]).toBeCloseTo(0, 6);
    expect(eff.curve.points[2]).toBeCloseTo(0.5, 6);
  });

  it('marks amount=0 records as disabled', () => {
    const blob = concatWithJunk(
      makeEffectorRecord({
        amount: 0,
        pairs: [
          [0, 0],
          [0.5, 0.7],
          [1, 1],
        ],
      }),
    );

    const effectors = findEffectorCurves(blob);
    expect(effectors).toHaveLength(1);
    expect(effectors[0].enabled).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* (2) 前段ゴミは除外                                                  */
  /* ---------------------------------------------------------------- */

  it('rejects a curve signature whose prefix is garbage (false-positive scope)', () => {
    // 実ファイル偽陽性と同様、前段に長さ整合のないランダム大値を置く。
    const record = makeEffectorRecord({
      pairs: [
        [0, 0],
        [0.5, 0.7],
        [1, 1],
      ],
    });
    const view = new DataView(record.buffer);
    view.setUint32(16, 1785410533, false); // -16: 長さフィールドをゴミ化
    view.setUint32(28, 2899698375, false); // -4: 予約フィールドもゴミ化
    const blob = concatWithJunk(record);

    expect(findEffectorCurves(blob)).toHaveLength(0);
    // 従来の署名走査は同じブロックを拾う(=厳密スコープだけが除外できる)。
    expect(findPressureCurves(blob).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* (3)(4) selectBrushPressureCurves                                     */
/* ------------------------------------------------------------------ */

describe('selectBrushPressureCurves', () => {
  it('prefers strict effector hits over plain signature scan results', () => {
    const blob = concatWithJunk(
      makeEffectorRecord({
        amount: 100,
        pairs: [
          [0, 0],
          [0.5, 0.7],
          [1, 1],
        ],
      }),
      // 前段なしの単調カーブ(従来走査なら拾われる)。
      makeCurveBlock([0, 0.3, 1]),
    );

    const curves = selectBrushPressureCurves(blob);
    expect(curves).toHaveLength(1);
    expect(curves[0].points[2]).toBeCloseTo(0.5, 6); // 厳密ヒット側のみ
  });

  it('falls back to the legacy filter when there is no strict hit', () => {
    // 偽陽性風の非単調カーブ + 本物らしい単調カーブ(どちらも前段なし)。
    const blob = concatWithJunk(
      makeCurveBlock([0, 0, 0.077, 0.028, 0.23, 0.066, 0.384]),
      makeCurveBlock([0, 0.5, 1]),
    );

    expect(findEffectorCurves(blob)).toHaveLength(0);
    const curves = selectBrushPressureCurves(blob);
    expect(curves).toHaveLength(1);
    expect(curves[0].points).toEqual([0, 0.5, 1]);
    // 現行 store フィルタと完全同値であること。
    expect(curves).toEqual(currentStoreFilter(blob));
  });

  it('falls back when the only effector record is disabled (amount=0)', () => {
    const blob = concatWithJunk(
      makeEffectorRecord({
        amount: 0,
        range: 100,
        pairs: [
          [0, 0],
          [0.6, 0.9],
          [1, 1],
        ],
      }),
    );

    // 厳密側 0 件 → フォールバックが同じブロックを従来走査で拾う。
    const curves = selectBrushPressureCurves(blob);
    expect(curves).toEqual(currentStoreFilter(blob));
    expect(curves).toHaveLength(1);
    expect(curves[0].points[2]).toBeCloseTo(0.6, 6);
  });

  /* ---------------------------------------------------------------- */
  /* (5) 空/短小バッファ安全性                                            */
  /* ---------------------------------------------------------------- */

  it('is safe on empty and tiny buffers', () => {
    expect(findEffectorCurves(new Uint8Array(0))).toEqual([]);
    expect(selectBrushPressureCurves(new Uint8Array(0))).toEqual([]);
    expect(findEffectorCurves(new Uint8Array(10))).toEqual([]);
    expect(selectBrushPressureCurves(new Uint8Array(31))).toEqual([]);
  });

  it('handles subarray views with non-zero byteOffset', () => {
    const record = concatWithJunk(
      makeEffectorRecord({
        pairs: [
          [0, 0],
          [0.5, 0.7],
          [1, 1],
        ],
      }),
    );
    // 大きいバッファの途中に置いた subarray(byteOffset > 0)でも同結果。
    const outer = new Uint8Array(record.length + 64).fill(0x55);
    outer.set(record, 64);
    const view = outer.subarray(64);

    expect(findEffectorCurves(view)).toHaveLength(1);
    expect(selectBrushPressureCurves(view)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* (+) 実 .sut ファイルでの互換確認(assetpass がある環境のみ)            */
/* ------------------------------------------------------------------ */

const assetDir = join(process.cwd(), 'assetpass');
const sutFiles = existsSync(assetDir)
  ? readdirSync(assetDir).filter((f) => f.endsWith('.sut'))
  : [];

describe.skipIf(sutFiles.length === 0)('real .sut files (assetpass)', () => {
  it('selectBrushPressureCurves matches the current store filter on every real file', () => {
    for (const f of sutFiles) {
      const bytes = new Uint8Array(readFileSync(join(assetDir, f)));
      const selected = selectBrushPressureCurves(bytes);
      // 現行 store フィルタと結果一致(後方互換)。
      expect(selected, f).toEqual(currentStoreFilter(bytes));
      // 偽陽性(非単調カーブ)は決して含まれない。
      for (const curve of selected) {
        expect(curveLooksLikePressureResponse(curve), f).toBe(true);
      }
    }
  });

  it('findEffectorCurves never returns the known SQLite-page false positive', () => {
    for (const f of sutFiles) {
      const bytes = new Uint8Array(readFileSync(join(assetDir, f)));
      for (const eff of findEffectorCurves(bytes)) {
        // 偽陽性は全実ファイル共通で非単調 7 点列。厳密スコープでは出ない。
        const pts = eff.curve.points;
        const isFalsePositive =
          pts.length === 7 && Math.abs(pts[2] - 0.077) < 1e-2 && pts[3] < pts[2];
        expect(isFalsePositive, f).toBe(false);
      }
    }
  });
});
