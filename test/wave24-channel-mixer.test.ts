import { describe, expect, it } from 'vitest';
import { channelMixer, type ChannelMixerOptions } from '../src/filters/channel-mixer';

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function identityMix(): ChannelMixerOptions {
  return {
    red: { r: 1, g: 0, b: 0 },
    green: { r: 0, g: 1, b: 0 },
    blue: { r: 0, g: 0, b: 1 },
  };
}

describe('channelMixer', () => {
  it('keeps pixels byte-identical for identity mix', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      50, 60, 70, 80,
      200, 210, 220, 230,
    ]);
    const before = Array.from(pixels);

    channelMixer(pixels, 3, 1, identityMix());

    expect(Array.from(pixels)).toEqual(before);
  });

  it('swaps red and blue channels', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 77,
      200, 150, 100, 99,
    ]);

    channelMixer(pixels, 2, 1, {
      red: { r: 0, g: 0, b: 1 },
      green: { r: 0, g: 1, b: 0 },
      blue: { r: 1, g: 0, b: 0 },
    });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([30, 20, 10, 77]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([100, 150, 200, 99]);
  });

  it('writes monochrome output to all RGB channels', () => {
    const pixels = new Uint8ClampedArray([
      100, 50, 200, 123,
      20, 30, 40, 45,
    ]);

    channelMixer(pixels, 2, 1, {
      red: { r: 0.5, g: 0.5, b: 0 },
      green: { r: 0, g: 0, b: 0, constant: 255 },
      blue: { r: 0, g: 0, b: 0, constant: 255 },
      monochrome: true,
    });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([75, 75, 75, 123]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([25, 25, 25, 45]);
  });

  it('leaves mask coverage 0 unchanged and blends intermediate coverage', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
      100, 100, 100, 99,
    ]);

    channelMixer(pixels, 2, 1, {
      red: { r: 0, g: 0, b: 0, constant: 200 },
      green: { r: 0, g: 0, b: 0, constant: 50 },
      blue: { r: 0, g: 0, b: 0 },
      mask: new Uint8ClampedArray([0, 128]),
    });

    expect(pixelAt(pixels, 0, 0, 2)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(pixels, 1, 0, 2)).toEqual([150, 75, 50, 99]);
  });

  it('adds channel constants to mixed output', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 88,
    ]);

    channelMixer(pixels, 1, 1, {
      red: { r: 1, g: 0, b: 0, constant: 50 },
      green: { r: 0, g: 1, b: 0 },
      blue: { r: 0, g: 0, b: 1 },
    });

    expect(pixelAt(pixels, 0, 0, 1)).toEqual([60, 20, 30, 88]);
  });

  it('does not throw or mutate for non-positive dimensions', () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 40,
    ]);
    const before = Array.from(pixels);

    expect(() => channelMixer(pixels, 0, 1, identityMix())).not.toThrow();
    expect(() => channelMixer(pixels, 1, 0, identityMix())).not.toThrow();
    expect(() => channelMixer(pixels, -1, 1, identityMix())).not.toThrow();

    expect(Array.from(pixels)).toEqual(before);
  });
});
