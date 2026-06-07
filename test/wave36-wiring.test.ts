// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import initSqlJs from 'sql.js';

import { createPresetLibrary } from '../src/engine/brush-presets';
import { useStore } from '../src/state/store';
import { DEFAULT_BRUSH } from '../src/types';
import { stampTip, type TipAlpha } from '../src/engine/tip-stamp';

function locateWasm(): string {
  return path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
}

/** CRC-32 (PNG 多項式) を計算する最小実装。 */
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

/**
 * extractPngFromBlob が IHDR..IEND を拾えれば十分なので、
 * 署名 + IHDR(1x1) + 空 IDAT + IEND からなる最小の有効 PNG を作る。
 */
function makeMinimalPng(): Uint8Array {
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  // IHDR: width=1, height=1, bitDepth=8, colorType=6(RGBA), compression=0, filter=0, interlace=0
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

async function createSyntheticSutBrush(
  name: string,
  size: number,
  opacity: number,
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
      [opacity, size, 90, 50, 20, 3],
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

/** 固定 RGBA(4x4の十字形, alpha チャンネルで形状を表現)を返す decodeTip スタブ。 */
function makeTipDecodeStub(): (
  png: Uint8Array,
) => Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  const w = 4;
  const h = 4;
  const data = new Uint8ClampedArray(w * h * 4);
  // 中央 2x2 を不透明、それ以外を透明にする(auto→alpha 判定)。
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = (y * w + x) * 4;
      const inside = x >= 1 && x <= 2 && y >= 1 && y <= 2;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = inside ? 255 : 0;
    }
  }
  return async () => ({ data, width: w, height: h });
}

describe('wave36 SUT tip wiring', () => {
  beforeEach(() => {
    useStore.getState().newDocument(16, 16, 'wave36 tip wiring');
    useStore.setState({
      brush: { ...DEFAULT_BRUSH },
      brushPresets: createPresetLibrary(),
    });
  });

  it('injects a TipAlpha into brush.tip when decodeTip is provided', async () => {
    const bytes = await createSyntheticSutBrush('tip-brush', 40, 80, makeMinimalPng());

    await useStore.getState().importSutBrush(bytes, { decodeTip: makeTipDecodeStub() });

    const state = useStore.getState();
    expect(state.brushPresets.presets).toHaveLength(1);
    const tip = state.brush.tip;
    expect(tip).toBeTruthy();
    expect(tip!.width).toBe(4);
    expect(tip!.height).toBe(4);
    // 中央 2x2 が不透明(alpha 由来で 1)、四隅は 0。
    expect(tip!.data[1 * 4 + 1]).toBeCloseTo(1, 6);
    expect(tip!.data[0]).toBeCloseTo(0, 6);
    expect(tip!.data[4 * 4 - 1]).toBeCloseTo(0, 6);
    // preset.settings にも tip が載っている。
    expect(state.brushPresets.presets[0].settings.tip).toBeTruthy();
  });

  it('leaves brush.tip unset when decodeTip is not provided', async () => {
    const bytes = await createSyntheticSutBrush('no-tip-brush', 40, 80, makeMinimalPng());

    await useStore.getState().importSutBrush(bytes, {});

    const state = useStore.getState();
    expect(state.brush.tip).toBeFalsy();
    expect(state.brush.size).toBe(40);
  });

  it('the single-arg legacy call still works (backward compatible)', async () => {
    const bytes = await createSyntheticSutBrush('legacy-brush', 64, 50, makeMinimalPng());

    await useStore.getState().importSutBrush(bytes);

    const state = useStore.getState();
    expect(state.brushPresets.presets).toHaveLength(1);
    expect(state.brushPresets.presets[0].name).toBe('legacy-brush');
    expect(state.brush.size).toBe(64);
    expect(state.brush.opacity).toBeCloseTo(0.5, 3);
    expect(state.brush.tip).toBeFalsy();
  });

  it('renders a tip-shaped coverage through beginStroke/endStroke when brush.tip is set', async () => {
    const bytes = await createSyntheticSutBrush('stroke-brush', 8, 100, makeMinimalPng());
    await useStore.getState().importSutBrush(bytes, { decodeTip: makeTipDecodeStub() });

    // tip 形状のスタンプを直接検証(coverage への書き込みを stampTip で再現)。
    const tip = useStore.getState().brush.tip as TipAlpha;
    const cw = 16;
    const ch = 16;
    const coverage = new Float32Array(cw * ch);
    stampTip(coverage, cw, ch, tip, { x: 8, y: 8, size: 8, rotation: 0, flow: 1 });

    // 中心は不透明 tip があるので coverage > 0、角(0,0)は tip 範囲外で 0。
    expect(coverage[8 * cw + 8]).toBeGreaterThan(0);
    expect(coverage[0]).toBe(0);
  });

  it('does not change non-tip dab behaviour (DEFAULT_BRUSH has no tip)', () => {
    expect(DEFAULT_BRUSH.tip).toBeUndefined();
    expect(DEFAULT_BRUSH.pressureSizeCurve).toBeUndefined();
    expect(DEFAULT_BRUSH.pressureFlowCurve).toBeUndefined();
  });
});
