import { describe, expect, it } from 'vitest';
import { createMeshGrid, meshWarp } from '../src/tools/mesh-warp';

function rgbaGradient(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      pixels[index] = x * 30;
      pixels[index + 1] = y * 35;
      pixels[index + 2] = x * 13 + y * 17;
      pixels[index + 3] = 200 + x + y;
    }
  }
  return pixels;
}

function channel(pixels: Uint8ClampedArray, x: number, y: number, width: number, c = 0): number {
  return pixels[(y * width + x) * 4 + c];
}

function maxChannelDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let maxDelta = 0;
  for (let i = 0; i < a.length; i++) {
    maxDelta = Math.max(maxDelta, Math.abs(a[i] - b[i]));
  }
  return maxDelta;
}

describe('mesh warp', () => {
  it('createMeshGrid returns evenly spaced row-major control points', () => {
    const grid = createMeshGrid(8, 6, 2, 3);

    expect(grid.cols).toBe(2);
    expect(grid.rows).toBe(3);
    expect(grid.points).toHaveLength((2 + 1) * (3 + 1));
    expect(grid.points[0]).toEqual({ x: 0, y: 0 });
    expect(grid.points[1]).toEqual({ x: 4, y: 0 });
    expect(grid.points[2]).toEqual({ x: 8, y: 0 });
    expect(grid.points[3]).toEqual({ x: 0, y: 2 });
    expect(grid.points[7]).toEqual({ x: 4, y: 4 });
    expect(grid.points[11]).toEqual({ x: 8, y: 6 });
  });

  it('identity grid preserves the input image byte-close', () => {
    const width = 5;
    const height = 4;
    const pixels = rgbaGradient(width, height);
    const grid = createMeshGrid(width, height, 2, 2);

    const out = meshWarp(pixels, width, height, grid);

    expect(out).not.toBe(pixels);
    expect(out).toHaveLength(pixels.length);
    expect(maxChannelDelta(out, pixels)).toBeLessThanOrEqual(2);
  });

  it('moving one control point pulls nearby pixels in that direction', () => {
    const width = 6;
    const height = 6;
    const pixels = rgbaGradient(width, height);
    const grid = createMeshGrid(width, height, 2, 2);
    grid.points[4] = { x: grid.points[4].x + 1, y: grid.points[4].y };

    const out = meshWarp(pixels, width, height, grid);

    expect(channel(out, 4, 3, width)).toBe(channel(pixels, 3, 3, width));
    expect(channel(out, 4, 3, width)).toBeLessThan(channel(pixels, 4, 3, width));
  });

  it('meshWarp does not mutate the input buffer', () => {
    const width = 4;
    const height = 4;
    const pixels = rgbaGradient(width, height);
    const before = Array.from(pixels);
    const grid = createMeshGrid(width, height, 1, 1);
    grid.points[2] = { x: -1, y: height };

    meshWarp(pixels, width, height, grid);

    expect(Array.from(pixels)).toEqual(before);
  });

  it('degenerate image dimensions return an empty output buffer', () => {
    const pixels = rgbaGradient(2, 2);
    const grid = createMeshGrid(2, 2, 1, 1);

    expect(meshWarp(pixels, 0, 2, grid)).toHaveLength(0);
    expect(meshWarp(pixels, 2, 0, grid)).toHaveLength(0);
    expect(meshWarp(pixels, -1, 2, grid)).toHaveLength(0);
  });
});
