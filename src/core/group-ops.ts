import type { Layer, LayerId, PaintDocument } from '../types';

function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), max));
}

function copyLayer(layer: Layer): Layer {
  if (layer.kind !== 'group') return { ...layer };
  return {
    ...layer,
    children: [...(layer.children ?? [])],
  };
}

function copyDocument(doc: PaintDocument, layers = doc.layers.map(copyLayer)): PaintDocument {
  return {
    ...doc,
    layers,
  };
}

function findCopiedGroup(layers: Layer[], groupId: LayerId): Layer | undefined {
  const group = layers.find((layer) => layer.id === groupId);
  return group?.kind === 'group' ? group : undefined;
}

export function moveLayer(doc: PaintDocument, id: LayerId, toIndex: number): PaintDocument {
  const fromIndex = doc.layers.findIndex((layer) => layer.id === id);
  const layers = doc.layers.map(copyLayer);
  if (fromIndex < 0) return copyDocument(doc, layers);

  const [layer] = layers.splice(fromIndex, 1);
  layers.splice(clampIndex(toIndex, layers.length), 0, layer);
  return copyDocument(doc, layers);
}

export function addToGroup(
  doc: PaintDocument,
  layerId: LayerId,
  groupId: LayerId,
): PaintDocument {
  const layers = doc.layers.map(copyLayer);
  const layer = layers.find((item) => item.id === layerId);
  const group = findCopiedGroup(layers, groupId);
  if (!layer || !group || layerId === groupId) return copyDocument(doc, layers);

  const children = group.children ?? [];
  if (children.includes(layerId)) return copyDocument(doc, layers);

  group.children = [...children, layerId];
  return copyDocument(doc, layers);
}

export function removeFromGroup(
  doc: PaintDocument,
  layerId: LayerId,
  groupId: LayerId,
): PaintDocument {
  const layers = doc.layers.map(copyLayer);
  const group = findCopiedGroup(layers, groupId);
  if (!group) return copyDocument(doc, layers);

  group.children = (group.children ?? []).filter((id) => id !== layerId);
  return copyDocument(doc, layers);
}

export function reorderChildren(
  doc: PaintDocument,
  groupId: LayerId,
  fromIndex: number,
  toIndex: number,
): PaintDocument {
  const layers = doc.layers.map(copyLayer);
  const group = findCopiedGroup(layers, groupId);
  const children = group?.children ?? [];
  if (!group || children.length === 0) return copyDocument(doc, layers);

  const from = clampIndex(fromIndex, children.length - 1);
  const [child] = children.splice(from, 1);
  children.splice(clampIndex(toIndex, children.length), 0, child);
  group.children = children;
  return copyDocument(doc, layers);
}
