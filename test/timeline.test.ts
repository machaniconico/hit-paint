import { describe, expect, it } from 'vitest';

import {
  addFrame,
  createTimeline,
  duplicateFrame,
  insertFrame,
  onionSkin,
  removeFrame,
  reorderFrame,
  setCurrentFrame,
  type Frame,
} from '../src/anim/timeline';
import type { Layer } from '../src/types';

function raster(id: string): Layer {
  return {
    id,
    name: id,
    kind: 'raster',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    clipping: false,
  };
}

function frame(id: string, layers: Layer[] = []): Frame {
  return {
    id,
    layers,
    durationMs: 83,
  };
}

function ids(tl: { frames: Frame[] }): string[] {
  return tl.frames.map((item) => item.id);
}

describe('animation timeline', () => {
  it('adds a frame at the end without mutating the original timeline', () => {
    const tl = createTimeline(12);
    const originalFrames = tl.frames;
    const added = frame('added');

    const next = addFrame(tl, added);

    expect(next.frames).toHaveLength(2);
    expect(next.frames[1]).toBe(added);
    expect(tl.frames).toBe(originalFrames);
    expect(tl.frames).toHaveLength(1);
    expect(next).not.toBe(tl);
    expect(next.frames).not.toBe(tl.frames);
  });

  it('inserts a frame at a clamped index and keeps the selected frame stable', () => {
    const base = createTimeline(12);
    const selected = frame('selected');
    const tl = setCurrentFrame(addFrame(base, selected), 1);

    const next = insertFrame(tl, -20, frame('inserted'));

    expect(ids(next)).toEqual(['inserted', base.frames[0].id, 'selected']);
    expect(next.currentIndex).toBe(2);
    expect(ids(tl)).toEqual([base.frames[0].id, 'selected']);
  });

  it('removes frames with clamped indexes while keeping at least one frame', () => {
    const base = createTimeline(12);
    const tl = addFrame(addFrame(base, frame('a')), frame('b'));

    const removed = removeFrame(tl, 99);
    const last = removeFrame(removeFrame(removed, 0), 0);

    expect(ids(removed)).toEqual([base.frames[0].id, 'a']);
    expect(last.frames).toHaveLength(1);
    expect(removeFrame(last, 0).frames).toHaveLength(1);
    expect(tl.frames).toHaveLength(3);
  });

  it('duplicates a frame with a new id and an independent shallow layer array', () => {
    const layers = [raster('layer-a'), raster('layer-b')];
    const tl = addFrame(createTimeline(12), frame('source', layers));

    const next = duplicateFrame(tl, 1);
    const original = next.frames[1];
    const duplicate = next.frames[2];

    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.durationMs).toBe(original.durationMs);
    expect(duplicate.layers).toEqual(original.layers);
    expect(duplicate.layers).not.toBe(original.layers);
    expect(duplicate.layers[0]).toBe(original.layers[0]);
    expect(tl.frames).toHaveLength(2);
  });

  it('reorders frames with clamped indexes without mutating the original order', () => {
    const base = createTimeline(12);
    const tl = addFrame(addFrame(addFrame(base, frame('a')), frame('b')), frame('c'));

    const next = reorderFrame(tl, 0, 99);

    expect(ids(next)).toEqual(['a', 'b', 'c', base.frames[0].id]);
    expect(ids(tl)).toEqual([base.frames[0].id, 'a', 'b', 'c']);
    expect(next.frames).not.toBe(tl.frames);
  });

  it('clamps the current frame index', () => {
    const tl = addFrame(addFrame(createTimeline(12), frame('a')), frame('b'));

    expect(setCurrentFrame(tl, 99).currentIndex).toBe(2);
    expect(setCurrentFrame(tl, -99).currentIndex).toBe(0);
    expect(setCurrentFrame(tl, Number.NaN).currentIndex).toBe(0);
  });

  it('composites previous onion skin at low opacity without mutating input buffers', () => {
    const current = new Uint8ClampedArray([0, 0, 0, 0]);
    const prev = new Uint8ClampedArray([255, 0, 0, 255]);
    const prevBefore = new Uint8ClampedArray(prev);

    const out = onionSkin(current, prev, null, 1, 1, { prevOpacity: 0.5 });

    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(128);
    expect(prev).toEqual(prevBefore);
    expect(current).toEqual(new Uint8ClampedArray([0, 0, 0, 0]));
  });

  it('draws next onion skin above the current frame', () => {
    const current = new Uint8ClampedArray([0, 0, 255, 255]);
    const next = new Uint8ClampedArray([255, 0, 0, 255]);

    const out = onionSkin(current, null, next, 1, 1, { nextOpacity: 0.5 });

    expect(out[0]).toBe(128);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(128);
    expect(out[3]).toBe(255);
  });
});
