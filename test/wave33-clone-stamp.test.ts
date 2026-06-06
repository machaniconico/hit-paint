import { describe, expect, it } from 'vitest';
import { cloneStampDab, type CloneStampOptions } from '../src/tools/clone-stamp';

type RGBA = [number, number, number, number];

function filled(width: number, height: number, color: RGBA): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = color[3];
  }

  return pixels;
}

function patterned(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(pixels, x, y, width, [x * 25 + y, y * 30 + x, x * 12 + y * 7, 255]);
    }
  }

  return pixels;
}

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number, width: number): RGBA {
  const i = 4 * (y * width + x);
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

function setPixel(pixels: Uint8ClampedArray, x: number, y: number, width: number, color: RGBA): void {
  const i = 4 * (y * width + x);
  pixels[i] = color[0];
  pixels[i + 1] = color[1];
  pixels[i + 2] = color[2];
  pixels[i + 3] = color[3];
}

function paintSourceCircle(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  color: RGBA,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius) {
        setPixel(pixels, x, y, width, color);
      }
    }
  }
}

describe('wave33 clone stamp', () => {
  it('src 領域の色が dst 中心にコピーされる', () => {
    const width = 9;
    const height = 9;
    const pixels = filled(width, height, [0, 0, 0, 255]);
    const red: RGBA = [255, 0, 0, 255];
    const opts: CloneStampOptions = {
      srcX: 2,
      srcY: 2,
      dstX: 6,
      dstY: 6,
      radius: 3,
      hardness: 1,
      opacity: 1,
    };
    setPixel(pixels, 2, 2, width, red);

    cloneStampDab(pixels, width, height, opts);

    expect(pixelAt(pixels, 6, 6, width)).toEqual(red);
  });

  it('opacity=0.5 で部分ブレンド', () => {
    const width = 5;
    const height = 3;
    const red: RGBA = [255, 0, 0, 255];
    const opts: CloneStampOptions = {
      srcX: 1,
      srcY: 1,
      dstX: 3,
      dstY: 1,
      radius: 2,
      hardness: 1,
      opacity: 0.5,
    };
    const blackDst = filled(width, height, [0, 0, 0, 255]);
    setPixel(blackDst, 1, 1, width, red);

    cloneStampDab(blackDst, width, height, opts);

    expect(pixelAt(blackDst, 3, 1, width)[0]).toBeGreaterThan(100);
    expect(pixelAt(blackDst, 3, 1, width)[0]).toBeLessThan(200);

    const whiteDst = filled(width, height, [255, 255, 255, 255]);
    setPixel(whiteDst, 1, 1, width, red);

    cloneStampDab(whiteDst, width, height, opts);

    expect(pixelAt(whiteDst, 3, 1, width)[1]).toBeGreaterThan(100);
    expect(pixelAt(whiteDst, 3, 1, width)[1]).toBeLessThan(200);
  });

  it('hardness<1 で縁が中心より薄い', () => {
    const width = 20;
    const height = 12;
    const pixels = filled(width, height, [0, 0, 0, 255]);
    const red: RGBA = [255, 0, 0, 255];
    paintSourceCircle(pixels, width, height, 4, 6, 5, red);

    cloneStampDab(pixels, width, height, {
      srcX: 4,
      srcY: 6,
      dstX: 14,
      dstY: 6,
      radius: 5,
      hardness: 0,
      opacity: 1,
    });

    const center = pixelAt(pixels, 14, 6, width)[0];
    const edge = pixelAt(pixels, 18, 6, width)[0];
    expect(center).toBeGreaterThan(edge);
  });

  it('radius<=0 で no-op', () => {
    const pixels = filled(4, 3, [20, 40, 60, 255]);
    const before = Array.from(pixels);

    cloneStampDab(pixels, 4, 3, {
      srcX: 0,
      srcY: 0,
      dstX: 2,
      dstY: 2,
      radius: 0,
    });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('mask coverage=0 の画素が不変', () => {
    const width = 7;
    const height = 7;
    const pixels = filled(width, height, [0, 0, 0, 255]);
    const mask = new Uint8ClampedArray(width * height);
    mask.fill(255);
    mask[3 * width + 3] = 0;
    setPixel(pixels, 1, 1, width, [255, 0, 0, 255]);

    cloneStampDab(pixels, width, height, {
      srcX: 1,
      srcY: 1,
      dstX: 3,
      dstY: 3,
      radius: 3,
      hardness: 1,
      opacity: 1,
      mask,
    });

    expect(pixelAt(pixels, 3, 3, width)).toEqual([0, 0, 0, 255]);
  });

  it('src 範囲外はスキップ', () => {
    const pixels = filled(4, 4, [12, 34, 56, 255]);
    const before = Array.from(pixels);

    cloneStampDab(pixels, 4, 4, {
      srcX: -100,
      srcY: -100,
      dstX: 2,
      dstY: 2,
      radius: 2,
      hardness: 1,
      opacity: 1,
    });

    expect(Array.from(pixels)).toEqual(before);
  });

  it('自己重なり: src と dst が重なっても決定論的', () => {
    const width = 8;
    const height = 7;
    const first = patterned(width, height);
    const second = new Uint8ClampedArray(first);
    const before = new Uint8ClampedArray(first);
    const opts: CloneStampOptions = {
      srcX: 2,
      srcY: 3,
      dstX: 3,
      dstY: 3,
      radius: 3,
      hardness: 1,
      opacity: 1,
    };

    cloneStampDab(first, width, height, opts);
    cloneStampDab(second, width, height, opts);

    expect(Array.from(first)).toEqual(Array.from(second));
    expect(pixelAt(first, 4, 3, width)).toEqual(pixelAt(before, 3, 3, width));
  });
});
