export type ResampleMode = 'nearest' | 'bilinear';

function rgbaIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function sourceCoord(dstCoord: number, srcSize: number, dstSize: number): number {
  return ((dstCoord + 0.5) * srcSize) / dstSize - 0.5;
}

function copyNearest(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): void {
  for (let y = 0; y < dstH; y++) {
    const srcY = clamp(Math.round(sourceCoord(y, srcH, dstH)), 0, srcH - 1);

    for (let x = 0; x < dstW; x++) {
      const srcX = clamp(Math.round(sourceCoord(x, srcW, dstW)), 0, srcW - 1);
      const srcIndex = rgbaIndex(srcX, srcY, srcW);
      const dstIndex = rgbaIndex(x, y, dstW);

      target[dstIndex] = source[srcIndex];
      target[dstIndex + 1] = source[srcIndex + 1];
      target[dstIndex + 2] = source[srcIndex + 2];
      target[dstIndex + 3] = source[srcIndex + 3];
    }
  }
}

function copyBilinear(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): void {
  for (let y = 0; y < dstH; y++) {
    const srcY = clamp(sourceCoord(y, srcH, dstH), 0, srcH - 1);
    const y0 = Math.floor(srcY);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const yWeight = srcY - y0;

    for (let x = 0; x < dstW; x++) {
      const srcX = clamp(sourceCoord(x, srcW, dstW), 0, srcW - 1);
      const x0 = Math.floor(srcX);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const xWeight = srcX - x0;

      const topLeft = rgbaIndex(x0, y0, srcW);
      const topRight = rgbaIndex(x1, y0, srcW);
      const bottomLeft = rgbaIndex(x0, y1, srcW);
      const bottomRight = rgbaIndex(x1, y1, srcW);
      const dstIndex = rgbaIndex(x, y, dstW);

      for (let channel = 0; channel < 4; channel++) {
        const top = source[topLeft + channel] * (1 - xWeight)
          + source[topRight + channel] * xWeight;
        const bottom = source[bottomLeft + channel] * (1 - xWeight)
          + source[bottomRight + channel] * xWeight;

        target[dstIndex + channel] = Math.round(top * (1 - yWeight) + bottom * yWeight);
      }
    }
  }
}

export function resampleImage(
  px: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  mode: ResampleMode,
): Uint8ClampedArray {
  const sourceWidth = Math.floor(srcW);
  const sourceHeight = Math.floor(srcH);
  const targetWidth = Math.floor(dstW);
  const targetHeight = Math.floor(dstH);

  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return new Uint8ClampedArray(0);
  }

  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  if (mode === 'nearest') {
    copyNearest(px, out, sourceWidth, sourceHeight, targetWidth, targetHeight);
  } else {
    copyBilinear(px, out, sourceWidth, sourceHeight, targetWidth, targetHeight);
  }

  return out;
}
