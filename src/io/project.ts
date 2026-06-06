import type { PaintDocument, Layer } from '../types';

export interface ProjectJSON {
  version: number;
  [k: string]: unknown;
}

const PROJECT_VERSION = 1;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'add',
  'subtract',
] as const;
const LAYER_KINDS = ['raster', 'group', 'adjustment'] as const;

type BufferLike = Uint8Array & { toString(encoding?: string): string };

interface BufferConstructorLike {
  from(data: Uint8Array | Uint8ClampedArray | readonly number[]): BufferLike;
  from(data: string, encoding: 'base64'): Uint8Array;
}

function getBuffer(): BufferConstructorLike | undefined {
  const maybe = (globalThis as { Buffer?: BufferConstructorLike }).Buffer;
  return maybe && typeof maybe.from === 'function' ? maybe : undefined;
}

function encodeBase64(bytes: Uint8ClampedArray): string {
  const buffer = getBuffer();
  if (buffer) return buffer.from(bytes).toString('base64');

  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;

    output += BASE64_ALPHABET[b0 >> 2];
    output += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    output += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    output += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f] : '=';
  }
  return output;
}

function decodeBase64(value: string): Uint8ClampedArray {
  if (value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new Error('Invalid project base64 data');
  }

  const buffer = getBuffer();
  if (buffer) return new Uint8ClampedArray(buffer.from(value, 'base64'));

  if (value.length === 0) return new Uint8ClampedArray(0);

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = new Uint8ClampedArray((value.length / 4) * 3 - padding);
  let offset = 0;

  for (let i = 0; i < value.length; i += 4) {
    const c0 = BASE64_ALPHABET.indexOf(value[i]);
    const c1 = BASE64_ALPHABET.indexOf(value[i + 1]);
    const c2 = value[i + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[i + 2]);
    const c3 = value[i + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[i + 3]);

    bytes[offset++] = (c0 << 2) | (c1 >> 4);
    if (offset < bytes.length) bytes[offset++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (offset < bytes.length) bytes[offset++] = ((c2 & 0x03) << 6) | c3;
  }

  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function toJSONValue(value: unknown, key = ''): unknown {
  if (value instanceof Uint8ClampedArray) return encodeBase64(value);
  if (Array.isArray(value)) return value.map((item) => toJSONValue(item));
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = {};
  for (const childKey of Object.keys(value).sort()) {
    const child = value[childKey];
    if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue;
    output[childKey] = toJSONValue(child, childKey);
  }
  return output;
}

function toProjectJSON(doc: PaintDocument): ProjectJSON {
  const input = doc as unknown as Record<string, unknown>;
  const output: ProjectJSON = { version: PROJECT_VERSION };

  for (const key of Object.keys(input).sort()) {
    if (key === 'version') continue;

    const value = input[key];
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') continue;
    output[key] = toJSONValue(value, key);
  }

  return output;
}

function fromJSONValue(value: unknown, key = ''): unknown {
  if ((key === 'pixels' || key === 'mask') && typeof value === 'string') {
    return decodeBase64(value);
  }
  if (Array.isArray(value)) return value.map((item) => fromJSONValue(item));
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = {};
  for (const childKey of Object.keys(value)) {
    output[childKey] = fromJSONValue(value[childKey], childKey);
  }
  return output;
}

function fail(message: string): never {
  throw new Error(message);
}

function requireString(record: Record<string, unknown>, key: string, subject: string): void {
  if (typeof record[key] !== 'string') fail(`Invalid project: ${subject}.${key} is required`);
}

function requireNumber(record: Record<string, unknown>, key: string, subject: string): void {
  if (typeof record[key] !== 'number') fail(`Invalid project: ${subject}.${key} is required`);
}

function requireBoolean(record: Record<string, unknown>, key: string, subject: string): void {
  if (typeof record[key] !== 'boolean') fail(`Invalid project: ${subject}.${key} is required`);
}

function validateOptionalData(record: Record<string, unknown>, key: string, subject: string): void {
  if (hasOwn(record, key) && !isRecord(record[key])) {
    fail(`Invalid project: ${subject}.${key} must be an object`);
  }
}

function validateLayer(value: unknown, index: number): Layer {
  if (!isRecord(value)) fail(`Invalid project: layers[${index}] must be an object`);

  const subject = `layers[${index}]`;
  requireString(value, 'id', subject);
  requireString(value, 'name', subject);
  requireBoolean(value, 'visible', subject);
  requireNumber(value, 'opacity', subject);
  requireBoolean(value, 'locked', subject);
  requireBoolean(value, 'clipping', subject);

  if (!LAYER_KINDS.includes(value.kind as (typeof LAYER_KINDS)[number])) {
    fail(`Invalid project: ${subject}.kind is required`);
  }
  if (!BLEND_MODES.includes(value.blendMode as (typeof BLEND_MODES)[number])) {
    fail(`Invalid project: ${subject}.blendMode is required`);
  }
  if (hasOwn(value, 'pixels') && !(value.pixels instanceof Uint8ClampedArray)) {
    fail(`Invalid project: ${subject}.pixels must be base64`);
  }
  if (hasOwn(value, 'mask') && !(value.mask instanceof Uint8ClampedArray)) {
    fail(`Invalid project: ${subject}.mask must be base64`);
  }
  if (hasOwn(value, 'children') && (!Array.isArray(value.children) || !value.children.every((id) => typeof id === 'string'))) {
    fail(`Invalid project: ${subject}.children must be an array of strings`);
  }

  validateOptionalData(value, 'textData', subject);
  validateOptionalData(value, 'vectorData', subject);
  validateOptionalData(value, 'shapeData', subject);
  validateOptionalData(value, 'adjustment', subject);

  return value as unknown as Layer;
}

function validateSelection(value: unknown): PaintDocument['selection'] {
  if (value === null) return null;
  if (!isRecord(value)) fail('Invalid project: selection must be null or an object');
  if (!(value.mask instanceof Uint8ClampedArray)) fail('Invalid project: selection.mask must be base64');
  requireNumber(value, 'width', 'selection');
  requireNumber(value, 'height', 'selection');
  return value as unknown as PaintDocument['selection'];
}

function validateProject(value: unknown): PaintDocument {
  if (!isRecord(value)) fail('Invalid project: root must be an object');
  if (typeof value.version !== 'number') fail('Invalid project: version is required');
  if (value.version !== PROJECT_VERSION) fail(`Unsupported project version: ${value.version}`);

  requireString(value, 'id', 'document');
  requireString(value, 'name', 'document');
  requireNumber(value, 'width', 'document');
  requireNumber(value, 'height', 'document');
  requireNumber(value, 'dpi', 'document');

  if (!Array.isArray(value.layers)) fail('Invalid project: document.layers is required');
  value.layers = value.layers.map((layer, index) => validateLayer(layer, index));

  if (value.activeLayerId !== null && typeof value.activeLayerId !== 'string') {
    fail('Invalid project: document.activeLayerId is required');
  }
  value.selection = validateSelection(value.selection);

  return value as unknown as PaintDocument;
}

export function serializeProject(doc: PaintDocument): string {
  return JSON.stringify(toProjectJSON(doc));
}

export function deserializeProject(json: string): PaintDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid project JSON');
  }

  return validateProject(fromJSONValue(parsed));
}
