import type { Layer, RGBA } from '../types';
import {
  flattenPath,
  rasterizeDashedStroke,
  rasterizeFill,
  rasterizeStroke,
  type PathPoint,
  type VectorPath,
} from './path';

export type { PathPoint, VectorPath } from './path';

export interface VectorStroke {
  color: RGBA;
  width: number;
  dash?: number[];
  dashArray?: number[];
  dashOffset?: number;
}

export interface VectorSubpath {
  path: VectorPath;
  fill?: RGBA | null;
  stroke?: VectorStroke | null;
}

export interface VectorLayerData {
  subpaths: VectorSubpath[];
}

export type VectorRasterLayer = Layer & {
  kind: 'raster';
  vectorData?: VectorLayerData;
};

declare module '../types' {
  interface Layer {
    /** これを持つ raster レイヤーは vectorData から pixels を再生成できる再編集ベクターレイヤー。 */
    vectorData?: VectorLayerData;
  }
}

const DEFAULT_VECTOR_LAYER_DATA: VectorLayerData = {
  subpaths: [],
};

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function clampByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return v;
}

function wholePx(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

function cloneColor(color: RGBA): RGBA {
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    a: color.a,
  };
}

function clonePoint(point: PathPoint): PathPoint {
  return { ...point };
}

function clonePath(path: VectorPath): VectorPath {
  return {
    closed: path.closed,
    points: path.points.map(clonePoint),
  };
}

function cloneStroke(stroke: VectorStroke): VectorStroke {
  return {
    ...stroke,
    color: cloneColor(stroke.color),
    dash: stroke.dash ? [...stroke.dash] : undefined,
    dashArray: stroke.dashArray ? [...stroke.dashArray] : undefined,
  };
}

function cloneSubpath(subpath: VectorSubpath): VectorSubpath {
  return {
    path: clonePath(subpath.path),
    fill: subpath.fill ? cloneColor(subpath.fill) : subpath.fill,
    stroke: subpath.stroke ? cloneStroke(subpath.stroke) : subpath.stroke,
  };
}

function sourceOver(
  pixels: Uint8ClampedArray,
  i: number,
  color: RGBA,
  coverage: number,
): void {
  const srcA = clamp01((clampByte(color.a) / 255) * coverage);
  if (srcA <= 0) return;

  const dstA = pixels[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);

  if (outA <= 0) {
    pixels[i] = 0;
    pixels[i + 1] = 0;
    pixels[i + 2] = 0;
    pixels[i + 3] = 0;
    return;
  }

  const dstScale = dstA * (1 - srcA);
  pixels[i] = (clampByte(color.r) * srcA + pixels[i] * dstScale) / outA;
  pixels[i + 1] = (clampByte(color.g) * srcA + pixels[i + 1] * dstScale) / outA;
  pixels[i + 2] = (clampByte(color.b) * srcA + pixels[i + 2] * dstScale) / outA;
  pixels[i + 3] = outA * 255;
}

function compositeCoverage(
  pixels: Uint8ClampedArray,
  coverageMask: Uint8ClampedArray,
  color: RGBA,
): void {
  for (let p = 0; p < coverageMask.length; p++) {
    const coverage = coverageMask[p] / 255;
    if (coverage <= 0) continue;
    sourceOver(pixels, p * 4, color, coverage);
  }
}

function applyAlphaMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8ClampedArray,
): void {
  const total = width * height;

  for (let p = 0; p < total; p++) {
    const coverage = (mask[p] ?? 0) / 255;
    const i = p * 4;
    pixels[i + 3] = pixels[i + 3] * coverage;
  }
}

function strokeDash(stroke: VectorStroke): number[] | undefined {
  return stroke.dashArray ?? stroke.dash;
}

function hasGeometry(path: VectorPath): boolean {
  return flattenPath(path).length > 0;
}

export function createVectorLayerData(partial: Partial<VectorLayerData> = {}): VectorLayerData {
  const subpaths = partial.subpaths ?? DEFAULT_VECTOR_LAYER_DATA.subpaths;

  return {
    subpaths: subpaths.map(cloneSubpath),
  };
}

export function updateVectorLayerData(data: VectorLayerData, patch: Partial<VectorLayerData>): VectorLayerData {
  const subpaths = patch.subpaths ?? data.subpaths;

  return {
    ...data,
    ...patch,
    subpaths: subpaths.map(cloneSubpath),
  };
}

export function addSubpath(data: VectorLayerData, subpath: VectorSubpath): VectorLayerData {
  return {
    ...data,
    subpaths: [...data.subpaths.map(cloneSubpath), cloneSubpath(subpath)],
  };
}

export function rasterizeVectorLayer(
  data: VectorLayerData,
  w: number,
  h: number,
  mask?: Uint8ClampedArray | null,
): Uint8ClampedArray {
  const width = wholePx(w);
  const height = wholePx(h);
  const pixels = new Uint8ClampedArray(width * height * 4);
  if (width <= 0 || height <= 0 || data.subpaths.length === 0) return pixels;

  for (const subpath of data.subpaths) {
    const path = subpath.path;
    if (!hasGeometry(path)) continue;

    if (subpath.fill && path.closed) {
      compositeCoverage(pixels, rasterizeFill(path, width, height), subpath.fill);
    }

    if (subpath.stroke) {
      const dash = strokeDash(subpath.stroke);
      const coverage = dash !== undefined
        ? rasterizeDashedStroke(path, width, height, subpath.stroke.width, dash, subpath.stroke.dashOffset)
        : rasterizeStroke(path, width, height, subpath.stroke.width);
      compositeCoverage(pixels, coverage, subpath.stroke.color);
    }
  }

  if (mask) applyAlphaMask(pixels, width, height, mask);
  return pixels;
}
