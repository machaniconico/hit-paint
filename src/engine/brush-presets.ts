import type { BrushSettings } from '../types';

export interface BrushPreset {
  id: string;
  name: string;
  settings: BrushSettings;
  tipPng?: string;
}

export interface BrushPresetLibrary {
  presets: BrushPreset[];
}

export type BrushPresetInput = Omit<BrushPreset, 'id'> & { id?: string };

const AUTO_ID_PATTERN = /^preset_(\d+)$/;

function nextPresetId(library: BrushPresetLibrary): string {
  let maxId = -1;

  for (const preset of library.presets) {
    const match = AUTO_ID_PATTERN.exec(preset.id);

    if (match) {
      maxId = Math.max(maxId, Number(match[1]));
    }
  }

  return `preset_${maxId + 1}`;
}

export function createPresetLibrary(): BrushPresetLibrary {
  return { presets: [] };
}

export function addPreset(library: BrushPresetLibrary, preset: BrushPresetInput): BrushPresetLibrary {
  const id = preset.id ?? nextPresetId(library);

  return {
    presets: [
      ...library.presets,
      {
        ...preset,
        id,
      },
    ],
  };
}

export function findPreset(library: BrushPresetLibrary, id: string): BrushPreset | undefined {
  return library.presets.find((preset) => preset.id === id);
}

export function removePreset(library: BrushPresetLibrary, id: string): BrushPresetLibrary {
  return {
    presets: library.presets.filter((preset) => preset.id !== id),
  };
}

export function renamePreset(library: BrushPresetLibrary, id: string, name: string): BrushPresetLibrary {
  return {
    presets: library.presets.map((preset) => (
      preset.id === id
        ? { ...preset, name }
        : preset
    )),
  };
}
