type Mask = Uint8ClampedArray | null | undefined;

export interface ChannelMixerOptions {
  red: { r: number; g: number; b: number; constant?: number };
  green: { r: number; g: number; b: number; constant?: number };
  blue: { r: number; g: number; b: number; constant?: number };
  monochrome?: boolean;
  mask?: Uint8ClampedArray | null;
}

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function maskCoverage(mask: Mask, pixel: number): number {
  return mask ? (mask[pixel] ?? 0) / 255 : 1;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

function mixChannel(
  r: number,
  g: number,
  b: number,
  coefficients: { r: number; g: number; b: number; constant?: number },
): number {
  return clamp255(r * coefficients.r + g * coefficients.g + b * coefficients.b + (coefficients.constant ?? 0));
}

export function channelMixer(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  opts: ChannelMixerOptions,
): void {
  if (w <= 0 || h <= 0 || px.length === 0) return;

  const totalPixels = Math.min(w * h, Math.floor(px.length / 4));

  for (let pixel = 0; pixel < totalPixels; pixel++) {
    const coverage = maskCoverage(opts.mask, pixel);
    if (coverage <= 0) continue;

    const index = pixel * 4;
    const r = px[index];
    const g = px[index + 1];
    const b = px[index + 2];

    if (opts.monochrome) {
      const gray = mixChannel(r, g, b, opts.red);
      px[index] = blendChannel(r, gray, coverage);
      px[index + 1] = blendChannel(g, gray, coverage);
      px[index + 2] = blendChannel(b, gray, coverage);
      continue;
    }

    const mixedR = mixChannel(r, g, b, opts.red);
    const mixedG = mixChannel(r, g, b, opts.green);
    const mixedB = mixChannel(r, g, b, opts.blue);

    px[index] = blendChannel(r, mixedR, coverage);
    px[index + 1] = blendChannel(g, mixedG, coverage);
    px[index + 2] = blendChannel(b, mixedB, coverage);
  }
}
