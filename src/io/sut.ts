/**
 * CLIP STUDIO subtool (.sut) import helpers.
 *
 * A .sut file is a SQLite database. CLIP STUDIO's full schema is proprietary,
 * so this module reads the stable scalar brush settings we can map into HIT
 * Paint's BrushSettings and preserves the scalar values in `raw`.
 */

import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';

import type { BrushSettings } from '../types';

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

export interface SutBrush {
  name: string;
  toolType: number | null;
  version: number | null;
  size: number;
  opacity: number;
  flow: number;
  hardness: number;
  interval: number;
  antiAlias: number;
  rotation: number;
  useSpray: boolean;
  spraySize: number;
  sprayDensity: number;
  useWaterColor: boolean;
  useIn: boolean;
  inLength: number;
  useOut: boolean;
  outLength: number;
  raw: Record<string, number | string | null>;
}

interface ColumnInfo {
  name: string;
  type: string;
}

const VARIANT_COLUMNS = [
  'Opacity',
  'AntiAlias',
  'CompositeMode',
  'BrushSize',
  'BrushSizeUnit',
  'BrushFlow',
  'BrushHardness',
  'BrushInterval',
  'BrushThickness',
  'BrushRotation',
  'BrushUseSpray',
  'BrushSpraySize',
  'BrushSprayDensity',
  'BrushUseWaterColor',
  'BrushUseIn',
  'BrushInLength',
  'BrushUseOut',
  'BrushOutLength',
  'BrushContinuousPlot',
  'BrushQuality',
  'UseDualBrush',
] as const;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function listColumns(db: Database, table: string): ColumnInfo[] {
  try {
    const res = db.exec(`PRAGMA table_info(${quoteIdentifier(table)});`);
    if (res.length === 0) return [];
    const columns: ColumnInfo[] = [];
    for (const row of res[0].values) {
      const name = row[1];
      const type = row[2];
      if (typeof name === 'string') {
        columns.push({ name, type: typeof type === 'string' ? type : '' });
      }
    }
    return columns;
  } catch {
    return [];
  }
}

function isBlobColumn(column: ColumnInfo): boolean {
  return column.type.toUpperCase().includes('BLOB');
}

function isRawValue(value: SqlValue): value is number | string | null {
  return value === null || typeof value === 'number' || typeof value === 'string';
}

function readFirstScalarRow(
  db: Database,
  table: string,
  requestedColumns?: readonly string[],
): Record<string, number | string | null> {
  const tableColumns = listColumns(db, table);
  if (tableColumns.length === 0) return {};

  const allowed = requestedColumns ? new Set(requestedColumns) : null;
  const columns = tableColumns.filter((column) => {
    if (isBlobColumn(column)) return false;
    if (column.name.endsWith('Effector')) return false;
    return allowed ? allowed.has(column.name) : true;
  });
  if (columns.length === 0) return {};

  try {
    const select = columns.map((column) => quoteIdentifier(column.name)).join(', ');
    const res = db.exec(`SELECT ${select} FROM ${quoteIdentifier(table)} LIMIT 1;`);
    if (res.length === 0 || res[0].values.length === 0) return {};

    const row = res[0].values[0];
    const values: Record<string, number | string | null> = {};
    for (let i = 0; i < columns.length; i++) {
      const value = row[i];
      if (isRawValue(value)) {
        values[columns[i].name] = value;
      }
    }
    return values;
  } catch {
    return {};
  }
}

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function numberOrDefault(
  row: Record<string, number | string | null>,
  column: string,
  fallback: number,
): number {
  return toNumber(row[column]) ?? fallback;
}

function nullableNumber(row: Record<string, number | string | null>, column: string): number | null {
  return toNumber(row[column]);
}

function booleanOrDefault(
  row: Record<string, number | string | null>,
  column: string,
  fallback: boolean,
): boolean {
  const value = row[column];
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed !== 0;
    return value.length > 0;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function parseSutBrush(bytes: Uint8Array): Promise<SutBrush> {
  const SQL = await getSQL();
  const db: Database = new SQL.Database(bytes);

  try {
    const manager = readFirstScalarRow(db, 'Manager', ['ToolType', 'Version']);
    const node = readFirstScalarRow(db, 'Node', ['NodeName']);
    const variant = readFirstScalarRow(db, 'Variant', VARIANT_COLUMNS);
    const raw: Record<string, number | string | null> = {
      ...manager,
      ...node,
      ...variant,
    };

    return {
      name: typeof node.NodeName === 'string' ? node.NodeName : '',
      toolType: nullableNumber(manager, 'ToolType'),
      version: nullableNumber(manager, 'Version'),
      size: numberOrDefault(variant, 'BrushSize', 1),
      opacity: numberOrDefault(variant, 'Opacity', 100),
      flow: numberOrDefault(variant, 'BrushFlow', 100),
      hardness: numberOrDefault(variant, 'BrushHardness', 100),
      interval: numberOrDefault(variant, 'BrushInterval', 10),
      antiAlias: numberOrDefault(variant, 'AntiAlias', 0),
      rotation: numberOrDefault(variant, 'BrushRotation', 0),
      useSpray: booleanOrDefault(variant, 'BrushUseSpray', false),
      spraySize: numberOrDefault(variant, 'BrushSpraySize', 0),
      sprayDensity: numberOrDefault(variant, 'BrushSprayDensity', 0),
      useWaterColor: booleanOrDefault(variant, 'BrushUseWaterColor', false),
      useIn: booleanOrDefault(variant, 'BrushUseIn', false),
      inLength: numberOrDefault(variant, 'BrushInLength', 0),
      useOut: booleanOrDefault(variant, 'BrushUseOut', false),
      outLength: numberOrDefault(variant, 'BrushOutLength', 0),
      raw,
    };
  } finally {
    db.close();
  }
}

export function sutToBrushSettings(brush: SutBrush): BrushSettings {
  return {
    shape: brush.antiAlias > 0 ? 'soft' : 'pixel',
    size: Math.max(1, brush.size),
    opacity: clamp(brush.opacity / 100, 0, 1),
    flow: clamp(brush.flow / 100, 0, 1),
    hardness: clamp(brush.hardness / 100, 0, 1),
    spacing: Math.max(0.01, brush.interval / 100),
    pressureSize: true,
    pressureOpacity: true,
  };
}
