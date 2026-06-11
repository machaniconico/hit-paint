// @vitest-environment jsdom
/**
 * Wave38 / US-4004 — symmetry の回転鏡映(mirrorPointsWithMeta)と
 * importSutBrush の筆圧カーブ選択委譲(selectBrushPressureCurves)の検証。
 *
 * Wave37 low 指摘: symmetry 有効時、tip の回転角が全ミラー点へそのまま
 * 渡されており、鏡映コピーの向きが「鏡映」になっていなかった。
 * US-4004 では各ミラー点に角度変換メタ {flip, rotate} を付与し、
 * 実回転 = flip ? (rotate - θ) : (rotate + θ) で鏡映を成立させる。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import initSqlJs from 'sql.js';

import { mirrorPoints, mirrorPointsWithMeta, type SymmetryConfig } from '../src/engine/symmetry';
import { stampTip, type TipAlpha } from '../src/engine/tip-stamp';
import {
  findPressureCurves,
  curveIsFlat,
  curveLooksLikePressureResponse,
} from '../src/io/sut-pressure';
import { createPresetLibrary } from '../src/engine/brush-presets';
import { useStore } from '../src/state/store';
import { DEFAULT_BRUSH, type BrushSettings, type PointerSample } from '../src/types';

function locateWasm(): string {
  return path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
}

/* ------------------------------------------------------------------ */
/* フィクスチャ(wave37-wiring.test.ts と同形)                          */
/* ------------------------------------------------------------------ */

/** CRC-32 (PNG 多項式) を計算する最小実装(wave37-wiring と同形)。 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32be(data.length), 0);
  out.set(body, 4);
  out.set(u32be(crc32(body)), 4 + body.length);
  return out;
}

/** 署名 + IHDR(1x1) + 空 IDAT + IEND の最小 PNG(extractPngFromBlob 用)。 */
function makeMinimalPng(): Uint8Array {
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(1), 0);
  ihdr.set(u32be(1), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', new Uint8Array(0));
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let off = 0;
  out.set(signature, off);
  off += signature.length;
  out.set(ihdrChunk, off);
  off += ihdrChunk.length;
  out.set(idatChunk, off);
  off += idatChunk.length;
  out.set(iendChunk, off);
  return out;
}

/** カーブ署名 [u32BE=12][u32BE=N][u32BE=16][N×float64BE] をエンコードする。 */
function encodeCurve(points: number[]): Uint8Array {
  const out = new Uint8Array(12 + points.length * 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, 12, false);
  view.setUint32(4, points.length, false);
  view.setUint32(8, 16, false);
  for (let i = 0; i < points.length; i += 1) {
    view.setFloat64(12 + i * 8, points[i], false);
  }
  return out;
}

/** 筆圧カーブ blob を同梱した合成 .sut(SQLite)を作る(wave37 フィクスチャの拡張)。 */
async function createCurveSutBrush(
  name: string,
  size: number,
  curveData: Uint8Array,
  materialData: Uint8Array,
): Promise<Uint8Array> {
  const SQL = await initSqlJs({ locateFile: locateWasm });
  const db = new SQL.Database();

  try {
    db.run('CREATE TABLE Manager (ToolType INTEGER, Version INTEGER);');
    db.run('INSERT INTO Manager (ToolType, Version) VALUES (?, ?);', [0, 145]);
    db.run('CREATE TABLE Node (NodeName TEXT);');
    db.run('INSERT INTO Node (NodeName) VALUES (?);', [name]);
    db.run(
      'CREATE TABLE Variant (' +
        'Opacity INT, BrushSize REAL, BrushFlow INT, BrushHardness INT, BrushInterval REAL, AntiAlias INT);',
    );
    db.run(
      'INSERT INTO Variant (Opacity, BrushSize, BrushFlow, BrushHardness, BrushInterval, AntiAlias) ' +
        'VALUES (?, ?, ?, ?, ?, ?);',
      [80, size, 90, 50, 20, 3],
    );
    db.run('CREATE TABLE MaterialFile (MaterialName TEXT, MaterialData BLOB);');
    db.run('INSERT INTO MaterialFile (MaterialName, MaterialData) VALUES (?, ?);', [
      `${name}-tip`,
      materialData,
    ]);
    db.run('INSERT INTO MaterialFile (MaterialName, MaterialData) VALUES (?, ?);', [
      `${name}-curve`,
      curveData,
    ]);

    return db.export();
  } finally {
    db.close();
  }
}

