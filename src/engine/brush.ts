import type { BrushSettings, PointerSample, RGBA } from '../types';

/**
 * Stamp coverage for a dab at distance ratio d (0 = center, 1 = edge).
 * hardness 0 -> very soft gaussian-ish falloff, 1 -> hard edge.
 */
function dabFalloff(d: number, hardness: number, pixel: boolean): number {
  if (d >= 1) return 0;
  if (pixel) return 1; // aliased hard square/round handled by caller
  const inner = hardness; // fraction of radius that is fully opaque
  if (d <= inner) return 1;
  const t = (d - inner) / (1 - inner);
  // smoothstep falloff
  return 1 - (t * t * (3 - 2 * t));
}

/**
 * Per-stroke painting engine. Accumulates dab coverage into a float buffer
 * (max-combine within a stroke avoids overlapping-dab darkening), then the
 * store composites/commits using brush opacity.
 */
export class StrokeEngine {
  readonly width: number;
  readonly height: number;
  readonly coverage: Float32Array; // 0..1 per pixel
  /** dirty bounding box for efficient overlay updates */
  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;

  private brush: BrushSettings;
  private erase: boolean;
  private last: PointerSample | null = null;
  private residual = 0;

  constructor(width: number, height: number, brush: BrushSettings, erase = false) {
    this.width = width;
    this.height = height;
    this.brush = brush;
    this.erase = erase;
    this.coverage = new Float32Array(width * height);
  }

  private markDirty(x: number, y: number, r: number) {
    this.minX = Math.min(this.minX, Math.floor(x - r));
    this.minY = Math.min(this.minY, Math.floor(y - r));
    this.maxX = Math.max(this.maxX, Math.ceil(x + r));
    this.maxY = Math.max(this.maxY, Math.ceil(y + r));
  }

  private stamp(x: number, y: number, pressure: number) {
    const b = this.brush;
    const size = (b.pressureSize ? Math.max(0.05, pressure) : 1) * b.size;
    const radius = size / 2;
    if (radius <= 0) return;
    const flow = b.flow * (b.pressureOpacity ? Math.max(0.05, pressure) : 1);
    const pixel = b.shape === 'pixel';
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(x + radius));
    const y0 = Math.max(0, Math.floor(y - radius));
    const y1 = Math.min(this.height - 1, Math.ceil(y + radius));
    const hardness = b.shape === 'round' ? 0.95 : b.hardness;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = (px + 0.5 - x) / radius;
        const dy = (py + 0.5 - y) / radius;
        const d = Math.sqrt(dx * dx + dy * dy);
        const a = dabFalloff(d, hardness, pixel) * flow;
        if (a <= 0) continue;
        const idx = py * this.width + px;
        // max-combine within the stroke
        if (a > this.coverage[idx]) this.coverage[idx] = a;
      }
    }
    this.markDirty(x, y, radius);
  }

  /** Feed one pointer sample; emits spacing-interpolated dabs since the last. */
  addSample(s: PointerSample) {
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
    // `residual` is the distance already consumed past the previous segment.
    let traveled = -this.residual;
    while (traveled + step <= dist) {
      traveled += step;
      const t = traveled / dist;
      const px = prev.x + dx * t;
      const py = prev.y + dy * t;
      const pr = prev.pressure + (s.pressure - prev.pressure) * t;
      this.stamp(px, py, pr);
    }
    // leftover distance toward the next dab, carried into the next segment
    this.residual = dist - traveled;
    this.last = s;
  }

  isErase(): boolean { return this.erase; }

  /** Commit the accumulated coverage into a target RGBA layer buffer. */
  commit(target: Uint8ClampedArray, color: RGBA, selection?: Uint8ClampedArray | null) {
    const opacity = this.brush.opacity;
    for (let i = 0; i < this.coverage.length; i++) {
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
