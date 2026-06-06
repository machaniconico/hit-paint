import { describe, expect, it } from 'vitest';
import { rgbToHsv } from '../src/color/color';
import { addSwatch, harmony, moveSwatch, removeSwatch } from '../src/color/palette';
import type { RGBA } from '../src/types';

const red: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const green: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const blue: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const halfRed: RGBA = { r: 255, g: 0, b: 0, a: 128 };

const hueOf = (color: RGBA): number => Math.round(rgbToHsv(color).h);
const normalizedHueDelta = (from: RGBA, to: RGBA): number => {
  const diff = hueOf(to) - hueOf(from);
  return ((diff % 360) + 360) % 360;
};

describe('palette swatches', () => {
  it('addSwatch adds a new color immutably', () => {
    const list = [red];
    const result = addSwatch(list, blue);

    expect(result).toEqual([red, blue]);
    expect(result).not.toBe(list);
    expect(list).toEqual([red]);
  });

  it('addSwatch does not add exact RGBA duplicates', () => {
    const list = [red, halfRed];
    const result = addSwatch(list, { ...red });

    expect(result).toEqual(list);
    expect(result).not.toBe(list);
  });

  it('removeSwatch removes the color at index immutably', () => {
    const list = [red, green, blue];
    const result = removeSwatch(list, 1);

    expect(result).toEqual([red, blue]);
    expect(result).not.toBe(list);
    expect(list).toEqual([red, green, blue]);
  });

  it('moveSwatch reorders colors and clamps the destination index', () => {
    const list = [red, green, blue];
    const result = moveSwatch(list, 0, 99);

    expect(result).toEqual([green, blue, red]);
    expect(result).not.toBe(list);
  });

  it('moveSwatch clamps the source index', () => {
    const list = [red, green, blue];
    const result = moveSwatch(list, -10, 1);

    expect(result).toEqual([green, red, blue]);
  });

  it('keeps the original array unchanged across swatch operations', () => {
    const list = [red, green, blue];

    addSwatch(list, halfRed);
    removeSwatch(list, 0);
    moveSwatch(list, 2, 0);

    expect(list).toEqual([red, green, blue]);
  });
});

describe('palette harmony', () => {
  it('returns the exact base color first without HSV round-trip drift', () => {
    const base: RGBA = { r: 200, g: 100, b: 50, a: 77 };
    const result = harmony(base, 'analogous');

    expect(result[0]).toEqual(base);
  });

  it('complementary returns base first plus a color at +180 degrees', () => {
    const result = harmony(red, 'complementary');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(red);
    expect(normalizedHueDelta(result[0], result[1])).toBe(180);
    expect(result[1].a).toBe(red.a);
  });

  it('triadic returns three colors separated by 120 degrees', () => {
    const result = harmony(red, 'triadic');

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(red);
    expect(normalizedHueDelta(result[0], result[1])).toBe(120);
    expect(normalizedHueDelta(result[1], result[2])).toBe(120);
    expect(normalizedHueDelta(result[2], result[0])).toBe(120);
  });

  it('analogous returns colors at -30 and +30 degrees from base', () => {
    const result = harmony(red, 'analogous');

    expect(result).toHaveLength(3);
    expect(normalizedHueDelta(result[0], result[1])).toBe(330);
    expect(normalizedHueDelta(result[0], result[2])).toBe(30);
  });

  it('tetradic returns colors at +90, +180, and +270 degrees', () => {
    const result = harmony(red, 'tetradic');

    expect(result).toHaveLength(4);
    expect(normalizedHueDelta(result[0], result[1])).toBe(90);
    expect(normalizedHueDelta(result[0], result[2])).toBe(180);
    expect(normalizedHueDelta(result[0], result[3])).toBe(270);
  });
});
