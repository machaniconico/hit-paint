import type { RGBA } from '../types';
import { measureText, renderText } from './index';
import { glyph } from './font5x7';
import { layoutText, type TextAlign } from './text-layout';
import { layoutVerticalText } from './text-vertical';
import { layoutTextOnPath } from './text-on-path';
import type { VectorPath, PathPoint } from '../vector/path';

/**
 * US-4604 配線: TextLayerData を整列/縦書き/パス追従に拡張。
 *
 * 設計判断:
 * - 後方互換最優先。拡張フィールド(align/maxWidth/vertical/pathPoints)が「全て未指定」の
 *   ときは従来どおり renderText を直接呼ぶ経路を通り、出力は既存とバイト同一になる。
 *   1つでも拡張が有効なときだけ layoutText/layoutVerticalText/layoutTextOnPath による
 *   配置を経由し、共通の renderPositionedGlyphs でスタンプする。
 * - 配置ヘルパ群(US-4601/4602/4603)は純粋・決定論なので、本ファイルも canvas 非依存で
 *   テスト可能(renderPositionedGlyphs は Uint8ClampedArray を直接書く)。
 * - drawGlyph 相当の描画は index.ts の private 実装と等価のものをここに持つ
 *   (index.ts の drawGlyph/compositePixel は export されていないため)。
 */

// font5x7 由来の寸法定数(index.ts と同値, export されていないため自前定義)。
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

/** pathPoints の保持形式: VectorPath そのもの、または PathPoint 配列(closed=false 既定)。 */
export type TextPathInput = VectorPath | PathPoint[];

export interface TextLayerData {
  text: string;
  x: number;
  y: number;
  color: RGBA;
  scale?: number;
  letterSpacing?: number;
  // --- US-4604 拡張(いずれも optional, 未指定で従来挙動) ---
  /** 水平整列(layoutText の align)。'left' 既定相当。 */
  align?: TextAlign;
  /** 折り返し基準幅(px)。指定時 layoutText で語折り返し+整列。 */
  maxWidth?: number;
  /** true で縦書き(layoutVerticalText)。 */
  vertical?: boolean;
  /** 指定時テキストをこのパスに沿わせる(layoutTextOnPath)。VectorPath か PathPoint 配列。 */
  pathPoints?: TextPathInput;
}

const DEFAULT_TEXT_LAYER_DATA: TextLayerData = {
  text: '',
  x: 0,
  y: 0,
  color: { r: 0, g: 0, b: 0, a: 255 },
  scale: 1,
  letterSpacing: 1,
};

export function createTextLayerData(partial: Partial<TextLayerData> = {}): TextLayerData {
  return {
    ...DEFAULT_TEXT_LAYER_DATA,
    ...partial,
    color: partial.color ?? { ...DEFAULT_TEXT_LAYER_DATA.color },
  };
}

/** 拡張(整列/縦書き/パス追従)が1つでも有効か。false なら従来 renderText 経路。 */
function hasLayoutExtension(data: TextLayerData): boolean {
  return (
    data.vertical === true
    || data.pathPoints !== undefined
    || data.maxWidth !== undefined
    || (data.align !== undefined && data.align !== 'left')
  );
}

/** TextPathInput を VectorPath へ正規化(配列なら closed=false の VectorPath に包む)。 */
function toVectorPath(input: TextPathInput): VectorPath {
  if (Array.isArray(input)) return { points: input, closed: false };
  return input;
}

/**
 * 配置済みグリフ列({char,x,y})を pixels へスタンプする純粋ヘルパ。
 * - glyph(char) の 5x7 ビットマップを index.ts の drawGlyph と同等の規約で描く。
 * - 各グリフの描画原点 = (originX + round(g.x), originY + round(g.y))。
 *   x,y は layout 由来の相対座標、originX/originY はレイヤー配置オフセット。
 * - mask / 合成は renderText と同一(alpha 合成 + 任意の選択マスク)。
 */
export function renderPositionedGlyphs(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  glyphs: { char: string; x: number; y: number }[],
  opts: { x: number; y: number; color: RGBA; scale?: number; mask?: Uint8ClampedArray | null },
): void {
  const scale = normalizeScale(opts.scale);
  const srcA = clampByte(opts.color.a) / 255;
  if (srcA <= 0 || width <= 0 || height <= 0) return;

  const originX = Math.trunc(opts.x);
  const originY = Math.trunc(opts.y);
  const mask = opts.mask ?? null;

  for (const g of glyphs) {
    if (g.char === ' ' || g.char === '\n') continue;
    const gx = originX + Math.round(g.x);
    const gy = originY + Math.round(g.y);
    drawGlyph(pixels, width, height, gx, gy, glyph(g.char), opts.color, srcA, scale, mask);
  }
}

