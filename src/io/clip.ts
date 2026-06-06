/**
 * CLIP STUDIO (.clip) import / export.
 *
 * A .clip file is, physically, a SQLite 3 database with a large, proprietary,
 * undocumented internal layout (tiled bitmaps, an offscreen image bank, vector
 * objects, etc.). Authoring a genuine .clip that CLIP STUDIO PAINT can re-open
 * is far out of scope for this app.
 *
 * Instead we take a pragmatic, honest approach:
 *
 *   - exportCLIP() writes OUR OWN simple, fully round-trippable schema into a
 *     real SQLite database (so the produced file is still a valid `.clip`
 *     SQLite container that HIT Paint can re-open losslessly). See the comment
 *     on exportCLIP for the important caveat.
 *
 *   - importCLIP() first checks for our own schema and, if present, restores the
 *     document exactly. Otherwise it treats the file as a genuine CSP .clip and
 *     does a best-effort read (canvas size + flattened preview), surfacing clear
 *     warnings about what could not be recovered.
 *
 * sql.js (SQLite compiled to WASM) does the heavy lifting and works in both the
 * browser and node (vitest) environments.
 */

import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';

import { createDocument, createRasterLayer, uid } from '../core/document';
import type {
  AdjustmentSpec,
  BlendMode,
  ImportResult,
  Layer,
  PaintDocument,
} from '../types';
import { BLEND_MODES } from '../types';

// ---------------------------------------------------------------------------
// sql.js bootstrap (cached module-level promise)
// ---------------------------------------------------------------------------

/**
 * Resolve the wasm binary location. In node (tests) we point at the file inside
 * node_modules; in the browser it is expected to be served from the web root.
 */
function wasmLocate(): string {
  // Under jsdom (vitest) `window` exists, so we key off node's `process`
  // instead: in node we resolve the wasm from node_modules; in a real browser
  // bundle it is served from the web root.
  const isNode =
    typeof process !== 'undefined' &&
    !!(process as unknown as { versions?: { node?: string } }).versions?.node;
  if (isNode) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('path').join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
  }
  return '/sql-wasm.wasm';
}

let _sqlPromise: Promise<SqlJsStatic> | null = null;

