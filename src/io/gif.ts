import { quantizeColors } from '../filters/quantize';
import type { RGBA } from '../types';

/**
 * アニメGIF(GIF89a)書き出し。
 *
 * 設計判断:
 * - canvas を一切使わず、純粋に Uint8Array でバイト列を組み立てる(jsdom テスト可能性のため)。
 *   全ロジックが純粋関数なので test/wave40-gif.test.ts で配列レベルに検証できる。
 * - パレットは全フレームの画素を連結し、quantizeColors(メディアンカット)で ≤256 色の
 *   グローバルカラーテーブル(GCT)を1枚生成する。全フレームがこの共通パレットを共有する。
 * - GCT サイズは必ず 2^n(2..256)に切り上げる。GIF89a の Logical Screen Descriptor /
 *   Image Descriptor の packed バイトは「GCT サイズ = 2^(n+1)」の n を保持するため、
 *   色数を 2 のべき乗へ丸める必要がある。
 * - 透明は今回非対応。全画素を不透明として扱い、RGBA の α は完全に無視する
 *   (パレット index 化は RGB 最近傍のみ)。GCE の transparentIndex は常に 0、
 *   transparent-color-flag は 0(未使用)で出力する。
 * - LZW は GIF 可変長 LZW(Clear/EOI コード・コード幅拡張・12bit 上限での辞書リセット)。
 *   出力は min-code-size バイトの後、255 バイトごとのサブブロック列 + 終端 0x00。
 */

/** encodeGif の 1 フレーム入力。rgba は width*height*4 の RGBA、delayMs は表示時間(ミリ秒)。 */
export interface GifFrameInput {
  rgba: Uint8ClampedArray;
  delayMs: number;
}

/** encodeGif の入力。loop=0(既定)で無限ループ、正の値で回数指定。 */
export interface GifEncodeInput {
  width: number;
  height: number;
  frames: GifFrameInput[];
  loop?: number;
}

/** 動的にバイト列を積むヘルパ(Uint8Array を都度確保せず push で構築)。 */
class ByteWriter {
  private bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  /** 16bit リトルエンディアン。 */
  u16le(value: number): void {
    this.bytes.push(value & 0xff);
    this.bytes.push((value >> 8) & 0xff);
  }

  ascii(text: string): void {
    for (let i = 0; i < text.length; i++) {
      this.bytes.push(text.charCodeAt(i) & 0xff);
    }
  }

