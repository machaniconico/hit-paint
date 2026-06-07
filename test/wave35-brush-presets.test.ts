import { describe, expect, it } from 'vitest';
import {
  addPreset,
  createPresetLibrary,
  findPreset,
  removePreset,
  renamePreset,
} from '../src/engine/brush-presets';
import type { BrushSettings } from '../src/types';

const settings: BrushSettings = {
  shape: 'round',
  size: 12,
  opacity: 0.8,
  flow: 0.7,
  hardness: 0.6,
  spacing: 0.1,
  pressureSize: false,
  pressureOpacity: true,
};

describe('brush preset library', () => {
  it('creates an empty preset library', () => {
    expect(createPresetLibrary()).toEqual({ presets: [] });
  });

  it('adds presets without mutating the original library', () => {
    const library = createPresetLibrary();
    const next = addPreset(library, { name: 'Ink', settings });

    expect(library).toEqual({ presets: [] });
    expect(next.presets).toEqual([{ id: 'preset_0', name: 'Ink', settings }]);
    expect(next).not.toBe(library);
  });

  it('auto-assigns deterministic preset ids', () => {
    const first = addPreset(createPresetLibrary(), { name: 'Pencil', settings });
    const second = addPreset(first, { name: 'Marker', settings });
    const third = addPreset(second, { name: 'Airbrush', settings });

    expect(first.presets.map((preset) => preset.id)).toEqual(['preset_0']);
    expect(second.presets.map((preset) => preset.id)).toEqual(['preset_0', 'preset_1']);
    expect(third.presets.map((preset) => preset.id)).toEqual(['preset_0', 'preset_1', 'preset_2']);
  });

  it('uses an explicit preset id as-is', () => {
    const library = addPreset(createPresetLibrary(), {
      id: 'favorite_brush',
      name: 'Favorite',
      settings,
    });

    expect(library.presets[0].id).toBe('favorite_brush');
  });

  it('finds presets by id', () => {
    const library = addPreset(createPresetLibrary(), { id: 'liner', name: 'Liner', settings });

    expect(findPreset(library, 'liner')).toEqual({ id: 'liner', name: 'Liner', settings });
    expect(findPreset(library, 'missing')).toBeUndefined();
  });

  it('removes presets by id without mutating the original library', () => {
    const library = addPreset(
      addPreset(createPresetLibrary(), { id: 'keep', name: 'Keep', settings }),
      { id: 'remove', name: 'Remove', settings },
    );
    const next = removePreset(library, 'remove');

    expect(library.presets.map((preset) => preset.id)).toEqual(['keep', 'remove']);
    expect(next.presets.map((preset) => preset.id)).toEqual(['keep']);
    expect(next).not.toBe(library);
  });

  it('renames presets by id without mutating the original library', () => {
    const library = addPreset(createPresetLibrary(), { id: 'brush', name: 'Old', settings });
    const next = renamePreset(library, 'brush', 'New');

    expect(library.presets[0].name).toBe('Old');
    expect(next.presets[0]).toEqual({ id: 'brush', name: 'New', settings });
    expect(next).not.toBe(library);
  });

  it('reproduces the same id sequence for the same operations', () => {
    const run = () => {
      const first = addPreset(createPresetLibrary(), { name: 'A', settings });
      const second = addPreset(first, { id: 'custom', name: 'B', settings });
      const third = addPreset(second, { name: 'C', settings });
      const fourth = addPreset(third, { id: 'preset_8', name: 'D', settings });
      return addPreset(fourth, { name: 'E', settings });
    };

    expect(run().presets.map((preset) => preset.id))
      .toEqual(['preset_0', 'custom', 'preset_1', 'preset_8', 'preset_9']);
    expect(run().presets.map((preset) => preset.id)).toEqual(run().presets.map((preset) => preset.id));
  });

  it('preserves optional tip PNG data', () => {
    const withTip = addPreset(createPresetLibrary(), {
      name: 'Textured',
      settings,
      tipPng: 'data:image/png;base64,AAAA',
    });
    const withoutTip = addPreset(withTip, { name: 'Plain', settings });

    expect(withTip.presets[0].tipPng).toBe('data:image/png;base64,AAAA');
    expect(withoutTip.presets[1]).not.toHaveProperty('tipPng');
  });
});
