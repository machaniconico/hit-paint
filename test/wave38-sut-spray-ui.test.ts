// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import initSqlJs from 'sql.js';

import { parseSutBrush, sutToBrushSettings } from '../src/io/sut';
import { useStore } from '../src/state/store';
import { DEFAULT_BRUSH } from '../src/types';

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

/** wave37-sut-mapping のフィクスチャ生成ヘルパを踏襲した合成 .sut。 */
async function createSyntheticSutBrush(options: SyntheticSutOptions = {}): Promise<Uint8Array> {
  const {
    name = 'wave38-brush',
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

describe('wave38 SUT spray 写像修正 + tip UI 配線土台 (US-4002)', () => {
  it('useSpray=1 + sprayDensity=1 は tipScatterDensity=2 へ繰り上げ(エンジン散布条件 density>1 を満たす下限)', async () => {
    const bytes = await createSyntheticSutBrush({
      size: 60,
      useSpray: 1,
      spraySize: 20,
      sprayDensity: 1,
    });
    const settings = sutToBrushSettings(await parseSutBrush(bytes));

    expect(settings.tipScatter).toBeCloseTo(20, 6);
    // 1 のままだとエンジン側の散布条件(tipScatter>0 かつ density>1)に弾かれて
    // spray ON なのに散布が一切効かないため、下限 2 で実際に散布が効くようにする。
    expect(settings.tipScatterDensity).toBe(2);
  });

  it('useSpray=1 + sprayDensity=8 は従来通り tipScatterDensity=8(中間値は不変)', async () => {
    const bytes = await createSyntheticSutBrush({
      size: 60,
      useSpray: 1,
      spraySize: 30,
      sprayDensity: 8,
    });
    const settings = sutToBrushSettings(await parseSutBrush(bytes));

    expect(settings.tipScatter).toBeCloseTo(30, 6);
    expect(settings.tipScatterDensity).toBe(8);
  });

  it('useSpray=1 でも spraySize=0 なら tipScatter/tipScatterDensity とも未設定 (undefined)', async () => {
    const bytes = await createSyntheticSutBrush({
      size: 60,
      useSpray: 1,
      spraySize: 0,
      sprayDensity: 5,
    });
    const settings = sutToBrushSettings(await parseSutBrush(bytes));

    // 散布半径ゼロのスプレーは意味を持たないので「意味がある時のみ付与」に統一。
    expect(settings.tipScatter).toBeUndefined();
    expect(settings.tipScatterDensity).toBeUndefined();
  });

  it('useSpray=0 では従来通り両方 undefined (回帰)', async () => {
    const bytes = await createSyntheticSutBrush({
      size: 60,
      useSpray: 0,
      spraySize: 40,
      sprayDensity: 5,
    });
    const settings = sutToBrushSettings(await parseSutBrush(bytes));

    expect(settings.tipScatter).toBeUndefined();
    expect(settings.tipScatterDensity).toBeUndefined();
  });

  it('setBrush({tipAngle, tipAngleJitter}) が store の brush に反映される(UI スライダ配線の土台)', () => {
    useStore.setState({ brush: { ...DEFAULT_BRUSH } });

    useStore.getState().setBrush({ tipAngle: Math.PI / 4, tipAngleJitter: 0.1 });

    const brush = useStore.getState().brush;
    expect(brush.tipAngle).toBeCloseTo(Math.PI / 4, 9);
    expect(brush.tipAngleJitter).toBeCloseTo(0.1, 9);
    // 他フィールドは部分更新で保たれる(setBrush のマージ挙動確認)。
    expect(brush.size).toBe(DEFAULT_BRUSH.size);
    expect(brush.opacity).toBe(DEFAULT_BRUSH.opacity);
  });
});
