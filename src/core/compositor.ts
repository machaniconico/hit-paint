import {
  adjustBrightnessContrast,
  adjustHueSaturation,
  adjustLevels,
  grayscale,
  invertColors,
} from '../filters';
import type { AdjustmentSpec, BlendMode, Layer, LayerId, PaintDocument } from '../types';

/** Per-channel blend function on normalized 0..1 backdrop(b) and source(s). */
type BlendFn = (b: number, s: number) => number;

const BLENDS: Record<BlendMode, BlendFn> = {
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

/**
 * Composite all visible layers of `doc` into a fresh ImageData (straight alpha).
 * Compositing order is bottom (layers[0]) to top. Clipping layers are masked by
 * the alpha of the first non-clipping layer beneath them.
 */
export function composite(doc: PaintDocument): ImageData {
  const { width, height } = doc;
  const out = new Uint8ClampedArray(width * height * 4); // starts transparent
  renderLayers(doc, doc.layers, out, topLevelChildIds(doc));
  return new ImageData(out, width, height);
}

/** Flatten a document into a single opaque-over-white RGBA buffer. */
export function flattenToRGBA(doc: PaintDocument): Uint8ClampedArray {
  const img = composite(doc);
  return img.data;
}

function topLevelChildIds(doc: PaintDocument): Set<LayerId> {
  const ids = new Set<LayerId>();
  for (const layer of doc.layers) {
    if (layer.kind !== 'group' || !layer.children) continue;
    for (const id of layer.children) ids.add(id);
  }
  return ids;
}

function renderLayers(
  doc: PaintDocument,
  layers: Layer[],
  out: Uint8ClampedArray,
  skipIds?: Set<LayerId>,
): void {
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    if (skipIds?.has(layer.id)) continue;
    if (!layer.visible || layer.opacity <= 0) continue;

    if (layer.kind === 'group') {
      const groupBuffer = renderGroup(doc, layer);
      compositeBuffer(out, groupBuffer, layer.opacity, layer.blendMode, layer.mask);
      continue;
    }

    if (layer.kind === 'adjustment') {
      applyAdjustmentLayer(out, doc.width, doc.height, layer);
      continue;
    }

    if (!layer.pixels) continue;
    compositeBuffer(
      out,
      layer.pixels,
      layer.opacity,
      layer.blendMode,
      layer.mask,
      layer.clipping ? findClipMask(layers, li) : null,
    );
  }
}

function renderGroup(doc: PaintDocument, group: Layer): Uint8ClampedArray {
  const out = new Uint8ClampedArray(doc.width * doc.height * 4);
  if (!group.children || group.children.length === 0) return out;

  const byId = new Map<LayerId, Layer>();
  for (const layer of doc.layers) byId.set(layer.id, layer);

  const children: Layer[] = [];
  for (const id of group.children) {
    const child = byId.get(id);
    if (child) children.push(child);
  }
  renderLayers(doc, children, out);
  return out;
}

function applyAdjustmentLayer(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  layer: Layer,
): void {
  if (!layer.adjustment) return;

  const filtered = new Uint8ClampedArray(out);
  applyAdjustmentFilter(filtered, width, height, layer.adjustment);
  blendAdjustment(out, filtered, layer.opacity, layer.mask);
}

function applyAdjustmentFilter(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  adjustment: AdjustmentSpec,
): void {
  const opts = adjustment.opts ?? {};
  switch (adjustment.type) {
    case 'brightness-contrast':
      adjustBrightnessContrast(pixels, width, height, {
        brightness: opts.brightness ?? 0,
        contrast: opts.contrast ?? 0,
      });
      break;
    case 'invert':
      invertColors(pixels, width, height);
      break;
    case 'grayscale':
      grayscale(pixels, width, height);
      break;
    case 'hue-saturation':
      adjustHueSaturation(pixels, width, height, {
        hue: opts.hue ?? 0,
        saturation: opts.saturation ?? 0,
      });
      break;
    case 'levels':
      adjustLevels(pixels, width, height, {
        inBlack: opts.inBlack ?? 0,
        inWhite: opts.inWhite ?? 255,
        gamma: opts.gamma ?? 1,
        outBlack: opts.outBlack ?? 0,
        outWhite: opts.outWhite ?? 255,
      });
      break;
  }
}

function blendAdjustment(
  out: Uint8ClampedArray,
  filtered: Uint8ClampedArray,
  opacity: number,
  mask?: Uint8ClampedArray,
): void {
  for (let i = 0, p = 0; i < out.length; i += 4, p++) {
    const coverage = opacity * (mask ? mask[p] / 255 : 1);
    if (coverage <= 0) continue;

    for (let channel = 0; channel < 4; channel++) {
      const original = out[i + channel];
      out[i + channel] = original + (filtered[i + channel] - original) * coverage;
    }
  }
}

function findClipMask(layers: Layer[], layerIndex: number): Uint8ClampedArray | null {
  for (let k = layerIndex - 1; k >= 0; k--) {
    const base = layers[k];
    if (!base.clipping && base.pixels) return base.pixels;
  }
  return null;
}

function compositeBuffer(
  out: Uint8ClampedArray,
  src: Uint8ClampedArray,
  opacity: number,
  blendMode: BlendMode,
  mask?: Uint8ClampedArray,
  clipMask?: Uint8ClampedArray | null,
): void {
  const blend = BLENDS[blendMode] ?? BLENDS.normal;
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    let sa = (src[i + 3] / 255) * opacity;
    if (sa <= 0) continue;
    if (mask) sa *= mask[p] / 255;
    if (clipMask) sa *= clipMask[i + 3] / 255;
    if (sa <= 0) continue;
    const da = out[i + 3] / 255;
    const sr = src[i] / 255, sg = src[i + 1] / 255, sb = src[i + 2] / 255;
    const dr = out[i] / 255, dg = out[i + 1] / 255, db = out[i + 2] / 255;
    // Blended source color (only meaningful where backdrop is opaque).
    const br = da > 0 ? blend(dr, sr) : sr;
    const bg2 = da > 0 ? blend(dg, sg) : sg;
    const bb = da > 0 ? blend(db, sb) : sb;
    // Mix blended vs raw source by backdrop alpha (per W3C compositing).
    const mr = (1 - da) * sr + da * br;
    const mg = (1 - da) * sg + da * bg2;
    const mb = (1 - da) * sb + da * bb;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) continue;
    out[i] = ((mr * sa + dr * da * (1 - sa)) / oa) * 255;
    out[i + 1] = ((mg * sa + dg * da * (1 - sa)) / oa) * 255;
    out[i + 2] = ((mb * sa + db * da * (1 - sa)) / oa) * 255;
    out[i + 3] = oa * 255;
  }
}