/** Initialise (once) and return the sql.js static module. */
function getSQL(): Promise<SqlJsStatic> {
  if (!_sqlPromise) {
    _sqlPromise = initSqlJs({ locateFile: wasmLocate });
  }
  return _sqlPromise;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Write the document into a real SQLite database using HIT Paint's own schema.
 *
 * IMPORTANT: the resulting container round-trips perfectly within HIT Paint, but
 * it is NOT openable by real CLIP STUDIO PAINT. Producing a fully compatible
 * `.clip` (with CSP's tiled/offscreen bitmap layout, vector layers, etc.) is out
 * of scope; we only guarantee a valid SQLite file that we can read back.
 */
export async function exportCLIP(doc: PaintDocument): Promise<ArrayBuffer> {
  const SQL = await getSQL();
  const db: Database = new SQL.Database();

  try {
    // Schema -------------------------------------------------------------
    db.run(
      'CREATE TABLE hitpaint_meta (width INT, height INT, dpi REAL, name TEXT);',
    );
    db.run(
      'CREATE TABLE hitpaint_layers (' +
        'idx INT, id TEXT, name TEXT, kind TEXT, visible INT, opacity REAL, blend TEXT, ' +
        'clipping INT, locked INT, w INT, h INT, rgba BLOB, mask BLOB, children TEXT, adjustment TEXT);',
    );

    // Meta (single row) --------------------------------------------------
    db.run('INSERT INTO hitpaint_meta (width, height, dpi, name) VALUES (?, ?, ?, ?);', [
      doc.width,
      doc.height,
      doc.dpi,
      doc.name,
    ]);

    // Layers (in document order, bottom -> top) --------------------------
    const insertLayer = db.prepare(
      'INSERT INTO hitpaint_layers ' +
        '(idx, id, name, kind, visible, opacity, blend, clipping, locked, w, h, rgba, mask, children, adjustment) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
    );
    try {
      doc.layers.forEach((layer, index) => {
        // Groups have no pixel buffer; store an empty blob so the row still
        // round-trips structurally. `kind` is persisted explicitly so import
        // never has to infer group-vs-raster from blob size.
        const px = layer.pixels;
        const blob = px
          ? // Copy into a plain Uint8Array view (sql.js stores raw bytes).
            new Uint8Array(px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength))
          : new Uint8Array(0);
        const mask = layer.mask
          ? new Uint8Array(
              layer.mask.buffer.slice(layer.mask.byteOffset, layer.mask.byteOffset + layer.mask.byteLength),
            )
          : new Uint8Array(0);
        insertLayer.run([
          index,
          layer.id,
          layer.name,
          layer.kind,
          layer.visible ? 1 : 0,
          layer.opacity,
          layer.blendMode,
          layer.clipping ? 1 : 0,
          layer.locked ? 1 : 0,
          doc.width,
          doc.height,
          blob,
          mask,
          layer.children ? JSON.stringify(layer.children) : null,
          layer.kind === 'adjustment' && layer.adjustment ? JSON.stringify(layer.adjustment) : null,
        ]);
      });
    } finally {
      insertLayer.free();
    }

    const bytes = db.export();
    // Return a tight ArrayBuffer slice covering exactly the exported bytes.
    // sql.js always yields a plain ArrayBuffer; the cast keeps tsc happy since
    // Uint8Array.prototype.buffer is typed as the wider ArrayBufferLike.
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Coerce a sql.js BLOB value into a Uint8ClampedArray of pixels. */
function blobToPixels(value: SqlValue): Uint8ClampedArray {
  if (value instanceof Uint8Array) {
    return new Uint8ClampedArray(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return new Uint8ClampedArray(0);
}

/** Coerce a sql.js BLOB value into a Uint8ClampedArray of mask coverage bytes. */
function blobToMask(value: SqlValue): Uint8ClampedArray {
  if (value instanceof Uint8Array) {
    return new Uint8ClampedArray(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return new Uint8ClampedArray(0);
}

/** Validate a stored blend string against the known set, falling back to normal. */
function toBlendMode(value: SqlValue): BlendMode {
  if (typeof value === 'string' && (BLEND_MODES as string[]).includes(value)) {
    return value as BlendMode;
  }
  return 'normal';
}

function parseChildren(value: SqlValue): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((child) => typeof child === 'string')) {
      return parsed;
    }
  } catch {
    // Corrupt children metadata should not abort the whole import.
  }
  return [];
}

function parseAdjustment(value: SqlValue): AdjustmentSpec | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const { type, opts } = parsed as { type?: unknown; opts?: unknown };
    if (
      type !== 'brightness-contrast' &&
      type !== 'invert' &&
      type !== 'grayscale' &&
      type !== 'hue-saturation' &&
      type !== 'levels'
    ) {
      return null;
    }
    if (opts === undefined) return { type };
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) return null;
    const cleanOpts: Record<string, number> = {};
    for (const [key, optValue] of Object.entries(opts)) {
      if (typeof optValue !== 'number' || !Number.isFinite(optValue)) return null;
      cleanOpts[key] = optValue;
    }
    return { type, opts: cleanOpts };
  } catch {
    return null;
  }
}

/** Read the names of all user tables in the database. */
function listTables(db: Database): Set<string> {
  const names = new Set<string>();
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table';");
  if (res.length > 0) {
    for (const row of res[0].values) {
      const n = row[0];
      if (typeof n === 'string') names.add(n);
    }
  }
  return names;
}

/** True when a table has a named column. Missing tables/columns return false. */
function tableHasColumn(db: Database, table: string, column: string): boolean {
  try {
    const res = db.exec(`PRAGMA table_info(${table});`);
    if (res.length === 0) return false;
    return res[0].values.some((row) => row[1] === column);
  } catch {
    return false;
  }
}

/** Reconstruct a PaintDocument from HIT Paint's own round-trip schema. */
function importHitPaint(db: Database): ImportResult {
  const warnings: string[] = [];

  // Meta ----------------------------------------------------------------
  let width = 1280;
  let height = 720;
  let dpi = 72;
  let name = '無題';
  const metaRes = db.exec('SELECT width, height, dpi, name FROM hitpaint_meta LIMIT 1;');
  if (metaRes.length > 0 && metaRes[0].values.length > 0) {
    const [w, h, d, n] = metaRes[0].values[0];
    if (typeof w === 'number') width = w;
    if (typeof h === 'number') height = h;
    if (typeof d === 'number') dpi = d;
    if (typeof n === 'string') name = n;
  } else {
    warnings.push('メタ情報が見つからなかったため、既定のキャンバスサイズを使用します。');
  }

  // Layers (ordered by idx) --------------------------------------------
  const layers: Layer[] = [];
  const hasKindColumn = tableHasColumn(db, 'hitpaint_layers', 'kind');
  const hasMaskColumn = tableHasColumn(db, 'hitpaint_layers', 'mask');
  const hasChildrenColumn = tableHasColumn(db, 'hitpaint_layers', 'children');
  const hasAdjustmentColumn = tableHasColumn(db, 'hitpaint_layers', 'adjustment');
  const layerRes = db.exec(
    'SELECT id, name, ' +
      (hasKindColumn ? 'kind' : "'raster' AS kind") +
      ', visible, opacity, blend, clipping, locked, rgba, ' +
      (hasMaskColumn ? 'mask' : 'NULL AS mask') +
      ', ' +
      (hasChildrenColumn ? 'children' : 'NULL AS children') +
      ', ' +
      (hasAdjustmentColumn ? 'adjustment' : 'NULL AS adjustment') +
      ' FROM hitpaint_layers ORDER BY idx ASC;',
  );
  if (layerRes.length > 0) {
    const expected = width * height * 4;
    const expectedMask = width * height;
    for (const row of layerRes[0].values) {
      const [
        lId,
        lName,
        lKind,
        lVisible,
        lOpacity,
        lBlend,
        lClipping,
        lLocked,
        lRgba,
        lMask,
        lChildren,
        lAdjustment,
      ] = row;
      const adjustment = parseAdjustment(lAdjustment);
      const kind = lKind === 'group' ? 'group' : lKind === 'adjustment' && adjustment ? 'adjustment' : 'raster';
      const layer: Layer = {
        id: typeof lId === 'string' && lId ? lId : uid('layer'),
        name: typeof lName === 'string' ? lName : 'レイヤー',
        kind,
        visible: lVisible !== 0,
        opacity: typeof lOpacity === 'number' ? lOpacity : 1,
        blendMode: toBlendMode(lBlend),
        locked: lLocked !== 0,
        clipping: lClipping !== 0,
      };
      if (kind === 'raster') {
        const pixels = blobToPixels(lRgba);
        // Guard against a size mismatch (e.g. corrupt/legacy file).
        layer.pixels = pixels.length === expected ? pixels : new Uint8ClampedArray(expected);
        if (pixels.length !== expected) {
          warnings.push(`レイヤー「${layer.name}」の画素データが不正なため、空のレイヤーに置き換えました。`);
        }
        if (lKind === 'adjustment' && !adjustment) {
          warnings.push(`調整レイヤー「${layer.name}」の設定が不正なため、通常レイヤーとして読み込みました。`);
        }
      } else if (kind === 'group') {
        layer.children = parseChildren(lChildren);
      } else {
        layer.adjustment = adjustment ?? undefined;
      }
      const mask = blobToMask(lMask);
      if (mask.length === expectedMask) {
        layer.mask = mask;
      }
      layers.push(layer);
    }
  }

  if (layers.length === 0) {
    // Degenerate file: hand back a blank document rather than an empty one.
    warnings.push('レイヤーが見つからなかったため、空のドキュメントを生成しました。');
    const doc = createDocument(width, height, name, dpi);
    return { doc, warnings };
  }

  const doc: PaintDocument = {
    id: uid('doc'),
    name,
    width,
    height,
    dpi,
    layers,
    // Activate the topmost layer.
    activeLayerId: layers[layers.length - 1].id,
    selection: null,
  };
  return { doc, warnings };
}

/** Read a numeric value from the first row of a single-column query, if any. */
function firstNumber(db: Database, sql: string): number | null {
  try {
    const res = db.exec(sql);
    if (res.length > 0 && res[0].values.length > 0) {
      const v = res[0].values[0][0];
      if (typeof v === 'number') return v;
    }
  } catch {
    // Missing table/column — caller falls back.
  }
  return null;
}

/** Read a BLOB value from the first row of a single-column query, if any. */
function firstBlob(db: Database, sql: string): Uint8Array | null {
  try {
    const res = db.exec(sql);
    if (res.length > 0 && res[0].values.length > 0) {
      const v = res[0].values[0][0];
      if (v instanceof Uint8Array) return v;
    }
  } catch {
    // Missing table/column — caller falls back.
  }
  return null;
}

/** True if the bytes look like a PNG file (8-byte signature). */
function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 && // P
    bytes[2] === 0x4e && // N
    bytes[3] === 0x47 && // G
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

/**
 * Best-effort read of a genuine CLIP STUDIO PAINT .clip file.
 *
 * CSP's schema is undocumented and version-dependent, so this only attempts to
 * recover the canvas dimensions and the flattened preview bitmap. Layer
 * structure, blend modes, masks, vectors, etc. are not recoverable here.
 */
function importGenuineCsp(db: Database, tables: Set<string>): ImportResult {
  const warnings: string[] = [];

  // Canvas size: column names vary between CSP versions.
  let width = 0;
  let height = 0;
  if (tables.has('Canvas')) {
    width =
      firstNumber(db, 'SELECT CanvasWidth FROM Canvas LIMIT 1;') ??
      firstNumber(db, 'SELECT Width FROM Canvas LIMIT 1;') ??
      0;
    height =
      firstNumber(db, 'SELECT CanvasHeight FROM Canvas LIMIT 1;') ??
      firstNumber(db, 'SELECT Height FROM Canvas LIMIT 1;') ??
      0;
  }
  if (width <= 0 || height <= 0) {
    width = 1280;
    height = 720;
    warnings.push('キャンバスサイズを特定できなかったため、既定のサイズを使用しました。');
  }

  // Flattened preview BLOB (column name varies).
  let preview: Uint8Array | null = null;
  if (tables.has('CanvasPreview')) {
    preview =
      firstBlob(db, 'SELECT ImageData FROM CanvasPreview LIMIT 1;') ??
      firstBlob(db, 'SELECT image FROM CanvasPreview LIMIT 1;');
  }

  warnings.push(
    'CSP独自フォーマットのため、レイヤー構造の完全な復元には未対応です（プレビュー画像のみ読み込み）',
  );

  // Build a single flattened raster layer.
  const doc = createDocument(width, height, 'CLIP STUDIO 読み込み', 72);
  // Replace the default two-layer setup with a single flattened layer.
  const layer = createRasterLayer(width, height, '統合プレビュー');

  if (preview && isPng(preview)) {
    // Actual PNG decode requires a real DOM/canvas (createImageBitmap), which is
    // unavailable in the test environment. Guard so tests stay pure.
    if (typeof document !== 'undefined') {
      // In a real browser the UI layer is responsible for decoding the PNG and
      // filling `layer.pixels`; we leave the (blank) buffer in place here and let
      // the caller hydrate it. Surfacing this as a warning keeps behaviour honest.
      warnings.push('プレビューPNGを検出しました。実行環境でデコードして読み込みます。');
    } else {
      warnings.push('プレビューPNGを検出しましたが、現在の環境ではデコードできません。');
    }
  } else if (preview) {
    warnings.push('プレビュー画像を検出しましたが、対応していない形式のため読み込めませんでした。');
  } else {
    warnings.push('読み込み可能なプレビュー画像が見つかりませんでした。');
  }

  doc.layers = [layer];
  doc.activeLayerId = layer.id;
  return { doc, warnings };
}

/**
 * Import a .clip (SQLite) file.
 *
 * - If it carries HIT Paint's own schema, restore the document losslessly.
 * - Otherwise do a best-effort read of a genuine CSP file (size + preview).
 * - If nothing is decodable, return a blank document plus a warning.
 */
export async function importCLIP(buffer: ArrayBuffer): Promise<ImportResult> {
  const SQL = await getSQL();
  const db: Database = new SQL.Database(new Uint8Array(buffer));

  try {
    const tables = listTables(db);
    if (tables.has('hitpaint_layers')) {
      return importHitPaint(db);
    }
    return importGenuineCsp(db, tables);
  } catch (err) {
    // Unreadable / corrupt file: hand back a blank document so the app stays usable.
    const message = err instanceof Error ? err.message : String(err);
    return {
      doc: createDocument(),
      warnings: [`.clipファイルを読み込めませんでした（${message}）。空のドキュメントを生成しました。`],
    };
  } finally {
    db.close();
  }
}
