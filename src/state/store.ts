import { create } from 'zustand';
import type {
  AdjustmentSpec, BrushSettings, Layer, LayerId, PaintDocument, PointerSample, RGBA, ToolId, Viewport,
} from '../types';
import type { TextLayerData } from '../text/text-layer';
import { DEFAULT_BRUSH, IDENTITY_VIEWPORT } from '../types';
import {
  createAdjustmentLayer, createDocument, createRasterLayer, createLayerMask, createGroupLayer, createTextLayer,
  findLayer, activeLayer, layerIndex,
} from '../core/document';
import { addToGroup, removeFromGroup } from '../core/group-ops';
import { History, pixelSnapshotCommand } from '../core/history';
import { StrokeEngine } from '../engine/brush';
import { BLACK, WHITE } from '../color/color';
import { floodFill, fillRegion } from '../tools/fill';
import { paintMaskDab } from '../tools/mask-paint';
import { featherSelection, growSelection, invertSelection, selectAll, shrinkSelection } from '../tools/selection';
import { moveLayerPixels } from '../tools/transform';
import type { Selection } from '../types';
import { renderText } from '../text';
import { createTextLayerData, rasterizeTextLayer, updateTextLayerData } from '../text/text-layer';
import {
  adjustBrightnessContrast,
  adjustHueSaturation,
  adjustLevels,
  gaussianBlur,
  grayscale,
  invertColors,
  posterize,
  type BrightnessContrastOptions,
  type GaussianBlurOptions,
  type HueSaturationOptions,
  type LevelsOptions,
  type PosterizeOptions,
  type SharpenOptions,
  sharpen,
  sepia,
  threshold,
  type ThresholdOptions,
} from '../filters';
import { adjustColorBalance, gradientMap, type ColorBalanceOptions, type GradientMapOptions } from '../filters/color-balance';
import { emboss, sobelEdge } from '../filters/convolve';
import { applyCurves, type CurvesOptions } from '../filters/curves';
import { autoContrast, autoLevels, type AutoToneOptions } from '../filters/histogram';
import { orderedDither, type OrderedDitherOptions } from '../filters/noise';
import { pixelate, type PixelateOptions } from '../filters/pixelate';

type Maskless<T> = Omit<T, 'mask'>;

export interface FilterOptionMap {
  blur: Partial<GaussianBlurOptions>;
  'brightness-contrast': Partial<BrightnessContrastOptions>;
  invert: Record<string, never>;
  grayscale: Record<string, never>;
  'hue-saturation': Partial<HueSaturationOptions>;
  levels: Partial<LevelsOptions>;
  sharpen: Partial<SharpenOptions>;
  threshold: Partial<ThresholdOptions>;
  posterize: Partial<PosterizeOptions>;
  sepia: Record<string, never>;
  'auto-levels': Partial<Maskless<AutoToneOptions>>;
  'auto-contrast': Partial<Maskless<AutoToneOptions>>;
  'sobel-edge': Record<string, never>;
  emboss: Record<string, never>;
  mosaic: Partial<Maskless<PixelateOptions>>;
  'ordered-dither': Partial<Maskless<OrderedDitherOptions>>;
  'color-balance': Partial<Maskless<ColorBalanceOptions>>;
  'gradient-map': Partial<Maskless<GradientMapOptions>>;
  curves: Partial<Maskless<CurvesOptions>>;
}

export type FilterName = keyof FilterOptionMap;
export type FilterOptions = FilterOptionMap[FilterName];

/** Transient, non-reactive stroke state (kept out of the reactive store). */
interface StrokeContext {
  engine: StrokeEngine;
  layerId: LayerId;
  before: Uint8ClampedArray; // snapshot for undo
  color: RGBA;
}
let activeStroke: StrokeContext | null = null;
let activeMaskStroke: LayerId | null = null;
export const getActiveStroke = () => activeStroke;

const history = new History(60);

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

export interface AppState {
  doc: PaintDocument;
  viewport: Viewport;
  tool: ToolId;
  brush: BrushSettings;
  primary: RGBA;
  secondary: RGBA;
  /** 0..255 color match tolerance for the fill tool */
  fillTolerance: number;
  /** bump to force canvas redraw after in-place pixel mutation */
  rev: number;
  isStroking: boolean;
  canUndo: boolean;
  canRedo: boolean;
  maskEditMode: boolean;

  // document lifecycle
  newDocument: (w?: number, h?: number, name?: string) => void;
  loadDocument: (doc: PaintDocument) => void;

  // tool & brush & color
  setTool: (t: ToolId) => void;
  setBrush: (patch: Partial<BrushSettings>) => void;
  setPrimary: (c: RGBA) => void;
  setSecondary: (c: RGBA) => void;
  swapColors: () => void;

  // viewport
  setViewport: (patch: Partial<Viewport>) => void;
  resetViewport: () => void;

  // painting
  beginStroke: (s: PointerSample) => void;
  extendStroke: (s: PointerSample) => void;
  endStroke: () => void;
  paintActiveLayerMaskDab: (x: number, y: number) => void;
  pickColorAt: (x: number, y: number) => void;
  setFillTolerance: (n: number) => void;
  floodFillAt: (x: number, y: number) => void;
  moveActiveLayer: (dx: number, dy: number) => void;
  placeTextAt: (x: number, y: number, text: string) => void;
  createTextLayerAt: (x: number, y: number, text: string) => void;
  updateActiveTextLayer: (patch: Partial<TextLayerData>) => void;

