// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import initSqlJs from 'sql.js';

import { parseSutBrush, sutToBrushSettings } from '../src/io/sut';

function locateWasm(): string {
  return path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
}

interface SyntheticSutOptions {
  name?: string;
  size?: number;
  opacity?: number;
  flow?: number;
  hardness?: number;
  interval?: number;
  antiAlias?: number;
  rotation?: number;
  useSpray?: number;
  spraySize?: number;
  sprayDensity?: number;
}

/** wave35/36 のフィクスチャ生成を踏襲した合成 .sut(回転/スプレー列を追加)。 */
async function createSyntheticSutBrush(options: SyntheticSutOptions = {}): Promise<Uint8Array> {
  const {
    name = 'wave37-brush',
    size = 60,
    opacity = 80,
    flow = 90,
    hardness = 50,
    interval = 20,
    antiAlias = 3,
    rotation = 0,
    useSpray = 0,
    spraySize = 0,
    sprayDensity = 0,
  } = options;

  const SQL = await initSqlJs({ locateFile: locateWasm });
  const db = new SQL.Database();

  try {
    db.run('CREATE TABLE Manager (ToolType INTEGER, Version INTEGER);');
    db.run('INSERT INTO Manager (ToolType, Version) VALUES (?, ?);', [0, 145]);
    db.run('CREATE TABLE Node (NodeName TEXT);');
    db.run('INSERT INTO Node (NodeName) VALUES (?);', [name]);
    db.run(
      'CREATE TABLE Variant (' +
        'Opacity INT, BrushSize REAL, BrushFlow INT, BrushHardness INT, BrushInterval REAL, ' +
        'AntiAlias INT, BrushRotation REAL, BrushUseSpray INT, BrushSpraySize REAL, BrushSprayDensity REAL);',
    );
    db.run(
      'INSERT INTO Variant (Opacity, BrushSize, BrushFlow, BrushHardness, BrushInterval, ' +
        'AntiAlias, BrushRotation, BrushUseSpray, BrushSpraySize, BrushSprayDensity) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
      [opacity, size, flow, hardness, interval, antiAlias, rotation, useSpray, spraySize, sprayDensity],
    );

    return db.export();
  } finally {
    db.close();
  }
}

describe('wave37 SUT -> BrushSettings tip マッピング (US-3903)', () => {
  it('BrushRotation=90 (度) は tipAngle ≈ π/2 (ラジアン) へ変換される', async () => {
    const bytes = await createSyntheticSutBrush({ rotation: 90 });
    const settings = sutToBrushSettings(await parseSutBrush(bytes));

    expect(settings.tipAngle).toBeDefined();
    expect(settings.tipAngle!).toBeCloseTo(Math.PI / 2, 6);
  });

  it('BrushUseSpray=1 + spraySize/density 指定で tipScatter>0 / tipScatterDensity>=1', async () => {
    const bytes = await createSyntheticSutBrush({
      size: 60,
      useSpray: 1,
      spraySize: 40,
      sprayDensity: 5,
    });
    const settings = sutToBrushSettings(await parseSutBrush(bytes));

    expect(settings.tipScatter).toBeDefined();
    expect(settings.tipScatter!).toBeGreaterThan(0);
    // spraySize=40 は size*2=120 以下なのでそのまま px へ写像される
    expect(settings.tipScatter!).toBeCloseTo(40, 6);
    expect(settings.tipScatterDensity).toBeDefined();
    expect(settings.tipScatterDensity!).toBeGreaterThanOrEqual(1);
    expect(settings.tipScatterDensity).toBe(5);
    expect(Number.isInteger(settings.tipScatterDensity!)).toBe(true);
  });

  it('tipScatter はブラシ径の 2 倍にクランプされ、density は 2..16 に収まる (Wave38 で下限 1→2)', async () => {
    const bytes = await createSyntheticSutBrush({
      size: 30,
      useSpray: 1,
      spraySize: 500,
      sprayDensity: 999,
    });
    const settings = sutToBrushSettings(await parseSutBrush(bytes));

    expect(settings.tipScatter).toBe(30 * 2);
    expect(settings.tipScatterDensity).toBe(16);
  });

  it('BrushUseSpray=0 では tipScatter/tipScatterDensity は未設定 (undefined)', async () => {
    const bytes = await createSyntheticSutBrush({
      useSpray: 0,
      spraySize: 40,
      sprayDensity: 5,
    });
    const settings = sutToBrushSettings(await parseSutBrush(bytes));

    expect(settings.tipScatter).toBeUndefined();
    expect(settings.tipScatterDensity).toBeUndefined();
  });

  it('rotation=0 (既定) では tipAngle は未設定 (undefined) のまま', async () => {
    const bytes = await createSyntheticSutBrush({ rotation: 0 });
    const settings = sutToBrushSettings(await parseSutBrush(bytes));

    expect(settings.tipAngle).toBeUndefined();
    // tipFollowStroke も CLIP からは判別不能のため未設定のまま(既定 false 扱い)
    expect(settings.tipFollowStroke).toBeUndefined();
  });

  it('既存フィールド (size/opacity/flow/hardness/spacing/shape) は従来通り (後方互換回帰)', async () => {
    const bytes = await createSyntheticSutBrush({
      size: 150,
      opacity: 80,
      flow: 90,
      hardness: 50,
      interval: 20,
      antiAlias: 3,
      rotation: 45,
      useSpray: 1,
      spraySize: 10,
      sprayDensity: 3,
    });
    const settings = sutToBrushSettings(await parseSutBrush(bytes));

    expect(settings.shape).toBe('soft');
    expect(settings.size).toBe(150);
    expect(settings.opacity).toBeCloseTo(0.8, 6);
    expect(settings.flow).toBeCloseTo(0.9, 6);
    expect(settings.hardness).toBeCloseTo(0.5, 6);
    expect(settings.spacing).toBeCloseTo(0.2, 6);
    expect(settings.pressureSize).toBe(true);
    expect(settings.pressureOpacity).toBe(true);
  });
});