  push(values: Iterable<number>): void {
    for (const value of values) this.bytes.push(value & 0xff);
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** value 以上で最小の 2 のべき乗を返す(最低 2、最大 256)。GCT サイズ算出に使う。 */
function ceilPow2(value: number): number {
  let size = 2;
  while (size < value) size *= 2;
  if (size < 2) size = 2;
  if (size > 256) size = 256;
  return size;
}

/** GCT サイズ size(2^(n+1)) から packed 用の n(0..7)を求める。 */
function gctSizeField(size: number): number {
  // size = 2^(n+1) ⇒ n = log2(size) - 1
  return Math.max(0, Math.round(Math.log2(size)) - 1);
}

/**
 * GIF 可変長 LZW エンコード。
 *
 * 要点:
 * - clearCode=2^minCodeSize、eoiCode=clearCode+1 を予約コードとする。
 * - 辞書は clearCode/eoiCode の次(eoiCode+1)から新規シーケンスを割り当てる。
 * - 現在のコード幅で表せる最大コードに達したらコード幅を +1 する。
 * - 12bit(辞書サイズ 4096)を超える割り当てが起きる直前に Clear を出力して辞書をリセットする。
 * - ビットは LSB-first で codeStream にパックする(GIF 仕様)。
 */
function lzwEncode(indices: number[], minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const maxCode = 4096; // 12bit 上限

  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;

  const writeCode = (code: number, width: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += width;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  let dict = new Map<string, number>();
  let nextCode = eoiCode + 1;
  let codeWidth = minCodeSize + 1;

  const resetDict = (): void => {
    dict = new Map<string, number>();
    nextCode = eoiCode + 1;
    codeWidth = minCodeSize + 1;
  };

  writeCode(clearCode, codeWidth);
  resetDict();

  if (indices.length === 0) {
    writeCode(eoiCode, codeWidth);
    if (bitCount > 0) out.push(bitBuffer & 0xff);
    return out;
  }

  let current = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const combined = `${current},${k}`;
    if (dict.has(combined)) {
      current = combined;
    } else {
      // current は単一 index か既存辞書エントリのいずれかを表す。そのコードを出力。
      writeCode(currentCode(current, dict), codeWidth);
      // 新規シーケンスを辞書登録。
      if (nextCode < maxCode) {
        dict.set(combined, nextCode);
        nextCode++;
        // 現在のコード幅で表せる範囲を超えたら +1。
        if (nextCode > (1 << codeWidth) && codeWidth < 12) {
          codeWidth++;
        }
      } else {
        // 辞書満杯: Clear を出力してリセット。
        writeCode(clearCode, codeWidth);
        resetDict();
      }
      current = String(k);
    }
  }

  writeCode(currentCode(current, dict), codeWidth);
  writeCode(eoiCode, codeWidth);
  if (bitCount > 0) out.push(bitBuffer & 0xff);
  return out;
}

/**
 * current 文字列(カンマ区切り index 列)に対応する出力コードを返す。
 * 単一 index("5" など)はその数値そのもの、複数 index は辞書登録済みのコード。
 */
function currentCode(current: string, dict: Map<string, number>): number {
  if (dict.has(current)) return dict.get(current)!;
  // 単一 index ならその値そのものがコード(< clearCode のはず)。
  return Number(current);
}

/**
 * GIF 可変長 LZW デコード(ラウンドトリップ/テスト用)。
 * encodeGif が出力した LZW サブブロック連結後の生バイト列ではなく、
 * lzwEncode の出力相当(min-code-size を含まないコードストリーム)を受け取り、
 * 復元した index 列を返す。
 */
export function decodeGifLzw(bytes: number[] | Uint8Array, minCodeSize: number): number[] {
  const data = Array.from(bytes);
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let bitBuffer = 0;
  let bitCount = 0;
  let pos = 0;

  const readCode = (width: number): number => {
    while (bitCount < width) {
      if (pos >= data.length) return eoiCode;
      bitBuffer |= data[pos] << bitCount;
      pos++;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << width) - 1);
    bitBuffer >>= width;
    bitCount -= width;
    return code;
  };

  const out: number[] = [];
  let dict: number[][] = [];
  let codeWidth = minCodeSize + 1;

  const resetDict = (): void => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push([]); // clearCode のプレースホルダ
    dict.push([]); // eoiCode のプレースホルダ
    codeWidth = minCodeSize + 1;
  };

  resetDict();

  let prev: number[] | null = null;
  for (;;) {
    const code = readCode(codeWidth);
    if (code === eoiCode) break;
    if (code === clearCode) {
      resetDict();
      prev = null;
      continue;
    }

    let entry: number[];
    if (code < dict.length) {
      entry = dict[code];
    } else if (prev) {
      // KwKwK ケース: 直前列 + 直前列先頭。
      entry = [...prev, prev[0]];
    } else {
      break;
    }

    for (const v of entry) out.push(v);

    if (prev) {
      dict.push([...prev, entry[0]]);
      // コード幅拡張: デコーダは辞書登録がエンコーダより 1 ステップ遅れるため、
      // エンコーダ(nextCode > 1<<codeWidth で拡張)と対称になるよう
      // dict.length === 1<<codeWidth(= >=)で拡張する。両者の dict 番号は揃っている。
      if (dict.length >= (1 << codeWidth) && codeWidth < 12) {
        codeWidth++;
      }
    }
    prev = entry;
  }

  return out;
}

/** バイト列を 255 バイトごとのサブブロック列(各先頭に長さバイト)+終端 0x00 に分割して書く。 */
function writeSubBlocks(writer: ByteWriter, data: number[]): void {
  let offset = 0;
  while (offset < data.length) {
    const chunk = Math.min(255, data.length - offset);
    writer.byte(chunk);
    for (let i = 0; i < chunk; i++) writer.byte(data[offset + i]);
    offset += chunk;
  }
  writer.byte(0x00);
}

