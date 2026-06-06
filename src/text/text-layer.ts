import type { RGBA } from '../types';
import { measureText, renderText } from './index';

export interface TextLayerData {
  text: string;
  x: number;
  y: number;
  color: RGBA;
  scale?: number;
  letterSpacing?: number;
}

const DEFAULT_TEXT_LAYER_DATA: TextLayerData = {
  text: '',
  x: 0,
  y: 0,
  color: { r: 0, g: 0, b: 0, a: 255 },
  scale: 1,
  letterSpacing: 1,
};

export function createTextLayerData(partial: Partial<TextLayerData> = {}): TextLayerData {
  return {
    ...DEFAULT_TEXT_LAYER_DATA,
    ...partial,
    color: partial.color ?? { ...DEFAULT_TEXT_LAYER_DATA.color },
  };
}

export function rasterizeTextLayer(
  data: TextLayerData,
  width: number,
  height: number,
  mask?: Uint8ClampedArray | null,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  renderText(pixels, width, height, { ...data, mask });
  return pixels;
}

export function updateTextLayerData(data: TextLayerData, patch: Partial<TextLayerData>): TextLayerData {
  return { ...data, ...patch };
}

export function measureTextLayer(data: TextLayerData): { width: number; height: number } {
  if (data.text.length === 0) return { width: 0, height: 0 };

  return measureText(data.text, {
    scale: data.scale,
    letterSpacing: data.letterSpacing,
  });
}