  // selection
  setSelection: (sel: Selection | null) => void;
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
  mergeDown: (id: LayerId) => void;
  addLayerMask: (id: LayerId) => void;
  removeLayerMask: (id: LayerId) => void;
  setMaskEditMode: (on: boolean) => void;
  addGroup: () => void;
  moveLayerToGroupAction: (layerId: LayerId, groupId: LayerId) => void;
  removeLayerFromGroupAction: (layerId: LayerId, groupId: LayerId) => void;

  // filters
  applyFilter: <T extends FilterName>(name: T, opts?: FilterOptionMap[T]) => void;

  // history
  undo: () => void;
  redo: () => void;
  /** record an externally-applied edit (tools/io) for undo */
  commitEdit: (label: string, layerId: LayerId, before: Uint8ClampedArray, beforeTextData?: TextLayerData) => void;
  bump: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  doc: createDocument(),
  viewport: { ...IDENTITY_VIEWPORT },
  tool: 'brush',
  brush: { ...DEFAULT_BRUSH },
  primary: { ...BLACK },
  secondary: { ...WHITE },
  fillTolerance: 32,
  rev: 0,
  isStroking: false,
  canUndo: false,
  canRedo: false,
  maskEditMode: false,

  newDocument: (w = 1280, h = 720, name = '無題') => {
    history.clear();
    activeStroke = null;
    activeMaskStroke = null;
    set({ doc: createDocument(w, h, name), rev: get().rev + 1, isStroking: false, canUndo: false, canRedo: false });
  },
  loadDocument: (doc) => {
    history.clear();
    activeStroke = null;
    activeMaskStroke = null;
    set({ doc, rev: get().rev + 1, isStroking: false, canUndo: false, canRedo: false });
  },

  setTool: (t) => set({ tool: t }),
  setBrush: (patch) => set({ brush: { ...get().brush, ...patch } }),
  setPrimary: (c) => set({ primary: c }),
  setSecondary: (c) => set({ secondary: c }),
  swapColors: () => set({ primary: get().secondary, secondary: get().primary }),

  setViewport: (patch) => set({ viewport: { ...get().viewport, ...patch } }),
  resetViewport: () => set({ viewport: { ...IDENTITY_VIEWPORT } }),

  beginStroke: (s) => {
    const { doc, brush, tool, primary, maskEditMode } = get();
    const layer = activeLayer(doc);
    if (!layer || !layer.pixels || layer.locked || !layer.visible) return;
    if (maskEditMode) {
      if (layer.kind !== 'raster') return;
      get().paintActiveLayerMaskDab(s.x, s.y);
      activeMaskStroke = layer.id;
      set({ isStroking: true });
      return;
    }
    const erase = tool === 'eraser';
    const engine = new StrokeEngine(doc.width, doc.height, brush, erase);
    engine.addSample(s);
    activeStroke = {
      engine,
      layerId: layer.id,
      before: layer.pixels.slice(),
      color: erase ? primary : primary,
    };
    set({ isStroking: true, rev: get().rev + 1 });
  },
  extendStroke: (s) => {
    if (activeMaskStroke) {
      get().paintActiveLayerMaskDab(s.x, s.y);
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

  setSelection: (sel) => set({ doc: { ...get().doc, selection: sel }, rev: get().rev + 1 }),
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
  mergeDown: (id) => {
    const { doc } = get();
    const i = layerIndex(doc, id);
    if (i <= 0) return;
    const top = doc.layers[i];
    const bottom = doc.layers[i - 1];
    if (!top.pixels || !bottom.pixels) return;
    // composite top over bottom (normal, respecting top opacity)
    const tp = top.pixels, bp = bottom.pixels, op = top.opacity;
    for (let o = 0; o < bp.length; o += 4) {
      const sa = (tp[o + 3] / 255) * op;
      if (sa <= 0) continue;
      const da = bp[o + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) continue;
      bp[o] = (tp[o] * sa + bp[o] * da * (1 - sa)) / oa;
      bp[o + 1] = (tp[o + 1] * sa + bp[o + 1] * da * (1 - sa)) / oa;
      bp[o + 2] = (tp[o + 2] * sa + bp[o + 2] * da * (1 - sa)) / oa;
      bp[o + 3] = oa * 255;
    }
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
  applyFilter: (name, opts) => {
    const { doc } = get();
    const layer = activeLayer(doc);
    if (!layer?.pixels || layer.kind !== 'raster' || layer.locked) return;

    const before = layer.pixels.slice();
    const selectionMask = doc.selection?.mask ?? null;

    switch (name) {
      case 'blur': {
        const filterOpts = opts as Partial<GaussianBlurOptions> | undefined;
        gaussianBlur(layer.pixels, doc.width, doc.height, { radius: filterOpts?.radius ?? 4 }, selectionMask);
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
      case 'threshold': {
        const filterOpts = opts as Partial<ThresholdOptions> | undefined;
        threshold(layer.pixels, doc.width, doc.height, { level: filterOpts?.level ?? 128 }, selectionMask);
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
    }

    if (!pixelsEqual(before, layer.pixels)) {
      get().commitEdit('フィルター', layer.id, before);
    }
  },

  undo: () => {
    history.undo();
    set({ rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  redo: () => {
    history.redo();
    set({ rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  commitEdit: (label, layerId, before, beforeTextData) => {
    const afterLayer = findLayer(get().doc, layerId);
    const after = afterLayer?.pixels?.slice();
    if (!after) return;
    const afterTextData = beforeTextData && afterLayer?.textData ? cloneTextLayerData(afterLayer.textData) : undefined;
    if (beforeTextData && afterTextData) {
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
    } else {
      history.push(pixelSnapshotCommand(label, () => findLayer(get().doc, layerId)?.pixels, before, after));
    }
    set({ rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  bump: () => set({ rev: get().rev + 1 }),
}));
