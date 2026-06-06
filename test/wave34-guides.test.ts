import { describe, expect, it } from 'vitest';

import { addGuide, createGuideState, removeGuide, snapPoint, type GuideState } from '../src/core/guides';

describe('wave34 guides', () => {
  it('createGuideState returns the default guide settings', () => {
    expect(createGuideState()).toEqual({
      guides: [],
      gridSize: 50,
      gridEnabled: false,
    });
  });

  it('addGuide is non-destructive and adds a guide', () => {
    const state = createGuideState();
    const result = addGuide(state, { orientation: 'v', position: 100 });

    expect(result).not.toBe(state);
    expect(state.guides).toEqual([]);
    expect(result.guides).toEqual([{ orientation: 'v', position: 100 }]);
  });

  it('addGuide ignores a duplicate guide with the same orientation and position', () => {
    const state = addGuide(createGuideState(), { orientation: 'v', position: 100 });
    const result = addGuide(state, { orientation: 'v', position: 100 });

    expect(result).toBe(state);
    expect(result.guides).toEqual([{ orientation: 'v', position: 100 }]);
  });

  it('removeGuide is non-destructive and removes a guide by index', () => {
    const state: GuideState = {
      ...createGuideState(),
      guides: [
        { orientation: 'v', position: 100 },
        { orientation: 'h', position: 200 },
      ],
    };
    const result = removeGuide(state, 0);

    expect(result).not.toBe(state);
    expect(state.guides).toEqual([
      { orientation: 'v', position: 100 },
      { orientation: 'h', position: 200 },
    ]);
    expect(result.guides).toEqual([{ orientation: 'h', position: 200 }]);
  });

  it('snapPoint snaps x to a vertical guide within threshold and leaves y unchanged', () => {
    const state = addGuide(createGuideState(), { orientation: 'v', position: 100 });

    expect(snapPoint(state, { x: 103, y: 40 }, 5)).toEqual({
      x: 100,
      y: 40,
      snappedX: true,
      snappedY: false,
    });
  });

  it('snapPoint does not snap x to a guide outside threshold', () => {
    const state = addGuide(createGuideState(), { orientation: 'v', position: 100 });

    expect(snapPoint(state, { x: 120, y: 40 }, 5)).toEqual({
      x: 120,
      y: 40,
      snappedX: false,
      snappedY: false,
    });
  });

  it('snapPoint snaps to a grid line when the grid is enabled', () => {
    const state: GuideState = {
      ...createGuideState(),
      gridEnabled: true,
      gridSize: 50,
    };

    expect(snapPoint(state, { x: 48, y: 12 }, 5)).toEqual({
      x: 50,
      y: 12,
      snappedX: true,
      snappedY: false,
    });
  });

  it('snapPoint chooses the nearer candidate when both a guide and grid line are available', () => {
    const state: GuideState = {
      guides: [{ orientation: 'v', position: 52 }],
      gridEnabled: true,
      gridSize: 50,
    };

    expect(snapPoint(state, { x: 49, y: 10 }, 5)).toEqual({
      x: 50,
      y: 10,
      snappedX: true,
      snappedY: false,
    });
  });

  it('snapPoint never uses grid lines when gridSize is less than or equal to zero', () => {
    const state: GuideState = {
      guides: [],
      gridEnabled: true,
      gridSize: 0,
    };

    expect(snapPoint(state, { x: 48, y: 98 }, 5)).toEqual({
      x: 48,
      y: 98,
      snappedX: false,
      snappedY: false,
    });
  });
});