/** 固定 RGBA(4x4 中央 2x2 不透明)を返す decodeTip スタブ(wave37 と同形)。 */
function makeTipDecodeStub(): (
  png: Uint8Array,
) => Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  const w = 4;
  const h = 4;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = (y * w + x) * 4;
      const inside = x >= 1 && x <= 2 && y >= 1 && y <= 2;
      data[idx + 3] = inside ? 255 : 0;
    }
  }
  return async () => ({ data, width: w, height: h });
}

/* ------------------------------------------------------------------ */
/* tip / ストロークヘルパ                                              */
/* ------------------------------------------------------------------ */

/**
 * 両軸対称な細長楕円 tip(既定 8x2)。x/y どちらの反転にも不変なので、
 * 「θ→π-θ の純回転」がそのまま正確な鏡映スタンプになる形状。
 */
function makeEllipseTip(width = 8, height = 2): TipAlpha {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = (x + 0.5 - width / 2) / (width / 2);
      const ny = (y + 0.5 - height / 2) / (height / 2);
      data[y * width + x] = nx * nx + ny * ny <= 1 ? 1 : 0;
    }
  }
  return { width, height, data };
}

const DOC_W = 32;
const DOC_H = 32;

/**
 * 指定ブラシ + symmetry で 1 ストローク描き、前後のレイヤー画素を返す。
 * 各呼び出しで newDocument し直すので相互に独立・決定論的。
 */
function runStroke(
  brushPatch: Partial<BrushSettings>,
  samples: PointerSample[],
  symmetryPatch?: Partial<SymmetryConfig>,
): { before: Uint8ClampedArray; after: Uint8ClampedArray } {
  useStore.getState().newDocument(DOC_W, DOC_H, 'wave38 symmetry tip');
  useStore.setState({ brush: { ...DEFAULT_BRUSH, ...brushPatch } });
  if (symmetryPatch) {
    useStore.getState().setSymmetry(symmetryPatch);
  }

  const doc0 = useStore.getState().doc;
  const layer0 = doc0.layers.find((l) => l.id === doc0.activeLayerId)!;
  const before = layer0.pixels!.slice();

  useStore.getState().beginStroke(samples[0]);
  for (let i = 1; i < samples.length; i += 1) {
    useStore.getState().extendStroke(samples[i]);
  }
  useStore.getState().endStroke();

  const doc = useStore.getState().doc;
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
  return { before, after: layer.pixels!.slice() };
}

function pixelsEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** FNV-1a 32bit。ゴールデン回帰用の決定論的ハッシュ。 */
function fnv1a(bytes: Uint8ClampedArray): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** coverage(Float32Array)の x=W/2 鏡映対称からの最大ズレ。 */
function coverageMirrorDiff(cov: Float32Array, w: number, h: number): number {
  let max = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const d = Math.abs(cov[y * w + x] - cov[y * w + (w - 1 - x)]);
      if (d > max) max = d;
    }
  }
  return max;
}

/** RGBA 画素列の x=W/2 鏡映対称からの最大ズレ(チャネル単位)。 */
function pixelMirrorDiff(pixels: Uint8ClampedArray, w: number, h: number): number {
  let max = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = (y * w + x) * 4;
      const b = (y * w + (w - 1 - x)) * 4;
      for (let c = 0; c < 4; c += 1) {
        const d = Math.abs(pixels[a + c] - pixels[b + c]);
        if (d > max) max = d;
      }
    }
  }
  return max;
}

/* ------------------------------------------------------------------ */
/* テスト本体                                                          */
/* ------------------------------------------------------------------ */

