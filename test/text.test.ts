import { describe, expect, it } from 'vitest';
import { glyph } from '../src/text/font5x7';
import { measureText, renderText } from '../src/text';
import type { RGBA } from '../src/types';

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE_HALF: RGBA = { r: 0, g: 0, b: 255, a: 128 };

function transparentBuffer(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

function pixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): RGBA {
  const i = (y * width + x) * 4;
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
}

describe('font5x7 glyph', () => {
  it('returns printable ASCII glyph rows and falls back to space', () => {
    for (let code = 0x20; code <= 0x7e; code++) {
      const rows = glyph(String.fromCharCode(code));
      expect(rows).toHaveLength(7);
      expect(rows.every((row) => row >= 0 && row <= 0b11111)).toBe(true);
    }

    expect(glyph('\u{1f600}')).toEqual(glyph(' '));
  });
});

describe('renderText', () => {
  it('draws known on/off pixels for a single glyph', () => {
    const width = 8;
    const pixels = transparentBuffer(width, 8);

    renderText(pixels, width, 8, { text: 'A', x: 1, y: 0, color: BLACK });

    expect(pixel(pixels, width, 2, 0)).toEqual(BLACK);
    expect(pixel(pixels, width, 1, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(pixel(pixels, width, 1, 3)).toEqual(BLACK);
  });

  it('scales glyph pixels and measured dimensions', () => {
    const width = 16;
    const pixels = transparentBuffer(width, 16);

    renderText(pixels, width, 16, { text: 'A', x: 0, y: 0, color: RED, scale: 2 });

    expect(measureText('A', { scale: 2 })).toEqual({ width: 10, height: 14 });
    expect(pixel(pixels, width, 2, 0)).toEqual(RED);
    expect(pixel(pixels, width, 3, 1)).toEqual(RED);
    expect(pixel(pixels, width, 0, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('composites the requested color alpha into the target pixels', () => {
    const width = 8;
    const pixels = transparentBuffer(width, 8);

    renderText(pixels, width, 8, { text: 'A', x: 0, y: 0, color: BLUE_HALF });

    expect(pixel(pixels, width, 1, 0)).toEqual(BLUE_HALF);
  });

  it('handles newlines by increasing measured height and resetting x', () => {
    const width = 8;
    const pixels = transparentBuffer(width, 18);

    renderText(pixels, width, 18, { text: 'A\nA', x: 1, y: 0, color: RED });

    expect(measureText('A\nA')).toEqual({ width: 5, height: 16 });
    expect(pixel(pixels, width, 2, 0)).toEqual(RED);
    expect(pixel(pixels, width, 2, 9)).toEqual(RED);
  });

  it('leaves pixels unchanged when the selection mask coverage is zero', () => {
    const width = 8;
    const pixels = new Uint8ClampedArray(width * 8 * 4).fill(33);
    const before = new Uint8ClampedArray(pixels);
    const mask = new Uint8ClampedArray(width * 8);

    renderText(pixels, width, 8, { text: 'A', x: 0, y: 0, color: RED, mask });

    expect(pixels).toEqual(before);
  });

  it('clips glyph pixels outside the target bounds', () => {
    const width = 3;
    const pixels = transparentBuffer(width, 3);

    renderText(pixels, width, 3, { text: 'A', x: -1, y: -1, color: RED });

    expect(pixel(pixels, width, 0, 2)).toEqual(RED);
    expect(pixel(pixels, width, 1, 0)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(pixel(pixels, width, 2, 2)).toEqual(RED);
  });
});
