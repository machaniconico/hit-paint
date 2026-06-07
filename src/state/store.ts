import { create } from 'zustand';
import { createTimeline, removeFrame as removeTimelineFrame, type Frame, type Timeline } from '../anim/timeline';
import type {
  AdjustmentSpec, BrushSettings, Layer, LayerId, PaintDocument, PointerSample, RGBA, ToolId, Viewport,
} from '../types';
import type { TextLayerData } from '../text/text-layer';
import { DEFAULT_BRUSH, IDENTITY_VIEWPORT } from '../types';
import {
  createAdjustmentLayer, createDocument, createRasterLayer, createLayerMask, createGroupLayer, createTextLayer,
  createShapeLayer, createVectorLayer,
  findLayer, activeLayer, layerIndex,
} from '../core/document';
import { addToGroup, removeFromGroup } from '../core/group-ops';
import { History, pixelSnapshotCommand } from '../core/history';
import { BLACK, WHITE } from '../color/color';
import { floodFill, fillRegion } from '../tools/fill';
import { fillLinearGradient } from '../tools/gradient';
import { bloatDab, pinchDab, pushDab } from '../tools/liquify';
import { ellipseMask, rectMask } from '../tools/marquee';
import { selectionMaskFromColor } from '../tools/magic-wand';
import { paintMaskDab } from '../tools/mask-paint';
import { featherSelection, growSelection, invertSelection, selectAll, shrinkSelection } from '../tools/selection';
import { moveLayerPixels } from '../tools/transform';
import { blurDab, burnDab, dodgeDab, sharpenDab } from '../engine/effect-brush';
import { flipHorizontal, flipVertical, rotate180, rotate90CCW, rotate90CW } from '../tools/layer-transform';
import { cropDocument, resizeCanvas, type ResizeCanvasOptions } from '../core/doc-ops';
import { alignOffset, opaqueBounds, translatePixels, type AlignMode } from '../core/layer-bounds';
import type { BlendMode, Selection } from '../types';
import { documentToSvg } from '../io/svg';
import { renderText } from '../text';
import { createTextLayerData, rasterizeTextLayer, updateTextLayerData } from '../text/text-layer';
import { createShapeData, rasterizeShape, updateShapeData, type ShapeData } from '../vector/shape';
import {
  createVectorLayerData,
  rasterizeVectorLayer,
  updateVectorLayerData,
  type VectorLayerData,
} from '../vector/vector-layer';
import {
  adjustBrightnessContrast,
  adjustHueSaturation,
  adjustLevels,
  grayscale,
  invertColors,
  posterize,
  type BrightnessContrastOptions,
  type HueSaturationOptions,
  type LevelsOptions,
  type PosterizeOptions,
  type SharpenOptions,
  sharpen,
  sepia,
  threshold,
  type ThresholdOptions,
} from '../filters';
import { bloom, type BloomOptions } from '../filters/bloom';
import { adaptiveThreshold, type AdaptiveThresholdOptions } from '../filters/adaptive-threshold';
import { channelMixer, type ChannelMixerOptions } from '../filters/channel-mixer';
import { chromaticAberration, type ChromaticOptions } from '../filters/chromatic';
import { chromaKey, type ChromaKeyOptions } from '../filters/chromakey';
import { clarity, type ClarityOptions } from '../filters/clarity';
import { adjustColorBalance, gradientMap, type ColorBalanceOptions, type GradientMapOptions } from '../filters/color-balance';
import { emboss, sobelEdge } from '../filters/convolve';
import { applyCurves, type CurvesOptions } from '../filters/curves';
import { dehaze, type DehazeOptions } from '../filters/dehaze';
import { duotone, type DuotoneOptions } from '../filters/duotone';
import { gaussianBlur, type GaussianBlurOptions } from '../filters/gaussian';
import { halftone, type HalftoneOptions } from '../filters/halftone';
import { autoContrast, autoLevels, type AutoToneOptions } from '../filters/histogram';
import { lensDistort, type LensDistortOptions } from '../filters/lens';
import { motionBlur, type MotionBlurOptions, zoomBlur, type ZoomBlurOptions } from '../filters/motion-blur';
import { orderedDither, type OrderedDitherOptions } from '../filters/noise';
import { oilPaint, type OilPaintOptions } from '../filters/oil';
import { pixelate, type PixelateOptions } from '../filters/pixelate';
import { applyQuantize } from '../filters/quantize';
import { replaceColor } from '../filters/replace-color';
import { pencilSketch, type SketchOptions } from '../filters/sketch';
import { adjustGamma, equalizeHistogram } from '../filters/tone';
import { unsharpMask } from '../filters/unsharp';
import { vignette, type VignetteOptions } from '../filters/vignette';
import { autoWhiteBalance, type WhiteBalanceOptions } from '../filters/white-balance';
import { generateGradient, type GradientSpec } from '../engine/gradient';
import { mirrorPoints, type SymmetryConfig } from '../engine/symmetry';
import { applyDynamics, type DynamicsConfig } from '../engine/brush-dynamics';
import { worleyField, worleyToGrayscale } from '../engine/cellular';
import { generateNoiseField, noiseToGrayscale } from '../engine/perlin';
import { cloneStampDab, type CloneStampOptions } from '../tools/clone-stamp';
import { createMeshGrid, meshWarp, type MeshGrid } from '../tools/mesh-warp';
import { perspectiveWarp, type Quad } from '../tools/perspective';
import {
  addSwatch,
  harmony,
  moveSwatch,
  removeSwatch,
  type HarmonyScheme,
} from '../color/palette';
import { rasterizeFill, rasterizeStroke, type VectorPath } from '../vector/path';
import {
  bevelEmboss,
  dropShadow,
  innerShadow,
  outerGlow,
  strokeOutline,
  type BevelEmbossOptions,
  type DropShadowOptions,
  type InnerShadowOptions,
  type OuterGlowOptions,
  type StrokeOutlineOptions,
} from '../core/layer-effects';
import { serializeProject, deserializeProject } from '../io/project';
import { extractPalette, type Swatch } from '../color/swatches';
import { kaleidoscope, type KaleidoscopeOptions } from '../tools/kaleidoscope';
import { parseSutBrush, sutToBrushSettings } from '../io/sut';
import {
  addPreset,
  createPresetLibrary,
  type BrushPreset,
  type BrushPresetLibrary,
} from '../engine/brush-presets';

type Maskless<T> = Omit<T, 'mask'>;
type DuotoneColor = DuotoneOptions['shadow'] | RGBA;
type StoreDuotoneOptions = Omit<DuotoneOptions, 'shadow' | 'highlight'> & {
  shadow: DuotoneColor;
  highlight: DuotoneColor;
};
export type LiquifyMode = 'push' | 'bloat' | 'pinch';

export interface FilterOptionMap {
  blur: Partial<Maskless<GaussianBlurOptions>>;
  gaussian: Partial<Maskless<GaussianBlurOptions>>;
  bloom: Partial<Maskless<BloomOptions>>;
  'brightness-contrast': Partial<BrightnessContrastOptions>;
  invert: Record<string, never>;
  grayscale: Record<string, never>;
  'hue-saturation': Partial<HueSaturationOptions>;
  levels: Partial<LevelsOptions>;
  sharpen: Partial<SharpenOptions>;
  unsharp: { amount: number; radius: number; threshold?: number };
  threshold: Partial<ThresholdOptions>;
  sketch: SketchOptions;
  'adaptive-threshold': AdaptiveThresholdOptions;
  posterize: Partial<PosterizeOptions>;
  sepia: Record<string, never>;
  'auto-levels': Partial<Maskless<AutoToneOptions>>;
  'auto-contrast': Partial<Maskless<AutoToneOptions>>;
  'white-balance': WhiteBalanceOptions;
  'sobel-edge': Record<string, never>;
  emboss: Record<string, never>;
  mosaic: Partial<Maskless<PixelateOptions>>;
  'ordered-dither': Partial<Maskless<OrderedDitherOptions>>;
  'color-balance': Partial<Maskless<ColorBalanceOptions>>;
  'gradient-map': Partial<Maskless<GradientMapOptions>>;
  curves: Partial<Maskless<CurvesOptions>>;
  quantize: { maxColors: number };
  equalize: Record<string, never>;
  gamma: { gamma: number };
  'motion-blur': MotionBlurOptions;
  'zoom-blur': Pick<ZoomBlurOptions, 'strength'>;
  'replace-color': { from: RGBA; to: RGBA; tolerance: number; fuzziness?: number };
  lens: LensDistortOptions;
  vignette: VignetteOptions;
  'channel-mixer': ChannelMixerOptions;
  clarity: ClarityOptions;
  halftone: HalftoneOptions;
  chromatic: ChromaticOptions;
  oil: OilPaintOptions;
  dehaze: DehazeOptions;
  duotone: StoreDuotoneOptions;
  chromakey: ChromaKeyOptions;
}

export type FilterName = keyof FilterOptionMap;
export type FilterOptions = FilterOptionMap[FilterName];

export interface LayerEffectOptionMap {
  'drop-shadow': Partial<DropShadowOptions>;
  stroke: Partial<StrokeOutlineOptions>;
  glow: Partial<OuterGlowOptions>;
  'inner-shadow': Partial<InnerShadowOptions>;
  'bevel-emboss': Partial<BevelEmbossOptions>;
}

export type LayerEffectKind = keyof LayerEffectOptionMap;
export type LayerEffectOptions = LayerEffectOptionMap[LayerEffectKind];

/** Transient, non-reactive stroke state (kept out of the reactive store). */
interface StrokeContext {
  engine: StoreStrokeEngine;
  layerId: LayerId;
  before: Uint8ClampedArray; // snapshot for undo
  color: RGBA;
}
interface LiquifyStrokeContext {
  layerId: LayerId;
  before: Uint8ClampedArray;
  lastX: number;
  lastY: number;
}
let activeStroke: StrokeContext | null = null;
let activeLiquifyStroke: LiquifyStrokeContext | null = null;
let activeMaskStroke: LayerId | null = null;
let animFrameCounter = 0;
export const getActiveStroke = () => activeStroke;

const history = new History(60);

