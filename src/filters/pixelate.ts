export interface PixelateOptions {
  blockSize: number;
  mask?: Uint8ClampedArray | null;
}

function clamp255(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function rgbaIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function blendChannel(original: number, filtered: number, coverage: number): number {
  if (coverage <= 0) return original;
  if (coverage >= 1) return clamp255(filtered);
  return clamp255(original + (filtered - original) * coverage);
}

export function pixelate(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  opts: PixelateOptions,
): void {
  const blockSize = Math.floor(opts.blockSize);
  if (blockSize <= 1 || width <= 0 || height <= 0) return;

  const source = new Uint8ClampedArray(pixels);
  const mask = opts.mask;

  for (let blockY = 0; blockY < height; blockY += blockSize) {
    const endY = Math.min(height, blockY + blockSize);

    for (let blockX = 0; blockX < width; blockX += blockSize) {
      const endX = Math.min(width, blockX + blockSize);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let y = blockY; y < endY; y++) {
        for (let x = blockX; x < endX; x++) {
          const index = rgbaIndex(x, y, width);
          r += source[index];
          g += source[index + 1];
          b += source[index + 2];
          a += source[index + 3];
          count++;
        }
      }

      const averageR = r / count;
      const averageG = g / count;
      const averageB = b / count;
      const averageA = a / count;

      for (let y = blockY; y < endY; y++) {
        for (let x = blockX; x < endX; x++) {
          const pixelIndex = y * width + x;
          const coverage = mask ? mask[pixelIndex] / 255 : 1;
          if (coverage <= 0) continue;

          const index = pixelIndex * 4;
          pixels[index] = blendChannel(source[index], averageR, coverage);
          pixels[index + 1] = blendChannel(source[index + 1], averageG, coverage);
          pixels[index + 2] = blendChannel(source[index + 2], averageB, coverage);
          pixels[index + 3] = blendChannel(source[index + 3], averageA, coverage);
        }
      }
    }
  }
}
