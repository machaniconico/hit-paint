import { describe, expect, it } from 'vitest';

import {
  addToGroup,
  moveLayer,
  removeFromGroup,
  reorderChildren,
} from '../src/core/group-ops';
import type { Layer, PaintDocument } from '../src/types';

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

function group(id: string, children: string[] = []): Layer {
  return {
    id,
    name: id,
    kind: 'group',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    clipping: false,
    children,
  };
}

function docWith(layers: Layer[]): PaintDocument {
  return {
    id: 'doc',
    name: 'group ops test',
    width: 4,
    height: 4,
    dpi: 72,
    layers,
    activeLayerId: layers[0]?.id ?? null,
    selection: null,
  };
}

function ids(doc: PaintDocument): string[] {
  return doc.layers.map((layer) => layer.id);
}

describe('group operations', () => {
  it('moves a layer in flat order without mutating the original layers array', () => {
    const layers = [raster('a'), raster('b'), raster('c')];
    const doc = docWith(layers);

    const next = moveLayer(doc, 'a', 2);

    expect(ids(next)).toEqual(['b', 'c', 'a']);
    expect(ids(doc)).toEqual(['a', 'b', 'c']);
    expect(doc.layers).toBe(layers);
    expect(next).not.toBe(doc);
    expect(next.layers).not.toBe(doc.layers);
  });

  it('clamps moveLayer target indexes into the flat layer range', () => {
    const doc = docWith([raster('a'), raster('b'), raster('c')]);

    expect(ids(moveLayer(doc, 'b', -20))).toEqual(['b', 'a', 'c']);
    expect(ids(moveLayer(doc, 'b', 99))).toEqual(['a', 'c', 'b']);
  });

  it('adds a layer to the end of group children without duplicating it', () => {
    const baseGroup = group('g', ['a']);
    const doc = docWith([raster('a'), raster('b'), baseGroup]);

    const added = addToGroup(doc, 'b', 'g');
    const repeated = addToGroup(added, 'b', 'g');

    expect(added.layers[2].children).toEqual(['a', 'b']);
    expect(repeated.layers[2].children).toEqual(['a', 'b']);
    expect(baseGroup.children).toEqual(['a']);
  });

  it('does not add missing layers, missing groups, or self references', () => {
    const doc = docWith([raster('a'), group('g', ['a'])]);

    const missingLayer = addToGroup(doc, 'missing', 'g');
    const missingGroup = addToGroup(doc, 'a', 'missing');
    const selfReference = addToGroup(doc, 'g', 'g');

    expect(missingLayer).not.toBe(doc);
    expect(missingLayer.layers[1].children).toEqual(['a']);
    expect(missingGroup.layers[1].children).toEqual(['a']);
    expect(selfReference.layers[1].children).toEqual(['a']);
  });

  it('removes a layer id from group children', () => {
    const baseGroup = group('g', ['a', 'b', 'c']);
    const doc = docWith([raster('a'), raster('b'), raster('c'), baseGroup]);

    const next = removeFromGroup(doc, 'b', 'g');

    expect(next.layers[3].children).toEqual(['a', 'c']);
    expect(baseGroup.children).toEqual(['a', 'b', 'c']);
  });

  it('reorders group children and clamps indexes within the children range', () => {
    const doc = docWith([raster('a'), raster('b'), raster('c'), group('g', ['a', 'b', 'c'])]);

    const movedToEnd = reorderChildren(doc, 'g', 0, 99);
    const movedToStart = reorderChildren(doc, 'g', 99, -10);

    expect(movedToEnd.layers[3].children).toEqual(['b', 'c', 'a']);
    expect(movedToStart.layers[3].children).toEqual(['c', 'a', 'b']);
  });

  it('keeps the original document, layer array, and children arrays immutable', () => {
    const originalGroup = group('g', ['a']);
    const layers = [raster('a'), raster('b'), originalGroup];
    const doc = docWith(layers);
    const originalChildren = originalGroup.children;

    const next = addToGroup(doc, 'b', 'g');

    expect(next).not.toBe(doc);
    expect(next.layers).not.toBe(doc.layers);
    expect(next.layers[2]).not.toBe(originalGroup);
    expect(next.layers[2].children).not.toBe(originalChildren);
    expect(originalGroup.children).toEqual(['a']);
    expect(doc.layers).toBe(layers);
    expect(ids(doc)).toEqual(['a', 'b', 'g']);
  });
});
