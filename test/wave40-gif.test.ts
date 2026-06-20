import { describe, expect, it } from 'vitest';
import { decodeGifLzw, encodeGif } from '../src/io/gif';

/** バイト列中に部分列 needle が現れるか。GIF 構造マーカーの検出に使う。 */
function indexOfSeq(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** ASCII 文字列をバイト配列へ。 */
function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

/** GCE(0x21 0xF9)の出現回数を数える。 */
function countGce(bytes: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) count++;
  }
  return count;
}

/** 2x2 の単色寄り RGBA フレームを作る。 */
function frame2x2(colors: number[][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(2 * 2 * 4);
  for (let p = 0; p < 4; p++) {
    data[p * 4] = colors[p][0];
    data[p * 4 + 1] = colors[p][1];
    data[p * 4 + 2] = colors[p][2];
    data[p * 4 + 3] = 255;
  }
  return data;
}

describe('encodeGif', () => {
  const frames = [
    {
      rgba: frame2x2([
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 0],
      ]),
      delayMs: 100,
    },
    {
      rgba: frame2x2([
        [0, 0, 0],
        [255, 255, 255],
        [128, 128, 128],
        [64, 64, 64],
      ]),
      delayMs: 100,
    },
  ];

  it('先頭6バイトが GIF89a で、LSD に width/height と GCT フラグが立つ', () => {
    const bytes = encodeGif({ width: 2, height: 2, frames });

    expect(Array.from(bytes.slice(0, 6))).toEqual(ascii('GIF89a'));
    // LSD: width LE, height LE
    expect(bytes[6]).toBe(2);
    expect(bytes[7]).toBe(0);
    expect(bytes[8]).toBe(2);
    expect(bytes[9]).toBe(0);
    // packed バイトの最上位(GCT フラグ)が立つ
    expect(bytes[10] & 0x80).toBe(0x80);
  });

  it('NETSCAPE2.0 拡張を含み、GCE が frames 数だけ、Trailer 0x3B で終端する', () => {
    const bytes = encodeGif({ width: 2, height: 2, frames });

    expect(indexOfSeq(bytes, ascii('NETSCAPE2.0'))).toBeGreaterThanOrEqual(0);
    expect(countGce(bytes)).toBe(frames.length);
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it('delayMs=100 が GCE で delay=10(1/100秒)になる', () => {
    const bytes = encodeGif({ width: 2, height: 2, frames });

    // GCE: 0x21 0xF9 0x04 packed delayLE(2) transparentIndex 0x00
    const gceIndex = indexOfSeq(bytes, [0x21, 0xf9, 0x04]);
    expect(gceIndex).toBeGreaterThanOrEqual(0);
    const delayLo = bytes[gceIndex + 4];
    const delayHi = bytes[gceIndex + 5];
    expect(delayLo | (delayHi << 8)).toBe(10);
  });

  it('loop 値が NETSCAPE2.0 拡張に LE で書かれる', () => {
    const bytes = encodeGif({ width: 2, height: 2, frames, loop: 3 });
    const nsIndex = indexOfSeq(bytes, ascii('NETSCAPE2.0'));
    // 'NETSCAPE2.0'(11) の後: 0x03 0x01 loopLO loopHI 0x00
    expect(bytes[nsIndex + 11]).toBe(0x03);
    expect(bytes[nsIndex + 12]).toBe(0x01);
    const loop = bytes[nsIndex + 13] | (bytes[nsIndex + 14] << 8);
    expect(loop).toBe(3);
  });
});

/** encodeGif の出力から最初のフレームの LZW 画像データ(min-code-size と sub-block 連結)を取り出す。 */
function extractLzw(bytes: Uint8Array): { minCodeSize: number; lzw: number[] } {
  const idIndex = indexOfSeq(bytes, [0x2c]);
  const minCodeSize = bytes[idIndex + 10];
  let p = idIndex + 11;
  const lzw: number[] = [];
  for (;;) {
    const len = bytes[p];
    p++;
    if (len === 0) break;
    for (let i = 0; i < len; i++) lzw.push(bytes[p + i]);
    p += len;
  }
  return { minCodeSize, lzw };
}

/** GCT を読み、RGB から最近傍パレット index を求めて期待 index 列を作る(decode と突き合わせる用)。 */
function expectedIndicesFromGct(bytes: Uint8Array, rgb: number[][]): number[] {
  // packed の GCT サイズ field(下位3bit)から GCT エントリ数を得る。
  const sizeField = bytes[10] & 0x07;
  const gctEntries = 1 << (sizeField + 1);
  const gctStart = 13; // Header(6)+LSD(7)
  const palette: number[][] = [];
  for (let i = 0; i < gctEntries; i++) {
    palette.push([bytes[gctStart + i * 3], bytes[gctStart + i * 3 + 1], bytes[gctStart + i * 3 + 2]]);
  }
  return rgb.map(([r, g, b]) => {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const dr = r - palette[c][0];
      const dg = g - palette[c][1];
      const db = b - palette[c][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  });
}

describe('decodeGifLzw ラウンドトリップ', () => {
  it('encodeGif の画像データを decodeGifLzw で完全復元する(短い列)', () => {
    const rgb = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ];
    const rgba = frame2x2(rgb);
    const bytes = encodeGif({ width: 2, height: 2, frames: [{ rgba, delayMs: 100 }] });

    const { minCodeSize, lzw } = extractLzw(bytes);
    const decoded = decodeGifLzw(lzw, minCodeSize);
    const expected = expectedIndicesFromGct(bytes, rgb);

    expect(decoded).toHaveLength(4);
    expect(decoded).toEqual(expected);
  });

  it('clear/EOI/コード幅拡張を跨ぐ長い index 列を完全復元する(16色・256画素)', () => {
    // 16 段階灰色 → 16 色パレット。256 画素で辞書が育ち、コード幅 5→6... の拡張を跨ぐ。
    const width = 16;
    const height = 16;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const rgb: number[][] = [];
    for (let p = 0; p < width * height; p++) {
      const v = p % 16;
      const g = v * 17; // 0..255 を 16 段階で
      rgba[p * 4] = g;
      rgba[p * 4 + 1] = g;
      rgba[p * 4 + 2] = g;
      rgba[p * 4 + 3] = 255;
      rgb.push([g, g, g]);
    }

    const bytes = encodeGif({ width, height, frames: [{ rgba, delayMs: 50 }] });
    const { minCodeSize, lzw } = extractLzw(bytes);
    const decoded = decodeGifLzw(lzw, minCodeSize);
    const expected = expectedIndicesFromGct(bytes, rgb);

    expect(decoded).toHaveLength(width * height);
    expect(decoded).toEqual(expected);
  });

  it('辞書リセットを伴う長尺列(1024画素)を完全復元する', () => {
    // 8 段階 × 1024 画素。十分長く、コード幅拡張を確実に跨ぐ列で往復一致を保証する。
    const width = 32;
    const height = 32;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const rgb: number[][] = [];
    for (let p = 0; p < width * height; p++) {
      const v = (p * 5) % 8;
      const c = v * 32;
      rgba[p * 4] = c;
      rgba[p * 4 + 1] = 0;
      rgba[p * 4 + 2] = 0;
      rgba[p * 4 + 3] = 255;
      rgb.push([c, 0, 0]);
    }

    const bytes = encodeGif({ width, height, frames: [{ rgba, delayMs: 100 }] });
    const { minCodeSize, lzw } = extractLzw(bytes);
    const decoded = decodeGifLzw(lzw, minCodeSize);
    const expected = expectedIndicesFromGct(bytes, rgb);

    expect(decoded).toHaveLength(width * height);
    expect(decoded).toEqual(expected);
  });
});
