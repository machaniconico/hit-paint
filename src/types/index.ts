/**
 * HIT Paint — shared type contracts.
 *
 * Every module (core, engine, tools, io, ui) imports from here. Keep this file
 * dependency-free so it can be the single source of truth for the data model.
 */

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/** Straight (non-premultiplied) 8-bit RGBA, channels 0-255. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Hue 0-360, saturation/value 0-1. */
export interface HSV {
  h: number;
  s: number;
  v: number;
}

// ---------------------------------------------------------------------------
// Blend modes (names align with PSD / CLIP conventions)
// ---------------------------------------------------------------------------

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'add'
  | 'subtract';

export const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'add', 'subtract',
];

// ---------------------------------------------------------------------------
// Layers & Document
// ---------------------------------------------------------------------------

export type LayerId = string;

export type LayerKind = 'raster' | 'group';

/**
 * A raster layer holds a full-document-sized RGBA pixel buffer.
 * (We keep layers document-sized for simplicity of compositing; offset is
 * reserved for future tiled storage.)
 */
export interface Layer {
  id: LayerId;
  name: string;
  kind: LayerKind;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  /** Clip to the layer directly below (CLIP/PSD "clipping mask"). */
  clipping: boolean;
  /** RGBA pixels, length = width*height*4. Undefined for groups. */
  pixels?: Uint8ClampedArray;
  /** 8-bit visibility mask, length = width*height (0 = hide, 255 = show). */
  mask?: Uint8ClampedArray;
  /** child layer ids, for kind==='group' */
  children?: LayerId[];
}

export interface Selection {
  /** 8-bit coverage mask, length = width*height (0 = unselected, 255 = full). */
  mask: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PaintDocument {
  id: string;
  name: string;
  width: number;
  height: number;
  /** dots per inch, for print sizing & format round-trip */
  dpi: number;
  /** flat ordered list; render order is bottom (index 0) to top */
  layers: Layer[];
  activeLayerId: LayerId | null;
  selection: Selection | null;
}

// ---------------------------------------------------------------------------
// Brush engine
// ---------------------------------------------------------------------------

export type BrushShape = 'round' | 'soft' | 'pixel';

export interface BrushSettings {
  shape: BrushShape;
  /** diameter in px at full pressure */
  size: number;
  /** 0..1 */
  opacity: number;
  /** 0..1, per-stamp flow */
  flow: number;
  /** 0..1, edge softness (0 = hard, 1 = very soft) */
  hardness: number;
  /** distance between stamps as a fraction of size, e.g. 0.1 */
  spacing: number;
  /** map pen pressure to size */
  pressureSize: boolean;
  /** map pen pressure to opacity */
  pressureOpacity: boolean;
}

export const DEFAULT_BRUSH: BrushSettings = {
  shape: 'soft',
  size: 24,
  opacity: 1,
  flow: 1,
  hardness: 0.8,
  spacing: 0.08,
  pressureSize: true,
  pressureOpacity: true,
};

/** A single sampled pointer event along a stroke. */
export interface PointerSample {
  /** document-space coordinates (px) */
  x: number;
  y: number;
  /** 0..1 */
  pressure: number;
  /** radians, optional pen tilt */
  tiltX?: number;
  tiltY?: number;
  /** ms timestamp (monotonic) */
  t: number;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export type ToolId =
  | 'brush'
  | 'eraser'
  | 'fill'
  | 'text'
  | 'eyedropper'
  | 'select-rect'
  | 'select-lasso'
  | 'move'
  | 'transform'
  | 'pan';

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

export interface ImportResult {
  doc: PaintDocument;
  /** non-fatal warnings surfaced to the user (e.g. unsupported features) */
  warnings: string[];
}

export interface ExportOptions {
  /** flatten all layers into one before export */
  flatten?: boolean;
}

/** Canvas viewport transform (screen <-> document mapping). */
export interface Viewport {
  /** pan offset in screen px */
  panX: number;
  panY: number;
  /** zoom factor, 1 = 100% */
  zoom: number;
  /** rotation in radians */
  rotation: number;
}

export const IDENTITY_VIEWPORT: Viewport = { panX: 0, panY: 0, zoom: 1, rotation: 0 };
