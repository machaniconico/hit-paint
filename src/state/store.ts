import { create } from 'zustand';
import type {
  BrushSettings, Layer, LayerId, PaintDocument, PointerSample, RGBA, ToolId, Viewport,
} from '../types';
import { DEFAULT_BRUSH, IDENTITY_VIEWPORT } from '../types';
import {
  createDocument, createRasterLayer, findLayer, activeLayer, layerIndex, uid,
} from '../core/document';
import { History, pixelSnapshotCommand } from '../core/history';
import { StrokeEngine } from '../engine/brush';
import { BLACK, WHITE } from '../color/color';
import { floodFill, fillRegion } from '../tools/fill';
import { selectAll, invertSelection } from '../tools/selection';
import { moveLayerPixels } from '../tools/transform';
import type { Selection } from '../types';

/** Transient, non-reactive stroke state (kept out of the reactive store). */
interface StrokeContext {
  engine: StrokeEngine;
  layerId: LayerId;
  before: Uint8ClampedArray; // snapshot for undo
  color: RGBA;
}
let activeStroke: StrokeContext | null = null;
export const getActiveStroke = () => activeStroke;

const history = new History(60);

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
  pickColorAt: (x: number, y: number) => void;
  setFillTolerance: (n: number) => void;
  floodFillAt: (x: number, y: number) => void;
  moveActiveLayer: (dx: number, dy: number) => void;

  // selection
  setSelection: (sel: Selection | null) => void;
  selectAllArea: () => void;
  invertSelectionArea: () => void;
  clearSelection: () => void;
  fillSelectionWithPrimary: () => void;

  // layers
  addLayer: () => void;
  removeLayer: (id: LayerId) => void;
  selectLayer: (id: LayerId) => void;
  setLayerProps: (id: LayerId, patch: Partial<Layer>) => void;
  moveLayer: (id: LayerId, dir: -1 | 1) => void;
  mergeDown: (id: LayerId) => void;

  // history
  undo: () => void;
  redo: () => void;
  /** record an externally-applied edit (tools/io) for undo */
  commitEdit: (label: string, layerId: LayerId, before: Uint8ClampedArray) => void;
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

  newDocument: (w = 1280, h = 720, name = '無題') => {
    history.clear();
    activeStroke = null;
    set({ doc: createDocument(w, h, name), rev: get().rev + 1, isStroking: false, canUndo: false, canRedo: false });
  },
  loadDocument: (doc) => {
    history.clear();
    activeStroke = null;
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
    const { doc, brush, tool, primary } = get();
    const layer = activeLayer(doc);
    if (!layer || !layer.pixels || layer.locked || !layer.visible) return;
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
    if (!activeStroke) return;
    activeStroke.engine.addSample(s);
    set({ rev: get().rev + 1 });
  },
  endStroke: () => {
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

  addLayer: () => {
    const { doc } = get();
    const layer = createRasterLayer(doc.width, doc.height, `レイヤー ${doc.layers.length}`);
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

  undo: () => {
    history.undo();
    set({ rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  redo: () => {
    history.redo();
    set({ rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  commitEdit: (label, layerId, before) => {
    const after = findLayer(get().doc, layerId)?.pixels?.slice();
    if (!after) return;
    history.push(pixelSnapshotCommand(label, () => findLayer(get().doc, layerId)?.pixels, before, after));
    set({ rev: get().rev + 1, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },
  bump: () => set({ rev: get().rev + 1 }),
}));
