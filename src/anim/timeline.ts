import type { Layer, RGBA } from '../types';

export interface Frame {
  id: string;
  layers: Layer[];
  durationMs: number;
}

export interface Timeline {
  frames: Frame[];
  currentIndex: number;
  fps: number;
}

export interface OnionSkinOptions {
  prevOpacity?: number;
  nextOpacity?: number;
  prevTint?: RGBA;
  nextTint?: RGBA;
}

let frameCounter = 0;

function nextFrameId(): string {
  frameCounter += 1;
  return `frame_${frameCounter}`;
}

function normalizeFps(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? fps : 12;
}

function defaultDurationMs(fps: number): number {
  return Math.round(1000 / normalizeFps(fps));
}

function emptyFrame(fps: number): Frame {
  return {
    id: nextFrameId(),
    layers: [],
    durationMs: defaultDurationMs(fps),
  };
}

function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), max));
}

function clampInsertIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

function clampOpacity(opacity: number | undefined, fallback: number): number {
  const value = opacity ?? fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(value, 1));
}

function framesOrDefault(tl: Timeline): Frame[] {
  return tl.frames.length > 0 ? tl.frames : [emptyFrame(tl.fps)];
}

export function createTimeline(fps = 12): Timeline {
  const normalizedFps = normalizeFps(fps);
  return {
    frames: [emptyFrame(normalizedFps)],
    currentIndex: 0,
    fps: normalizedFps,
  };
}

export function addFrame(tl: Timeline, frame: Frame): Timeline {
  const frames = framesOrDefault(tl);
  return {
    ...tl,
    frames: [...frames, frame],
    currentIndex: clampIndex(tl.currentIndex, frames.length - 1),
  };
}

export function insertFrame(tl: Timeline, index: number, frame: Frame): Timeline {
  const frames = framesOrDefault(tl);
  const insertAt = clampInsertIndex(index, frames.length);
  const currentIndex = clampIndex(tl.currentIndex, frames.length - 1);
  return {
    ...tl,
    frames: [...frames.slice(0, insertAt), frame, ...frames.slice(insertAt)],
    currentIndex: insertAt <= currentIndex ? currentIndex + 1 : currentIndex,
  };
}

export function removeFrame(tl: Timeline, index: number): Timeline {
  const frames = framesOrDefault(tl);
  if (frames.length <= 1) {
    return {
      ...tl,
      frames: [...frames],
      currentIndex: 0,
    };
  }

  const removeAt = clampIndex(index, frames.length - 1);
  const currentIndex = clampIndex(tl.currentIndex, frames.length - 1);
  const nextFrames = frames.filter((_, frameIndex) => frameIndex !== removeAt);
  const nextCurrentIndex = removeAt < currentIndex
    ? currentIndex - 1
    : Math.min(currentIndex, nextFrames.length - 1);

  return {
    ...tl,
    frames: nextFrames,
    currentIndex: nextCurrentIndex,
  };
}

export function duplicateFrame(tl: Timeline, index: number): Timeline {
  const frames = framesOrDefault(tl);
  const duplicateFrom = clampIndex(index, frames.length - 1);
  const source = frames[duplicateFrom];
  const duplicate: Frame = {
    ...source,
    id: nextFrameId(),
    layers: [...source.layers],
  };

  return insertFrame(tl, duplicateFrom + 1, duplicate);
}

export function reorderFrame(tl: Timeline, from: number, to: number): Timeline {
  const frames = framesOrDefault(tl);
  const fromIndex = clampIndex(from, frames.length - 1);
  const selectedFrame = frames[clampIndex(tl.currentIndex, frames.length - 1)];
  const nextFrames = [...frames];
  const [frame] = nextFrames.splice(fromIndex, 1);
  nextFrames.splice(clampInsertIndex(to, nextFrames.length), 0, frame);

  return {
    ...tl,
    frames: nextFrames,
    currentIndex: nextFrames.indexOf(selectedFrame),
  };
}

export function setCurrentFrame(tl: Timeline, index: number): Timeline {
  const frames = framesOrDefault(tl);
  return {
    ...tl,
    frames: [...frames],
    currentIndex: clampIndex(index, frames.length - 1),
  };
}

function compositeSourceOver(
  dest: Float64Array,
  source: Uint8ClampedArray,
  pixelCount: number,
  opacity: number,
  tint?: RGBA,
): void {
  const tintAlpha = tint ? Math.max(0, Math.min(tint.a, 255)) / 255 : 1;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const sourceAlpha = (source[offset + 3] / 255) * opacity * tintAlpha;
    if (sourceAlpha <= 0) continue;

    const destAlpha = dest[offset + 3];
    const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
    const sourceRed = tint ? tint.r : source[offset];
    const sourceGreen = tint ? tint.g : source[offset + 1];
    const sourceBlue = tint ? tint.b : source[offset + 2];

    dest[offset] = outAlpha === 0
      ? 0
      : (sourceRed * sourceAlpha + dest[offset] * destAlpha * (1 - sourceAlpha)) / outAlpha;
    dest[offset + 1] = outAlpha === 0
      ? 0
      : (sourceGreen * sourceAlpha + dest[offset + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha;
    dest[offset + 2] = outAlpha === 0
      ? 0
      : (sourceBlue * sourceAlpha + dest[offset + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha;
    dest[offset + 3] = outAlpha;
  }
}

export function onionSkin(
  current: Uint8ClampedArray,
  prev: Uint8ClampedArray | null,
  next: Uint8ClampedArray | null,
  w: number,
  h: number,
  opts: OnionSkinOptions = {},
): Uint8ClampedArray {
  const width = Math.max(0, Math.trunc(w));
  const height = Math.max(0, Math.trunc(h));
  const pixelCount = width * height;
  const accum = new Float64Array(pixelCount * 4);

  if (prev) {
    compositeSourceOver(accum, prev, pixelCount, clampOpacity(opts.prevOpacity, 0.3), opts.prevTint);
  }
  compositeSourceOver(accum, current, pixelCount, 1);
  if (next) {
    compositeSourceOver(accum, next, pixelCount, clampOpacity(opts.nextOpacity, 0.3), opts.nextTint);
  }

  const out = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = accum[i];
    out[i + 1] = accum[i + 1];
    out[i + 2] = accum[i + 2];
    out[i + 3] = accum[i + 3] * 255;
  }
  return out;
}
