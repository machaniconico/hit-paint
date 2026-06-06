// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { RGBA } from '../src/types';
import {
  addSubpath,
  createVectorLayerData,
  rasterizeVectorLayer,
  updateVectorLayerData,
  type VectorLayerData,
  type VectorPath,
  type VectorSubpath,
} from '../src/vector/vector-layer';
import { rasterizeDashedStroke } from '../src/vector/path';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

function pixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): RGBA {
  const i = (y * width + x) * 4;
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
}

function coloredXs(pixels: Uint8ClampedArray, width: number, y: number): number[] {
  const xs: number[] = [];
  for (let x = 0; x < width; x++) {
    if (pixel(pixels, width, x, y).a > 0) xs.push(x);
  }
  return xs;
}

describe('wave25 vector layer data', () => {
  it('rasterizes a closed triangle subpath fill and leaves exterior pixels transparent', () => {
    const triangle: VectorPath = {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 8, y: 1 },
        { x: 1, y: 8 },
      ],
    };
    const data = createVectorLayerData({
      subpaths: [{ path: triangle, fill: RED }],
    });

    const pixels = rasterizeVectorLayer(data, 10, 10);

    expect(pixel(pixels, 10, 2, 2)).toEqual(RED);
    expect(pixel(pixels, 10, 8, 8)).toEqual(TRANSPARENT);
  });

  it('rasterizes a stroke-only subpath on the stroke line', () => {
    const data = createVectorLayerData({
      subpaths: [{
        path: {
          closed: false,
          points: [
            { x: 1, y: 4 },
            { x: 8, y: 4 },
          ],
        },
        stroke: { color: BLUE, width: 2 },
      }],
    });

    const pixels = rasterizeVectorLayer(data, 10, 10);

    expect(pixel(pixels, 10, 4, 4)).toEqual(BLUE);
  });

  it('composites subpaths bottom-to-top so an upper subpath takes priority', () => {
    const lower: VectorSubpath = {
      path: {
        closed: true,
        points: [
          { x: 1, y: 1 },
          { x: 8, y: 1 },
          { x: 8, y: 8 },
          { x: 1, y: 8 },
        ],
      },
      fill: RED,
    };
    const upper: VectorSubpath = {
      path: {
        closed: true,
        points: [
          { x: 3, y: 3 },
          { x: 9, y: 3 },
          { x: 9, y: 9 },
          { x: 3, y: 9 },
        ],
      },
      fill: GREEN,
    };
    const data = createVectorLayerData({ subpaths: [lower, upper] });

    const pixels = rasterizeVectorLayer(data, 10, 10);

    expect(pixel(pixels, 10, 4, 4)).toEqual(GREEN);
    expect(pixel(pixels, 10, 2, 2)).toEqual(RED);
  });

  it('uses dashed stroke coverage when a dash array is specified', () => {
    const path: VectorPath = {
      closed: false,
      points: [
        { x: 1, y: 5 },
        { x: 18, y: 5 },
      ],
    };
    const data = createVectorLayerData({
      subpaths: [{
        path,
        stroke: { color: BLUE, width: 1, dash: [2, 2] },
      }],
    });

    const pixels = rasterizeVectorLayer(data, 20, 10);
    const expectedMask = rasterizeDashedStroke(path, 20, 10, 1, [2, 2]);

    expect(coloredXs(pixels, 20, 5).length).toBeGreaterThan(0);
    expect(coloredXs(pixels, 20, 5).length).toBeLessThan(18);
    for (let x = 0; x < 20; x++) {
      expect(pixel(pixels, 20, x, 5).a).toBe(expectedMask[5 * 20 + x]);
    }
  });

  it('creates, updates, and appends vector layer data immutably', () => {
    const path: VectorPath = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
    };
    const subpath: VectorSubpath = {
      path,
      stroke: { color: BLUE, width: 1, dashArray: [1, 1] },
    };

    const empty = createVectorLayerData();
    const added = addSubpath(empty, subpath);
    const updated = updateVectorLayerData(added, {
      subpaths: [{ path: { ...path, closed: true }, fill: RED }],
    });

    path.points[0].x = 99;
    subpath.stroke?.dashArray?.push(9);

    expect(empty).toEqual({ subpaths: [] });
    expect(added).not.toBe(empty);
    expect(added.subpaths).toHaveLength(1);
    expect(added.subpaths[0].path.points[0].x).toBe(0);
    expect(added.subpaths[0].stroke?.dashArray).toEqual([1, 1]);
    expect(updated).not.toBe(added);
    expect(updated).toEqual<VectorLayerData>({
      subpaths: [{ path: { closed: true, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }, fill: RED }],
    });
    expect(added.subpaths[0].stroke?.color).toEqual(BLUE);
  });
});
