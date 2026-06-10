// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import initSqlJs from 'sql.js';

import { createPresetLibrary } from '../src/engine/brush-presets';
import { useStore } from '../src/state/store';
import { DEFAULT_BRUSH, type BrushSettings, type PointerSample } from '../src/types';
import type { TipAlpha } from '../src/engine/tip-stamp';

function locateWasm(): string {
  return path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
}

/** CRC-32 (PNG 多項式) を計算する最小実装(wave36-wiring と同形)。 */
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

/** スプレー設定付きの合成 .sut(SQLite)を作る(wave36 フィクスチャの拡張)。 */
async function createSpraySutBrush(
  name: string,
  size: number,
  spraySize: number,
  sprayDensity: number,
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
        'Opacity INT, BrushSize REAL, BrushFlow INT, BrushHardness INT, BrushInterval REAL, AntiAlias INT, ' +
        'BrushUseSpray INT, BrushSpraySize REAL, BrushSprayDensity INT);',
    );
    db.run(
      'INSERT INTO Variant (Opacity, BrushSize, BrushFlow, BrushHardness, BrushInterval, AntiAlias, ' +
        'BrushUseSpray, BrushSpraySize, BrushSprayDensity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);',
      [80, size, 90, 50, 20, 3, 1, spraySize, sprayDensity],
    );
    db.run('CREATE TABLE MaterialFile (MaterialName TEXT, MaterialData BLOB);');
    db.run('INSERT INTO MaterialFile (MaterialName, MaterialData) VALUES (?, ?);', [
      `${name}-tip`,
      materialData,
    ]);

    return db.export();
  } finally {
    db.close();
  }
}

/** 固定 RGBA(4x4 中央 2x2 不透明)を返す decodeTip スタブ(wave36 と同形)。 */
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

/** 非対称(横長バー 7x1)tip。方向追従回転の効果が分かりやすい形状。 */
function makeBarTip(): TipAlpha {
  const width = 7;
  const height = 1;
  const data = new Float32Array(width * height).fill(1);
  return { width, height, data };
}

/** 小さな正方形 2x2 tip。散布の広がり計測用。 */
function makeDotTip(): TipAlpha {
  const width = 2;
  const height = 2;
  const data = new Float32Array(width * height).fill(1);
  return { width, height, data };
}

const DOC_W = 32;
const DOC_H = 32;

/**
 * 指定ブラシで 1 ストローク描き、ストローク前後のレイヤー画素を返す。
 * 各呼び出しで newDocument し直すので相互に独立・決定論的。
 */
