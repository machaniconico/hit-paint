import { describe, expect, it } from 'vitest';
import { extractPngFromBlob, listPngOffsets } from '../src/io/sut-tip';

const PNG_SIGNATURE = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
);

const IEND_CRC = Uint8Array.of(0xae, 0x42, 0x60, 0x82);

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);

  for (let i = 0; i < table.length; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }

  return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  return bytes;
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function typeBytes(type: string): Uint8Array {
  return Uint8Array.from(type, (char) => char.charCodeAt(0));
}

function createChunk(type: string, data = new Uint8Array()): Uint8Array {
  const typeData = typeBytes(type);
  const bytes = new Uint8Array(12 + data.length);
  writeUint32BE(bytes, 0, data.length);
  bytes.set(typeData, 4);
  bytes.set(data, 8);
  writeUint32BE(bytes, 8 + data.length, crc32(concatBytes(typeData, data)));
  return bytes;
}

function createIhdrChunk(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeUint32BE(data, 0, width);
  writeUint32BE(data, 4, height);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return createChunk('IHDR', data);
}

function createIdatChunk(): Uint8Array {
  const deflateStream = Uint8Array.of(
    0x78,
    0x01,
    0x01,
    0x05,
    0x00,
    0xfa,
    0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    0x01,
    0x04,
    0x01,
    0x00,
  );

  return createChunk('IDAT', deflateStream);
}

function createTextChunk(): Uint8Array {
  const data = Uint8Array.from(
    ['n', 'o', 't', 'e', '\0', 'l', 'a', 'r', 'g', 'e'],
    (char) => char.charCodeAt(0),
  );

  return createChunk('tEXt', data);
}

function createIendChunk(): Uint8Array {
  return Uint8Array.of(
    0x00,
    0x00,
    0x00,
    0x00,
    0x49,
    0x45,
    0x4e,
    0x44,
    ...IEND_CRC,
  );
}

function createMinimalPng(extraChunks: Uint8Array[] = []): Uint8Array {
  return concatBytes(
    PNG_SIGNATURE,
    createIhdrChunk(1, 1),
    createIdatChunk(),
    ...extraChunks,
    createIendChunk(),
  );
}

function createTwoPngBlob(): {
  blob: Uint8Array;
  smallPng: Uint8Array;
  largePng: Uint8Array;
  smallOffset: number;
  largeOffset: number;
} {
  const smallPng = createMinimalPng();
  const largePng = createMinimalPng([createTextChunk()]);
  const prefix = Uint8Array.of(0x10, 0x20, 0x30, 0x40, 0x50);
  const middle = Uint8Array.of(0xaa, 0xbb, 0xcc);
  const suffix = Uint8Array.of(0xfe, 0xed, 0xfa, 0xce);
  const smallOffset = prefix.length;
  const largeOffset = prefix.length + smallPng.length + middle.length;

  return {
    blob: concatBytes(prefix, smallPng, middle, largePng, suffix),
    smallPng,
    largePng,
    smallOffset,
    largeOffset,
  };
}

describe('extractPngFromBlob', () => {
  it('returns a single PNG wrapped in junk', () => {
    const png = createMinimalPng();
    const junkBefore = Uint8Array.from({ length: 32 }, (_, index) => index & 0xff);
    const junkAfter = Uint8Array.of(0xff, 0xee, 0xdd, 0xcc, 0xbb);
    const blob = concatBytes(junkBefore, png, junkAfter);

    const result = extractPngFromBlob(blob);

    if (result === null) {
      throw new Error('Expected a PNG to be extracted');
    }

    expect(result.length).toBe(png.length);
    expect([...result.slice(0, 8)]).toEqual([...PNG_SIGNATURE]);
    expect([...result.slice(result.length - 4)]).toEqual([...IEND_CRC]);
  });

  it('returns null when there is no PNG', () => {
    const blob = Uint8Array.from([0x00, 0x01, 0x02, 0xff]);

    expect(extractPngFromBlob(blob)).toBeNull();
  });

  it('returns the larger PNG when two PNGs are present', () => {
    const { blob, largePng } = createTwoPngBlob();

    const result = extractPngFromBlob(blob);

    if (result === null) {
      throw new Error('Expected a PNG to be extracted');
    }

    expect(result.length).toBe(largePng.length);
    expect([...result]).toEqual([...largePng]);
  });
});

describe('listPngOffsets', () => {
  it('returns offsets for two PNGs in ascending order', () => {
    const { blob, smallOffset, largeOffset } = createTwoPngBlob();

    expect(listPngOffsets(blob)).toEqual([smallOffset, largeOffset]);
  });
});
