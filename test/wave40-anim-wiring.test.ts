import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildGifFrameInputs,
  buildTweenInsertion,
  useStore,
} from '../src/state/store';
import { createTimeline, type Frame, type Timeline } from '../src/anim/timeline';
import { resolveFrameAt } from '../src/anim/playback';
import { encodeGif } from '../src/io/gif';
import type { Layer } from '../src/types';

/**
 * Wave40 US-4204 — store/App 配線(中割り挿入 / GIF フレーム配列組み立て / 再生モード)の
 * 純粋ヘルパ検証。canvas/ImageData を使うアクション本体(exportGif の flatten / downloadBlob)は
 * jsdom で動かないため呼ばず、分離した純粋ヘルパと store 状態のみを検証する。
 */

function raster(id: string, opacity: number): Layer {
  return {
    id,
    name: id,
    kind: 'raster',
    visible: true,
    opacity,
    blendMode: 'normal',
    locked: false,
    clipping: false,
  };
}

function frame(id: string, opacity: number, durationMs = 100): Frame {
  return {
    id,
    layers: [raster('L', opacity)],
    durationMs,
  };
}

function twoFrameTimeline(): Timeline {
  const base = createTimeline(10);
  return {
    ...base,
    // a.opacity=0 → b.opacity=1、durationMs は両端 100/200。
    frames: [frame('a', 0, 100), frame('b', 1, 200)],
    currentIndex: 0,
  };
}

describe('buildTweenInsertion — 中割り挿入の純粋ヘルパ', () => {
  it('2フレームに中割りN枚を挿入すると frames.length が +N になり挿入位置が index と次の間になる', () => {
    const tl = twoFrameTimeline();
    const out = buildTweenInsertion(tl, 0, 3);
    expect(out.frames).toHaveLength(5);
    // 端点(a, b)は維持され、中割りが index 0 と最後の b の間に入る。
    expect(out.frames[0].id).toBe('a');
    expect(out.frames[4].id).toBe('b');
    expect(out.frames.slice(1, 4).map((f) => f.id)).toEqual([
      'tween_0_1',
      'tween_0_2',
      'tween_0_3',
    ]);
  });

  it('補間 opacity が linear で単調増加し端点を含まない(t=i/(N+1))', () => {
    const tl = twoFrameTimeline();
    const out = buildTweenInsertion(tl, 0, 3);
    const ops = out.frames.slice(1, 4).map((f) => f.layers[0].opacity);
    // from=0, to=1, N=3 → t=1/4,2/4,3/4(linear)。
    expect(ops[0]).toBeCloseTo(0.25, 6);
    expect(ops[1]).toBeCloseTo(0.5, 6);
    expect(ops[2]).toBeCloseTo(0.75, 6);
    // 端点 0/1 は中割りに含まれない。
    expect(ops.every((o) => o > 0 && o < 1)).toBe(true);
  });

  it('durationMs も両端を線形補間する', () => {
    const tl = twoFrameTimeline();
    const out = buildTweenInsertion(tl, 0, 1);
    // N=1 → t=1/2 → (100+200)/2 = 150。
    expect(out.frames[1].durationMs).toBeCloseTo(150, 6);
  });

  it('count<=0 / 最終フレーム指定 / 1フレームのみ では元の frames をそのまま返す(挿入なし)', () => {
    const tl = twoFrameTimeline();
    expect(buildTweenInsertion(tl, 0, 0).frames).toHaveLength(2);
    // 最終フレーム(index 1)には次が無いので挿入しない。
    expect(buildTweenInsertion(tl, 1, 3).frames).toHaveLength(2);

    const single: Timeline = { ...tl, frames: [frame('only', 0.5)], currentIndex: 0 };
    expect(buildTweenInsertion(single, 0, 3).frames).toHaveLength(1);
  });

  it('元 timeline を変更しない(純粋)', () => {
    const tl = twoFrameTimeline();
    const before = tl.frames.length;
    buildTweenInsertion(tl, 0, 3);
    expect(tl.frames).toHaveLength(before);
  });
});