describe('wave38 symmetry tip rotation + curve selection (US-4004)', () => {
  beforeEach(() => {
    useStore.getState().newDocument(DOC_W, DOC_H, 'wave38 symmetry tip');
    useStore.setState({
      brush: { ...DEFAULT_BRUSH },
      brushPresets: createPresetLibrary(),
    });
  });

  it('mirrorPointsWithMeta returns the exact same coordinates as mirrorPoints (h/v/both/radial)', () => {
    const configs: SymmetryConfig[] = [
      { mode: 'horizontal', centerX: 10, centerY: 12 },
      { mode: 'vertical', centerX: 10, centerY: 12 },
      { mode: 'both', centerX: 10, centerY: 12 },
      { mode: 'radial', centerX: 10, centerY: 12, slices: 5 },
    ];

    for (const cfg of configs) {
      const meta = mirrorPointsWithMeta(7, 4, cfg);
      // 座標列は mirrorPoints と完全同一。
      expect(meta.map((p) => ({ x: p.x, y: p.y }))).toEqual(mirrorPoints(7, 4, cfg));
      // 先頭要素は必ず元の点(無変換)。
      expect(meta[0].flip).toBe(false);
      expect(meta[0].rotate).toBe(0);
    }

    // none も単一・無変換。
    const none = mirrorPointsWithMeta(7, 4, { mode: 'none', centerX: 10, centerY: 12 });
    expect(none).toEqual([{ x: 7, y: 4, flip: false, rotate: 0 }]);
  });

  it('angle meta maps direction vectors correctly (horizontal: θ→π-θ, vertical: θ→-θ, both/radial)', () => {
    const cfgBase = { centerX: 16, centerY: 16 };
    const apply = (meta: { flip: boolean; rotate: number }, theta: number): number =>
      meta.flip ? meta.rotate - theta : meta.rotate + theta;

    for (const theta of [0.3, 1.1]) {
      // horizontal(垂直軸鏡映): 方向ベクトル (cosθ, sinθ) → (-cosθ, sinθ)。
      const h = mirrorPointsWithMeta(7, 4, { mode: 'horizontal', ...cfgBase });
      const th = apply(h[1], theta);
      expect(Math.cos(th)).toBeCloseTo(-Math.cos(theta), 12);
      expect(Math.sin(th)).toBeCloseTo(Math.sin(theta), 12);

      // vertical(水平軸鏡映): (cosθ, sinθ) → (cosθ, -sinθ)。
      const v = mirrorPointsWithMeta(7, 4, { mode: 'vertical', ...cfgBase });
      const tv = apply(v[1], theta);
      expect(Math.cos(tv)).toBeCloseTo(Math.cos(theta), 12);
      expect(Math.sin(tv)).toBeCloseTo(-Math.sin(theta), 12);

      // both の第4要素は 180° 回転コピー: (cosθ, sinθ) → (-cosθ, -sinθ)。
      const b = mirrorPointsWithMeta(7, 4, { mode: 'both', ...cfgBase });
      const tb = apply(b[3], theta);
      expect(b[3].flip).toBe(false);
      expect(Math.cos(tb)).toBeCloseTo(-Math.cos(theta), 12);
      expect(Math.sin(tb)).toBeCloseTo(-Math.sin(theta), 12);

      // radial はセクタ k の純回転 2πk/n。
      const r = mirrorPointsWithMeta(7, 4, { mode: 'radial', ...cfgBase, slices: 5 });
      for (let k = 0; k < 5; k += 1) {
        expect(r[k].flip).toBe(false);
        expect(r[k].rotate).toBeCloseTo((Math.PI * 2 * k) / 5, 12);
      }
    }
  });

  it('engine-level: π-θ rotation makes the mirrored stamp symmetric, same-θ (Wave37) does not', () => {
    const W = 32;
    const H = 16;
    const tip = makeEllipseTip();
    const theta = Math.PI / 6;

    // Wave37 相当: 両側とも同じ回転 θ → 鏡映にならない(対比ケース)。
    const covOld = new Float32Array(W * H);
    stampTip(covOld, W, H, tip, { x: 10, y: 8, size: 8, rotation: theta, flow: 1 });
    stampTip(covOld, W, H, tip, { x: 22, y: 8, size: 8, rotation: theta, flow: 1 });
    expect(coverageMirrorDiff(covOld, W, H)).toBeGreaterThan(0.2);

    // US-4004: 鏡映側は π-θ → 両軸対称 tip では正確な鏡映になる。
    const covNew = new Float32Array(W * H);
    stampTip(covNew, W, H, tip, { x: 10, y: 8, size: 8, rotation: theta, flow: 1 });
    stampTip(covNew, W, H, tip, { x: 22, y: 8, size: 8, rotation: Math.PI - theta, flow: 1 });
    expect(coverageMirrorDiff(covNew, W, H)).toBeLessThan(1e-4);
  });

  it('store integration: horizontal symmetry + tipAngle paints a mirror-symmetric result', () => {
    const brush: Partial<BrushSettings> = {
      tip: makeEllipseTip(),
      size: 8,
      spacing: 0.5,
      opacity: 1,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
      tipAngle: Math.PI / 6,
    };
    // 単一打点(x=10)。鏡映コピーは x=22(centerX=16)。
    const samples: PointerSample[] = [{ x: 10, y: 16, pressure: 1, t: 0 }];
    const { before, after } = runStroke(brush, samples, { mode: 'horizontal', centerX: 16, centerY: 16 });

    // 実際に描けている(左半分にも差分がある)。
    expect(pixelsEqual(before, after)).toBe(false);
    let leftChanged = false;
    for (let y = 0; y < DOC_H && !leftChanged; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const o = (y * DOC_W + x) * 4;
        if (before[o + 3] !== after[o + 3] || before[o] !== after[o]) {
          leftChanged = true;
          break;
        }
      }
    }
    expect(leftChanged).toBe(true);

    // x=16 軸での鏡映一致(量子化誤差 ±1 を許容)。Wave37 までは鏡映側も
    // 同じ θ で回っていたため、この対称性は成立しなかった(engine-level の
    // 対比ケース参照)。
    expect(pixelMirrorDiff(after, DOC_W, DOC_H)).toBeLessThanOrEqual(1);
  });

  it("symmetry='none' tip stroke is byte-identical to Wave37 (golden regression)", () => {
    // ゴールデン値 0x513cb8f9 は US-4004 適用前(Wave37 の store.ts/symmetry.ts)で
    // 同一シナリオを実行して採取した FNV-1a ハッシュ。mode='none' は単一点
    // {flip:false, rotate:0} なので実回転 = 従来 rotation と完全一致する。
    const brush: Partial<BrushSettings> = {
      tip: makeEllipseTip(),
      size: 8,
      spacing: 0.5,
      opacity: 1,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
      tipAngle: Math.PI / 6,
      tipFollowStroke: true,
      tipAngleJitter: 0.4,
      tipScatter: 5,
      tipScatterDensity: 4,
    };
    const samples: PointerSample[] = [
      { x: 6, y: 6, pressure: 1, t: 0 },
      { x: 16, y: 14, pressure: 0.8, t: 16 },
      { x: 26, y: 24, pressure: 0.6, t: 32 },
    ];
    const { after } = runStroke(brush, samples);
    expect(fnv1a(after)).toBe(0x513cb8f9);
  });

  it('importSutBrush: selectBrushPressureCurves yields the same curves as the legacy inline filter', async () => {
    // 単調非減少 + 有意スパンの「本物らしい」カーブを blob として同梱する。
    const curvePoints = [0.1, 0.4, 0.7, 1.0];
    const bytes = await createCurveSutBrush(
      'curve-brush',
      40,
      encodeCurve(curvePoints),
      makeMinimalPng(),
    );

    // 従来の store.ts インラインフィルタ(Wave37 まで)と同じ選択を再現。
    const legacy = findPressureCurves(bytes).filter(
      (curve) => !curveIsFlat(curve) && curveLooksLikePressureResponse(curve),
    );
    // 同梱カーブが拾われており、比較が非自明であること。
    expect(legacy.length).toBeGreaterThanOrEqual(1);
    expect(legacy.some((c) => c.points.length === curvePoints.length)).toBe(true);

    await useStore.getState().importSutBrush(bytes, { decodeTip: makeTipDecodeStub() });

    const state = useStore.getState();
    // 置換後(selectBrushPressureCurves 委譲)も割り当て結果は従来と一致。
    expect(state.brush.pressureSizeCurve).toEqual(legacy[0]);
    expect(state.brush.pressureFlowCurve).toEqual(legacy.length >= 2 ? legacy[1] : undefined);
    // tip も従来どおりデコードされている。
    expect(state.brush.tip).toBeTruthy();
  });
});
