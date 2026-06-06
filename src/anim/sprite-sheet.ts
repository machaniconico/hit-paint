export interface SpriteFrame {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface SpriteSheetResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  cols: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
}

function normalizeSize(size: number): number {
  return Number.isFinite(size) ? Math.max(0, Math.trunc(size)) : 0;
}

function normalizeCols(cols: number | undefined, frameCount: number): number {
  if (cols === undefined) return Math.ceil(Math.sqrt(frameCount));
  return Number.isFinite(cols) ? Math.max(1, Math.trunc(cols)) : 1;
}

export function composeSpriteSheet(frames: SpriteFrame[], cols?: number): SpriteSheetResult {
  if (frames.length <= 0) {
    return {
      pixels: new Uint8ClampedArray(0),
      width: 0,
      height: 0,
      cols: 0,
      rows: 0,
      frameWidth: 0,
      frameHeight: 0,
    };
  }

  const frameWidth = frames.reduce((max, frame) => Math.max(max, normalizeSize(frame.width)), 0);
  const frameHeight = frames.reduce((max, frame) => Math.max(max, normalizeSize(frame.height)), 0);
  const sheetCols = normalizeCols(cols, frames.length);
  const rows = Math.ceil(frames.length / sheetCols);
  const width = sheetCols * frameWidth;
  const height = rows * frameHeight;
  const pixels = new Uint8ClampedArray(width * height * 4);

  frames.forEach((frame, frameIndex) => {
    const sourceWidth = normalizeSize(frame.width);
    const sourceHeight = normalizeSize(frame.height);
    const cellX = frameIndex % sheetCols;
    const cellY = Math.floor(frameIndex / sheetCols);
    const offsetX = cellX * frameWidth;
    const offsetY = cellY * frameHeight;

    for (let y = 0; y < sourceHeight; y++) {
      for (let x = 0; x < sourceWidth; x++) {
        const source = (y * sourceWidth + x) * 4;
        const dest = ((offsetY + y) * width + offsetX + x) * 4;
        pixels[dest] = frame.pixels[source];
        pixels[dest + 1] = frame.pixels[source + 1];
        pixels[dest + 2] = frame.pixels[source + 2];
        pixels[dest + 3] = frame.pixels[source + 3];
      }
    }
  });

  return {
    pixels,
    width,
    height,
    cols: sheetCols,
    rows,
    frameWidth,
    frameHeight,
  };
}
