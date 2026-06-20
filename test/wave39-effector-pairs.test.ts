import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findEffectorCurves,
  resampleEffectorCurve,
  samplePressureCurve,
  selectBrushPressureCurves,
} from '../src/io/sut-pressure';

/* ------------------------------------------------------------------ */
/* fixture ビルダ(wave38 と同形だが自前で構築)                          */
/* ------------------------------------------------------------------ */

/**
 * Effector レコード([前段32B][12][N][16][N×(x,y) f64BE ペア])を組み立てる。
 * 実 .sut のレイアウト(src/io/sut-pressure.ts コメント)に従う。
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
  view.setInt32(0, amount, false); // -32: 効果量(enabled 判定)
  view.setUint32(4, inputSource, false); // -28: 入力源様
  view.setInt32(8, offset, false); // -24: オフセット様(符号付き)
  view.setUint32(12, 0, false); // -20: 予約 0
  view.setUint32(16, 12 + 16 * n, false); // -16: カーブ1 長さ = 12+16N
  view.setUint32(20, 0, false); // -12: 随伴カーブ2なし
  view.setUint32(24, range, false); // -8: 範囲上限様
  view.setUint32(28, 0, false); // -4: 予約 0
  view.setUint32(32, 12, false);
  view.setUint32(36, n, false);
  view.setUint32(40, 16, false);
  pairs.forEach(([x, y], i) => {
    view.setFloat64(44 + i * 16, x, false);
    view.setFloat64(44 + i * 16 + 8, y, false);
  });
  return bytes;
}

/** チャンクを 0xAA パディングで連結(偶発署名一致を避ける)。 */
function concatWithJunk(...chunks: Uint8Array[]): Uint8Array {
  const pad = new Uint8Array(24).fill(0xaa);
  const parts: Uint8Array[] = [pad];
  for (const c of chunks) parts.push(c, new Uint8Array(24).fill(0xaa));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* (1) decodeEffectorAt が (x,y) ペアを格納する                          */
/* ------------------------------------------------------------------ */

describe('EffectorCurve.pairs', () => {
  it('非一様 x 配置のペア列を (x,y) として正しく格納する', () => {
    const blob = concatWithJunk(
      makeEffectorRecord({
        pairs: [
          [0, 0],
          [0.9, 0.1],
          [1, 1],
        ],
      }),
    );
    const effs = findEffectorCurves(blob);
    expect(effs).toHaveLength(1);
    expect(effs[0].pairs).toEqual([
      { x: 0, y: 0 },
      { x: 0.9, y: 0.1 },
      { x: 1, y: 1 },
    ]);
    // 従来の「先頭 N float」表現は x 列(0, 0.9, 1)を points にしている。
    expect(effs[0].curve.points[0]).toBeCloseTo(0, 6);
    expect(effs[0].curve.points[1]).toBeCloseTo(0, 6); // = y0 (先頭Nは x0,y0,x1)
    expect(effs[0].curve.points[2]).toBeCloseTo(0.9, 6);
  });
});

/* ------------------------------------------------------------------ */
/* (2) resampleEffectorCurve: 線形補間の正確性                          */
/* ------------------------------------------------------------------ */

describe('resampleEffectorCurve', () => {
  it('非一様ペアを (x,y) 解釈で正しく線形補間する(旧 N-float 表現と異なる)', () => {
    // (0,0),(0.9,0.1),(1,1): 区間 [0,0.9] は傾き 0.1/0.9、[0.9,1] は傾き 0.9/0.1。
    // 出力点 i は t = i/(M-1) の y。M=10 → t = 0, 1/9, ... , 1。
    const pairs = [
      { x: 0, y: 0 },
      { x: 0.9, y: 0.1 },
      { x: 1, y: 1 },
    ];
    const M = 10;
    const curve = resampleEffectorCurve(pairs, M);
    // 期待値を区分線形で直接計算して各出力点を厳密検証。
    const expected = (t: number) =>
      t <= 0.9 ? (0.1 / 0.9) * t : 0.1 + ((t - 0.9) / 0.1) * 0.9;
    for (let i = 0; i < M; i++) {
      const t = i / (M - 1);
      expect(curve.points[i]).toBeCloseTo(expected(t), 6);
    }
    // 旧「先頭 N float」表現 [0, 0, 0.9] では t=0.5 が約 0(i0=1,i1=2 間)になるが、
    // 正規化後は t=0.5 ≈ 0.0556(区間 [0,0.9] 上)で明確に異なる形状。
    expect(expected(0.5)).toBeCloseTo(0.0556, 3);
  });

  it('単一ペアは y を M 個複製、空ペアは空 points', () => {
    expect(resampleEffectorCurve([{ x: 0.3, y: 0.7 }], 5).points).toEqual([
      0.7, 0.7, 0.7, 0.7, 0.7,
    ]);
    expect(resampleEffectorCurve([], 5).points).toEqual([]);
  });

  it('端点クランプ: x<先頭 / x>末尾 は端点 y を採る', () => {
    // ペアが x=0.2..0.8 にしか無い場合、t<0.2 は y(0.2)、t>0.8 は y(0.8)。
    const pairs = [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.9 },
    ];
    const curve = resampleEffectorCurve(pairs, 11); // t = 0, .1, ... 1
    expect(curve.points[0]).toBeCloseTo(0.3, 6); // t=0 → クランプ
    expect(curve.points[1]).toBeCloseTo(0.3, 6); // t=0.1 < 0.2 → クランプ
    expect(curve.points[10]).toBeCloseTo(0.9, 6); // t=1 → クランプ
    expect(curve.points[9]).toBeCloseTo(0.9, 6); // t=0.9 > 0.8 → クランプ
    // 中間 t=0.5 は [0.2,0.8] 上の補間 → 0.3 + (0.9-0.3)*((0.5-0.2)/0.6)=0.6。
    expect(curve.points[5]).toBeCloseTo(0.6, 6);
  });

  it('x 重複は後者優先(決定論)', () => {
    // x=0.5 が 2 つ。後者(y=0.9)を採用する。
    const pairs = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.1 },
      { x: 0.5, y: 0.9 },
      { x: 1, y: 1 },
    ];
    const curve = resampleEffectorCurve(pairs, 3); // t = 0, 0.5, 1
    expect(curve.points[0]).toBeCloseTo(0, 6);
    expect(curve.points[1]).toBeCloseTo(0.9, 6); // 後者優先
    expect(curve.points[2]).toBeCloseTo(1, 6);
  });

  it('入力順が乱れていても x 昇順に安定ソートして補間する', () => {
    const pairs = [
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
    ];
    const curve = resampleEffectorCurve(pairs, 5); // t=0,.25,.5,.75,1
    expect(curve.points).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

/* ------------------------------------------------------------------ */
/* (3) selectBrushPressureCurves: 正規化と恒等カーブ除外                 */
/* ------------------------------------------------------------------ */

describe('selectBrushPressureCurves normalize', () => {
  it('恒等カーブ (0,0),(1,1) は正規化後も除外される', () => {
    const blob = concatWithJunk(
      makeEffectorRecord({
        amount: 100,
        pairs: [
          [0, 0],
          [1, 1],
        ],
      }),
    );
    // 正規化なし(既定): 先頭 N float = [0,0] → flat → 除外。
    expect(selectBrushPressureCurves(blob)).toHaveLength(0);
    // 正規化あり: 線形ランプ → curveIsIdentityRamp で除外。
    expect(selectBrushPressureCurves(blob, { normalize: true })).toHaveLength(0);
  });

  it('normalize=true は非一様カーブを再サンプル済み形状で返す', () => {
    // 高しきい値応答 (0,0),(0.9,0),(1,1): 0.9 まで 0、その後 1 へ急上昇。
    const blob = concatWithJunk(
      makeEffectorRecord({
        amount: 100,
        pairs: [
          [0, 0],
          [0.9, 0],
          [1, 1],
        ],
      }),
    );
    const curves = selectBrushPressureCurves(blob, { normalize: true });
    expect(curves).toHaveLength(1);
    const c = curves[0];
    // t=0.5 は依然ほぼ 0(しきい値 0.9 未満)。
    expect(samplePressureCurve(c, 0.5)).toBeLessThan(0.05);
    // t=0.95 は [0.9,1] 区間上で約 0.5。
    expect(samplePressureCurve(c, 0.95)).toBeCloseTo(0.5, 1);
    // 単調非減少であること。
    for (let i = 1; i < c.points.length; i++) {
      expect(c.points[i]).toBeGreaterThanOrEqual(c.points[i - 1] - 1e-9);
    }
  });

  it('既定(normalize=false)は従来の先頭 N float 表現を返す(後方互換)', () => {
    const blob = concatWithJunk(
      makeEffectorRecord({
        amount: 100,
        pairs: [
          [0, 0],
          [0.5, 0.7],
          [1, 1],
        ],
      }),
    );
    const curves = selectBrushPressureCurves(blob);
    expect(curves).toHaveLength(1);
    // 先頭 N float = [x0, y0, x1] = [0, 0, 0.5]。
    expect(curves[0].points[2]).toBeCloseTo(0.5, 6);
  });
});

/* ------------------------------------------------------------------ */
/* (+) 実 .sut ファイル回帰(assetpass がある環境のみ)                    */
/* ------------------------------------------------------------------ */

const assetDir = join(process.cwd(), 'assetpass');
const sutFiles = existsSync(assetDir)
  ? readdirSync(assetDir).filter((f) => f.endsWith('.sut'))
  : [];

describe.skipIf(sutFiles.length === 0)('real .sut files (assetpass) normalize 回帰', () => {
  it('normalize=true でも従来と同数のカーブを返し、各カーブが単調非減少', () => {
    for (const f of sutFiles) {
      const bytes = new Uint8Array(readFileSync(join(assetDir, f)));
      const legacy = selectBrushPressureCurves(bytes);
      const normalized = selectBrushPressureCurves(bytes, { normalize: true });
      // 同数(回帰: カーブの取りこぼし/増殖がない)。
      expect(normalized.length, f).toBe(legacy.length);
      // 各カーブが単調非減少のまま(形状の健全性)。
      for (const c of normalized) {
        for (let i = 1; i < c.points.length; i++) {
          expect(c.points[i], f).toBeGreaterThanOrEqual(c.points[i - 1] - 1e-6);
        }
      }
    }
  });

  it('実ファイルの enabled な Effector ペアは全て x 昇順 0..1', () => {
    for (const f of sutFiles) {
      const bytes = new Uint8Array(readFileSync(join(assetDir, f)));
      for (const eff of findEffectorCurves(bytes)) {
        let prevX = -Infinity;
        for (const p of eff.pairs) {
          expect(p.x, f).toBeGreaterThanOrEqual(0);
          expect(p.x, f).toBeLessThanOrEqual(1);
          expect(p.y, f).toBeGreaterThanOrEqual(0);
          expect(p.y, f).toBeLessThanOrEqual(1);
          expect(p.x, f).toBeGreaterThanOrEqual(prevX - 1e-9);
          prevX = p.x;
        }
      }
    }
  });
});
