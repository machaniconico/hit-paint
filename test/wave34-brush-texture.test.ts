import { describe, expect, it } from 'vitest';
import { makeTexturedTip, scatterStamps } from '../src/engine/brush-texture';

describe('textured brush tip masks', () => {
  it('makes a circular tip with an opaque center and transparent corners', () => {
    const mask = makeTexturedTip({ size: 5, hardness: 1 });

    expect(mask[2 * 5 + 2]).toBeCloseTo(1, 6);
    expect(mask[0]).toBeCloseTo(0, 6);
    expect(mask[4]).toBeCloseTo(0, 6);
    expect(mask[4 * 5]).toBeCloseTo(0, 6);
    expect(mask[4 * 5 + 4]).toBeCloseTo(0, 6);
  });

  it('modulates tip alpha with tiled texture values', () => {
    const texture = new Float32Array(4).fill(0.5);
    const mask = makeTexturedTip({ size: 5, hardness: 1, texture, textureSize: 2 });

    expect(mask[2 * 5 + 2]).toBeCloseTo(0.5, 6);
  });

  it('returns an empty mask for non-positive size', () => {
    const mask = makeTexturedTip({ size: 0 });

    expect(mask).toHaveLength(0);
  });
});

describe('scatter brush stamps', () => {
  it('returns identical stamps for the same seed', () => {
    const opts = { count: 8, radius: 12, tipSize: 5, seed: 1234 };

    expect(scatterStamps(opts)).toEqual(scatterStamps(opts));
  });

  it('returns different stamps for different seeds', () => {
    const base = { count: 8, radius: 12, tipSize: 5 };

    expect(scatterStamps({ ...base, seed: 1 })).not.toEqual(scatterStamps({ ...base, seed: 2 }));
  });

  it('returns exactly count stamps', () => {
    const stamps = scatterStamps({ count: 7, radius: 10, tipSize: 4, seed: 55 });

    expect(stamps).toHaveLength(7);
  });

  it('places every stamp inside the configured radius circle', () => {
    const radius = 10;
    const stamps = scatterStamps({ count: 20, radius, tipSize: 4, seed: 77 });

    for (const stamp of stamps) {
      expect(stamp.dx * stamp.dx + stamp.dy * stamp.dy).toBeLessThanOrEqual(radius * radius);
    }
  });

  it('generates each stamp scale in the expected range', () => {
    const stamps = scatterStamps({ count: 20, radius: 10, tipSize: 4, seed: 88 });

    for (const stamp of stamps) {
      expect(stamp.scale).toBeGreaterThanOrEqual(0.5);
      expect(stamp.scale).toBeLessThanOrEqual(1);
    }
  });
});
