import { describe, expect, it } from 'vitest';
import path from 'node:path';
import initSqlJs from 'sql.js';

import { createAdjustmentLayer, createDocument, createGroupLayer } from '../src/core/document';
import { exportCLIP, importCLIP } from '../src/io/clip';

/** SQLite file header magic: "SQLite format 3\0" (16 bytes). */
const SQLITE_MAGIC = 'SQLite format 3\x00';

async function createLegacyClipWithoutKindOrAdjustment(): Promise<ArrayBuffer> {
  const SQL = await initSqlJs({
    locateFile: () => path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
  });
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE hitpaint_meta (width INT, height INT, dpi REAL, name TEXT);');
    db.run(
      'CREATE TABLE hitpaint_layers (' +
        'idx INT, id TEXT, name TEXT, visible INT, opacity REAL, blend TEXT, ' +
        'clipping INT, locked INT, w INT, h INT, rgba BLOB, mask BLOB, children TEXT);',
    );
    db.run('INSERT INTO hitpaint_meta (width, height, dpi, name) VALUES (?, ?, ?, ?);', [
      2,
      1,
      144,
      'legacy',
    ]);
    db.run(
      'INSERT INTO hitpaint_layers ' +
        '(idx, id, name, visible, opacity, blend, clipping, locked, w, h, rgba, mask, children) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
      [
        0,
        'legacy-layer',
        'legacy raster',
        1,
        0.75,
        'screen',
        1,
        0,
        2,
        1,
        new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]),
        new Uint8Array([255, 128]),
        null,
      ],
    );
    const bytes = db.export();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } finally {
    db.close();
  }
}

describe('CLIP (.clip) round-trip', () => {
  it('exports a valid SQLite database and re-imports it losslessly', async () => {
    const doc = createDocument(12, 10, 'テスト', 96);

    // Paint a known pixel on the top (draw) layer so we can assert on it later.
    const draw = doc.layers[doc.layers.length - 1];
    expect(draw.pixels).toBeDefined();
    const pixels = draw.pixels!;
    // Pixel at (x=5, y=3) -> index (3*12 + 5) * 4.
    const idx = (3 * 12 + 5) * 4;
    pixels[idx] = 200;
    pixels[idx + 1] = 100;
    pixels[idx + 2] = 50;
    pixels[idx + 3] = 255;

    // --- export ---
    const buffer = await exportCLIP(doc);
    expect(buffer).toBeInstanceOf(ArrayBuffer);

    // First 16 bytes must be the SQLite 3 file header.
    const head = new Uint8Array(buffer.slice(0, 16));
    let magic = '';
    for (let i = 0; i < 16; i++) magic += String.fromCharCode(head[i]);
    expect(magic).toBe(SQLITE_MAGIC);

    // --- import ---
    const result = await importCLIP(buffer);
    expect(result.doc.width).toBe(12);
    expect(result.doc.height).toBe(10);
    expect(result.doc.name).toBe('テスト');
    expect(result.doc.dpi).toBe(96);

    // Layer count round-trips (background + draw).
    expect(result.doc.layers.length).toBe(doc.layers.length);

    // The known pixel survives the round-trip on the top layer.
    const importedDraw = result.doc.layers[result.doc.layers.length - 1];
    expect(importedDraw.pixels).toBeDefined();
    const ip = importedDraw.pixels!;
    expect(ip[idx]).toBe(200);
    expect(ip[idx + 1]).toBe(100);
    expect(ip[idx + 2]).toBe(50);
    expect(ip[idx + 3]).toBe(255);

    // Metadata round-trips on a layer.
    expect(importedDraw.name).toBe(draw.name);
    expect(importedDraw.blendMode).toBe(draw.blendMode);
  });

  it('round-trips non-default layer properties (visibility, opacity, blend, clipping)', async () => {
    const doc = createDocument(8, 8);
    const top = doc.layers[doc.layers.length - 1];
    top.visible = false;
    top.opacity = 0.42;
    top.blendMode = 'multiply';
    top.clipping = true;

    const buffer = await exportCLIP(doc);
    const result = await importCLIP(buffer);

    const importedTop = result.doc.layers[result.doc.layers.length - 1];
    expect(importedTop.visible).toBe(false);
    expect(importedTop.opacity).toBeCloseTo(0.42, 5);
    expect(importedTop.blendMode).toBe('multiply');
    expect(importedTop.clipping).toBe(true);
  });

  it('round-trips layer masks, missing masks, and group children', async () => {
    const doc = createDocument(3, 2);
    const background = doc.layers[0];
    const masked = doc.layers[1];
    masked.mask = new Uint8ClampedArray([0, 32, 64, 128, 192, 255]);

    const group = createGroupLayer('親グループ', [background.id, masked.id]);
    doc.layers.push(group);
    doc.activeLayerId = group.id;

    const buffer = await exportCLIP(doc);
    const result = await importCLIP(buffer);

    const importedBackground = result.doc.layers.find((layer) => layer.id === background.id);
    const importedMasked = result.doc.layers.find((layer) => layer.id === masked.id);
    const importedGroup = result.doc.layers.find((layer) => layer.id === group.id);

    expect(importedMasked?.mask).toBeDefined();
    expect(Array.from(importedMasked!.mask!)).toEqual(Array.from(masked.mask));
    expect(importedGroup?.children).toEqual([background.id, masked.id]);
    expect(importedBackground?.mask).toBeUndefined();
  });

  it('round-trips adjustment layer kind and settings', async () => {
    const doc = createDocument(4, 3);
    const adjustment = createAdjustmentLayer(
      'brightness-contrast',
      { brightness: 0.125, contrast: -0.5 },
      'tone tweak',
    );
    adjustment.opacity = 0.6;
    doc.layers.push(adjustment);
    doc.activeLayerId = adjustment.id;

    const buffer = await exportCLIP(doc);
    const result = await importCLIP(buffer);

    const importedAdjustment = result.doc.layers.find((layer) => layer.id === adjustment.id);
    expect(importedAdjustment?.kind).toBe('adjustment');
    expect(importedAdjustment?.adjustment?.type).toBe('brightness-contrast');
    expect(importedAdjustment?.adjustment?.opts).toEqual({ brightness: 0.125, contrast: -0.5 });
    expect(importedAdjustment?.adjustment?.opts?.brightness).toBeCloseTo(0.125, 5);
    expect(importedAdjustment?.adjustment?.opts?.contrast).toBeCloseTo(-0.5, 5);
    expect(importedAdjustment?.pixels).toBeUndefined();
  });

  it('imports legacy HIT Paint clips without kind or adjustment columns', async () => {
    const buffer = await createLegacyClipWithoutKindOrAdjustment();
    const result = await importCLIP(buffer);

    expect(result.doc.width).toBe(2);
    expect(result.doc.height).toBe(1);
    expect(result.doc.dpi).toBe(144);
    expect(result.doc.layers).toHaveLength(1);
    expect(result.doc.layers[0].kind).toBe('raster');
    expect(result.doc.layers[0].blendMode).toBe('screen');
    expect(result.doc.layers[0].opacity).toBeCloseTo(0.75, 5);
    expect(result.doc.layers[0].clipping).toBe(true);
    expect(Array.from(result.doc.layers[0].pixels!)).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(Array.from(result.doc.layers[0].mask!)).toEqual([255, 128]);
  });

  it('returns a blank document with a warning for an unreadable file', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    const result = await importCLIP(garbage);
    expect(result.doc.layers.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
