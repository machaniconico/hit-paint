// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import initSqlJs from 'sql.js';

import { createDocument, createShapeLayer, createVectorLayer } from '../src/core/document';
import { exportCLIP, importCLIP } from '../src/io/clip';
import type { RGBA } from '../src/types';
import { createShapeData } from '../src/vector/shape';
import { createVectorLayerData } from '../src/vector/vector-layer';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

function locateWasm(): string {
  return path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
}

async function createLegacyClipWithoutShapeOrVectorData(): Promise<ArrayBuffer> {
  const SQL = await initSqlJs({ locateFile: locateWasm });
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE hitpaint_meta (width INT, height INT, dpi REAL, name TEXT);');
    db.run(
      'CREATE TABLE hitpaint_layers (' +
        'idx INT, id TEXT, name TEXT, kind TEXT, visible INT, opacity REAL, blend TEXT, ' +
        'clipping INT, locked INT, w INT, h INT, rgba BLOB, mask BLOB, children TEXT, adjustment TEXT, textData TEXT);',
    );
    db.run('INSERT INTO hitpaint_meta (width, height, dpi, name) VALUES (?, ?, ?, ?);', [
      2,
      2,
      72,
      'legacy editable layers',
    ]);
    db.run(
      'INSERT INTO hitpaint_layers ' +
        '(idx, id, name, kind, visible, opacity, blend, clipping, locked, w, h, rgba, mask, children, adjustment, textData) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
      [
        0,
        'legacy-raster',
        'legacy raster',
        'raster',
        1,
        1,
        'normal',
        0,
        0,
        2,
        2,
        new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
        new Uint8Array(0),
        null,
        null,
        null,
      ],
    );
    const bytes = db.export();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } finally {
    db.close();
  }
}

describe('wave25 CLIP editable layer round-trip', () => {
  it('round-trips raster shapeData layers structurally', async () => {
    const doc = createDocument(12, 10, 'shape clip');
    const shapeData = createShapeData({
      shape: 'rounded-rect',
      x: 2,
      y: 3,
      width: 6,
      height: 4,
      cornerRadius: 1.5,
      style: {
        fill: RED,
        stroke: { color: BLUE, width: 1 },
      },
    });
    const layer = createShapeLayer(doc.width, doc.height, shapeData, 'editable shape');
    doc.layers.push(layer);
    doc.activeLayerId = layer.id;

    const buffer = await exportCLIP(doc);
    const SQL = await initSqlJs({ locateFile: locateWasm });
    const db = new SQL.Database(new Uint8Array(buffer));
    try {
      const columns = db.exec('PRAGMA table_info(hitpaint_layers);');
      expect(columns[0].values.some((row) => row[1] === 'shapeData' && row[2] === 'TEXT')).toBe(true);
      expect(columns[0].values.some((row) => row[1] === 'vectorData' && row[2] === 'TEXT')).toBe(true);
    } finally {
      db.close();
    }

    const result = await importCLIP(buffer);
    const importedLayer = result.doc.layers.find((item) => item.id === layer.id);

    expect(importedLayer?.kind).toBe('raster');
    expect(importedLayer?.shapeData).toEqual(shapeData);
  });

  it('round-trips raster vectorData layers structurally', async () => {
    const doc = createDocument(12, 10, 'vector clip');
    const vectorData = createVectorLayerData({
      subpaths: [
        {
          path: {
            closed: true,
            points: [
              { x: 1, y: 1 },
              { x: 8, y: 1 },
              { x: 3, y: 7 },
            ],
          },
          fill: GREEN,
          stroke: { color: BLUE, width: 1, dashArray: [2, 1], dashOffset: 0.5 },
        },
        {
          path: {
            closed: false,
            points: [
              { x: 2, y: 8 },
              { x: 10, y: 8 },
            ],
          },
          stroke: { color: RED, width: 2, dash: [1, 2] },
        },
      ],
    });
    const layer = createVectorLayer(doc.width, doc.height, vectorData, 'editable vector');
    doc.layers.push(layer);
    doc.activeLayerId = layer.id;

    const buffer = await exportCLIP(doc);
    const result = await importCLIP(buffer);
    const importedLayer = result.doc.layers.find((item) => item.id === layer.id);

    expect(importedLayer?.kind).toBe('raster');
    expect(importedLayer?.vectorData).toEqual(vectorData);
  });

  it('imports legacy clips without shapeData or vectorData columns', async () => {
    const buffer = await createLegacyClipWithoutShapeOrVectorData();
    const result = await importCLIP(buffer);
    const importedLayer = result.doc.layers[0];

    expect(result.doc.layers).toHaveLength(1);
    expect(importedLayer.kind).toBe('raster');
    expect(importedLayer.shapeData).toBeUndefined();
    expect(importedLayer.vectorData).toBeUndefined();
    expect(Array.from(importedLayer.pixels!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
});
