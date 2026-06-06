// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { documentToSvg, pathToSvgD, shapeToSvg, vectorLayerToSvg } from '../src/io/svg';
import type { Layer, PaintDocument, RGBA } from '../src/types';
import type { ShapeData } from '../src/vector/shape';
import type { VectorLayerData, VectorPath } from '../src/vector/vector-layer';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

function layer(partial: Partial<Layer>): Layer {
  return {
    id: partial.id ?? 'layer',
    name: partial.name ?? 'layer',
    kind: partial.kind ?? 'raster',
    visible: partial.visible ?? true,
    opacity: partial.opacity ?? 1,
    blendMode: partial.blendMode ?? 'normal',
    locked: partial.locked ?? false,
    clipping: partial.clipping ?? false,
    ...partial,
  };
}

describe('wave31 SVG export', () => {
  it('exports rect shapes with size, fill, and corner radius attributes', () => {
    const shape: ShapeData = {
      shape: 'rect',
      x: 2,
      y: 3,
      width: 10,
      height: 8,
      cornerRadius: 2,
      style: { fill: RED, stroke: { color: BLUE, width: 1 } },
    };

    const svg = shapeToSvg(shape);

    expect(svg).toContain('<rect ');
    expect(svg).toContain('width="10"');
    expect(svg).toContain('height="8"');
    expect(svg).toContain('fill="rgba(255,0,0,1.00)"');
    expect(svg).toContain('stroke="rgba(0,0,255,1.00)"');
    expect(svg).toContain('rx="2"');
  });

  it('exports ellipse shapes as ellipse elements', () => {
    const shape: ShapeData = {
      shape: 'ellipse',
      x: 4,
      y: 6,
      width: 20,
      height: 10,
      style: { fill: GREEN },
    };

    const svg = shapeToSvg(shape);

    expect(svg).toContain('<ellipse ');
    expect(svg).toContain('cx="14"');
    expect(svg).toContain('cy="11"');
    expect(svg).toContain('rx="10"');
    expect(svg).toContain('ry="5"');
  });

  it('exports SVG path data for lines, cubic curves, and closed paths', () => {
    const linePath: VectorPath = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
    };
    const cubicPath: VectorPath = {
      closed: false,
      points: [
        { x: 0, y: 0, outX: 0, outY: 10 },
        { x: 10, y: 0, inX: 10, inY: 10 },
      ],
    };
    const closedPath: VectorPath = {
      closed: true,
      points: [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 5 },
      ],
    };

    expect(pathToSvgD(linePath)).toContain('M 0 0 L 10 5');
    expect(pathToSvgD(cubicPath)).toContain('C');
    expect(pathToSvgD(closedPath)).toContain('Z');
  });

  it('exports vector layer subpaths with fill, stroke, and dash attributes', () => {
    const data: VectorLayerData = {
      subpaths: [
        {
          path: {
            closed: true,
            points: [
              { x: 1, y: 1 },
              { x: 8, y: 1 },
              { x: 4, y: 6 },
            ],
          },
          fill: RED,
          stroke: { color: BLUE, width: 2, dashArray: [3, 1] },
        },
        {
          path: {
            closed: false,
            points: [
              { x: 0, y: 8 },
              { x: 10, y: 8 },
            ],
          },
          stroke: { color: GREEN, width: 1 },
        },
      ],
    };

    const svg = vectorLayerToSvg(data);

    expect(svg.match(/<path d=/g)).toHaveLength(2);
    expect(svg).toContain('fill="rgba(255,0,0,1.00)"');
    expect(svg).toContain('stroke="rgba(0,0,255,1.00)"');
    expect(svg).toContain('stroke-dasharray="3 1"');
    expect(svg).toContain('stroke="rgba(0,255,0,1.00)"');
  });

  it('exports document SVG with editable vector layers and ignores raster-only layers', () => {
    const shapeData: ShapeData = {
      shape: 'rect',
      x: 1,
      y: 2,
      width: 6,
      height: 4,
      style: { fill: RED },
    };
    const vectorData: VectorLayerData = {
      subpaths: [{
        path: {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 12, y: 12 },
          ],
        },
        stroke: { color: BLUE, width: 1 },
      }],
    };
    const rasterOnly = layer({
      id: 'raster',
      name: 'raster only',
      pixels: new Uint8ClampedArray(12 * 12 * 4).fill(255),
    });
    const doc: PaintDocument = {
      id: 'doc',
      name: 'svg doc',
      width: 12,
      height: 12,
      dpi: 72,
      layers: [
        rasterOnly,
        layer({ id: 'shape', name: 'shape', shapeData }),
        layer({ id: 'vector', name: 'vector', vectorData }),
      ],
      activeLayerId: 'vector',
      selection: null,
    };

    const svg = documentToSvg(doc);

    expect(svg).toContain('<svg ');
    expect(svg).toContain('width="12"');
    expect(svg).toContain('height="12"');
    expect(svg).toContain('<rect ');
    expect(svg).toContain('<path d=');
    expect(svg.match(/<rect |<path d=/g)).toHaveLength(2);
  });
});
