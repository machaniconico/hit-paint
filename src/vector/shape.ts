import type { RGBA } from '../types';
import { rasterizeFill, rasterizeStroke, type PathPoint, type VectorPath } from './path';

export type ShapeKind = 'rect' | 'rounded-rect' | 'ellipse' | 'polygon' | 'star' | 'line';

export interface ShapeStyle {
  fill?: RGBA | null;
  stroke?: { color: RGBA; width: number } | null;
}

export interface ShapeData {
  shape: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius?: number;
  sides?: number;
  innerRatio?: number;
  style: ShapeStyle;
}

const DEFAULT_SHAPE_DATA: ShapeData = {
  shape: 'rect',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  style: {
    fill: { r: 0, g: 0, b: 0, a: 255 },
    stroke: null,
  },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cloneColor(color: RGBA): RGBA {
  return { r: color.r, g: color.g, b: color.b, a: color.a };
}

function cloneStroke(stroke: ShapeStyle['stroke']): ShapeStyle['stroke'] {
  if (!stroke) return stroke ?? null;
  return { color: cloneColor(stroke.color), width: stroke.width };
}

function cloneStyle(style: ShapeStyle): ShapeStyle {
  return {
    fill: style.fill ? cloneColor(style.fill) : style.fill ?? null,
    stroke: cloneStroke(style.stroke),
  };
}

function mergeStyle(base: ShapeStyle, patch: ShapeStyle = {}): ShapeStyle {
  const fill = patch.fill !== undefined ? patch.fill : base.fill;
  const stroke = patch.stroke !== undefined ? patch.stroke : base.stroke;

  return {
    fill: fill ? cloneColor(fill) : fill ?? null,
    stroke: cloneStroke(stroke),
  };
}

export function createShapeData(partial: Partial<ShapeData> = {}): ShapeData {
  const { style, ...rest } = partial;

  return {
    ...DEFAULT_SHAPE_DATA,
    ...rest,
    style: mergeStyle(DEFAULT_SHAPE_DATA.style, style),
  };
}

export function updateShapeData(data: ShapeData, patch: Partial<ShapeData>): ShapeData {
  const { style, ...rest } = patch;

  return {
    ...data,
    ...rest,
    style: style ? mergeStyle(data.style, style) : cloneStyle(data.style),
  };
}

function emptyPixels(w: number, h: number): Uint8ClampedArray {
  return new Uint8ClampedArray(Math.max(0, Math.floor(w)) * Math.max(0, Math.floor(h)) * 4);
}

function rectMask(data: ShapeData, w: number, h: number): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(w * h);
  const right = data.x + data.width;
  const bottom = data.y + data.height;

  for (let py = 0; py < h; py++) {
    if (py < data.y || py >= bottom) continue;

    for (let px = 0; px < w; px++) {
      if (px >= data.x && px < right) {
        mask[py * w + px] = 255;
      }
    }
  }

  return mask;
}

function ellipseMask(data: ShapeData, w: number, h: number): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(w * h);
  const cx = data.x + data.width / 2;
  const cy = data.y + data.height / 2;
  const rx = data.width / 2;
  const ry = data.height / 2;
  const rx2 = rx * rx;
  const ry2 = ry * ry;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = px - cx;
      const dy = py - cy;
      if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1) {
        mask[py * w + px] = 255;
      }
    }
  }

  return mask;
}

function roundedRectMask(data: ShapeData, w: number, h: number): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(w * h);
  const left = data.x;
  const top = data.y;
  const right = data.x + data.width;
  const bottom = data.y + data.height;
  const radius = Math.max(0, Math.min(data.cornerRadius ?? 0, data.width / 2, data.height / 2));
  const radiusSquared = radius * radius;

  if (radius === 0) return rectMask(data, w, h);

  for (let py = 0; py < h; py++) {
    if (py < top || py >= bottom) continue;

    for (let px = 0; px < w; px++) {
      if (px < left || px >= right) continue;

      let cx = px;
      let cy = py;
      if (px < left + radius) cx = left + radius;
      if (px >= right - radius) cx = right - radius;
      if (py < top + radius) cy = top + radius;
      if (py >= bottom - radius) cy = bottom - radius;

      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= radiusSquared) {
        mask[py * w + px] = 255;
      }
    }
  }

  return mask;
}

function regularSides(data: ShapeData, fallback: number): number {
  return Math.max(3, Math.floor(data.sides ?? fallback));
}

function regularPath(data: ShapeData, sides: number): VectorPath {
  const cx = data.x + data.width / 2;
  const cy = data.y + data.height / 2;
  const radius = Math.min(data.width, data.height) / 2;
  const points: PathPoint[] = [];

  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / sides;
    points.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }

  return { points, closed: true };
}

function starPath(data: ShapeData, sides: number): VectorPath {
  const cx = data.x + data.width / 2;
  const cy = data.y + data.height / 2;
  const outerRadius = Math.min(data.width, data.height) / 2;
  const innerRadius = outerRadius * clamp01(data.innerRatio ?? 0.5);
  const points: PathPoint[] = [];

  for (let i = 0; i < sides * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (i * Math.PI) / sides;
    points.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }

  return { points, closed: true };
}

function ellipsePath(data: ShapeData, steps = 32): VectorPath {
  const cx = data.x + data.width / 2;
  const cy = data.y + data.height / 2;
  const rx = data.width / 2;
  const ry = data.height / 2;
  const points: PathPoint[] = [];

  for (let i = 0; i < steps; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / steps;
    points.push({
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
    });
  }

  return { points, closed: true };
}