function runStroke(
  brushPatch: Partial<BrushSettings>,
  samples: PointerSample[],
): { before: Uint8ClampedArray; after: Uint8ClampedArray } {
  useStore.getState().newDocument(DOC_W, DOC_H, 'wave37 wiring');
  useStore.setState({ brush: { ...DEFAULT_BRUSH, ...brushPatch } });

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

/**
 * before との差分がある画素の x 座標範囲(min/max)を返す。差分なしなら null。
 * yMin を指定すると y >= yMin の行のみ対象(先頭シード打点は方向未定義で
 * 回転しないため、追従効果の計測時はシード打点の行を除外する)。
 */
function changedXRange(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  yMin = 0,
): { minX: number; maxX: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  for (let p = yMin * DOC_W; p < DOC_W * DOC_H; p += 1) {
    const o = p * 4;
    if (
      before[o] !== after[o] ||
      before[o + 1] !== after[o + 1] ||
      before[o + 2] !== after[o + 2] ||
      before[o + 3] !== after[o + 3]
    ) {
      const x = p % DOC_W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  return Number.isFinite(minX) ? { minX, maxX } : null;
}

/** 縦方向ストローク(x=16 固定)。方向追従で tip が 90° 回るはず。 */
const VERTICAL_STROKE: PointerSample[] = [
  { x: 16, y: 6, pressure: 1, t: 0 },
  { x: 16, y: 16, pressure: 1, t: 16 },
  { x: 16, y: 26, pressure: 1, t: 32 },
];

describe('wave37 tip live wiring (US-3904)', () => {
  beforeEach(() => {
    useStore.getState().newDocument(DOC_W, DOC_H, 'wave37 wiring');
    useStore.setState({
      brush: { ...DEFAULT_BRUSH },
      brushPresets: createPresetLibrary(),
    });
  });

  it('tipFollowStroke rotates an asymmetric tip live (vertical stroke differs from non-follow)', () => {
    const base: Partial<BrushSettings> = {
      tip: makeBarTip(),
      size: 8,
      spacing: 0.5,
      opacity: 1,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
    };

    const plain = runStroke({ ...base, tipFollowStroke: false }, VERTICAL_STROKE);
    const follow = runStroke({ ...base, tipFollowStroke: true }, VERTICAL_STROKE);

    // 両方とも実際に描けている。
    expect(pixelsEqual(plain.before, plain.after)).toBe(false);
    expect(pixelsEqual(follow.before, follow.after)).toBe(false);
    // 方向追従回転がライブで効くので結果が異なる。
    expect(pixelsEqual(plain.after, follow.after)).toBe(false);

    // 横長バー tip が縦ストロークで 90° 回るため、追従時は x 方向の広がりが狭くなる。
    // 先頭シード打点(y=6 付近)は方向未定義で回転しないため、y>=12 の行のみ計測する。
    const plainRange = changedXRange(plain.before, plain.after, 12)!;
    const followRange = changedXRange(follow.before, follow.after, 12)!;
    expect(followRange.maxX - followRange.minX).toBeLessThan(plainRange.maxX - plainRange.minX);
  });

  it('tipScatter/tipScatterDensity spread stamps deterministically', () => {
    const base: Partial<BrushSettings> = {
      tip: makeDotTip(),
      size: 2,
      spacing: 1,
      opacity: 1,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
    };

    const single = runStroke(base, VERTICAL_STROKE);
    const scattered = runStroke({ ...base, tipScatter: 6, tipScatterDensity: 8 }, VERTICAL_STROKE);
    const scatteredAgain = runStroke(
      { ...base, tipScatter: 6, tipScatterDensity: 8 },
      VERTICAL_STROKE,
    );

    // 散布が効いて結果が変わる。
    expect(pixelsEqual(single.after, scattered.after)).toBe(false);
    // x=16 の縦ストロークなので、散布で x 方向の広がりが増える。
    const singleRange = changedXRange(single.before, single.after)!;
    const scatterRange = changedXRange(scattered.before, scattered.after)!;
    expect(scatterRange.maxX - scatterRange.minX).toBeGreaterThan(
      singleRange.maxX - singleRange.minX,
    );
    // seed 付き PRNG のみ使用 → 同入力は必ず同出力(決定論)。
    expect(pixelsEqual(scattered.after, scatteredAgain.after)).toBe(true);
  });

  it('tip-less brushes are byte-identical even when tip-only fields are set (regression)', () => {
    const legacy = runStroke({}, VERTICAL_STROKE);
    const withTipFields = runStroke(
      {
        // tip が無い限り、これらのフィールドは描画へ一切影響しない。
        tipFollowStroke: true,
        tipAngle: 0.7,
        tipAngleJitter: 0.5,
        tipScatter: 10,
        tipScatterDensity: 8,
      },
      VERTICAL_STROKE,
    );

    expect(pixelsEqual(legacy.before, legacy.after)).toBe(false);
    expect(pixelsEqual(legacy.after, withTipFields.after)).toBe(true);
  });

  it('addSample step stays unchanged when tip or curve is missing (regression)', () => {
    const samples: PointerSample[] = [
      { x: 6, y: 16, pressure: 0.5, t: 0 },
      { x: 16, y: 16, pressure: 0.5, t: 16 },
      { x: 26, y: 16, pressure: 0.5, t: 32 },
    ];

    // tip 無し: pressureSizeCurve が居ても step/coverage は従来と完全一致。
    const legacy = runStroke({}, samples);
    const withCurve = runStroke(
      { pressureSizeCurve: { points: [0.2, 0.2] }, pressureFlowCurve: { points: [0.5, 0.5] } },
      samples,
    );
    expect(pixelsEqual(legacy.after, withCurve.after)).toBe(true);

    // tip 有り + フラット(=1)カーブ: 倍率 1 なので curve 無しと完全一致(退化確認)。
    const tipBase: Partial<BrushSettings> = {
      tip: makeDotTip(),
      size: 4,
      spacing: 0.5,
      opacity: 1,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
    };
    const tipNoCurve = runStroke(tipBase, samples);
    const tipFlatCurve = runStroke(
      { ...tipBase, pressureSizeCurve: { points: [1, 1] } },
      samples,
    );
    expect(pixelsEqual(tipNoCurve.after, tipFlatCurve.after)).toBe(true);

    // tip 有り + 非フラットカーブ: step/サイズに倍率が反映され結果が変わる(US-3904 修正の正方向確認)。
    const tipScaledCurve = runStroke(
      { ...tipBase, pressureSizeCurve: { points: [0.25, 0.25] } },
      samples,
    );
    expect(pixelsEqual(tipNoCurve.after, tipScaledCurve.after)).toBe(false);
  });

  it('importSutBrush maps spray settings into tipScatter/tipScatterDensity (US-3903 wiring)', async () => {
    const bytes = await createSpraySutBrush('spray-brush', 40, 12, 5, makeMinimalPng());

    await useStore.getState().importSutBrush(bytes, { decodeTip: makeTipDecodeStub() });

    const state = useStore.getState();
    // tip 本体もデコードされている。
    expect(state.brush.tip).toBeTruthy();
    // BrushSpraySize=12 → tipScatter=12(径 40 の 2 倍上限内)。
    expect(state.brush.tipScatter).toBe(12);
    // BrushSprayDensity=5 → 1..16 に丸めて 5。
    expect(state.brush.tipScatterDensity).toBe(5);
    // preset にも同じ settings が載る(applyBrushPreset で復元可能)。
    expect(state.brushPresets.presets).toHaveLength(1);
    expect(state.brushPresets.presets[0].settings.tipScatter).toBe(12);
    expect(state.brushPresets.presets[0].settings.tipScatterDensity).toBe(5);
  });
});
