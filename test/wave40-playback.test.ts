import { describe, expect, it } from 'vitest';
import {
  frameDurationMs,
  frameTimings,
  totalDurationMs,
  resolveFrameAt,
  type PlaybackMode,
} from '../src/anim/playback';
import type { Frame, Timeline } from '../src/anim/timeline';

/**
 * Wave40 US-4203 — アニメ再生タイミング(累積/ループ/ピンポン)。
 *
 * canvas を使わず「時刻 → フレーム index」のスケジューリングのみを純粋配列ロジックで検証する。
 * pingpong は往路 0..n-1 / 復路 n-1..0 を時刻反射させ、先頭(0)と末尾(n-1)の折り返し点を
 * 二重表示しない設計(論理サイクル長 = 2*total、フレーム軸では 2*n-2)。
 */

/** durationMs を直接指定して Frame を作る(layers は空でよい)。 */
function frame(id: string, durationMs: number): Frame {
  return { id, layers: [], durationMs };
}

/** frames と fps から Timeline を組み立てる。 */
function timelineOf(frames: Frame[], fps = 12): Timeline {
  return { frames, currentIndex: 0, fps };
}

describe('frameDurationMs', () => {
  it('durationMs が正なら採用する', () => {
    expect(frameDurationMs(frame('a', 250), 12)).toBe(250);
  });

  it('durationMs が 0 / 負 / 非有限なら 1000/fps を使う', () => {
    expect(frameDurationMs(frame('a', 0), 10)).toBe(100);
    expect(frameDurationMs(frame('a', -5), 10)).toBe(100);
    expect(frameDurationMs(frame('a', Number.NaN), 10)).toBe(100);
  });

  it('fps<=0(非有限含む)は 12 にフォールバックする', () => {
    expect(frameDurationMs(frame('a', 0), 0)).toBeCloseTo(1000 / 12, 6);
    expect(frameDurationMs(frame('a', 0), -3)).toBeCloseTo(1000 / 12, 6);
    expect(frameDurationMs(frame('a', 0), Number.NaN)).toBeCloseTo(1000 / 12, 6);
  });
});

describe('frameTimings', () => {
  it('durationMs 混在で start/end が累積する', () => {
    const tl = timelineOf([frame('a', 100), frame('b', 200), frame('c', 100)]);
    expect(frameTimings(tl)).toEqual([
      { index: 0, startMs: 0, endMs: 100, durationMs: 100 },
      { index: 1, startMs: 100, endMs: 300, durationMs: 200 },
      { index: 2, startMs: 300, endMs: 400, durationMs: 100 },
    ]);
  });

  it('durationMs 無しは fps から導出して累積する(fps=10 → 100ms)', () => {
    const tl = timelineOf([frame('a', 0), frame('b', 0)], 10);
    expect(frameTimings(tl)).toEqual([
      { index: 0, startMs: 0, endMs: 100, durationMs: 100 },
      { index: 1, startMs: 100, endMs: 200, durationMs: 100 },
    ]);
  });

  it('空 frames は空配列', () => {
    expect(frameTimings(timelineOf([]))).toEqual([]);
  });
});

describe('totalDurationMs', () => {
  it('全フレーム長の合計', () => {
    const tl = timelineOf([frame('a', 100), frame('b', 200), frame('c', 100)]);
    expect(totalDurationMs(tl)).toBe(400);
  });

  it('空 frames は 0', () => {
    expect(totalDurationMs(timelineOf([]))).toBe(0);
  });

  it('durationMs 無しは fps から導出', () => {
    expect(totalDurationMs(timelineOf([frame('a', 0), frame('b', 0)], 10))).toBe(200);
  });
});

describe('resolveFrameAt — ガード', () => {
  const modes: PlaybackMode[] = ['once', 'loop', 'pingpong'];

  it('空タイムラインは常に 0', () => {
    const tl = timelineOf([]);
    for (const mode of modes) {
      expect(resolveFrameAt(tl, 0, mode)).toBe(0);
      expect(resolveFrameAt(tl, 9999, mode)).toBe(0);
    }
  });

  it('単一フレームは常に 0', () => {
    const tl = timelineOf([frame('a', 100)]);
    for (const mode of modes) {
      expect(resolveFrameAt(tl, 0, mode)).toBe(0);
      expect(resolveFrameAt(tl, 50, mode)).toBe(0);
      expect(resolveFrameAt(tl, 100, mode)).toBe(0);
      expect(resolveFrameAt(tl, 5000, mode)).toBe(0);
    }
  });

  it('負の t は 0 扱い(決定論ガード)', () => {
    const tl = timelineOf([frame('a', 100), frame('b', 100), frame('c', 100)]);
    for (const mode of modes) {
      expect(resolveFrameAt(tl, -1, mode)).toBe(0);
      expect(resolveFrameAt(tl, -9999, mode)).toBe(0);
    }
  });

  it('非有限 t は 0 扱い', () => {
    const tl = timelineOf([frame('a', 100), frame('b', 100)]);
    expect(resolveFrameAt(tl, Number.NaN, 'loop')).toBe(0);
    expect(resolveFrameAt(tl, Number.POSITIVE_INFINITY, 'loop')).toBe(0);
  });
});