export function rasterizeTextLayer(
  data: TextLayerData,
  width: number,
  height: number,
  mask?: Uint8ClampedArray | null,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  // 拡張未指定 → 従来 renderText を素通し(既存とバイト同一)。
  if (!hasLayoutExtension(data)) {
    renderText(pixels, width, height, { ...data, mask });
    return pixels;
  }

  const scale = data.scale;
  const letterSpacing = data.letterSpacing;

  // 配置の優先順位: 縦書き > パス追従 > 整列/折り返し。
  let glyphs: { char: string; x: number; y: number }[];
  if (data.vertical === true) {
    glyphs = layoutVerticalText(data.text, { scale, lineGap: undefined, columnGap: undefined }).glyphs;
  } else if (data.pathPoints !== undefined) {
    const path = toVectorPath(data.pathPoints);
    glyphs = layoutTextOnPath(data.text, path, { scale, letterSpacing }).map((g) => ({
      char: g.char,
      x: g.x,
      y: g.y,
    }));
  } else {
    glyphs = layoutText(data.text, {
      scale,
      letterSpacing,
      maxWidth: data.maxWidth,
      align: data.align,
    }).glyphs;
  }

  renderPositionedGlyphs(pixels, width, height, glyphs, {
    x: data.x,
    y: data.y,
    color: data.color,
    scale,
    mask,
  });
  return pixels;
}

export function updateTextLayerData(data: TextLayerData, patch: Partial<TextLayerData>): TextLayerData {
  return { ...data, ...patch };
}

export function measureTextLayer(data: TextLayerData): { width: number; height: number } {
  if (data.text.length === 0) return { width: 0, height: 0 };

  if (data.vertical === true) {
    const r = layoutVerticalText(data.text, { scale: data.scale });
    return { width: r.width, height: r.height };
  }
  if (data.maxWidth !== undefined || (data.align !== undefined && data.align !== 'left')) {
    const r = layoutText(data.text, {
      scale: data.scale,
      letterSpacing: data.letterSpacing,
      maxWidth: data.maxWidth,
      align: data.align,
    });
    return { width: r.width, height: r.height };
  }

  return measureText(data.text, {
    scale: data.scale,
    letterSpacing: data.letterSpacing,
  });
}

// --- index.ts drawGlyph / compositePixel と等価の private 描画(export されていないため再実装) ---

function drawGlyph(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  rows: number[],
  color: RGBA,
  srcA: number,
  scale: number,
  mask: Uint8ClampedArray | null,
): void {
  for (let gy = 0; gy < GLYPH_HEIGHT; gy++) {
    const row = rows[gy] ?? 0;
    if (row === 0) continue;

    for (let gx = 0; gx < GLYPH_WIDTH; gx++) {
      if (((row >> (GLYPH_WIDTH - 1 - gx)) & 1) === 0) continue;

      for (let sy = 0; sy < scale; sy++) {
        const py = y + gy * scale + sy;
        if (py < 0 || py >= height) continue;

        for (let sx = 0; sx < scale; sx++) {
          const px = x + gx * scale + sx;
          if (px < 0 || px >= width) continue;
          compositePixel(pixels, width, px, py, color, srcA, mask);
        }
      }
    }
  }
}

function compositePixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  color: RGBA,
  srcA: number,
  mask: Uint8ClampedArray | null,
): void {
  const p = y * width + x;
  let effectiveA = srcA;
  if (mask) effectiveA *= (mask[p] ?? 0) / 255;
  if (effectiveA <= 0) return;

  const i = p * 4;
  const dstA = pixels[i + 3] / 255;
  const outA = effectiveA + dstA * (1 - effectiveA);
  if (outA <= 0) return;

  const srcR = clampByte(color.r);
  const srcG = clampByte(color.g);
  const srcB = clampByte(color.b);
  pixels[i] = (srcR * effectiveA + pixels[i] * dstA * (1 - effectiveA)) / outA;
  pixels[i + 1] = (srcG * effectiveA + pixels[i + 1] * dstA * (1 - effectiveA)) / outA;
  pixels[i + 2] = (srcB * effectiveA + pixels[i + 2] * dstA * (1 - effectiveA)) / outA;
  pixels[i + 3] = outA * 255;
}

function normalizeScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}
