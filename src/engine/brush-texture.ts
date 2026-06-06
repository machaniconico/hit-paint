export interface TexturedTipOptions {
  size: number;
  hardness?: number;
  texture?: Float32Array;
  textureSize?: number;
}

export interface ScatterOptions {
  count: number;
  radius: number;
  tipSize: number;
  seed: number;
}

function normalizeSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return Math.floor(size);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeTextureSize(texture: Float32Array | undefined, textureSize: number | undefined): number {
  if (!texture) return 0;
  if (Number.isFinite(textureSize) && textureSize !== undefined && textureSize > 0) {
    return Math.floor(textureSize);
  }

  const inferred = Math.floor(Math.sqrt(texture.length));
  return inferred > 0 ? inferred : 0;
}

function sampleTiledTexture(texture: Float32Array, textureSize: number, x: number, y: number, size: number): number {
  const tx = Math.floor((x / size) * textureSize) % textureSize;
  const ty = Math.floor((y / size) * textureSize) % textureSize;
  return clamp01(texture[ty * textureSize + tx] ?? 0);
}

export function makeTexturedTip(opts: TexturedTipOptions): Float32Array {
  const size = normalizeSize(opts.size);
  const mask = new Float32Array(size * size);
  if (size <= 0) return mask;

  const hardness = clamp01(opts.hardness ?? 1);
  const falloffPower = 1 + (1 - hardness) * 4;
  const center = (size - 1) / 2;
  const radius = size / 2;
  const texture = opts.texture;
  const textureSize = normalizeTextureSize(texture, opts.textureSize);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center);
      const normalizedDistance = distance / radius;
      if (normalizedDistance >= 1) continue;

      let alpha = Math.pow(1 - normalizedDistance, falloffPower);
      if (texture && textureSize > 0) {
        alpha *= sampleTiledTexture(texture, textureSize, x, y, size);
      }

      mask[y * size + x] = clamp01(alpha);
    }
  }

  return mask;
}

function mixSeed(seed: number): number {
  let state = Number.isFinite(seed) ? seed | 0 : 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b);
  state ^= state >>> 16;
  return (state || 0x9e3779b9) >>> 0;
}

function createPrng(seed: number): () => number {
  let state = mixSeed(seed);

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function scatterStamps(opts: ScatterOptions): { dx: number; dy: number; scale: number }[] {
  const count = normalizeSize(opts.count);
  const radius = Number.isFinite(opts.radius) && opts.radius > 0 ? opts.radius : 0;
  const nextFloat = createPrng(opts.seed);
  const stamps: { dx: number; dy: number; scale: number }[] = [];

  for (let i = 0; i < count; i++) {
    let dx = 0;
    let dy = 0;

    for (let attempt = 0; attempt < 20; attempt++) {
      const candidateDx = (nextFloat() * 2 - 1) * radius;
      const candidateDy = (nextFloat() * 2 - 1) * radius;

      if (candidateDx * candidateDx + candidateDy * candidateDy <= radius * radius) {
        dx = candidateDx;
        dy = candidateDy;
        break;
      }
    }

    stamps.push({
      dx,
      dy,
      scale: 0.5 + 0.5 * nextFloat(),
    });
  }

  return stamps;
}
