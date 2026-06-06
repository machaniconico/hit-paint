interface TileFillOptions {
  offsetX?: number;
  offsetY?: number;
  mask?: Uint8ClampedArray | null;
}

function validSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function wholePx(v: number): number {
  return Number.isFinite(v) ? Math.trunc(v) : 0;
}

function wrap(v: number, size: number): number {
  const r = v % size;
  return r < 0 ? r + size : r;
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function sourceOver(
  dst: Uint8ClampedArray,
  di: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
  coverage: number,
): void {
  const srcA = clamp01((sa / 255) * coverage);
  if (srcA <= 0) return;

  const dstA = dst[di + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);

  if (outA <= 0) {
    dst[di] = 0;
    dst[di + 1] = 0;
    dst[di + 2] = 0;
    dst[di + 3] = 0;
    return;
  }

  const dstScale = dstA * (1 - srcA);
  dst[di] = (sr * srcA + dst[di] * dstScale) / outA;
  dst[di + 1] = (sg * srcA + dst[di + 1] * dstScale) / outA;
  dst[di + 2] = (sb * srcA + dst[di + 2] * dstScale) / outA;
  dst[di + 3] = outA * 255;
}

function blendComponents(
  ar: number,
  ag: number,
  ab: number,
  aa: number,
  br: number,
  bg: number,
  bb: number,
  ba: number,
  t: number,
): [number, number, number, number] {
  const ca = 1 - t;
  const cb = t;
  const aA = aa / 255;
  const bA = ba / 255;
  const outA = aA * ca + bA * cb;

  if (outA <= 0) return [0, 0, 0, 0];

  return [
    (ar * aA * ca + br * bA * cb) / outA,
    (ag * aA * ca + bg * bA * cb) / outA,
    (ab * aA * ca + bb * bA * cb) / outA,
    outA * 255,
  ];
}

function blendPixels(
  src: Uint8ClampedArray,
  ai: number,
  bi: number,
  t: number,
): [number, number, number, number] {
  return blendComponents(
    src[ai],
    src[ai + 1],
    src[ai + 2],
    src[ai + 3],
    src[bi],
    src[bi + 1],
    src[bi + 2],
    src[bi + 3],
    t,
  );
}

function writeBlended(
  out: Uint8ClampedArray,
  di: number,
  color: [number, number, number, number],
  t: number,
): void {
  if (t <= 0) return;

  const blended = blendComponents(
    out[di],
    out[di + 1],
    out[di + 2],
    out[di + 3],
    color[0],
    color[1],
    color[2],
    color[3],
    t,
  );

  out[di] = blended[0];
  out[di + 1] = blended[1];
  out[di + 2] = blended[2];
  out[di + 3] = blended[3];
}

export function tileFill(
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number,
  tile: Uint8ClampedArray,
  tileW: number,
  tileH: number,
  opts: TileFillOptions = {},
): void {
  if (!validSize(dstW, dstH) || !validSize(tileW, tileH)) return;

  const w = wholePx(dstW);
  const h = wholePx(dstH);
  const tw = wholePx(tileW);
  const th = wholePx(tileH);
  if (w <= 0 || h <= 0 || tw <= 0 || th <= 0) return;

  const total = Math.min(w * h, Math.floor(dst.length / 4));
  const tileTotal = Math.floor(tile.length / 4);
  if (total <= 0 || tileTotal <= 0) return;

  const offsetX = wholePx(opts.offsetX ?? 0);
  const offsetY = wholePx(opts.offsetY ?? 0);

  for (let pi = 0; pi < total; pi++) {
    const coverage = opts.mask ? (opts.mask[pi] ?? 0) / 255 : 1;
    if (coverage <= 0) continue;

    const x = pi % w;
    const y = Math.floor(pi / w);
    const tx = wrap(x - offsetX, tw);
    const ty = wrap(y - offsetY, th);
    const ti = ty * tw + tx;
    if (ti >= tileTotal) continue;

    const si = ti * 4;
    sourceOver(dst, pi * 4, tile[si], tile[si + 1], tile[si + 2], tile[si + 3], coverage);
  }
}

export function makeSeamless(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  blend: number,
): Uint8ClampedArray {
  if (!validSize(w, h)) return new Uint8ClampedArray(0);

  const width = wholePx(w);
  const height = wholePx(h);
  if (width <= 0 || height <= 0) return new Uint8ClampedArray(0);

  const out = new Uint8ClampedArray(width * height * 4);
  out.set(px.subarray(0, out.length));

  const bandX = Math.min(wholePx(blend), Math.floor(width / 2));
  const bandY = Math.min(wholePx(blend), Math.floor(height / 2));
  if (bandX <= 0 && bandY <= 0) return out;

  const src = new Uint8ClampedArray(width * height * 4);
  src.set(px.subarray(0, src.length));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;

      if (bandX > 0) {
        if (x < bandX) {
          const oppositeX = width - bandX + x;
          const t = (bandX - x) / (bandX + 1);
          writeBlended(out, di, blendPixels(src, di, (y * width + oppositeX) * 4, 0.5), t);
        } else if (x >= width - bandX) {
          const oppositeX = x - (width - bandX);
          const t = (x - (width - bandX) + 1) / (bandX + 1);
          writeBlended(out, di, blendPixels(src, di, (y * width + oppositeX) * 4, 0.5), t);
        }
      }

      if (bandY > 0) {
        if (y < bandY) {
          const oppositeY = height - bandY + y;
          const t = (bandY - y) / (bandY + 1);
          writeBlended(out, di, blendPixels(src, di, (oppositeY * width + x) * 4, 0.5), t);
        } else if (y >= height - bandY) {
          const oppositeY = y - (height - bandY);
          const t = (y - (height - bandY) + 1) / (bandY + 1);
          writeBlended(out, di, blendPixels(src, di, (oppositeY * width + x) * 4, 0.5), t);
        }
      }
    }
  }

  return out;
}
