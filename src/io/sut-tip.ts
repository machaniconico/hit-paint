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

const IEND_0 = 0x49;
const IEND_1 = 0x45;
const IEND_2 = 0x4e;
const IEND_3 = 0x44;

type PngRange = {
  start: number;
  end: number;
};

type ChunkEndCache = Map<number, number | null>;

function hasPngSignature(blob: Uint8Array, offset: number): boolean {
  if (offset + PNG_SIGNATURE.length > blob.length) {
    return false;
  }

  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (blob[offset + i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }

  return true;
}

function readUint32BE(blob: Uint8Array, offset: number): number {
  return (
    blob[offset] * 0x1000000 +
    ((blob[offset + 1] << 16) | (blob[offset + 2] << 8) | blob[offset + 3])
  );
}

function isIendChunkType(blob: Uint8Array, typeOffset: number): boolean {
  return (
    blob[typeOffset] === IEND_0 &&
    blob[typeOffset + 1] === IEND_1 &&
    blob[typeOffset + 2] === IEND_2 &&
    blob[typeOffset + 3] === IEND_3
  );
}

function findPngEnd(
  blob: Uint8Array,
  start: number,
  chunkEndCache: ChunkEndCache,
): number | null {
  let offset = start + PNG_SIGNATURE.length;
  const seenOffsets: number[] = [];
  let result: number | null = null;

  while (true) {
    if (chunkEndCache.has(offset)) {
      result = chunkEndCache.get(offset) ?? null;
      break;
    }

    if (offset + 12 > blob.length) {
      result = null;
      break;
    }

    seenOffsets.push(offset);

    const length = readUint32BE(blob, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;

    if (length > blob.length - dataOffset - 4) {
      result = null;
      break;
    }

    const nextOffset = dataOffset + length + 4;

    if (isIendChunkType(blob, typeOffset)) {
      result = length === 0 ? nextOffset : null;
      break;
    }

    offset = nextOffset;
  }

  for (const seenOffset of seenOffsets) {
    chunkEndCache.set(seenOffset, result);
  }

  return result;
}

function collectPngRanges(blob: Uint8Array): PngRange[] {
  const ranges: PngRange[] = [];
  const chunkEndCache: ChunkEndCache = new Map();

  for (let offset = 0; offset <= blob.length - PNG_SIGNATURE.length; offset += 1) {
    if (!hasPngSignature(blob, offset)) {
      continue;
    }

    const end = findPngEnd(blob, offset, chunkEndCache);
    if (end !== null) {
      ranges.push({ start: offset, end });
    }
  }

  return ranges;
}

export function extractPngFromBlob(blob: Uint8Array): Uint8Array | null {
  let largest: PngRange | null = null;

  for (const range of collectPngRanges(blob)) {
    if (largest === null || range.end - range.start > largest.end - largest.start) {
      largest = range;
    }
  }

  return largest === null ? null : blob.slice(largest.start, largest.end);
}

export function listPngOffsets(blob: Uint8Array): number[] {
  return collectPngRanges(blob).map((range) => range.start);
}
