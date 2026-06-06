import { describe, expect, it } from 'vitest';
import { applyDynamics } from '../src/engine/brush-dynamics';

describe('brush dynamics', () => {
  it('reproduces the same dab for the same seed and step', () => {
    const base = { size: 16, opacity: 0.75, x: 24, y: 32 };
    const cfg = { sizeJitter: 0.4, opacityJitter: 0.5, scatter: 8, seed: 1703 };

    expect(applyDynamics(base, cfg, 12)).toEqual(applyDynamics(base, cfg, 12));
  });

  it('leaves a valid base dab unchanged when jitter and scatter are zero', () => {
    const base = { size: 12, opacity: 0.6, x: 10, y: 20 };

    expect(applyDynamics(base, { sizeJitter: 0, opacityJitter: 0, scatter: 0, seed: 5 }, 3))
      .toEqual(base);
  });

  it('reduces size when size jitter is enabled', () => {
    const base = { size: 20, opacity: 0.8, x: 3, y: 4 };
    const dab = applyDynamics(base, { sizeJitter: 0.75, opacityJitter: 0, scatter: 0, seed: 99 }, 1);

    expect(dab.size).toBeLessThan(base.size);
    expect(dab.size).toBeGreaterThanOrEqual(0.1);
    expect(dab.opacity).toBe(base.opacity);
    expect(dab.x).toBe(base.x);
    expect(dab.y).toBe(base.y);
  });

  it('clamps size and opacity to their allowed ranges', () => {
    const small = applyDynamics(
      { size: 0.01, opacity: 3, x: 0, y: 0 },
      { sizeJitter: 1, opacityJitter: 0, scatter: 0, seed: 2 },
      4,
    );
    const transparent = applyDynamics(
      { size: 10, opacity: -0.5, x: 0, y: 0 },
      { sizeJitter: 0, opacityJitter: 1, scatter: 0, seed: 2 },
      4,
    );

    expect(small.size).toBeGreaterThanOrEqual(0.1);
    expect(small.opacity).toBe(1);
    expect(transparent.opacity).toBe(0);
  });

  it('keeps scatter offsets inside the configured radius on both axes', () => {
    const base = { size: 8, opacity: 0.5, x: 100, y: 200 };
    const scatter = 12;

    for (let step = 0; step < 20; step++) {
      const dab = applyDynamics(base, { scatter, seed: 44 }, step);

      expect(dab.x).toBeGreaterThanOrEqual(base.x - scatter);
      expect(dab.x).toBeLessThanOrEqual(base.x + scatter);
      expect(dab.y).toBeGreaterThanOrEqual(base.y - scatter);
      expect(dab.y).toBeLessThanOrEqual(base.y + scatter);
    }
  });

  it('uses the default seed deterministically', () => {
    const base = { size: 14, opacity: 0.9, x: 2, y: 6 };
    const cfg = { sizeJitter: 0.25, opacityJitter: 0.25, scatter: 3 };

    expect(applyDynamics(base, cfg, 7)).toEqual(applyDynamics(base, cfg, 7));
  });
});
