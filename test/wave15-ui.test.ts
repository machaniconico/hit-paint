import { beforeEach, describe, expect, it } from 'vitest';

import { composite } from '../src/core/compositor';
import { createRasterLayer } from '../src/core/document';
import { StrokeEngine } from '../src/engine/brush';
import { useStore } from '../src/state/store';
import type { BrushSettings, Layer, PaintDocument, PointerSample, RGBA } from '../src/types';

const red: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const green: RGBA = { r: 0, g: 255, b: 0, a: 255 };
const blue: RGBA = { r: 0, g: 0, b: 255, a: 255 };

const brush: BrushSettings = {
  shape: 'pixel',
  size: 2,
  opacity: 1,
  flow: 1,
  hardness: 1,
  spacing: 1,
  pressureSize: false,
  pressureOpacity: false,
};

function resetStore(width = 8, height = 4): void {
  useStore.getState().newDocument(width, height, 'wave15');
  useStore.setState({
    tool: 'brush',
    brush,
    primary: red,
    secondary: blue,
    dynamics: { sizeJitter: 0, opacityJitter: 0, scatter: 0, seed: 0 },
    symmetry: { mode: 'none', centerX: width / 2, centerY: height / 2, slices: 6 },
    swatches: [],
    maskEditMode: false,
  });
}

function activePixels(): Uint8ClampedArray {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer?.pixels) throw new Error('active layer has no pixels');
  return layer.pixels;
}

function alphaAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): number {
  return pixels[(y * width + x) * 4 + 3];
}

function stroke(sample: PointerSample): void {
  useStore.getState().beginStroke(sample);
  useStore.getState().endStroke();
}

function docWith(width: number, height: number, layers: Layer[]): PaintDocument {
  return {
    id: 'doc',
    name: 'merge test',
    width,
    height,
    dpi: 72,
    layers,
    activeLayerId: layers[layers.length - 1]?.id ?? null,
    selection: null,
  };
}

describe('wave15 store UI wiring', () => {
  beforeEach(() => {
    resetStore();
  });

  it('setSymmetry makes beginStroke paint the horizontal mirror point', () => {
    useStore.getState().setSymmetry({ mode: 'horizontal', centerX: 4, centerY: 2 });

    stroke({ x: 1, y: 1, pressure: 1, t: 0 });

    const pixels = activePixels();
    expect(alphaAt(pixels, 8, 1, 1)).toBeGreaterThan(0);
    expect(alphaAt(pixels, 8, 7, 1)).toBeGreaterThan(0);
  });

  it('zero dynamics keeps a single dab byte-identical to the original brush engine', () => {
    const sample = { x: 3, y: 2, pressure: 1, t: 0 };
    const expected = new Uint8ClampedArray(8 * 4 * 4);
    const engine = new StrokeEngine(8, 4, brush, false);
    engine.addSample(sample);
    engine.commit(expected, red, null);

    stroke(sample);

    expect(Array.from(activePixels())).toEqual(Array.from(expected));
  });

  it('swatches can add the primary color and select it back into primary', () => {
    useStore.getState().setPrimary(red);
    useStore.getState().addSwatchAction();
    useStore.getState().setPrimary(green);
    useStore.getState().addSwatchAction();

    useStore.getState().selectSwatch(0);

    expect(useStore.getState().swatches).toEqual([red, green]);
    expect(useStore.getState().primary).toEqual(red);
  });

  it('generateHarmony merges generated colors into swatches', () => {
    useStore.getState().setPrimary(red);

    useStore.getState().generateHarmony('triadic');

    expect(useStore.getState().swatches.length).toBe(3);
    expect(useStore.getState().swatches[0]).toEqual(red);
  });

  it('removeSwatchAction removes only the selected swatch', () => {
    useStore.getState().setPrimary(red);
    useStore.getState().addSwatchAction();
    useStore.getState().setPrimary(green);
    useStore.getState().addSwatchAction();

    useStore.getState().removeSwatchAction(0);

    expect(useStore.getState().swatches).toEqual([green]);
  });

  it('mergeDown respects a top layer mask and leaves hidden pixels as the lower layer', () => {
    const bottom = createRasterLayer(2, 1, 'bottom', blue);
    const top = createRasterLayer(2, 1, 'top', red);
    top.mask = new Uint8ClampedArray([255, 0]);
    const before = docWith(2, 1, [bottom, top]);
    const expected = Array.from(composite(before).data);
    useStore.getState().loadDocument(before);

    useStore.getState().mergeDown(top.id);

    const merged = useStore.getState().doc.layers[0].pixels;
    expect(merged).toBeDefined();
    expect(Array.from(merged!)).toEqual(expected);
    expect(Array.from(merged!.slice(4, 8))).toEqual([0, 0, 255, 255]);
  });

  it('mergeDown applies the top layer blendMode', () => {
    const bottom = createRasterLayer(1, 1, 'bottom', { r: 100, g: 100, b: 100, a: 255 });
    const top = createRasterLayer(1, 1, 'top', { r: 200, g: 50, b: 25, a: 255 });
    top.blendMode = 'multiply';
    const before = docWith(1, 1, [bottom, top]);
    const expected = Array.from(composite(before).data);
    useStore.getState().loadDocument(before);

    useStore.getState().mergeDown(top.id);

    const merged = useStore.getState().doc.layers[0].pixels;
    expect(merged).toBeDefined();
    expect(Array.from(merged!)).toEqual(expected);
  });
});
