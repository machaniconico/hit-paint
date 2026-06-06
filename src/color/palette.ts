import { hsvToRgb, rgbToHsv } from './color';
import type { RGBA } from '../types';

export type HarmonyScheme = 'complementary' | 'analogous' | 'triadic' | 'tetradic';

const sameColor = (a: RGBA, b: RGBA): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

const clampIndex = (index: number, max: number): number =>
  Math.min(Math.max(Math.trunc(index), 0), max);

const rotateHue = (base: RGBA, degrees: number): RGBA => {
  const hsv = rgbToHsv(base);
  const rgb = hsvToRgb({ ...hsv, h: hsv.h + degrees });
  return { ...rgb, a: base.a };
};

export function addSwatch(list: RGBA[], color: RGBA): RGBA[] {
  return list.some((swatch) => sameColor(swatch, color)) ? [...list] : [...list, color];
}

export function removeSwatch(list: RGBA[], index: number): RGBA[] {
  if (index < 0 || index >= list.length) return [...list];
  return list.filter((_, i) => i !== index);
}

export function moveSwatch(list: RGBA[], from: number, to: number): RGBA[] {
  if (list.length === 0) return [];

  const fromIndex = clampIndex(from, list.length - 1);
  const toIndex = clampIndex(to, list.length - 1);
  const next = [...list];
  const [swatch] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, swatch);
  return next;
}

export function harmony(base: RGBA, scheme: HarmonyScheme): RGBA[] {
  const rotations: Record<HarmonyScheme, number[]> = {
    complementary: [180],
    analogous: [-30, 30],
    triadic: [120, 240],
    tetradic: [90, 180, 270],
  };

  return [base, ...rotations[scheme].map((degrees) => rotateHue(base, degrees))];
}
