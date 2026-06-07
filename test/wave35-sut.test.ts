// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import initSqlJs from 'sql.js';

import { parseSutBrush, sutToBrushSettings } from '../src/io/sut';
import type { BrushSettings } from '../src/types';

function locateWasm(): string {
  return path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
}

async function createFullSutFixture(): Promise<Uint8Array> {
  const SQL = await initSqlJs({ locateFile: locateWasm });
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE Manager (ToolType INTEGER, Version INTEGER);');
    db.run('INSERT INTO Manager (ToolType, Version) VALUES (?, ?);', [0, 145]);
    db.run('CREATE TABLE Node (NodeName TEXT, NodeUuid BLOB);');
    db.run('INSERT INTO Node (NodeName, NodeUuid) VALUES (?, ?);', ['テストブラシ', null]);
    db.run(
      'CREATE TABLE Variant (' +
        'Opacity INT, BrushSize REAL, BrushFlow INT, BrushHardness INT, BrushInterval REAL, AntiAlias INT);',
    );
    db.run(
      'INSERT INTO Variant (Opacity, BrushSize, BrushFlow, BrushHardness, BrushInterval, AntiAlias) ' +
        'VALUES (?, ?, ?, ?, ?, ?);',
      [80, 300, 90, 50, 20, 3],
    );
    return db.export();
  } finally {
    db.close();
  }
}

async function createMinimalSutFixture(): Promise<Uint8Array> {
  const SQL = await initSqlJs({ locateFile: locateWasm });
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE Manager (ToolType INTEGER);');
    db.run('INSERT INTO Manager (ToolType) VALUES (?);', [0]);
    db.run('CREATE TABLE Variant (BrushSize REAL);');
    db.run('INSERT INTO Variant (BrushSize) VALUES (?);', [150]);
    return db.export();
  } finally {
    db.close();
  }
}

describe('wave35 SUT subtool parser', () => {
  it('parseSutBrush: full fixture', async () => {
    const bytes = await createFullSutFixture();
    const brush = await parseSutBrush(bytes);

    expect(brush.name).toBe('テストブラシ');
    expect(brush.size).toBe(300);
    expect(brush.opacity).toBe(80);
    expect(brush.flow).toBe(90);
    expect(brush.hardness).toBe(50);
    expect(brush.interval).toBe(20);
    expect(brush.antiAlias).toBe(3);
  });

  it('sutToBrushSettings: mapping', async () => {
    const bytes = await createFullSutFixture();
    const brush = await parseSutBrush(bytes);
    const settings: BrushSettings = sutToBrushSettings(brush);

    expect(settings.size).toBe(300);
    expect(settings.opacity).toBeCloseTo(0.8, 3);
    expect(settings.flow).toBeCloseTo(0.9, 3);
    expect(settings.hardness).toBeCloseTo(0.5, 3);
    expect(settings.spacing).toBeCloseTo(0.2, 3);
    expect(settings.shape).toBe('soft');
    expect(settings).toEqual({
      shape: 'soft',
      size: 300,
      opacity: settings.opacity,
      flow: settings.flow,
      hardness: settings.hardness,
      spacing: settings.spacing,
      pressureSize: true,
      pressureOpacity: true,
    });
  });

  it('parseSutBrush: missing columns robustness', async () => {
    const bytes = await createMinimalSutFixture();
    const brush = await parseSutBrush(bytes);

    expect(brush.size).toBe(150);
    expect(brush.name).toBe('');
    expect(brush.version).toBeNull();
  });
});
