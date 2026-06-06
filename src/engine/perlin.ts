export interface NoiseFieldOptions {
  width?: number;
  height?: number;
  seed?: number;
  scale?: number;
  octaves?: number;
  persistence?: number;
}

const DEFAULT_SEED = 1;
const DEFAULT_SCALE = 1;
const DEFAULT_OCTAVES = 6;
const DEFAULT_PERSISTENCE = 0.5;

function normalizeSeed(seed: number | undefined): number {
  return (seed ?? DEFAULT_SEED) >>> 0;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash2D(x: number, y: number, seed: number): number {
  let h = normalizeSeed(seed);
  h ^= Math.imul(x | 0, 0x9e3779b1);
  h ^= Math.imul(y | 0, 0x85ebca77);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function hashUnit(x: number, y: number, seed: number): number {
  return 0.25 + (hash2D(x, y, seed) / 0x100000000) * 0.5;
}

function clampNoise(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1 - Number.EPSILON;
  return value;
}

function normalizeOctaves(octaves: number | undefined): number {
  if (!Number.isFinite(octaves) || octaves === undefined || octaves <= 0) return DEFAULT_OCTAVES;
  return Math.max(1, Math.floor(octaves));
}

function normalizePersistence(persistence: number | undefined): number {
  if (!Number.isFinite(persistence) || persistence === undefined) return DEFAULT_PERSISTENCE;
  if (persistence <= 0) return 0;
  return persistence;
}

function normalizeScale(scale: number | undefined): number {
  if (!Number.isFinite(scale) || scale === undefined || scale <= 0) return DEFAULT_SCALE;
  return scale;
}

function normalizeSize(size: number | undefined): number {
  if (!Number.isFinite(size) || size === undefined || size <= 0) return 0;
  return Math.floor(size);
}

function noiseByte(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 255;
  return Math.round(value * 255);
}

export function valueNoise2D(x: number, y: number, seed = DEFAULT_SEED): number {
  const sx = Number.isFinite(x) ? x : 0;
  const sy = Number.isFinite(y) ? y : 0;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = smoothstep(sx - x0);
  const ty = smoothstep(sy - y0);

  const n00 = hashUnit(x0, y0, seed);
  const n10 = hashUnit(x0 + 1, y0, seed);
  const n01 = hashUnit(x0, y0 + 1, seed);
  const n11 = hashUnit(x0 + 1, y0 + 1, seed);

  const nx0 = lerp(n00, n10, tx);
  const nx1 = lerp(n01, n11, tx);
  return clampNoise(lerp(nx0, nx1, ty));
}

export function fbm2D(
  x: number,
  y: number,
  seed = DEFAULT_SEED,
  octaves = DEFAULT_OCTAVES,
  persistence = DEFAULT_PERSISTENCE,
): number {
  const count = normalizeOctaves(octaves);
  const gain = normalizePersistence(persistence);
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let amplitudeSum = 0;

  for (let octave = 0; octave < count; octave++) {
    const octaveSeed = (normalizeSeed(seed) + Math.imul(octave, 0x9e3779b9)) >>> 0;
    total += valueNoise2D(x * frequency, y * frequency, octaveSeed) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= gain;
    frequency *= 2;
  }

  if (amplitudeSum <= 0) return 0;
  return clampNoise(total / amplitudeSum);
}

export function generateNoiseField(width: number, height: number, options?: NoiseFieldOptions): Float32Array;
export function generateNoiseField(options: NoiseFieldOptions & { width: number; height: number }): Float32Array;
export function generateNoiseField(
  widthOrOptions: number | (NoiseFieldOptions & { width: number; height: number }),
  height?: number,
  options: NoiseFieldOptions = {},
): Float32Array {
  const opts = typeof widthOrOptions === 'number' ? options : widthOrOptions;
  const width = normalizeSize(typeof widthOrOptions === 'number' ? widthOrOptions : widthOrOptions.width);
  const resolvedHeight = normalizeSize(typeof widthOrOptions === 'number' ? height : widthOrOptions.height);
  const field = new Float32Array(width * resolvedHeight);
  const scale = normalizeScale(opts.scale);
  const seed = normalizeSeed(opts.seed);
  const octaves = normalizeOctaves(opts.octaves);
  const persistence = normalizePersistence(opts.persistence);

  if (width <= 0 || resolvedHeight <= 0) return field;

  for (let py = 0; py < resolvedHeight; py++) {
    for (let px = 0; px < width; px++) {
      const x = px / (width * scale);
      const y = py / (resolvedHeight * scale);
      field[py * width + px] = fbm2D(x, y, seed, octaves, persistence);
    }
  }

  return field;
}

export function noiseToGrayscale(field: ArrayLike<number>, width: number, height: number): Uint8ClampedArray {
  const outputWidth = normalizeSize(width);
  const outputHeight = normalizeSize(height);
  const pixels = new Uint8ClampedArray(outputWidth * outputHeight * 4);

  for (let i = 0; i < outputWidth * outputHeight; i++) {
    const gray = noiseByte(field[i] ?? 0);
    const offset = i * 4;
    pixels[offset] = gray;
    pixels[offset + 1] = gray;
    pixels[offset + 2] = gray;
    pixels[offset + 3] = 255;
  }

  return pixels;
}