describe('resolveFrameAt — once', () => {
  // [100,200,100]: f0[0,100) f1[100,300) f2[300,400) total=400
  const tl = timelineOf([frame('a', 100), frame('b', 200), frame('c', 100)]);

  it('各区間の代表時刻', () => {
    expect(resolveFrameAt(tl, 0, 'once')).toBe(0);
    expect(resolveFrameAt(tl, 99, 'once')).toBe(0);
    expect(resolveFrameAt(tl, 100, 'once')).toBe(1);
    expect(resolveFrameAt(tl, 250, 'once')).toBe(1);
    expect(resolveFrameAt(tl, 300, 'once')).toBe(2);
    expect(resolveFrameAt(tl, 399, 'once')).toBe(2);
  });

  it('総時間以上は最終フレームに張り付く', () => {
    expect(resolveFrameAt(tl, 400, 'once')).toBe(2);
    expect(resolveFrameAt(tl, 10000, 'once')).toBe(2);
  });
});

describe('resolveFrameAt — loop', () => {
  // [100,100,100] total=300
  const tl = timelineOf([frame('a', 100), frame('b', 100), frame('c', 100)]);

  it('1周目', () => {
    expect(resolveFrameAt(tl, 0, 'loop')).toBe(0);
    expect(resolveFrameAt(tl, 150, 'loop')).toBe(1);
    expect(resolveFrameAt(tl, 250, 'loop')).toBe(2);
  });

  it('t=total は先頭へ巻き戻る', () => {
    expect(resolveFrameAt(tl, 300, 'loop')).toBe(0);
  });

  it('複数周回しても剰余で同じ位置', () => {
    expect(resolveFrameAt(tl, 300 + 150, 'loop')).toBe(1);
    expect(resolveFrameAt(tl, 3000 + 250, 'loop')).toBe(2);
    expect(resolveFrameAt(tl, 3000, 'loop')).toBe(0);
  });
});

describe('resolveFrameAt — pingpong', () => {
  // [100,100,100] total=300, n=3。1サイクル=600ms。
  // 往路: 0(0-100) 1(100-200) 2(200-300) / 折り返し点 t=300 で末尾 2
  // 復路: 2(300-400) 1(400-500) 0(500-600) で先頭へ
  const tl = timelineOf([frame('a', 100), frame('b', 100), frame('c', 100)]);

  it('往路 0 → n-1', () => {
    expect(resolveFrameAt(tl, 0, 'pingpong')).toBe(0);
    expect(resolveFrameAt(tl, 50, 'pingpong')).toBe(0);
    expect(resolveFrameAt(tl, 150, 'pingpong')).toBe(1);
    expect(resolveFrameAt(tl, 250, 'pingpong')).toBe(2);
  });

  it('折り返し点(t=total)は末尾フレーム', () => {
    expect(resolveFrameAt(tl, 300, 'pingpong')).toBe(2);
  });

  it('復路 n-1 → 0 に反射する', () => {
    expect(resolveFrameAt(tl, 350, 'pingpong')).toBe(2);
    expect(resolveFrameAt(tl, 450, 'pingpong')).toBe(1);
    expect(resolveFrameAt(tl, 550, 'pingpong')).toBe(0);
  });

  it('1サイクル末(t=2*total)で先頭へ戻り次サイクルが始まる', () => {
    expect(resolveFrameAt(tl, 600, 'pingpong')).toBe(0);
    expect(resolveFrameAt(tl, 650, 'pingpong')).toBe(0);
    expect(resolveFrameAt(tl, 900, 'pingpong')).toBe(2);
  });

  it('往路と復路は折り返し点を中心に対称', () => {
    // 往路 t と 復路 (2*total - t) は同じフレームを指す(先頭/末尾の二重表示は無し)
    expect(resolveFrameAt(tl, 150, 'pingpong')).toBe(resolveFrameAt(tl, 600 - 150, 'pingpong'));
    expect(resolveFrameAt(tl, 50, 'pingpong')).toBe(resolveFrameAt(tl, 600 - 50, 'pingpong'));
  });
});
