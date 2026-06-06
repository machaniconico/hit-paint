/**
 * HIT Paint - layer geometry transforms
 *
 * Pure RGBA buffer transforms for straight-alpha, row-major pixels.
 * Input buffers are never modified.
 */

export type RotatedLayerPixels = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

function pixelIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function copyPixel(
  source: Uint8ClampedArray,
  sourceIndex: number,
  target: Uint8ClampedArray,
  targetIndex: number,
): void {
  target[targetIndex] = source[sourceIndex];
  target[targetIndex + 1] = source[sourceIndex + 1];
  target[targetIndex + 2] = source[sourceIndex + 2];
  target[targetIndex + 3] = source[sourceIndex + 3];
}

export function flipHorizontal(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      copyPixel(
        pixels,
        pixelIndex(x, y, width),
        out,
        pixelIndex(width - 1 - x, y, width),
      );
    }
  }

  return out;
}

export function flipVertical(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      copyPixel(
        pixels,
        pixelIndex(x, y, width),
        out,
        pixelIndex(x, height - 1 - y, width),
      );
    }
  }

  return out;
}

export function rotate90CW(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): RotatedLayerPixels {
  const outWidth = height;
  const outHeight = width;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      copyPixel(
        pixels,
        pixelIndex(x, y, width),
        out,
        pixelIndex(height - 1 - y, x, outWidth),
      );
    }
  }

  return { pixels: out, width: outWidth, height: outHeight };
}

export function rotate90CCW(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): RotatedLayerPixels {
  const outWidth = height;
  const outHeight = width;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      copyPixel(
        pixels,
        pixelIndex(x, y, width),
        out,
        pixelIndex(y, width - 1 - x, outWidth),
      );
    }
  }

  return { pixels: out, width: outWidth, height: outHeight };
}

export function rotate180(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): RotatedLayerPixels {
  const out = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      copyPixel(
        pixels,
        pixelIndex(x, y, width),
        out,
        pixelIndex(width - 1 - x, height - 1 - y, width),
      );
    }
  }

  return { pixels: out, width, height };
}
