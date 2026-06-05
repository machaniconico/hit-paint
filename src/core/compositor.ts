import type { BlendMode, Layer, PaintDocument } from '../types';

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
  // Track the alpha of the current clipping base per pixel for clipping masks.
  for (let li = 0; li < doc.layers.length; li++) {
    const layer = doc.layers[li];
    if (!layer.visible || !layer.pixels || layer.opacity <= 0) continue;
    if (layer.kind === 'group') continue;
    const src = layer.pixels;
    const blend = BLENDS[layer.blendMode] ?? BLENDS.normal;
    const layerAlpha = layer.opacity;
    // clipping mask source: alpha of the nearest lower non-clipping layer
    let clipMask: Uint8ClampedArray | null = null;
    if (layer.clipping) {
      for (let k = li - 1; k >= 0; k--) {
        const base = doc.layers[k];
        if (!base.clipping && base.pixels) { clipMask = base.pixels; break; }
      }
    }
    for (let i = 0; i < src.length; i += 4) {
      let sa = (src[i + 3] / 255) * layerAlpha;
      if (sa <= 0) continue;
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
  return new ImageData(out, width, height);
}

/** Flatten a document into a single opaque-over-white RGBA buffer. */
export function flattenToRGBA(doc: PaintDocument): Uint8ClampedArray {
  const img = composite(doc);
  return img.data;
}