function rectPath(data: ShapeData): VectorPath {
  const left = data.x;
  const top = data.y;
  const right = data.x + data.width;
  const bottom = data.y + data.height;

  return {
    closed: true,
    points: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
  };
}

function roundedRectPath(data: ShapeData, steps = 8): VectorPath {
  const left = data.x;
  const top = data.y;
  const right = data.x + data.width;
  const bottom = data.y + data.height;
  const radius = Math.max(0, Math.min(data.cornerRadius ?? 0, data.width / 2, data.height / 2));
  if (radius === 0) return rectPath(data);

  const corners = [
    { cx: right - radius, cy: top + radius, start: -Math.PI / 2 },
    { cx: right - radius, cy: bottom - radius, start: 0 },
    { cx: left + radius, cy: bottom - radius, start: Math.PI / 2 },
    { cx: left + radius, cy: top + radius, start: Math.PI },
  ];
  const points: PathPoint[] = [];

  for (const corner of corners) {
    for (let i = 0; i <= steps; i++) {
      const angle = corner.start + (i * Math.PI) / (2 * steps);
      points.push({
        x: corner.cx + Math.cos(angle) * radius,
        y: corner.cy + Math.sin(angle) * radius,
      });
    }
  }

  return { points, closed: true };
}

function shapePath(data: ShapeData): VectorPath {
  switch (data.shape) {
    case 'rounded-rect':
      return roundedRectPath(data);
    case 'ellipse':
      return ellipsePath(data);
    case 'polygon':
      return regularPath(data, regularSides(data, 3));
    case 'star':
      return starPath(data, regularSides(data, 5));
    case 'line':
      return {
        closed: false,
        points: [
          { x: data.x, y: data.y },
          { x: data.x + data.width, y: data.y + data.height },
        ],
      };
    case 'rect':
    default:
      return rectPath(data);
  }
}

function shapeCoverage(data: ShapeData, w: number, h: number): Uint8ClampedArray {
  switch (data.shape) {
    case 'rounded-rect':
      return roundedRectMask(data, w, h);
    case 'ellipse':
      return ellipseMask(data, w, h);
    case 'polygon':
      return rasterizeFill(regularPath(data, regularSides(data, 3)), w, h);
    case 'star':
      return rasterizeFill(starPath(data, regularSides(data, 5)), w, h);
    case 'line':
      return new Uint8ClampedArray(w * h);
    case 'rect':
    default:
      return rectMask(data, w, h);
  }
}

function writeColor(pixels: Uint8ClampedArray, index: number, color: RGBA): void {
  pixels[index] = color.r;
  pixels[index + 1] = color.g;
  pixels[index + 2] = color.b;
  pixels[index + 3] = color.a;
}

function compositeColor(pixels: Uint8ClampedArray, index: number, color: RGBA): void {
  const sa = color.a / 255;
  if (sa <= 0) return;

  const da = pixels[index + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;

  pixels[index] = ((color.r / 255 * sa + pixels[index] / 255 * da * (1 - sa)) / oa) * 255;
  pixels[index + 1] = ((color.g / 255 * sa + pixels[index + 1] / 255 * da * (1 - sa)) / oa) * 255;
  pixels[index + 2] = ((color.b / 255 * sa + pixels[index + 2] / 255 * da * (1 - sa)) / oa) * 255;
  pixels[index + 3] = oa * 255;
}

function paintCoverage(
  pixels: Uint8ClampedArray,
  coverage: Uint8ClampedArray,
  color: RGBA,
  composite = false,
): void {
  for (let i = 0; i < coverage.length; i++) {
    if (coverage[i] !== 255) continue;
    if (composite) {
      compositeColor(pixels, i * 4, color);
    } else {
      writeColor(pixels, i * 4, color);
    }
  }
}

function applyMask(pixels: Uint8ClampedArray, mask: Uint8ClampedArray): void {
  const count = Math.min(mask.length, Math.floor(pixels.length / 4));

  for (let i = 0; i < count; i++) {
    pixels[i * 4 + 3] = Math.round((pixels[i * 4 + 3] * mask[i]) / 255);
  }

  for (let i = count; i < pixels.length / 4; i++) {
    pixels[i * 4 + 3] = 0;
  }
}

export function rasterizeShape(
  data: ShapeData,
  w: number,
  h: number,
  mask?: Uint8ClampedArray | null,
): Uint8ClampedArray {
  const canvasWidth = Math.max(0, Math.floor(w));
  const canvasHeight = Math.max(0, Math.floor(h));
  const pixels = emptyPixels(canvasWidth, canvasHeight);

  if (canvasWidth <= 0 || canvasHeight <= 0 || data.width <= 0 || data.height <= 0) {
    return pixels;
  }

  if (data.shape !== 'line' && data.style.fill) {
    paintCoverage(pixels, shapeCoverage(data, canvasWidth, canvasHeight), data.style.fill);
  }

  if (data.style.stroke) {
    const strokeMask = rasterizeStroke(shapePath(data), canvasWidth, canvasHeight, data.style.stroke.width);
    paintCoverage(pixels, strokeMask, data.style.stroke.color, true);
  }

  if (mask) {
    applyMask(pixels, mask);
  }

  return pixels;
}