const BLENDS: Record<BlendMode, (b: number, s: number) => number> = {
  normal: (_b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
  'color-dodge': (b, s) => (s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (b, s) => (s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'hard-light': (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  'soft-light': (b, s) =>
    s <= 0.5
      ? b - (1 - 2 * s) * b * (1 - b)
      : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b),
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
  add: (b, s) => Math.min(1, b + s),
  subtract: (b, s) => Math.max(0, b - s),
};

function defaultSymmetry(width: number, height: number): SymmetryConfig {
  return {
    mode: 'none',
    centerX: width / 2,
    centerY: height / 2,
    slices: 6,
  };
}

function defaultDynamics(): DynamicsConfig {
  return {
    sizeJitter: 0,
    opacityJitter: 0,
    scatter: 0,
    seed: 0,
  };
}

function duotoneTuple(color: DuotoneColor): DuotoneOptions['shadow'] {
  if (Array.isArray(color)) return color as DuotoneOptions['shadow'];
  return [color.r, color.g, color.b, color.a];
}

function dabFalloff(d: number, hardness: number, pixel: boolean): number {
  if (d >= 1) return 0;
  if (pixel) return 1;
  const inner = hardness;
  if (d <= inner) return 1;
  const t = (d - inner) / (1 - inner);
  return 1 - (t * t * (3 - 2 * t));
}

class StoreStrokeEngine {
  readonly width: number;
  readonly height: number;
  readonly coverage: Float32Array;

  private brush: BrushSettings;
  private erase: boolean;
  private symmetry: SymmetryConfig;
  private dynamics: DynamicsConfig;
  private last: PointerSample | null = null;
  private residual = 0;
  private dabStep = 0;

  constructor(
    width: number,
    height: number,
    brush: BrushSettings,
    erase: boolean,
    symmetry: SymmetryConfig,
    dynamics: DynamicsConfig,
  ) {
    this.width = width;
    this.height = height;
    this.brush = brush;
    this.erase = erase;
    this.symmetry = symmetry;
    this.dynamics = dynamics;
    this.coverage = new Float32Array(width * height);
  }

  private stampCoverage(x: number, y: number, size: number, flow: number): void {
    const radius = size / 2;
    if (radius <= 0 || flow <= 0) return;
    const pixel = this.brush.shape === 'pixel';
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(x + radius));
    const y0 = Math.max(0, Math.floor(y - radius));
    const y1 = Math.min(this.height - 1, Math.ceil(y + radius));
    const hardness = this.brush.shape === 'round' ? 0.95 : this.brush.hardness;

    for (let py = y0; py <= y1; py += 1) {
      for (let px = x0; px <= x1; px += 1) {
        const dx = (px + 0.5 - x) / radius;
        const dy = (py + 0.5 - y) / radius;
        const d = Math.sqrt(dx * dx + dy * dy);
        const a = dabFalloff(d, hardness, pixel) * flow;
        if (a <= 0) continue;
        const idx = py * this.width + px;
        if (a > this.coverage[idx]) this.coverage[idx] = a;
      }
    }
  }

  private stamp(x: number, y: number, pressure: number): void {
    const sizePressure = this.brush.pressureSize ? Math.max(0.05, pressure) : 1;
    const opacityPressure = this.brush.pressureOpacity ? Math.max(0.05, pressure) : 1;
    const dab = applyDynamics(
      {
        size: sizePressure * this.brush.size,
        opacity: this.brush.opacity,
        x,
        y,
      },
      this.dynamics,
      this.dabStep,
    );
    this.dabStep += 1;

    const opacityScale = this.brush.opacity > 0 ? dab.opacity / this.brush.opacity : 1;
    const flow = this.brush.flow * opacityPressure * opacityScale;
    const points = this.symmetry.mode === 'none'
      ? [{ x: dab.x, y: dab.y }]
      : mirrorPoints(dab.x, dab.y, this.symmetry);
    for (const point of points) {
      this.stampCoverage(point.x, point.y, dab.size, flow);
    }
  }

  addSample(s: PointerSample): void {
    if (!this.last) {
      this.stamp(s.x, s.y, s.pressure);
      this.last = s;
      return;
    }

    const prev = this.last;
    const dx = s.x - prev.x;
    const dy = s.y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const avgPressure = (prev.pressure + s.pressure) / 2;
    const size = (this.brush.pressureSize ? Math.max(0.05, avgPressure) : 1) * this.brush.size;
    const step = Math.max(0.5, this.brush.spacing * size);
    let traveled = -this.residual;
    while (traveled + step <= dist) {
      traveled += step;
      const t = traveled / dist;
      const px = prev.x + dx * t;
      const py = prev.y + dy * t;
      const pr = prev.pressure + (s.pressure - prev.pressure) * t;
      this.stamp(px, py, pr);
    }
    this.residual = dist - traveled;
    this.last = s;
  }

  isErase(): boolean {
    return this.erase;
  }

  commit(target: Uint8ClampedArray, color: RGBA, selection?: Uint8ClampedArray | null): void {
    const opacity = this.brush.opacity;
    for (let i = 0; i < this.coverage.length; i += 1) {
      let cov = this.coverage[i] * opacity;
      if (cov <= 0) continue;
      if (selection) cov *= selection[i] / 255;
      if (cov <= 0) continue;
      const o = i * 4;
      if (this.erase) {
        target[o + 3] = target[o + 3] * (1 - cov);
        continue;
      }
      const sa = cov;
      const da = target[o + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) continue;
      target[o] = (color.r * sa + target[o] * da * (1 - sa)) / oa;
      target[o + 1] = (color.g * sa + target[o + 1] * da * (1 - sa)) / oa;
      target[o + 2] = (color.b * sa + target[o + 2] * da * (1 - sa)) / oa;
      target[o + 3] = oa * 255;
    }
  }
}

function compositeLayerPixelsIntoBottom(bottom: Uint8ClampedArray, top: Layer): void {
  if (!top.pixels) return;
  const src = top.pixels;
  const blend = BLENDS[top.blendMode] ?? BLENDS.normal;

  for (let i = 0, p = 0; i < src.length; i += 4, p += 1) {
    let sa = (src[i + 3] / 255) * top.opacity;
    if (sa <= 0) continue;
    if (top.mask) sa *= top.mask[p] / 255;
    if (sa <= 0) continue;

    const da = bottom[i + 3] / 255;
    const sr = src[i] / 255;
    const sg = src[i + 1] / 255;
    const sb = src[i + 2] / 255;
    const dr = bottom[i] / 255;
    const dg = bottom[i + 1] / 255;
    const db = bottom[i + 2] / 255;
    const br = da > 0 ? blend(dr, sr) : sr;
    const bg = da > 0 ? blend(dg, sg) : sg;
    const bb = da > 0 ? blend(db, sb) : sb;
    const mr = (1 - da) * sr + da * br;
    const mg = (1 - da) * sg + da * bg;
    const mb = (1 - da) * sb + da * bb;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) continue;

    bottom[i] = ((mr * sa + dr * da * (1 - sa)) / oa) * 255;
    bottom[i + 1] = ((mg * sa + dg * da * (1 - sa)) / oa) * 255;
    bottom[i + 2] = ((mb * sa + db * da * (1 - sa)) / oa) * 255;
    bottom[i + 3] = oa * 255;
  }
}

function pixelsEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function maskEquals(a: Uint8ClampedArray | undefined, b: Uint8ClampedArray | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function adjustmentLayerName(type: AdjustmentSpec['type']): string {
  switch (type) {
    case 'brightness-contrast': return '明るさ・コントラスト';
    case 'invert': return '階調反転';
    case 'grayscale': return 'グレースケール';
    case 'hue-saturation': return '色相・彩度';
    case 'levels': return 'レベル';
  }
}

function cloneTextLayerData(data: TextLayerData): TextLayerData {
  return { ...data, color: { ...data.color } };
}

function cloneShapeData(data: ShapeData): ShapeData {
  return {
    ...data,
    style: {
      fill: data.style.fill ? { ...data.style.fill } : data.style.fill,
      stroke: data.style.stroke ? {
        color: { ...data.style.stroke.color },
        width: data.style.stroke.width,
      } : data.style.stroke,
    },
  };
}

function cloneVectorLayerData(data: VectorLayerData): VectorLayerData {
  return createVectorLayerData(data);
}

interface LayerEditDataSnapshot {
  shapeData?: ShapeData;
  vectorData?: VectorLayerData;
}

function cloneLayerSnapshot(layer: Layer): Layer {
  return {
    ...layer,
    pixels: layer.pixels?.slice(),
    mask: layer.mask?.slice(),
    textData: layer.textData ? cloneTextLayerData(layer.textData) : undefined,
    shapeData: layer.shapeData ? cloneShapeData(layer.shapeData) : undefined,
    vectorData: layer.vectorData ? cloneVectorLayerData(layer.vectorData) : undefined,
    children: layer.children ? [...layer.children] : undefined,
    adjustment: layer.adjustment ? { ...layer.adjustment, opts: layer.adjustment.opts ? { ...layer.adjustment.opts } : undefined } : undefined,
  };
}

function cloneLayerSnapshots(layers: Layer[]): Layer[] {
  return layers.map(cloneLayerSnapshot);
}

function timelineFromLayers(layers: Layer[], fps = 12): Timeline {
  const timeline = createTimeline(fps);
  return {
    ...timeline,
    frames: [{
      ...timeline.frames[0],
      layers: cloneLayerSnapshots(layers),
    }],
    currentIndex: 0,
  };
}

function clampTimelineIndex(timeline: Timeline, index: number): number {
  const max = Math.max(0, timeline.frames.length - 1);
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), max));
}

function snapshotCurrentTimelineFrame(timeline: Timeline, doc: PaintDocument): Timeline {
  const safeTimeline = timeline.frames.length > 0 ? timeline : timelineFromLayers(doc.layers, timeline.fps);
  const currentIndex = clampTimelineIndex(safeTimeline, safeTimeline.currentIndex);
  return {
    ...safeTimeline,
    currentIndex,
    frames: safeTimeline.frames.map((frame, index) => (
      index === currentIndex ? { ...frame, layers: cloneLayerSnapshots(doc.layers) } : frame
    )),
  };
}

function cloneFrame(frame: Frame): Frame {
  animFrameCounter += 1;
  return {
    ...frame,
    id: `anim_frame_${animFrameCounter}`,
    layers: cloneLayerSnapshots(frame.layers),
  };
}

function validActiveLayerId(layers: Layer[], preferred: LayerId | null): LayerId | null {
  if (preferred && layers.some((layer) => layer.id === preferred)) return preferred;
  return layers[layers.length - 1]?.id ?? null;
}

function textLayerDataEquals(a: TextLayerData, b: TextLayerData): boolean {
  return (
    a.text === b.text
    && a.x === b.x
    && a.y === b.y
    && a.scale === b.scale
    && a.letterSpacing === b.letterSpacing
    && a.color.r === b.color.r
    && a.color.g === b.color.g
    && a.color.b === b.color.b
    && a.color.a === b.color.a
  );
}

