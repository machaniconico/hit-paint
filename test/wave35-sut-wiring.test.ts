// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import initSqlJs from 'sql.js';

import { createPresetLibrary } from '../src/engine/brush-presets';
import { useStore } from '../src/state/store';
import { DEFAULT_BRUSH } from '../src/types';

function locateWasm(): string {
  return path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
}

async function createSyntheticSutBrush(
  name: string,
  size: number,
  opacity: number,
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
      new Uint8Array([0, 1, 2, 3]),
    ]);

    return db.export();
  } finally {
    db.close();
  }
}

describe('wave35 SUT store wiring', () => {
  beforeEach(() => {
    useStore.getState().newDocument(8, 8, 'wave35 sut wiring');
    useStore.setState({
      brush: { ...DEFAULT_BRUSH },
      brushPresets: createPresetLibrary(),
    });
  });

  it('imports a synthetic SUT brush into presets and applies it to the current brush', async () => {
    const bytes = await createSyntheticSutBrush('test-brush', 150, 80);

    await useStore.getState().importSutBrush(bytes);

    const state = useStore.getState();
    expect(state.brushPresets.presets).toHaveLength(1);
    expect(state.brushPresets.presets[0].name).toBe('test-brush');
    expect(state.brush.size).toBe(150);
    expect(state.brush.opacity).toBeCloseTo(0.8, 3);
  });

  it('applies an earlier imported preset after a second SUT import', async () => {
    const firstBytes = await createSyntheticSutBrush('first-brush', 42, 40);
    const secondBytes = await createSyntheticSutBrush('second-brush', 88, 90);

    await useStore.getState().importSutBrush(firstBytes);
    await useStore.getState().importSutBrush(secondBytes);

    let state = useStore.getState();
    expect(state.brushPresets.presets).toHaveLength(2);
    expect(state.brush.size).toBe(88);
    expect(state.brush.opacity).toBeCloseTo(0.9, 3);

    state.applyBrushPreset(state.brushPresets.presets[0].id);

    state = useStore.getState();
    expect(state.brush.size).toBe(42);
    expect(state.brush.opacity).toBeCloseTo(0.4, 3);
  });
});