describe('buildGifFrameInputs — GIF フレーム配列組み立て', () => {
  it('各フレームの delayMs が durationMs に一致し rgba は flatten の戻り値になる', () => {
    const frames = [frame('a', 1, 80), frame('b', 1, 160)];
    // ダミー flatten: フレーム id を先頭画素に埋め込んだ 1px RGBA を返す。
    const flatten = (f: Frame): Uint8ClampedArray =>
      new Uint8ClampedArray([f.id.charCodeAt(0), 0, 0, 255]);
    const inputs = buildGifFrameInputs(frames, flatten);
    expect(inputs).toHaveLength(2);
    expect(inputs[0].delayMs).toBe(80);
    expect(inputs[1].delayMs).toBe(160);
    expect(inputs[0].rgba[0]).toBe('a'.charCodeAt(0));
    expect(inputs[1].rgba[0]).toBe('b'.charCodeAt(0));
  });

  it('組み立てた配列を encodeGif に通すと GIF89a シグネチャで始まる', () => {
    const width = 2;
    const height = 1;
    const frames = [frame('a', 1, 100), frame('b', 1, 100)];
    // 2px の単色 RGBA を返すダミー flatten。
    const flatten = (): Uint8ClampedArray =>
      new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const inputs = buildGifFrameInputs(frames, flatten);
    const bytes = encodeGif({ width, height, frames: inputs, loop: 0 });
    const sig = String.fromCharCode(...bytes.slice(0, 6));
    expect(sig).toBe('GIF89a');
  });
});

describe('setPlaybackMode — 再生モード状態と resolveFrameAt の整合', () => {
  beforeEach(() => {
    useStore.getState().newDocument(2, 1, 'wave40');
  });

  it('setPlaybackMode が状態へ反映され resolveFrameAt と整合する', () => {
    // 既定は loop。
    expect(useStore.getState().playbackMode).toBe('loop');

    useStore.getState().setPlaybackMode('once');
    expect(useStore.getState().playbackMode).toBe('once');

    // 100ms×3 フレームの timeline で once は total 超過時に最終フレームへ張り付く。
    const tl: Timeline = {
      ...createTimeline(10),
      frames: [frame('f0', 1, 100), frame('f1', 1, 100), frame('f2', 1, 100)],
      currentIndex: 0,
    };
    const mode = useStore.getState().playbackMode;
    expect(resolveFrameAt(tl, 150, mode)).toBe(1);
    expect(resolveFrameAt(tl, 999, mode)).toBe(2); // once: 末尾に張り付く

    useStore.getState().setPlaybackMode('loop');
    expect(resolveFrameAt(tl, 350, useStore.getState().playbackMode)).toBe(0); // 350%300=50 → f0
  });
});

describe('既存アニメアクション回帰', () => {
  beforeEach(() => {
    useStore.getState().newDocument(2, 1, 'wave40-regression');
  });

  it('addAnimFrame / removeAnimFrame が従来通り frame 数を増減する', () => {
    const before = useStore.getState().timeline.frames.length;
    useStore.getState().addAnimFrame();
    expect(useStore.getState().timeline.frames.length).toBe(before + 1);

    const mid = useStore.getState().timeline.frames.length;
    useStore.getState().removeAnimFrame(useStore.getState().timeline.currentIndex);
    expect(useStore.getState().timeline.frames.length).toBe(mid - 1);
  });

  it('insertTweenFrames アクションが store の timeline に中割りを差し込む', () => {
    // フレームを2枚にしてから中割りを挿入。
    useStore.getState().addAnimFrame();
    const before = useStore.getState().timeline.frames.length;
    useStore.getState().insertTweenFrames(0, 2);
    expect(useStore.getState().timeline.frames.length).toBe(before + 2);
  });
});