function shapeDataEquals(a: ShapeData, b: ShapeData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function vectorLayerDataEquals(a: VectorLayerData, b: VectorLayerData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneDocumentSnapshot(doc: PaintDocument): PaintDocument {
  return {
    ...doc,
    layers: cloneLayerSnapshots(doc.layers),
    selection: doc.selection
      ? { ...doc.selection, mask: doc.selection.mask.slice() }
      : null,
  };
}

function selectionBounds(selection: Selection): { x: number; y: number; w: number; h: number } | null {
  let minX = selection.width;
  let minY = selection.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < selection.height; y += 1) {
    for (let x = 0; x < selection.width; x += 1) {
      if (selection.mask[y * selection.width + x] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0 || maxY < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function fitRotatedPixels(
  rotated: { pixels: Uint8ClampedArray; width: number; height: number },
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const offsetX = Math.floor((width - rotated.width) / 2);
  const offsetY = Math.floor((height - rotated.height) / 2);

  for (let y = 0; y < rotated.height; y += 1) {
    const dstY = y + offsetY;
    if (dstY < 0 || dstY >= height) continue;

    for (let x = 0; x < rotated.width; x += 1) {
      const dstX = x + offsetX;
      if (dstX < 0 || dstX >= width) continue;

      const source = (y * rotated.width + x) * 4;
      const target = (dstY * width + dstX) * 4;
      out[target] = rotated.pixels[source];
      out[target + 1] = rotated.pixels[source + 1];
      out[target + 2] = rotated.pixels[source + 2];
      out[target + 3] = rotated.pixels[source + 3];
    }
  }

  return out;
}

function compositeMaskWithColor(
  target: Uint8ClampedArray,
  color: RGBA,
  mask: Uint8ClampedArray,
  selection?: Uint8ClampedArray | null,
): void {
  const sourceAlpha = color.a / 255;
  if (sourceAlpha <= 0) return;

  for (let i = 0; i < mask.length; i += 1) {
    let alpha = (mask[i] / 255) * sourceAlpha;
    if (selection) alpha *= selection[i] / 255;
    if (alpha <= 0) continue;

    const offset = i * 4;
    const destAlpha = target[offset + 3] / 255;
    const outAlpha = alpha + destAlpha * (1 - alpha);
    if (outAlpha <= 0) continue;

    target[offset] = (color.r * alpha + target[offset] * destAlpha * (1 - alpha)) / outAlpha;
    target[offset + 1] = (color.g * alpha + target[offset + 1] * destAlpha * (1 - alpha)) / outAlpha;
    target[offset + 2] = (color.b * alpha + target[offset + 2] * destAlpha * (1 - alpha)) / outAlpha;
    target[offset + 3] = outAlpha * 255;
  }
}

export interface AppState {
  doc: PaintDocument;
  timeline: Timeline;
  onionSkinEnabled: boolean;
  viewport: Viewport;
  tool: ToolId;
  brush: BrushSettings;
  brushPresets: BrushPresetLibrary;
  symmetry: SymmetryConfig;
  dynamics: DynamicsConfig;
  primary: RGBA;
  secondary: RGBA;
  liquifyMode: LiquifyMode;
  swatches: RGBA[];
  /** 0..255 color match tolerance for the fill tool */
  fillTolerance: number;
  cloneSourceX: number | null;
  cloneSourceY: number | null;
  /** bump to force canvas redraw after in-place pixel mutation */
  rev: number;
  isStroking: boolean;
  canUndo: boolean;
  canRedo: boolean;
  maskEditMode: boolean;
  penPath: VectorPath | null;

  // document lifecycle
  newDocument: (w?: number, h?: number, name?: string) => void;
  loadDocument: (doc: PaintDocument) => void;
  saveProjectJson: () => string;
  loadProjectJson: (json: string) => void;
  exportSvg: () => string;
  captureCurrentFrame: () => void;
  addAnimFrame: () => void;
  gotoAnimFrame: (index: number) => void;
  removeAnimFrame: (index: number) => void;
  setOnionSkin: (on: boolean) => void;

  // tool & brush & color
  setTool: (t: ToolId) => void;
  setBrush: (patch: Partial<BrushSettings>) => void;
  importSutBrush: (bytes: Uint8Array) => Promise<void>;
  applyBrushPreset: (id: string) => void;
  setSymmetry: (patch: Partial<SymmetryConfig>) => void;
  setDynamics: (patch: Partial<DynamicsConfig>) => void;
  setPrimary: (c: RGBA) => void;
  setSecondary: (c: RGBA) => void;
  setLiquifyMode: (mode: LiquifyMode) => void;
  swapColors: () => void;
  addSwatchAction: () => void;
  removeSwatchAction: (index: number) => void;
  moveSwatchAction: (from: number, to: number) => void;
  selectSwatch: (index: number) => void;
  generateHarmony: (scheme: HarmonyScheme) => void;
  activeLayerSwatches: (count?: number) => Swatch[];

  // viewport
  setViewport: (patch: Partial<Viewport>) => void;
  resetViewport: () => void;

  // painting
  beginStroke: (s: PointerSample) => void;
  extendStroke: (s: PointerSample) => void;
  endStroke: () => void;
  paintActiveLayerMaskDab: (x: number, y: number) => void;
  liquifyDab: (x: number, y: number, dx?: number, dy?: number) => void;
  pickColorAt: (x: number, y: number) => void;
  setFillTolerance: (n: number) => void;
  floodFillAt: (x: number, y: number) => void;
  applyGradient: (x0: number, y0: number, x1: number, y1: number) => void;
  addPenPoint: (x: number, y: number) => void;
  closePenPath: () => void;
  commitPenPath: (mode: 'fill' | 'stroke', width?: number) => void;
  cancelPenPath: () => void;
  effectBrushDab: (kind: 'blur' | 'sharpen' | 'dodge' | 'burn', x: number, y: number) => void;
  setCloneSource: (x: number, y: number) => void;
  applyCloneStamp: (dstX: number, dstY: number, radius?: number) => void;
  moveActiveLayer: (dx: number, dy: number) => void;
  placeTextAt: (x: number, y: number, text: string) => void;
  createTextLayerAt: (x: number, y: number, text: string) => void;
  updateActiveTextLayer: (patch: Partial<TextLayerData>) => void;
  addShapeLayer: (data?: Partial<ShapeData>) => void;
  addVectorLayer: (data?: Partial<VectorLayerData>) => void;
  updateActiveShapeLayer: (patch: Partial<ShapeData>) => void;
  updateActiveVectorLayer: (patch: Partial<VectorLayerData>) => void;

  // selection
  setSelection: (sel: Selection | null) => void;
  selectRect: (bounds: { x: number; y: number; w: number; h: number }) => void;
  selectEllipse: (bounds: { x: number; y: number; w: number; h: number }) => void;
  magicWandSelectAt: (x: number, y: number, tolerance: number, contiguous: boolean) => void;
  selectAllArea: () => void;
  invertSelectionArea: () => void;
  clearSelection: () => void;
  fillSelectionWithPrimary: () => void;
  growSelectionBy: (px: number) => void;
  shrinkSelectionBy: (px: number) => void;
  featherSelectionBy: (px: number) => void;

  // layers
  addLayer: () => void;
  addAdjustmentLayer: (type: AdjustmentSpec['type'], opts?: Record<string, number>) => void;
  removeLayer: (id: LayerId) => void;
  selectLayer: (id: LayerId) => void;
  setLayerProps: (id: LayerId, patch: Partial<Layer>) => void;
  moveLayer: (id: LayerId, dir: -1 | 1) => void;
  flipActiveLayer: (axis: 'h' | 'v') => void;
  rotateActiveLayer: (dir: 'cw' | 'ccw' | '180') => void;
  cropToSelection: () => void;
  resizeCanvasTo: (w: number, h: number, anchor?: ResizeCanvasOptions['anchor']) => void;
  alignActiveLayer: (mode: AlignMode) => void;
  applyPerspective: (dst: Quad) => void;
  applyMeshWarp: (grid: MeshGrid) => void;
  mergeDown: (id: LayerId) => void;
  addLayerMask: (id: LayerId) => void;
  removeLayerMask: (id: LayerId) => void;
  setMaskEditMode: (on: boolean) => void;
  addGroup: () => void;
  moveLayerToGroupAction: (layerId: LayerId, groupId: LayerId) => void;
  removeLayerFromGroupAction: (layerId: LayerId, groupId: LayerId) => void;

  // filters
  applyFilter: <T extends FilterName>(name: T, opts?: FilterOptionMap[T]) => void;
  fillWithGradient: (spec?: Partial<GradientSpec>) => void;
  fillWithNoise: (opts?: { scale?: number; seed?: number }) => void;
  fillWithCellular: (opts?: { cellSize?: number; seed?: number }) => void;
  applyKaleidoscope: (opts?: Partial<KaleidoscopeOptions>) => void;
  applyLayerEffect: <T extends LayerEffectKind>(kind: T, opts?: LayerEffectOptionMap[T]) => void;

  // history
  undo: () => void;
  redo: () => void;
  /** record an externally-applied edit (tools/io) for undo */
  commitEdit: (
    label: string,
    layerId: LayerId,
    before: Uint8ClampedArray,
    beforeTextData?: TextLayerData,
    beforeData?: LayerEditDataSnapshot,
  ) => void;
  bump: () => void;
}

const initialDocument = createDocument();

export const useStore = create<AppState>((set, get) => ({
  doc: initialDocument,
  timeline: timelineFromLayers(initialDocument.layers),
  onionSkinEnabled: false,
  viewport: { ...IDENTITY_VIEWPORT },
  tool: 'brush',
  brush: { ...DEFAULT_BRUSH },
  brushPresets: createPresetLibrary(),
  symmetry: defaultSymmetry(1280, 720),
  dynamics: defaultDynamics(),
  primary: { ...BLACK },
  secondary: { ...WHITE },
  liquifyMode: 'push',
  swatches: [],
  fillTolerance: 32,
  cloneSourceX: null,
  cloneSourceY: null,
  rev: 0,
  isStroking: false,
  canUndo: false,
  canRedo: false,
  maskEditMode: false,
  penPath: null,

  newDocument: (w = 1280, h = 720, name = '無題') => {
    history.clear();
    activeStroke = null;
    activeLiquifyStroke = null;
    activeMaskStroke = null;
    const doc = createDocument(w, h, name);
    set({
      doc,
      timeline: timelineFromLayers(doc.layers),
      onionSkinEnabled: false,
      symmetry: defaultSymmetry(w, h),
      rev: get().rev + 1,
      isStroking: false,
      canUndo: false,
      canRedo: false,
      cloneSourceX: null,
      cloneSourceY: null,
      penPath: null,
    });
  },
  loadDocument: (doc) => {
    history.clear();
    activeStroke = null;
    activeLiquifyStroke = null;
    activeMaskStroke = null;
    set({
      doc,
      timeline: timelineFromLayers(doc.layers),
      onionSkinEnabled: false,
      symmetry: defaultSymmetry(doc.width, doc.height),
      rev: get().rev + 1,
      isStroking: false,
      canUndo: false,
      canRedo: false,
      cloneSourceX: null,
      cloneSourceY: null,
      penPath: null,
    });
  },
  saveProjectJson: () => serializeProject(get().doc),
  loadProjectJson: (json) => {
    const doc = deserializeProject(json);
    get().loadDocument(doc);
  },
  exportSvg: () => documentToSvg(get().doc),
  captureCurrentFrame: () => {
    const { doc, timeline } = get();
    set({ timeline: snapshotCurrentTimelineFrame(timeline, doc) });
  },
  addAnimFrame: () => {
    const { doc, timeline } = get();
    const savedTimeline = snapshotCurrentTimelineFrame(timeline, doc);
    const sourceFrame = savedTimeline.frames[savedTimeline.currentIndex];
    const nextFrame = cloneFrame(sourceFrame);
    const frames = [...savedTimeline.frames, nextFrame];
    set({
      timeline: {
        ...savedTimeline,
        frames,
        currentIndex: frames.length - 1,
      },
    });
  },
  gotoAnimFrame: (index) => {
    const { doc, timeline } = get();
    const savedTimeline = snapshotCurrentTimelineFrame(timeline, doc);
    const currentIndex = clampTimelineIndex(savedTimeline, index);
    const layers = cloneLayerSnapshots(savedTimeline.frames[currentIndex].layers);
    set({
      doc: {
        ...doc,
        layers,
        activeLayerId: validActiveLayerId(layers, doc.activeLayerId),
      },
      timeline: {
        ...savedTimeline,
        currentIndex,
      },
      rev: get().rev + 1,
    });
  },
  removeAnimFrame: (index) => {
    const { doc, timeline } = get();
    const savedTimeline = snapshotCurrentTimelineFrame(timeline, doc);
    const nextTimeline = removeTimelineFrame(savedTimeline, index);
    const activeFrame = nextTimeline.frames[nextTimeline.currentIndex];
    const layers = cloneLayerSnapshots(activeFrame.layers);
    set({
      doc: {
        ...doc,
        layers,
        activeLayerId: validActiveLayerId(layers, doc.activeLayerId),
      },
      timeline: nextTimeline,
      rev: get().rev + 1,
    });
  },
  setOnionSkin: (on) => set({ onionSkinEnabled: on }),

  setTool: (t) => set({ tool: t }),
  setBrush: (patch) => set({ brush: { ...get().brush, ...patch } }),
  importSutBrush: async (bytes) => {
    const sut = await parseSutBrush(bytes);
    const settings = sutToBrushSettings(sut);
    set((state) => ({
      brush: { ...state.brush, ...settings },
      brushPresets: addPreset(state.brushPresets, {
        name: sut.name || 'Imported SUT Brush',
        settings,
      }),
    }));
  },
  applyBrushPreset: (id) => {
    const preset: BrushPreset | undefined = get().brushPresets.presets.find((item) => item.id === id);
    if (!preset) return;
    set({ brush: { ...get().brush, ...preset.settings } });
  },
  setSymmetry: (patch) => set({ symmetry: { ...get().symmetry, ...patch } }),
  setDynamics: (patch) => set({ dynamics: { ...get().dynamics, ...patch } }),
  setPrimary: (c) => set({ primary: c }),
  setSecondary: (c) => set({ secondary: c }),
  setLiquifyMode: (mode) => set({ liquifyMode: mode }),
  swapColors: () => set({ primary: get().secondary, secondary: get().primary }),
  addSwatchAction: () => set({ swatches: addSwatch(get().swatches, get().primary) }),
  removeSwatchAction: (index) => set({ swatches: removeSwatch(get().swatches, index) }),
  moveSwatchAction: (from, to) => set({ swatches: moveSwatch(get().swatches, from, to) }),
  selectSwatch: (index) => {
    const color = get().swatches[index];
    if (color) set({ primary: { ...color } });
  },
  generateHarmony: (scheme) => {
    const colors = harmony(get().primary, scheme);
    set({ swatches: colors.reduce((list, color) => addSwatch(list, color), get().swatches) });
  },
  activeLayerSwatches: (count) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster') return [];
    return extractPalette(layer.pixels, doc.width, doc.height, count ?? 8);
  },

  setViewport: (patch) => set({ viewport: { ...get().viewport, ...patch } }),
  resetViewport: () => set({ viewport: { ...IDENTITY_VIEWPORT } }),

  beginStroke: (s) => {
    const { doc, brush, tool, primary, maskEditMode, symmetry, dynamics } = get();
    const layer = activeLayer(doc);
    if (!layer || !layer.pixels || layer.locked || !layer.visible) return;
    if (maskEditMode) {
      if (layer.kind !== 'raster') return;
      get().paintActiveLayerMaskDab(s.x, s.y);
      activeMaskStroke = layer.id;
      set({ isStroking: true });
      return;
    }
    if (tool === 'liquify') {
      activeLiquifyStroke = {
        layerId: layer.id,
        before: layer.pixels.slice(),
        lastX: s.x,
        lastY: s.y,
      };
      get().liquifyDab(s.x, s.y, 0, 0);
      set({ isStroking: true });
      return;
    }
    const erase = tool === 'eraser';
    const engine = new StoreStrokeEngine(
      doc.width,
      doc.height,
      brush,
      erase,
      symmetry,
      dynamics,
    );
    engine.addSample(s);
    activeStroke = {
      engine,
      layerId: layer.id,
      before: layer.pixels.slice(),
      color: primary,
    };
    set({ isStroking: true, rev: get().rev + 1 });
  },
  extendStroke: (s) => {
    if (activeMaskStroke) {
      get().paintActiveLayerMaskDab(s.x, s.y);
      return;
    }
    if (activeLiquifyStroke) {
      const dx = s.x - activeLiquifyStroke.lastX;
      const dy = s.y - activeLiquifyStroke.lastY;
      activeLiquifyStroke.lastX = s.x;
      activeLiquifyStroke.lastY = s.y;
      get().liquifyDab(s.x, s.y, dx, dy);
      return;
    }
    if (!activeStroke) return;
    activeStroke.engine.addSample(s);
    set({ rev: get().rev + 1 });
  },
  endStroke: () => {
    if (activeMaskStroke) {
      activeMaskStroke = null;
      set({ isStroking: false, canUndo: history.canUndo(), canRedo: history.canRedo() });
      return;
    }
    if (activeLiquifyStroke) {
      const st = activeLiquifyStroke;
      activeLiquifyStroke = null;
      const layer = findLayer(get().doc, st.layerId);
      if (layer?.pixels && !pixelsEqual(st.before, layer.pixels)) {
        set({ isStroking: false });
        get().commitEdit('液状化', st.layerId, st.before);
      } else {
        set({ isStroking: false, canUndo: history.canUndo(), canRedo: history.canRedo() });
      }
      return;
    }
    const st = activeStroke;
    if (!st) { set({ isStroking: false }); return; }
    const { doc } = get();
    const layer = findLayer(doc, st.layerId);
    if (layer?.pixels) {
      st.engine.commit(layer.pixels, st.color, doc.selection?.mask ?? null);
      const before = st.before;
      const after = layer.pixels.slice();
      const lid = st.layerId;
      history.push(pixelSnapshotCommand(
        st.engine.isErase() ? '消しゴム' : 'ブラシ',
        () => findLayer(get().doc, lid)?.pixels,
        before, after,
      ));
    }
    activeStroke = null;
    set({ isStroking: false, rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  paintActiveLayerMaskDab: (x, y) => {
    const { doc, brush, tool } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked || !layer.visible) return;

    const beforeMask = layer.mask?.slice();
    const nextMask = beforeMask ? beforeMask.slice() : createLayerMask(doc.width, doc.height, 255);
    paintMaskDab(nextMask, doc.width, doc.height, {
      x,
      y,
      radius: Math.max(0.5, brush.size / 2),
      hardness: brush.hardness,
      value: tool === 'eraser' ? 0 : 255,
    });
    if (maskEquals(beforeMask, nextMask)) return;

    const layerId = layer.id;
    get().setLayerProps(layerId, { mask: nextMask });
    const afterMask = nextMask.slice();
    history.push({
      label: 'マスク描画',
      undo: () => {
        const currentDoc = get().doc;
        const layers = currentDoc.layers.map((item) => (
          item.id === layerId ? { ...item, mask: beforeMask ? beforeMask.slice() : undefined } : item
        ));
        set({ doc: { ...currentDoc, layers }, rev: get().rev + 1 });
      },
      redo: () => {
        const currentDoc = get().doc;
        const layers = currentDoc.layers.map((item) => (
          item.id === layerId ? { ...item, mask: afterMask.slice() } : item
        ));
        set({ doc: { ...currentDoc, layers }, rev: get().rev + 1 });
      },
    });
    set({ canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  liquifyDab: (x, y, dx, dy) => {
    const { doc, brush, liquifyMode } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked || !layer.visible) return;

    const before = layer.pixels.slice();
    const radius = Math.max(0.5, brush.size / 2);
    const strength = Math.max(0, Math.min(1, brush.opacity * brush.flow));

    switch (liquifyMode) {
      case 'push':
        pushDab(layer.pixels, doc.width, doc.height, {
          x,
          y,
          radius,
          dx: dx ?? 0,
          dy: dy ?? 0,
          strength,
        });
        break;
      case 'bloat':
        bloatDab(layer.pixels, doc.width, doc.height, { x, y, radius, strength });
        break;
      case 'pinch':
        pinchDab(layer.pixels, doc.width, doc.height, { x, y, radius, strength });
        break;
    }

    if (doc.selection) {
      for (let pi = 0; pi < doc.selection.mask.length; pi += 1) {
        const coverage = doc.selection.mask[pi] / 255;
        if (coverage >= 1) continue;
        const o = pi * 4;
        if (coverage <= 0) {
          layer.pixels[o] = before[o];
          layer.pixels[o + 1] = before[o + 1];
          layer.pixels[o + 2] = before[o + 2];
          layer.pixels[o + 3] = before[o + 3];
        } else {
          layer.pixels[o] = before[o] + (layer.pixels[o] - before[o]) * coverage;
          layer.pixels[o + 1] = before[o + 1] + (layer.pixels[o + 1] - before[o + 1]) * coverage;
          layer.pixels[o + 2] = before[o + 2] + (layer.pixels[o + 2] - before[o + 2]) * coverage;
          layer.pixels[o + 3] = before[o + 3] + (layer.pixels[o + 3] - before[o + 3]) * coverage;
        }
      }
    }

    set({ rev: get().rev + 1 });
  },
  pickColorAt: (x, y) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels) return;
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= doc.width || iy >= doc.height) return;
    const o = (iy * doc.width + ix) * 4;
    const p = layer.pixels;
    set({ primary: { r: p[o], g: p[o + 1], b: p[o + 2], a: 255 } });
  },
  setFillTolerance: (n) => set({ fillTolerance: Math.max(0, Math.min(255, n)) }),
  floodFillAt: (x, y) => {
    const { doc, primary, fillTolerance } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.locked) return;
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= doc.width || iy >= doc.height) return;
    const before = layer.pixels.slice();
    const changed = floodFill(
      layer.pixels, doc.width, doc.height, ix, iy, primary, fillTolerance,
      doc.selection?.mask ?? null,
    );
    if (!changed) return;
    get().commitEdit('塗りつぶし', layer.id, before);
  },
  applyGradient: (x0, y0, x1, y1) => {
    const { doc, primary, secondary } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked || !layer.visible) return;

    const before = layer.pixels.slice();
    const endColor = secondary.a > 0 ? secondary : { ...primary, a: 0 };
    fillLinearGradient(layer.pixels, doc.width, doc.height, {
      x0,
      y0,
      x1,
      y1,
      stops: [
        { t: 0, color: primary },
        { t: 1, color: endColor },
      ],
      mask: doc.selection?.mask ?? null,
    });

    if (!pixelsEqual(before, layer.pixels)) {
      get().commitEdit('グラデーション', layer.id, before);
    }
  },
  addPenPoint: (x, y) => {
    const point = { x, y };
    const path = get().penPath;
    set({
      penPath: path
        ? { ...path, points: [...path.points, point] }
        : { closed: false, points: [point] },
    });
  },
  closePenPath: () => {
    const path = get().penPath;
    if (!path) return;
    set({ penPath: { ...path, closed: true } });
  },
  commitPenPath: (mode, width = 2) => {
    const { doc, penPath, primary } = get();
    if (!penPath) return;

    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked || !layer.visible) {
      set({ penPath: null });
      return;
    }

    const mask = mode === 'fill'
      ? rasterizeFill(penPath, doc.width, doc.height)
      : rasterizeStroke(penPath, doc.width, doc.height, width);
    const before = layer.pixels.slice();
    compositeMaskWithColor(layer.pixels, primary, mask, doc.selection?.mask ?? null);
    set({ penPath: null });

    if (!pixelsEqual(before, layer.pixels)) {
      get().commitEdit(mode === 'fill' ? 'ペン塗り' : 'ペン線', layer.id, before);
    } else {
      set({ rev: get().rev + 1 });
    }
  },
  cancelPenPath: () => set({ penPath: null }),
  effectBrushDab: (kind, x, y) => {
    const { doc, brush } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked || !layer.visible) return;

    const before = layer.pixels.slice();
    const opts = {
      x,
      y,
      radius: Math.max(0.5, brush.size / 2),
      strength: Math.max(0, Math.min(1, brush.opacity * brush.flow)),
      hardness: brush.hardness,
    };

    switch (kind) {
      case 'blur':
        blurDab(layer.pixels, doc.width, doc.height, opts);
        break;
      case 'sharpen':
        sharpenDab(layer.pixels, doc.width, doc.height, opts);
        break;
      case 'dodge':
        dodgeDab(layer.pixels, doc.width, doc.height, opts);
        break;
      case 'burn':
        burnDab(layer.pixels, doc.width, doc.height, opts);
        break;
    }

    if (doc.selection) {
      for (let pi = 0; pi < doc.selection.mask.length; pi += 1) {
        const coverage = doc.selection.mask[pi] / 255;
        if (coverage >= 1) continue;
        const o = pi * 4;
        if (coverage <= 0) {
          layer.pixels[o] = before[o];
          layer.pixels[o + 1] = before[o + 1];
          layer.pixels[o + 2] = before[o + 2];
          layer.pixels[o + 3] = before[o + 3];
        } else {
          layer.pixels[o] = before[o] + (layer.pixels[o] - before[o]) * coverage;
          layer.pixels[o + 1] = before[o + 1] + (layer.pixels[o + 1] - before[o + 1]) * coverage;
          layer.pixels[o + 2] = before[o + 2] + (layer.pixels[o + 2] - before[o + 2]) * coverage;
          layer.pixels[o + 3] = before[o + 3] + (layer.pixels[o + 3] - before[o + 3]) * coverage;
        }
      }
    }

    if (!pixelsEqual(before, layer.pixels)) {
      get().commitEdit('効果ブラシ', layer.id, before);
    }
  },
  setCloneSource: (x, y) => {
    set({ cloneSourceX: x, cloneSourceY: y });
  },
  applyCloneStamp: (dstX, dstY, radius) => {
    const { doc, cloneSourceX, cloneSourceY } = get();
    if (cloneSourceX === null || cloneSourceY === null) return;

    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked || !layer.visible) return;

    const before = layer.pixels.slice();
    const opts: CloneStampOptions = {
      srcX: cloneSourceX,
      srcY: cloneSourceY,
      dstX,
      dstY,
      radius: radius ?? 20,
    };
    cloneStampDab(layer.pixels, doc.width, doc.height, opts);

    if (!pixelsEqual(before, layer.pixels)) {
      get().commitEdit('クローン', layer.id, before);
    }
  },
  moveActiveLayer: (dx, dy) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.locked) return;
    const before = layer.pixels.slice();
    const moved = moveLayerPixels(layer.pixels, doc.width, doc.height, Math.round(dx), Math.round(dy));
    layer.pixels.set(moved);
    get().commitEdit('レイヤー移動', layer.id, before);
  },
  placeTextAt: (x, y, text) => {
    const { doc, primary } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked || !layer.visible) return;
    if (text.length === 0) return;

    const before = layer.pixels.slice();
    renderText(layer.pixels, doc.width, doc.height, {
      text,
      x,
      y,
      color: primary,
      scale: 2,
      mask: doc.selection?.mask ?? null,
    });

    if (!pixelsEqual(before, layer.pixels)) {
      get().commitEdit('テキスト', layer.id, before);
    }
  },
  createTextLayerAt: (x, y, text) => {
    const { doc, primary } = get();
    if (text.length === 0) return;

    const data = createTextLayerData({ text, x, y, color: { ...primary }, scale: 2 });
    const layer = createTextLayer(doc.width, doc.height, data, 'テキスト');
    const activeIndex = doc.activeLayerId ? layerIndex(doc, doc.activeLayerId) : -1;
    const insertAt = activeIndex >= 0 ? activeIndex + 1 : doc.layers.length;
    const layers = [...doc.layers];
    layers.splice(insertAt, 0, layer);
    const previousActiveLayerId = doc.activeLayerId;

    set({ doc: { ...doc, layers, activeLayerId: layer.id }, rev: get().rev + 1 });
    history.push({
      label: 'テキストレイヤー作成',
      undo: () => {
        const currentDoc = get().doc;
        set({
          doc: {
            ...currentDoc,
            layers: currentDoc.layers.filter((item) => item.id !== layer.id),
            activeLayerId: previousActiveLayerId,
          },
        });
      },
      redo: () => {
        const currentDoc = get().doc;
        const nextLayers = [...currentDoc.layers];
        const nextIndex = Math.min(insertAt, nextLayers.length);
        nextLayers.splice(nextIndex, 0, layer);
        set({ doc: { ...currentDoc, layers: nextLayers, activeLayerId: layer.id } });
      },
    });
    set({ canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  updateActiveTextLayer: (patch) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || !layer.textData) return;

    const beforePixels = layer.pixels.slice();
    const beforeTextData = cloneTextLayerData(layer.textData);
    const textData = updateTextLayerData(layer.textData, patch);
    const pixels = rasterizeTextLayer(textData, doc.width, doc.height);
    if (textLayerDataEquals(beforeTextData, textData) && pixelsEqual(beforePixels, pixels)) return;

    const layers = doc.layers.map((item) => (
      item.id === layer.id ? { ...item, textData, pixels } : item
    ));
    set({ doc: { ...doc, layers } });
    get().commitEdit('テキスト編集', layer.id, beforePixels, beforeTextData);
  },
  addShapeLayer: (data) => {
    const { doc } = get();
    const shapeData = createShapeData(data);
    const layer = createShapeLayer(doc.width, doc.height, shapeData, 'シェイプ');
    const activeIndex = doc.activeLayerId ? layerIndex(doc, doc.activeLayerId) : -1;
    const insertAt = activeIndex >= 0 ? activeIndex + 1 : doc.layers.length;
    const layers = [...doc.layers];
    layers.splice(insertAt, 0, layer);
    const previousActiveLayerId = doc.activeLayerId;

    set({ doc: { ...doc, layers, activeLayerId: layer.id }, rev: get().rev + 1 });
    history.push({
      label: 'シェイプレイヤー作成',
      undo: () => {
        const currentDoc = get().doc;
        set({
          doc: {
            ...currentDoc,
            layers: currentDoc.layers.filter((item) => item.id !== layer.id),
            activeLayerId: previousActiveLayerId,
          },
        });
      },
      redo: () => {
        const currentDoc = get().doc;
        const nextLayers = [...currentDoc.layers];
        const nextIndex = Math.min(insertAt, nextLayers.length);
        nextLayers.splice(nextIndex, 0, layer);
        set({ doc: { ...currentDoc, layers: nextLayers, activeLayerId: layer.id } });
      },
    });
    set({ canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  addVectorLayer: (data) => {
    const { doc } = get();
    const vectorData = createVectorLayerData(data);
    const layer = createVectorLayer(doc.width, doc.height, vectorData, 'ベクター');
    const activeIndex = doc.activeLayerId ? layerIndex(doc, doc.activeLayerId) : -1;
    const insertAt = activeIndex >= 0 ? activeIndex + 1 : doc.layers.length;
    const layers = [...doc.layers];
    layers.splice(insertAt, 0, layer);
    const previousActiveLayerId = doc.activeLayerId;

    set({ doc: { ...doc, layers, activeLayerId: layer.id }, rev: get().rev + 1 });
    history.push({
      label: 'ベクターレイヤー作成',
      undo: () => {
        const currentDoc = get().doc;
        set({
          doc: {
            ...currentDoc,
            layers: currentDoc.layers.filter((item) => item.id !== layer.id),
            activeLayerId: previousActiveLayerId,
          },
        });
      },
      redo: () => {
        const currentDoc = get().doc;
        const nextLayers = [...currentDoc.layers];
        const nextIndex = Math.min(insertAt, nextLayers.length);
        nextLayers.splice(nextIndex, 0, layer);
        set({ doc: { ...currentDoc, layers: nextLayers, activeLayerId: layer.id } });
      },
    });
    set({ canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  updateActiveShapeLayer: (patch) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || !layer.shapeData) return;

    const beforePixels = layer.pixels.slice();
    const beforeShapeData = cloneShapeData(layer.shapeData);
    const shapeData = updateShapeData(layer.shapeData, patch);
    const pixels = rasterizeShape(shapeData, doc.width, doc.height);
    if (shapeDataEquals(beforeShapeData, shapeData) && pixelsEqual(beforePixels, pixels)) return;

    const layers = doc.layers.map((item) => (
      item.id === layer.id ? { ...item, shapeData, pixels } : item
    ));
    set({ doc: { ...doc, layers } });
    get().commitEdit('シェイプ編集', layer.id, beforePixels, undefined, { shapeData: beforeShapeData });
  },
  updateActiveVectorLayer: (patch) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || !layer.vectorData) return;

    const beforePixels = layer.pixels.slice();
    const beforeVectorData = cloneVectorLayerData(layer.vectorData);
    const vectorData = updateVectorLayerData(layer.vectorData, patch);
    const pixels = rasterizeVectorLayer(vectorData, doc.width, doc.height);
    if (vectorLayerDataEquals(beforeVectorData, vectorData) && pixelsEqual(beforePixels, pixels)) return;

    const layers = doc.layers.map((item) => (
      item.id === layer.id ? { ...item, vectorData, pixels } : item
    ));
    set({ doc: { ...doc, layers } });
    get().commitEdit('ベクター編集', layer.id, beforePixels, undefined, { vectorData: beforeVectorData });
  },

  setSelection: (sel) => set({ doc: { ...get().doc, selection: sel }, rev: get().rev + 1 }),
  selectRect: (bounds) => {
    const { doc } = get();
    const mask = rectMask(doc.width, doc.height, {
      x: bounds.x,
      y: bounds.y,
      rw: bounds.w,
      rh: bounds.h,
    });
    set({ doc: { ...doc, selection: { mask, width: doc.width, height: doc.height } }, rev: get().rev + 1 });
  },
  selectEllipse: (bounds) => {
    const { doc } = get();
    const mask = ellipseMask(doc.width, doc.height, {
      cx: bounds.x + bounds.w / 2,
      cy: bounds.y + bounds.h / 2,
      rx: Math.abs(bounds.w) / 2,
      ry: Math.abs(bounds.h) / 2,
    });
    set({ doc: { ...doc, selection: { mask, width: doc.width, height: doc.height } }, rev: get().rev + 1 });
  },
  magicWandSelectAt: (x, y, tolerance, contiguous) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels) return;

    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const mask = selectionMaskFromColor(layer.pixels, doc.width, doc.height, ix, iy, { tolerance, contiguous });
    set({ doc: { ...doc, selection: { mask, width: doc.width, height: doc.height } }, rev: get().rev + 1 });
  },
  selectAllArea: () => {
    const { doc } = get();
    set({ doc: { ...doc, selection: selectAll(doc.width, doc.height) }, rev: get().rev + 1 });
  },
  invertSelectionArea: () => {
    const { doc } = get();
    if (!doc.selection) { get().selectAllArea(); return; }
    set({ doc: { ...doc, selection: invertSelection(doc.selection) }, rev: get().rev + 1 });
  },
  clearSelection: () => set({ doc: { ...get().doc, selection: null }, rev: get().rev + 1 }),
  fillSelectionWithPrimary: () => {
    const { doc, primary } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.locked) return;
    const before = layer.pixels.slice();
    fillRegion(layer.pixels, doc.width, doc.height, primary, doc.selection?.mask ?? null);
    get().commitEdit('選択範囲を塗りつぶし', layer.id, before);
  },
  growSelectionBy: (px) => {
    const { doc } = get();
    if (!doc.selection) return;
    set({ doc: { ...doc, selection: growSelection(doc.selection, px) }, rev: get().rev + 1 });
  },
  shrinkSelectionBy: (px) => {
    const { doc } = get();
    if (!doc.selection) return;
    set({ doc: { ...doc, selection: shrinkSelection(doc.selection, px) }, rev: get().rev + 1 });
  },
  featherSelectionBy: (px) => {
    const { doc } = get();
    if (!doc.selection) return;
    set({ doc: { ...doc, selection: featherSelection(doc.selection, px) }, rev: get().rev + 1 });
  },

  addLayer: () => {
    const { doc } = get();
    const layer = createRasterLayer(doc.width, doc.height, `レイヤー ${doc.layers.length}`);
    const idx = doc.activeLayerId ? layerIndex(doc, doc.activeLayerId) + 1 : doc.layers.length;
    const layers = [...doc.layers];
    layers.splice(idx, 0, layer);
    set({ doc: { ...doc, layers, activeLayerId: layer.id }, rev: get().rev + 1 });
  },
  addAdjustmentLayer: (type, opts) => {
    const { doc } = get();
    const layer = createAdjustmentLayer(type, opts, adjustmentLayerName(type));
    const idx = doc.activeLayerId ? layerIndex(doc, doc.activeLayerId) + 1 : doc.layers.length;
    const layers = [...doc.layers];
    layers.splice(idx, 0, layer);
    set({ doc: { ...doc, layers, activeLayerId: layer.id }, rev: get().rev + 1 });
  },
  removeLayer: (id) => {
    const { doc } = get();
    if (doc.layers.length <= 1) return;
    const layers = doc.layers.filter((l) => l.id !== id);
    const activeLayerId = doc.activeLayerId === id ? layers[layers.length - 1].id : doc.activeLayerId;
    set({ doc: { ...doc, layers, activeLayerId }, rev: get().rev + 1 });
  },
  selectLayer: (id) => set({ doc: { ...get().doc, activeLayerId: id } }),
  setLayerProps: (id, patch) => {
    const { doc } = get();
    const layers = doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
    set({ doc: { ...doc, layers }, rev: get().rev + 1 });
  },
  moveLayer: (id, dir) => {
    const { doc } = get();
    const i = layerIndex(doc, id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= doc.layers.length) return;
    const layers = [...doc.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    set({ doc: { ...doc, layers }, rev: get().rev + 1 });
  },
  flipActiveLayer: (axis) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    const next = axis === 'h'
      ? flipHorizontal(layer.pixels, doc.width, doc.height)
      : flipVertical(layer.pixels, doc.width, doc.height);
    layer.pixels.set(next);
    get().commitEdit(axis === 'h' ? '左右反転' : '上下反転', layer.id, before);
  },
  rotateActiveLayer: (dir) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    const next = dir === '180'
      ? rotate180(layer.pixels, doc.width, doc.height).pixels
      : fitRotatedPixels(
        dir === 'cw'
          ? rotate90CW(layer.pixels, doc.width, doc.height)
          : rotate90CCW(layer.pixels, doc.width, doc.height),
        doc.width,
        doc.height,
      );
    layer.pixels.set(next);
    get().commitEdit(dir === 'cw' ? '時計回りに回転' : dir === 'ccw' ? '反時計回りに回転' : '180度回転', layer.id, before);
  },
  cropToSelection: () => {
    const { doc } = get();
    if (!doc.selection) return;

    const bounds = selectionBounds(doc.selection);
    if (!bounds) return;

    const before = cloneDocumentSnapshot(doc);
    const after = cloneDocumentSnapshot(cropDocument(doc, bounds));
    history.push({
      label: '選択範囲でクロップ',
      undo: () => set({ doc: cloneDocumentSnapshot(before), rev: get().rev + 1 }),
      redo: () => set({ doc: cloneDocumentSnapshot(after), rev: get().rev + 1 }),
    });
    set({ doc: cloneDocumentSnapshot(after), rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  resizeCanvasTo: (w, h, anchor) => {
    const { doc } = get();
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;

    const width = Math.trunc(w);
    const height = Math.trunc(h);
    if (width <= 0 || height <= 0 || (width === doc.width && height === doc.height)) return;

    const before = cloneDocumentSnapshot(doc);
    const after = cloneDocumentSnapshot(resizeCanvas(doc, { w: width, h: height, anchor }));
    history.push({
      label: 'キャンバスサイズ変更',
      undo: () => set({ doc: cloneDocumentSnapshot(before), rev: get().rev + 1 }),
      redo: () => set({ doc: cloneDocumentSnapshot(after), rev: get().rev + 1 }),
    });
    set({ doc: cloneDocumentSnapshot(after), rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  alignActiveLayer: (mode) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const bounds = opaqueBounds(layer.pixels, doc.width, doc.height);
    if (!bounds) return;

    const offset = alignOffset(bounds, { w: doc.width, h: doc.height }, mode);
    if (offset.dx === 0 && offset.dy === 0) return;

    const before = layer.pixels.slice();
    layer.pixels.set(translatePixels(layer.pixels, doc.width, doc.height, offset.dx, offset.dy));
    get().commitEdit('レイヤー整列', layer.id, before);
  },
  applyPerspective: (dst) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    const next = perspectiveWarp(layer.pixels, doc.width, doc.height, dst);
    if (next.length !== before.length) return;

    const layerId = layer.id;
    const layers = doc.layers.map((item) => (
      item.id === layerId ? { ...item, pixels: next } : item
    ));
    set({ doc: { ...doc, layers } });

    if (!pixelsEqual(before, next)) {
      get().commitEdit('パース変形', layerId, before);
    } else {
      set({ rev: get().rev + 1 });
    }
  },
  applyMeshWarp: (grid) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    const next = meshWarp(layer.pixels, doc.width, doc.height, grid);
    if (next.length !== before.length) return;

    const layerId = layer.id;
    const layers = doc.layers.map((item) => (
      item.id === layerId ? { ...item, pixels: next } : item
    ));
    set({ doc: { ...doc, layers } });

    if (!pixelsEqual(before, next)) {
      get().commitEdit('メッシュワープ', layerId, before);
    } else {
      set({ rev: get().rev + 1 });
    }
  },
  mergeDown: (id) => {
    const { doc } = get();
    const i = layerIndex(doc, id);
    if (i <= 0) return;
    const top = doc.layers[i];
    const bottom = doc.layers[i - 1];
    if (!top.pixels || !bottom.pixels) return;
    compositeLayerPixelsIntoBottom(bottom.pixels, top);
    const layers = doc.layers.filter((l) => l.id !== id);
    set({ doc: { ...doc, layers, activeLayerId: bottom.id }, rev: get().rev + 1 });
  },
  addLayerMask: (id) => {
    const { doc } = get();
    const layer = findLayer(doc, id);
    if (!layer) return;
    const mask = createLayerMask(doc.width, doc.height, 255);
    const layers = doc.layers.map((l) => (l.id === id ? { ...l, mask } : l));
    set({ doc: { ...doc, layers }, rev: get().rev + 1 });
  },
  removeLayerMask: (id) => {
    const { doc } = get();
    const layer = findLayer(doc, id);
    if (!layer?.mask) return;
    const layers = doc.layers.map((l) => (l.id === id ? { ...l, mask: undefined } : l));
    set({ doc: { ...doc, layers }, rev: get().rev + 1 });
  },
  setMaskEditMode: (on) => set({ maskEditMode: on }),
  addGroup: () => {
    const { doc } = get();
    const activeId = doc.activeLayerId;
    const group = createGroupLayer(`グループ ${doc.layers.filter((l) => l.kind === 'group').length + 1}`, activeId ? [activeId] : []);
    const insertAt = activeId ? layerIndex(doc, activeId) + 1 : doc.layers.length;
    const layers = [...doc.layers];
    layers.splice(insertAt, 0, group);
    set({ doc: { ...doc, layers, activeLayerId: group.id }, rev: get().rev + 1 });
  },
  moveLayerToGroupAction: (layerId, groupId) => {
    const { doc } = get();
    set({ doc: addToGroup(doc, layerId, groupId), rev: get().rev + 1 });
  },
  removeLayerFromGroupAction: (layerId, groupId) => {
    const { doc } = get();
    set({ doc: removeFromGroup(doc, layerId, groupId), rev: get().rev + 1 });
  },
  applyLayerEffect: (kind, opts) => {
    const { doc, primary } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    let next: Uint8ClampedArray;

    switch (kind) {
      case 'drop-shadow': {
        const effectOpts = opts as LayerEffectOptionMap['drop-shadow'] | undefined;
        next = dropShadow(layer.pixels, doc.width, doc.height, {
          dx: effectOpts?.dx ?? 4,
          dy: effectOpts?.dy ?? 4,
          blur: effectOpts?.blur ?? 4,
          color: effectOpts?.color ?? BLACK,
          opacity: effectOpts?.opacity ?? 0.5,
        });
        break;
      }
      case 'stroke': {
        const effectOpts = opts as LayerEffectOptionMap['stroke'] | undefined;
        next = strokeOutline(layer.pixels, doc.width, doc.height, {
          size: effectOpts?.size ?? 2,
          color: effectOpts?.color ?? primary,
          position: effectOpts?.position,
        });
        break;
      }
      case 'glow': {
        const effectOpts = opts as LayerEffectOptionMap['glow'] | undefined;
        next = outerGlow(layer.pixels, doc.width, doc.height, {
          blur: effectOpts?.blur ?? 6,
          color: effectOpts?.color ?? primary,
          opacity: effectOpts?.opacity ?? 0.6,
        });
        break;
      }
      case 'inner-shadow': {
        const effectOpts = opts as LayerEffectOptionMap['inner-shadow'] | undefined;
        next = innerShadow(layer.pixels, doc.width, doc.height, {
          dx: effectOpts?.dx ?? 4,
          dy: effectOpts?.dy ?? 4,
          blur: effectOpts?.blur ?? 4,
          color: effectOpts?.color ?? BLACK,
          opacity: effectOpts?.opacity ?? 0.5,
        });
        break;
      }
      case 'bevel-emboss': {
        const effectOpts = opts as LayerEffectOptionMap['bevel-emboss'] | undefined;
        next = bevelEmboss(layer.pixels, doc.width, doc.height, {
          depth: effectOpts?.depth ?? 1,
          blur: effectOpts?.blur ?? 3,
          angle: effectOpts?.angle ?? 135,
          opacity: effectOpts?.opacity ?? 0.7,
        });
        break;
      }
    }

    if (!pixelsEqual(before, next)) {
      const layerId = layer.id;
      const layers = doc.layers.map((item) => (
        item.id === layerId ? { ...item, pixels: next } : item
      ));
      set({ doc: { ...doc, layers } });
      get().commitEdit('レイヤー効果', layerId, before);
    }
  },
  applyFilter: (name, opts) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    const selectionMask = doc.selection?.mask ?? null;

    switch (name) {
      case 'blur': {
        const filterOpts = opts as FilterOptionMap['blur'] | undefined;
        gaussianBlur(layer.pixels, doc.width, doc.height, {
          radius: 4,
          ...filterOpts,
          mask: selectionMask,
        });
        break;
      }
      case 'gaussian': {
        const filterOpts = opts as FilterOptionMap['gaussian'] | undefined;
        gaussianBlur(layer.pixels, doc.width, doc.height, {
          radius: 4,
          ...filterOpts,
          mask: selectionMask,
        });
        break;
      }
      case 'bloom': {
        const filterOpts = opts as FilterOptionMap['bloom'] | undefined;
        bloom(layer.pixels, doc.width, doc.height, {
          threshold: 200,
          radius: 6,
          intensity: 0.8,
          ...filterOpts,
          mask: selectionMask,
        });
        break;
      }
      case 'brightness-contrast': {
        const filterOpts = opts as Partial<BrightnessContrastOptions> | undefined;
        adjustBrightnessContrast(layer.pixels, doc.width, doc.height, {
          brightness: filterOpts?.brightness ?? 10,
          contrast: filterOpts?.contrast ?? 10,
        }, selectionMask);
        break;
      }
      case 'invert':
        invertColors(layer.pixels, doc.width, doc.height, selectionMask);
        break;
      case 'grayscale':
        grayscale(layer.pixels, doc.width, doc.height, selectionMask);
        break;
      case 'hue-saturation': {
        const filterOpts = opts as Partial<HueSaturationOptions> | undefined;
        adjustHueSaturation(layer.pixels, doc.width, doc.height, {
          hue: filterOpts?.hue ?? 0,
          saturation: filterOpts?.saturation ?? 20,
        }, selectionMask);
        break;
      }
      case 'levels': {
        const filterOpts = opts as Partial<LevelsOptions> | undefined;
        adjustLevels(layer.pixels, doc.width, doc.height, {
          inBlack: filterOpts?.inBlack ?? 16,
          inWhite: filterOpts?.inWhite ?? 239,
          gamma: filterOpts?.gamma ?? 1,
          outBlack: filterOpts?.outBlack ?? 0,
          outWhite: filterOpts?.outWhite ?? 255,
        }, selectionMask);
        break;
      }
      case 'sharpen': {
        const filterOpts = opts as Partial<SharpenOptions> | undefined;
        sharpen(layer.pixels, doc.width, doc.height, { amount: filterOpts?.amount ?? 0.75 }, selectionMask);
        break;
      }
      case 'unsharp': {
        const filterOpts = opts as FilterOptionMap['unsharp'] | undefined;
        unsharpMask(layer.pixels, doc.width, doc.height, {
          amount: filterOpts?.amount ?? 1,
          radius: filterOpts?.radius ?? 1,
          threshold: filterOpts?.threshold,
        }, selectionMask);
        break;
      }
      case 'threshold': {
        const filterOpts = opts as Partial<ThresholdOptions> | undefined;
        threshold(layer.pixels, doc.width, doc.height, { level: filterOpts?.level ?? 128 }, selectionMask);
        break;
      }
      case 'sketch': {
        const filterOpts = opts as FilterOptionMap['sketch'] | undefined;
        pencilSketch(layer.pixels, doc.width, doc.height, {
          blurRadius: filterOpts?.blurRadius ?? 6,
          strength: filterOpts?.strength,
          mask: selectionMask,
        });
        break;
      }
      case 'adaptive-threshold': {
        const filterOpts = opts as FilterOptionMap['adaptive-threshold'] | undefined;
        adaptiveThreshold(layer.pixels, doc.width, doc.height, {
          radius: filterOpts?.radius ?? 8,
          bias: filterOpts?.bias,
          mask: selectionMask,
        });
        break;
      }
      case 'posterize': {
        const filterOpts = opts as Partial<PosterizeOptions> | undefined;
        posterize(layer.pixels, doc.width, doc.height, { levels: filterOpts?.levels ?? 4 }, selectionMask);
        break;
      }
      case 'sepia':
        sepia(layer.pixels, doc.width, doc.height, selectionMask);
        break;
      case 'auto-levels': {
        const filterOpts = opts as FilterOptionMap['auto-levels'] | undefined;
        autoLevels(layer.pixels, doc.width, doc.height, {
          clipPercent: filterOpts?.clipPercent ?? 0,
          mask: selectionMask,
        });
        break;
      }
      case 'auto-contrast': {
        const filterOpts = opts as FilterOptionMap['auto-contrast'] | undefined;
        autoContrast(layer.pixels, doc.width, doc.height, {
          clipPercent: filterOpts?.clipPercent ?? 0,
          mask: selectionMask,
        });
        break;
      }
      case 'white-balance': {
        const filterOpts = opts as FilterOptionMap['white-balance'] | undefined;
        autoWhiteBalance(layer.pixels, doc.width, doc.height, {
          ...filterOpts,
          mask: filterOpts?.mask ?? selectionMask,
        });
        break;
      }
      case 'sobel-edge':
        sobelEdge(layer.pixels, doc.width, doc.height, { mask: selectionMask });
        break;
      case 'emboss':
        emboss(layer.pixels, doc.width, doc.height, { mask: selectionMask });
        break;
      case 'mosaic': {
        const filterOpts = opts as FilterOptionMap['mosaic'] | undefined;
        pixelate(layer.pixels, doc.width, doc.height, {
          blockSize: filterOpts?.blockSize ?? 4,
          mask: selectionMask,
        });
        break;
      }
      case 'ordered-dither': {
        const filterOpts = opts as FilterOptionMap['ordered-dither'] | undefined;
        orderedDither(layer.pixels, doc.width, doc.height, {
          levels: filterOpts?.levels ?? 4,
          mask: selectionMask,
        });
        break;
      }
      case 'quantize': {
        const filterOpts = opts as FilterOptionMap['quantize'] | undefined;
        applyQuantize(layer.pixels, doc.width, doc.height, filterOpts?.maxColors ?? 16, selectionMask);
        break;
      }
      case 'color-balance': {
        const filterOpts = opts as FilterOptionMap['color-balance'] | undefined;
        adjustColorBalance(layer.pixels, doc.width, doc.height, {
          shadows: filterOpts?.shadows,
          midtones: filterOpts?.midtones ?? [8, 0, -8],
          highlights: filterOpts?.highlights,
          mask: selectionMask,
        });
        break;
      }
      case 'gradient-map': {
        const filterOpts = opts as FilterOptionMap['gradient-map'] | undefined;
        gradientMap(layer.pixels, doc.width, doc.height, {
          stops: filterOpts?.stops ?? [
            { t: 0, color: { r: 24, g: 35, b: 80, a: 255 } },
            { t: 1, color: { r: 255, g: 236, b: 184, a: 255 } },
          ],
          mask: selectionMask,
        });
        break;
      }
      case 'curves': {
        const filterOpts = opts as FilterOptionMap['curves'] | undefined;
        applyCurves(layer.pixels, doc.width, doc.height, {
          rgb: filterOpts?.rgb ?? [
            { x: 0, y: 0 },
            { x: 128, y: 148 },
            { x: 255, y: 255 },
          ],
          r: filterOpts?.r,
          g: filterOpts?.g,
          b: filterOpts?.b,
          mask: selectionMask,
        });
        break;
      }
      case 'equalize':
        equalizeHistogram(layer.pixels, doc.width, doc.height, selectionMask);
        break;
      case 'gamma': {
        const filterOpts = opts as FilterOptionMap['gamma'] | undefined;
        adjustGamma(layer.pixels, doc.width, doc.height, {
          gamma: filterOpts?.gamma ?? 1.5,
        }, selectionMask);
        break;
      }
      case 'motion-blur': {
        const filterOpts = opts as FilterOptionMap['motion-blur'] | undefined;
        motionBlur(layer.pixels, doc.width, doc.height, {
          angle: filterOpts?.angle ?? 0,
          distance: filterOpts?.distance ?? 8,
        }, selectionMask);
        break;
      }
      case 'zoom-blur': {
        const filterOpts = opts as FilterOptionMap['zoom-blur'] | undefined;
        zoomBlur(layer.pixels, doc.width, doc.height, {
          cx: (doc.width - 1) / 2,
          cy: (doc.height - 1) / 2,
          strength: filterOpts?.strength ?? 0.35,
        }, selectionMask);
        break;
      }
      case 'replace-color': {
        const filterOpts = opts as FilterOptionMap['replace-color'] | undefined;
        replaceColor(layer.pixels, doc.width, doc.height, {
          from: filterOpts?.from ?? get().primary,
          to: filterOpts?.to ?? get().secondary,
          tolerance: filterOpts?.tolerance ?? get().fillTolerance,
          fuzziness: filterOpts?.fuzziness,
        }, selectionMask);
        break;
      }
      case 'lens': {
        const filterOpts = opts as FilterOptionMap['lens'] | undefined;
        const lensOpts = { amount: 0.3, ...filterOpts } as LensDistortOptions;
        lensDistort(layer.pixels, doc.width, doc.height, lensOpts, selectionMask ?? undefined);
        break;
      }
      case 'vignette': {
        const filterOpts = opts as FilterOptionMap['vignette'] | undefined;
        const vignetteOpts = { amount: 0.5, ...filterOpts } as VignetteOptions;
        vignette(layer.pixels, doc.width, doc.height, vignetteOpts, selectionMask ?? undefined);
        break;
      }
      case 'channel-mixer': {
        const filterOpts = opts as FilterOptionMap['channel-mixer'] | undefined;
        channelMixer(layer.pixels, doc.width, doc.height, {
          monochrome: false,
          red: { r: 1, g: 0, b: 0 },
          green: { r: 0, g: 1, b: 0 },
          blue: { r: 0, g: 0, b: 1 },
          ...filterOpts,
          mask: selectionMask,
        });
        break;
      }
      case 'clarity': {
        const filterOpts = opts as FilterOptionMap['clarity'] | undefined;
        clarity(layer.pixels, doc.width, doc.height, {
          amount: 0.5,
          radius: 3,
          ...filterOpts,
          mask: selectionMask,
        });
        break;
      }
      case 'halftone': {
        const filterOpts = opts as FilterOptionMap['halftone'] | undefined;
        halftone(layer.pixels, doc.width, doc.height, {
          cellSize: 6,
          ...filterOpts,
          mask: selectionMask,
        });
        break;
      }
      case 'duotone': {
        const filterOpts = opts as FilterOptionMap['duotone'] | undefined;
        duotone(layer.pixels, doc.width, doc.height, {
          shadow: duotoneTuple(filterOpts?.shadow ?? { r: 20, g: 20, b: 60, a: 255 }),
          highlight: duotoneTuple(filterOpts?.highlight ?? { r: 255, g: 240, b: 200, a: 255 }),
          mask: selectionMask,
        });
        break;
      }
      case 'chromakey': {
        const filterOpts = opts as FilterOptionMap['chromakey'] | undefined;
        chromaKey(layer.pixels, doc.width, doc.height, {
          key: filterOpts?.key ?? { r: 0, g: 255, b: 0, a: 255 },
          tolerance: filterOpts?.tolerance ?? 80,
          softness: filterOpts?.softness ?? 40,
          mask: selectionMask,
        });
        break;
      }
      case 'chromatic': {
        const filterOpts = opts as FilterOptionMap['chromatic'] | undefined;
        chromaticAberration(layer.pixels, doc.width, doc.height, {
          amount: 4,
          ...filterOpts,
          mask: selectionMask ?? undefined,
        });
        break;
      }
      case 'oil': {
        const filterOpts = opts as FilterOptionMap['oil'] | undefined;
        oilPaint(layer.pixels, doc.width, doc.height, {
          radius: 3,
          ...filterOpts,
          mask: selectionMask ?? undefined,
        });
        break;
      }
      case 'dehaze': {
        const filterOpts = opts as FilterOptionMap['dehaze'] | undefined;
        dehaze(layer.pixels, doc.width, doc.height, {
          strength: 0.6,
          ...filterOpts,
          mask: selectionMask,
        });
        break;
      }
    }

    if (!pixelsEqual(before, layer.pixels)) {
      get().commitEdit('フィルター', layer.id, before);
    }
  },
  fillWithGradient: (spec) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    const defaultSpec: GradientSpec = {
      kind: 'linear',
      x0: 0,
      y0: 0,
      x1: doc.width,
      y1: 0,
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
        { offset: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
      ],
    };
    const mergedSpec: GradientSpec = {
      ...defaultSpec,
      ...spec,
      stops: spec?.stops ?? defaultSpec.stops,
    };

    layer.pixels.set(generateGradient(doc.width, doc.height, mergedSpec));

    if (!pixelsEqual(before, layer.pixels)) {
      get().commitEdit('グラデーション', layer.id, before);
    }
  },
  fillWithNoise: (opts) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    const next = noiseToGrayscale(generateNoiseField({
      width: doc.width,
      height: doc.height,
      scale: opts?.scale ?? 24,
      seed: opts?.seed ?? 1,
    }), doc.width, doc.height);
    layer.pixels.set(next);

    if (!pixelsEqual(before, layer.pixels)) {
      get().commitEdit('ノイズ生成', layer.id, before);
    }
  },
  fillWithCellular: (opts) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    const next = worleyToGrayscale(worleyField({
      width: doc.width,
      height: doc.height,
      cellSize: opts?.cellSize ?? 32,
      seed: opts?.seed ?? 1,
    }), doc.width, doc.height);
    layer.pixels.set(next);

    if (!pixelsEqual(before, layer.pixels)) {
      get().commitEdit('セルラーノイズ生成', layer.id, before);
    }
  },
  applyKaleidoscope: (opts) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    const next = kaleidoscope(layer.pixels, doc.width, doc.height, { segments: 6, ...opts });
    layer.pixels.set(next);
    get().commitEdit('万華鏡', layer.id, before);
  },

  undo: () => {
    history.undo();
    set({ rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  redo: () => {
    history.redo();
    set({ rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  commitEdit: (label, layerId, before, beforeTextData, beforeData) => {
    const afterLayer = findLayer(get().doc, layerId);
    const after = afterLayer?.pixels?.slice();
    if (!after) return;
    const afterTextData = beforeTextData && afterLayer?.textData ? cloneTextLayerData(afterLayer.textData) : undefined;
    const beforeShapeData = beforeData?.shapeData;
    const afterShapeData = beforeShapeData && afterLayer?.shapeData ? cloneShapeData(afterLayer.shapeData) : undefined;
    const beforeVectorData = beforeData?.vectorData;
    const afterVectorData = beforeVectorData && afterLayer?.vectorData ? cloneVectorLayerData(afterLayer.vectorData) : undefined;
    if (beforeTextData && afterTextData && !beforeShapeData && !beforeVectorData) {
      history.push({
        label,
        undo: () => {
          const currentDoc = get().doc;
          const layers = currentDoc.layers.map((item) => (
            item.id === layerId ? { ...item, pixels: before.slice(), textData: cloneTextLayerData(beforeTextData) } : item
          ));
          set({ doc: { ...currentDoc, layers } });
        },
        redo: () => {
          const currentDoc = get().doc;
          const layers = currentDoc.layers.map((item) => (
            item.id === layerId ? { ...item, pixels: after.slice(), textData: cloneTextLayerData(afterTextData) } : item
          ));
          set({ doc: { ...currentDoc, layers } });
        },
      });
    } else if (
      (beforeTextData && afterTextData)
      || (beforeShapeData && afterShapeData)
      || (beforeVectorData && afterVectorData)
    ) {
      history.push({
        label,
        undo: () => {
          const currentDoc = get().doc;
          const layers = currentDoc.layers.map((item) => {
            if (item.id !== layerId) return item;
            const nextLayer = { ...item, pixels: before.slice() };
            if (beforeTextData && afterTextData) nextLayer.textData = cloneTextLayerData(beforeTextData);
            if (beforeShapeData && afterShapeData) nextLayer.shapeData = cloneShapeData(beforeShapeData);
            if (beforeVectorData && afterVectorData) nextLayer.vectorData = cloneVectorLayerData(beforeVectorData);
            return nextLayer;
          });
          set({ doc: { ...currentDoc, layers } });
        },
        redo: () => {
          const currentDoc = get().doc;
          const layers = currentDoc.layers.map((item) => {
            if (item.id !== layerId) return item;
            const nextLayer = { ...item, pixels: after.slice() };
            if (beforeTextData && afterTextData) nextLayer.textData = cloneTextLayerData(afterTextData);
            if (beforeShapeData && afterShapeData) nextLayer.shapeData = cloneShapeData(afterShapeData);
            if (beforeVectorData && afterVectorData) nextLayer.vectorData = cloneVectorLayerData(afterVectorData);
            return nextLayer;
          });
          set({ doc: { ...currentDoc, layers } });
        },
      });
    } else {
      history.push(pixelSnapshotCommand(label, () => findLayer(get().doc, layerId)?.pixels, before, after));
    }
    set({ rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  bump: () => set({ rev: get().rev + 1 }),
}));
