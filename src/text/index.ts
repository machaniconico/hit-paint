import type { RGBA } from '../types';
import { glyph } from './font5x7';

export interface RenderTextOptions {
  text: string;
  x: number;
  y: number;
  color: RGBA;
  scale?: number;
  letterSpacing?: number;
  mask?: Uint8ClampedArray | null;
}

export interface MeasureTextOptions {
  scale?: number;
  letterSpacing?: number;
}

export interface TextMetrics {
  width: number;
  height: number;
}

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const DEFAULT_LETTER_SPACING = 1;
const LINE_GAP = 2;

export function renderText(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: RenderTextOptions,
): void {
  const scale = normalizeInteger(opts.scale, 1);
  const letterSpacing = normalizeSpacing(opts.letterSpacing);
  const lineHeight = GLYPH_HEIGHT * scale + LINE_GAP;
  const srcA = clampByte(opts.color.a) / 255;
  if (srcA <= 0 || width <= 0 || height <= 0) return;

  let penX = Math.trunc(opts.x);
  let penY = Math.trunc(opts.y);
  const originX = penX;

  for (const ch of opts.text) {
    if (ch === '\n') {
      penX = originX;
      penY += lineHeight;
      continue;
    }

    drawGlyph(pixels, width, height, penX, penY, glyph(ch), opts.color, srcA, scale, opts.mask ?? null);
    penX += GLYPH_WIDTH * scale + letterSpacing;
  }
}

export function measureText(text: string, opts: MeasureTextOptions = {}): TextMetrics {
  const scale = normalizeInteger(opts.scale, 1);
  const letterSpacing = normalizeSpacing(opts.letterSpacing);
  const lines = text.split('\n');
  let maxColumns = 0;

  for (const line of lines) {
    const count = [...line].length;
    const lineWidth = count === 0 ? 0 : count * GLYPH_WIDTH * scale + (count - 1) * letterSpacing;
    if (lineWidth > maxColumns) maxColumns = lineWidth;
  }

  return {
    width: maxColumns,
    height: lines.length === 0 ? 0 : lines.length * GLYPH_HEIGHT * scale + (lines.length - 1) * LINE_GAP,
  };
}

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

function normalizeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function normalizeSpacing(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LETTER_SPACING;
  return Math.trunc(value);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}
