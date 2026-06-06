/**
 * HIT Paint — マジックワンド選択
 *
 * 基準ピクセルの RGBA と対象ピクセルの max-channel 絶対差が
 * tolerance 以下の画素を 255、それ以外を 0 のマスクとして返す。
 */

type MagicWandOptions = {
  tolerance: number;
  contiguous: boolean;
};

function pixelOffset(pixelIndex: number): number {
  return pixelIndex * 4;
}

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

function clampTolerance(tolerance: number): number {
  if (!Number.isFinite(tolerance)) return 0;
  return Math.max(0, Math.min(255, tolerance));
}

function matchesSeedColor(
  pixels: Uint8ClampedArray,
  pixelIndex: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
  tolerance: number,
): boolean {
  const i = pixelOffset(pixelIndex);
  return Math.max(
    Math.abs(pixels[i] - sr),
    Math.abs(pixels[i + 1] - sg),
    Math.abs(pixels[i + 2] - sb),
    Math.abs(pixels[i + 3] - sa),
  ) <= tolerance;
}

/**
 * 指定座標の色を基準に、色域選択マスクを生成する。
 *
 * @param pixels - RGBA バッファ (row-major, length = width * height * 4)
 * @param width - キャンバス幅
 * @param height - キャンバス高さ
 * @param x - 基準 X 座標
 * @param y - 基準 Y 座標
 * @param options - tolerance は 0..255、contiguous は 4 近傍連結のみ選択するか
 * @returns length = width * height の 0/255 選択マスク
 */
export function selectionMaskFromColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  options: MagicWandOptions,
): Uint8ClampedArray {
  const total = width > 0 && height > 0 ? width * height : 0;
  const mask = new Uint8ClampedArray(total);
  if (!inBounds(x, y, width, height)) return mask;

  const tolerance = clampTolerance(options.tolerance);
  const seedIndex = y * width + x;
  const seedOffset = pixelOffset(seedIndex);
  const sr = pixels[seedOffset];
  const sg = pixels[seedOffset + 1];
  const sb = pixels[seedOffset + 2];
  const sa = pixels[seedOffset + 3];

  if (!options.contiguous) {
    for (let i = 0; i < total; i++) {
      if (matchesSeedColor(pixels, i, sr, sg, sb, sa, tolerance)) {
        mask[i] = 255;
      }
    }
    return mask;
  }

  const visited = new Uint8Array(total);
  const stack: number[] = [seedIndex];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited[current]) continue;
    visited[current] = 1;

    if (!matchesSeedColor(pixels, current, sr, sg, sb, sa, tolerance)) continue;

    mask[current] = 255;

    const cx = current % width;
    const cy = Math.floor(current / width);
    if (cx > 0) stack.push(current - 1);
    if (cx < width - 1) stack.push(current + 1);
    if (cy > 0) stack.push(current - width);
    if (cy < height - 1) stack.push(current + width);
  }

  return mask;
}