/** RGBA 1 枚を共通パレットへ最近傍 index 化する。α は無視(全画素不透明扱い)。 */
function mapToPaletteIndices(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: RGBA[],
): number[] {
  const total = width * height;
  const indices = new Array<number>(total);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let c = 0; c < palette.length; c++) {
      const col = palette[c];
      const dr = r - col.r;
      const dg = g - col.g;
      const db = b - col.b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    indices[p] = best;
  }
  return indices;
}

/**
 * 全フレームから共通グローバルパレットを生成する。
 * 全フレームの RGBA を縦に連結した 1 枚として quantizeColors に渡し、≤256 色を得る。
 */
function buildGlobalPalette(input: GifEncodeInput): RGBA[] {
  const { width, height, frames } = input;
  const perFrame = width * height;
  const combined = new Uint8ClampedArray(perFrame * frames.length * 4);
  for (let f = 0; f < frames.length; f++) {
    combined.set(frames[f].rgba.subarray(0, perFrame * 4), f * perFrame * 4);
  }
  const { palette } = quantizeColors(combined, width, height * frames.length, 256);
  if (palette.length === 0) {
    return [{ r: 0, g: 0, b: 0, a: 255 }];
  }
  return palette;
}

/**
 * アニメ GIF89a を Uint8Array で生成する。
 *
 * 透明非対応。全画素不透明前提で α を無視し、RGB 最近傍でグローバルパレットへ index 化する。
 * delayMs は GCE で 1/100 秒単位(round(delayMs/10))へ丸める。
 */
export function encodeGif(input: GifEncodeInput): Uint8Array {
  const { width, height, frames } = input;
  const loop = input.loop ?? 0;

  const palette = buildGlobalPalette(input);
  const gctSize = ceilPow2(palette.length); // 2^(n+1)
  const sizeField = gctSizeField(gctSize); // n

  // minCodeSize は最低 2(GIF 仕様)、パレットを表せる幅以上。
  const minCodeSize = Math.max(2, Math.ceil(Math.log2(Math.max(2, palette.length))));

  const writer = new ByteWriter();

  // --- Header ---
  writer.ascii('GIF89a');

  // --- Logical Screen Descriptor ---
  writer.u16le(width);
  writer.u16le(height);
  // packed: GCT flag(1) | color resolution(3) | sort(1) | GCT size(3)
  writer.byte(0x80 | (sizeField << 4) | sizeField);
  writer.byte(0x00); // 背景色 index
  writer.byte(0x00); // アスペクト比

  // --- Global Color Table(3*2^(n+1) バイト) ---
  for (let i = 0; i < gctSize; i++) {
    const col = palette[i];
    if (col) {
      writer.byte(col.r);
      writer.byte(col.g);
      writer.byte(col.b);
    } else {
      writer.byte(0);
      writer.byte(0);
      writer.byte(0);
    }
  }

  // --- Application Extension(NETSCAPE2.0 ループ) ---
  writer.byte(0x21);
  writer.byte(0xff);
  writer.byte(0x0b);
  writer.ascii('NETSCAPE2.0');
  writer.byte(0x03);
  writer.byte(0x01);
  writer.u16le(loop);
  writer.byte(0x00);

  // --- 各フレーム ---
  for (const frame of frames) {
    const delay = Math.round(frame.delayMs / 10); // 1/100 秒単位

    // Graphic Control Extension
    writer.byte(0x21);
    writer.byte(0xf9);
    writer.byte(0x04);
    writer.byte(0x00); // packed: disposal=0, transparent flag=0
    writer.u16le(delay);
    writer.byte(0x00); // transparent color index
    writer.byte(0x00); // ブロック終端

    // Image Descriptor
    writer.byte(0x2c);
    writer.u16le(0); // left
    writer.u16le(0); // top
    writer.u16le(width);
    writer.u16le(height);
    writer.byte(0x00); // packed: no local color table

    // LZW 画像データ
    const indices = mapToPaletteIndices(frame.rgba, width, height, palette);
    writer.byte(minCodeSize);
    const lzw = lzwEncode(indices, minCodeSize);
    writeSubBlocks(writer, lzw);
  }

  // --- Trailer ---
  writer.byte(0x3b);

  return writer.toUint8Array();
}
