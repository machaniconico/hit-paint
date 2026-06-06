import { beforeEach, describe, expect, it } from 'vitest';

import { useStore } from '../src/state/store';

function resetStore(): void {
  useStore.getState().newDocument(8, 8, 'store wave7');
  useStore.getState().setMaskEditMode(false);
  useStore.getState().setTool('brush');
  useStore.getState().setBrush({ size: 4, hardness: 1 });
}

describe('wave7 store wiring', () => {
  beforeEach(() => {
    resetStore();
  });

  it('adds and selects an adjustment layer above the active layer', () => {
    const before = useStore.getState().doc;
    const activeIndex = before.layers.findIndex((layer) => layer.id === before.activeLayerId);

    useStore.getState().addAdjustmentLayer('invert');

    const after = useStore.getState().doc;
    const layer = after.layers.find((item) => item.id === after.activeLayerId);
    expect(after.layers).toHaveLength(before.layers.length + 1);
    expect(after.layers[activeIndex + 1]).toBe(layer);
    expect(layer?.kind).toBe('adjustment');
    expect(layer?.adjustment?.type).toBe('invert');
  });

  it('creates a mask on the active raster layer and changes the dab center', () => {
    useStore.getState().setTool('eraser');

    useStore.getState().paintActiveLayerMaskDab(4, 4);

    const { doc } = useStore.getState();
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
    expect(layer?.mask).toBeInstanceOf(Uint8ClampedArray);
    expect(layer?.mask?.[4 * doc.width + 4]).toBe(0);
  });

  it('reflects mask edit mode toggles in store state', () => {
    useStore.getState().setMaskEditMode(true);
    expect(useStore.getState().maskEditMode).toBe(true);

    useStore.getState().setMaskEditMode(false);
    expect(useStore.getState().maskEditMode).toBe(false);
  });

  it('routes brush stroke samples to the active layer mask when mask edit mode is on', () => {
    useStore.getState().setTool('eraser');
    useStore.getState().setMaskEditMode(true);

    useStore.getState().beginStroke({ x: 2, y: 2, pressure: 1, t: 0 });
    useStore.getState().extendStroke({ x: 5, y: 5, pressure: 1, t: 16 });
    useStore.getState().endStroke();

    const { doc } = useStore.getState();
    const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
    expect(layer?.pixels?.[3]).toBe(0);
    expect(layer?.mask?.[2 * doc.width + 2]).toBe(0);
    expect(layer?.mask?.[5 * doc.width + 5]).toBe(0);
  });

  it('adds and removes a layer id through group store actions', () => {
    const initialDoc = useStore.getState().doc;
    const layerId = initialDoc.layers[0].id;
    useStore.getState().addGroup();
    const group = useStore.getState().doc.layers.find((layer) => layer.kind === 'group');

    expect(group).toBeDefined();
    useStore.getState().moveLayerToGroupAction(layerId, group!.id);
    expect(useStore.getState().doc.layers.find((layer) => layer.id === group!.id)?.children).toContain(layerId);

    useStore.getState().removeLayerFromGroupAction(layerId, group!.id);
    expect(useStore.getState().doc.layers.find((layer) => layer.id === group!.id)?.children).not.toContain(layerId);
  });
});
