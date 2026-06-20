/**
 * HIT Paint — shared type contracts.
 *
 * Every module (core, engine, tools, io, ui) imports from here. Keep this file
 * dependency-free so it can be the single source of truth for the data model.
 */

import type { TextLayerData } from '../text/text-layer';
import type { ShapeData } from '../vector/shape';
import type { VectorLayerData } from '../vector/vector-layer';

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

export type LayerKind = 'raster' | 'group' | 'adjustment';

/**
 * Non-destructive filter settings for an adjustment layer.
 * The filter is applied to the already-composited backdrop below the layer;
 * opts stores filter-specific numeric controls such as brightness/contrast,
 * hue/saturation, or levels input/output/gamma values.
 */
export interface AdjustmentSpec {
  type: 'brightness-contrast' | 'invert' | 'grayscale' | 'hue-saturation' | 'levels';
  opts?: Record<string, number>;
}

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
  /** RGBA pixels, length = width*height*4. Undefined for groups and adjustment layers. */
  pixels?: Uint8ClampedArray;
  /** これを持つ raster レイヤーは textData から pixels を再生成できる再編集テキストレイヤー。 */
  textData?: TextLayerData;
  /** これを持つ raster レイヤーは vectorData から pixels を再生成できる再編集ベクターレイヤー。 */
  vectorData?: VectorLayerData;
  /** これを持つ raster レイヤーは shapeData から pixels を再生成できる再編集シェイプレイヤー。 */
  shapeData?: ShapeData;
  /** Non-destructive filter applied by kind==='adjustment'. */
  adjustment?: AdjustmentSpec;
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
  /**
   * .sut 配布ブラシ由来の任意形状 tip(US-3804)。truthy のとき数式 dab の代わりに
   * この tip 形状をスタンプする。undefined/null なら従来通り。
   */
  tip?: import('../engine/tip-stamp').TipAlpha | null;
  /** 筆圧→サイズ倍率カーブ(.sut)。なければ素通り。 */
  pressureSizeCurve?: import('../io/sut-pressure').PressureCurve | null;
  /** 筆圧→flow 倍率カーブ(.sut)。なければ素通り。 */
  pressureFlowCurve?: import('../io/sut-pressure').PressureCurve | null;
  /** tip の基準回転(ラジアン)。 */
  tipAngle?: number;
  /** tip をストローク進行方向へ追従回転させる。 */
  tipFollowStroke?: boolean;
  /** tip 回転の角度ジッタ(ラジアン振幅)。 */
  tipAngleJitter?: number;
  /** tip 散布半径(px)。 */
  tipScatter?: number;
  /** 1打点あたりの散布スタンプ数。 */
  tipScatterDensity?: number;
  /**
   * カラーダイナミクス(US-4401/4404)。設定があるときのみ 1 打点ごとに前景色を
   * HSV 空間で決定論ジッタ + 前景/背景ブレンドする。undefined なら従来どおり
   * 単色コミット(バイト同一)。
   */
  colorDynamics?: import('../engine/brush-color-dynamics').ColorDynamicsConfig | null;
  /**
   * デュアルブラシ(US-4402/4404)。tip ブラシのαバッファを二次テクスチャで変調する。
   * undefined なら無変調(従来どおり)。secondary は行優先 0..1 の Float32Array。
   */
  dualBrush?: {
    secondary: Float32Array;
    secondaryWidth: number;
    secondaryHeight: number;
    mode: import('../engine/dual-brush').DualBlendMode;
    strength: number;
  } | null;
  /**
   * エアブラシ滞留ビルドアップ(US-4403/4404)。flow>0 のとき同一打点が重なるほど
   * 指定 ceiling へ向けて指数飽和で濃くなる。undefined なら従来どおり max 合成。
   */
  airbrushFlow?: number;
  /** エアブラシ蓄積の上限α(0..1)。airbrushFlow>0 のときのみ使用。 */
  airbrushCeiling?: number;
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
  | 'gradient'
  | 'pen'
  | 'text'
  | 'shape'
  | 'eyedropper'
  | 'liquify'
  | 'select-rect'
  | 'select-ellipse'
  | 'select-lasso'
  | 'magic-wand'
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
