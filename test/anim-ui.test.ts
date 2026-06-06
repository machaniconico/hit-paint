import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';
import type { Layer } from '../src/types';

function pixel(id: number): number[] {
  return [id, id + 1, id + 2, 255];
}

function pixelsFromIds(ids: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(ids.flatMap(pixel));
}

function idsFromPixels(pixels: Uint8ClampedArray): number[] {
  const ids: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    ids.push(pixels[i]);
  }
  return ids;
}

function activeLayer(): Layer {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer) throw new Error('active layer is missing');
  return layer;
}

function activePixels(): Uint8ClampedArray {
  const pixels = activeLayer().pixels;
  if (!pixels) throw new Error('active layer has no pixels');
  return pixels;
}

function setActivePixelIds(ids: number[]): void {
  activePixels().set(pixelsFromIds(ids));
}

function framePixels(frameIndex: number): Uint8ClampedArray {
  const { doc, timeline } = useStore.getState();
  const frameLayer = timeline.frames[frameIndex]?.layers.find((layer) => layer.id === doc.activeLayerId);
  const pixels = frameLayer?.pixels;
  if (!pixels) throw new Error(`frame ${frameIndex} has no pixels`);
  return pixels;
}

function frameMask(frameIndex: number): Uint8ClampedArray | undefined {
  const { doc, timeline } = useStore.getState();
  return timeline.frames[frameIndex]?.layers.find((layer) => layer.id === doc.activeLayerId)?.mask;
}

describe('animation timeline store UI wiring', () => {
  beforeEach(() => {
    useStore.getState().newDocument(2, 1, 'anim ui');
    setActivePixelIds([1, 2]);
    useStore.getState().captureCurrentFrame();
  });

  it('addAnimFrame increases the frame count and moves currentIndex to the new frame', () => {
    useStore.getState().addAnimFrame();

    const { timeline } = useStore.getState();
    expect(timeline.frames).toHaveLength(2);
    expect(timeline.currentIndex).toBe(1);
    expect(timeline.frames[1].layers).not.toBe(timeline.frames[0].layers);
    expect(framePixels(1)).not.toBe(framePixels(0));
  });

  it('gotoAnimFrame replaces doc.layers with the target frame contents', () => {
    useStore.getState().addAnimFrame();
    setActivePixelIds([9, 10]);
    useStore.getState().captureCurrentFrame();

    useStore.getState().gotoAnimFrame(0);
    expect(idsFromPixels(activePixels())).toEqual([1, 2]);

    useStore.getState().gotoAnimFrame(1);
    expect(idsFromPixels(activePixels())).toEqual([9, 10]);
  });

  it('keeps frame pixel buffers isolated when one frame is edited', () => {
    useStore.getState().addAnimFrame();
    setActivePixelIds([7, 8]);
    useStore.getState().captureCurrentFrame();

    expect(framePixels(0)).not.toBe(framePixels(1));

    useStore.getState().gotoAnimFrame(0);
    activePixels()[0] = 42;
    useStore.getState().captureCurrentFrame();

    useStore.getState().gotoAnimFrame(1);
    expect(idsFromPixels(activePixels())).toEqual([7, 8]);

    useStore.getState().gotoAnimFrame(0);
    expect(idsFromPixels(activePixels())).toEqual([42, 2]);
  });

  it('keeps frame mask buffers isolated', () => {
    useStore.getState().addLayerMask(activeLayer().id);
    const firstMask = activeLayer().mask;
    if (!firstMask) throw new Error('mask was not created');
    firstMask[0] = 32;
    useStore.getState().captureCurrentFrame();

    useStore.getState().addAnimFrame();
    const secondMask = activeLayer().mask;
    if (!secondMask) throw new Error('duplicated frame has no mask');
    secondMask[0] = 200;
    useStore.getState().captureCurrentFrame();

    const frame0Mask = frameMask(0);
    const frame1Mask = frameMask(1);
    expect(frame0Mask).not.toBe(frame1Mask);
    expect(frame0Mask?.[0]).toBe(32);
    expect(frame1Mask?.[0]).toBe(200);
  });

  it('removeAnimFrame keeps at least one frame', () => {
    useStore.getState().addAnimFrame();
    useStore.getState().removeAnimFrame(1);

    expect(useStore.getState().timeline.frames).toHaveLength(1);
    expect(useStore.getState().timeline.currentIndex).toBe(0);

    useStore.getState().removeAnimFrame(0);
    expect(useStore.getState().timeline.frames).toHaveLength(1);
    expect(useStore.getState().timeline.currentIndex).toBe(0);
  });

  it('setOnionSkin reflects the enabled state', () => {
    useStore.getState().setOnionSkin(true);
    expect(useStore.getState().onionSkinEnabled).toBe(true);

    useStore.getState().setOnionSkin(false);
    expect(useStore.getState().onionSkinEnabled).toBe(false);
  });
});
