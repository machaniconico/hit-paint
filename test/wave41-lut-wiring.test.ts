import { beforeEach, describe, expect, it } from 'vitest';

import {
  useStore,
  resolveLutPreset,
  lutFromCubeText,
  lutToCubeText,
  applyLutToBuffer,
} from '../src/state/store';
import { applyLut as applyLutToPixels } from '../src/color/lut';
import { parseCubeLut, writeCubeLut } from '../src/io/cube';
import {
  LUT_PRESETS,
  LUT_PRESET_NAMES,
  generateLut,
  warmTransform,
} from '../src/color/lut-presets';

/**
 * Wave41 (US-4304): store/App 配線テスト。
 *
 * jsdom では canvas API が使えないため、store アクションの核を切り出した
 * 純粋ヘルパ(resolveLutPreset / lutFromCubeText / lutToCubeText / applyLutToBuffer)
 * を直接検証し、配線が正しく既存ユニット(color/lut.ts, io/cube.ts, lut-presets.ts)へ
 * 委譲していることを示す。downloadBlob/pickFile 等のブラウザ API は呼ばない。
 */

function seedActiveLayer(width: number, height: number, pixels: Uint8ClampedArray): void {
  useStore.getState().newDocument(width, height, 'wave41 lut');
  const { doc } = useStore.getState();
  useStore.setState({
    doc: {
      ...doc,
      layers: doc.layers.map((layer) => (
        layer.id === doc.activeLayerId
          ? { ...layer, pixels: new Uint8ClampedArray(pixels) }
          : layer
      )),
      selection: null,
    },
  });
}

function activePixels(): Uint8ClampedArray {
  const { doc } = useStore.getState();
  const layer = doc.layers.find((item) => item.id === doc.activeLayerId);
  if (!layer?.pixels) throw new Error('active raster layer is missing pixels');
  return layer.pixels;
}

function gradientPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      pixels[i] = (x * 37 + y * 11) & 255;
      pixels[i + 1] = (y * 29 + x * 7) & 255;
      pixels[i + 2] = (64 + x * 13 + y * 5) & 255;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

describe('wave41 LUT 純粋ヘルパ', () => {
  it('resolveLutPreset は LUT_PRESETS と同じ LUT を返す', () => {
    for (const name of LUT_PRESET_NAMES) {
      const expected = LUT_PRESETS[name]();
      const actual = resolveLutPreset(name);
      expect(actual).not.toBeNull();
      expect(actual!.size).toBe(expected.size);
      expect(Array.from(actual!.data)).toEqual(Array.from(expected.data));
    }
  });

  it('resolveLutPreset(size) は指定 size の LUT を返す', () => {
    const expected = LUT_PRESETS.warm(5);
    const actual = resolveLutPreset('warm', 5);
    expect(actual!.size).toBe(5);
    expect(Array.from(actual!.data)).toEqual(Array.from(expected.data));
  });

  it('resolveLutPreset は未知の名前で null を返す', () => {
    expect(resolveLutPreset('__nope__')).toBeNull();
  });

  it('lutFromCubeText は parseCubeLut と一致する', () => {
    const lut = generateLut(3, warmTransform);
    const text = writeCubeLut(lut, 'warm-3');
    const viaHelper = lutFromCubeText(text);
    const viaParse = parseCubeLut(text);
    expect(viaHelper.size).toBe(viaParse.size);
    expect(Array.from(viaHelper.data)).toEqual(Array.from(viaParse.data));
  });

  it('lutToCubeText は writeCubeLut と一致する', () => {
    const lut = generateLut(4, warmTransform);
    expect(lutToCubeText(lut, 'x')).toBe(writeCubeLut(lut, 'x'));
  });

  it('applyLutToBuffer は color/lut.ts applyLut と同じ画素変換を行う', () => {
    const lut = LUT_PRESETS.sepia();
    const a = gradientPixels(6, 5);
    const b = new Uint8ClampedArray(a);
    applyLutToBuffer(a, 6, 5, lut);
    applyLutToPixels(b, 6, 5, lut);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('exportCubeLut 純粋部分は parse でラウンドトリップする', () => {
    const lut = LUT_PRESETS.cool();
    const text = lutToCubeText(lut, 'roundtrip');
    const parsed = lutFromCubeText(text);
    expect(parsed.size).toBe(lut.size);
    // .cube は 6 桁固定小数のため厳密一致ではなく近接で確認
    for (let i = 0; i < lut.data.length; i += 1) {
      expect(parsed.data[i]).toBeCloseTo(lut.data[i], 5);
    }
  });
});

describe('wave41 store アクション配線', () => {
  beforeEach(() => {
    seedActiveLayer(6, 5, gradientPixels(6, 5));
  });

  it('setLutPreset は currentLut を LUT_PRESETS の LUT にする', () => {
    useStore.getState().setLutPreset('warm');
    const lut = useStore.getState().currentLut;
    expect(lut).not.toBeNull();
    expect(Array.from(lut!.data)).toEqual(Array.from(LUT_PRESETS.warm().data));
  });

  it('setLutPreset は未知名で currentLut を変更しない', () => {
    useStore.setState({ currentLut: null });
    useStore.getState().setLutPreset('__nope__');
    expect(useStore.getState().currentLut).toBeNull();
  });

  it('importCubeLut は parseCubeLut の結果を currentLut に入れる', () => {
    const lut = generateLut(3, warmTransform);
    const text = writeCubeLut(lut);
    useStore.getState().importCubeLut(text);
    const got = useStore.getState().currentLut;
    expect(got!.size).toBe(3);
    expect(Array.from(got!.data)).toEqual(Array.from(parseCubeLut(text).data));
  });

  it('applyLut はアクティブ画素へ純粋ヘルパと同じ変換を破壊的適用する', () => {
    const lut = LUT_PRESETS.sepia();
    const expected = new Uint8ClampedArray(activePixels());
    applyLutToBuffer(expected, 6, 5, lut);

    useStore.setState({ currentLut: lut });
    useStore.getState().applyLut();

    expect(Array.from(activePixels())).toEqual(Array.from(expected));
  });

  it('applyLut の後 undo で元画素へ戻る', () => {
    const before = Array.from(activePixels());
    useStore.setState({ currentLut: LUT_PRESETS.cool() });
    useStore.getState().applyLut();
    expect(Array.from(activePixels())).not.toEqual(before);

    useStore.getState().undo();
    expect(Array.from(activePixels())).toEqual(before);
  });

  it('currentLut が null の applyLut は何もしない', () => {
    useStore.setState({ currentLut: null });
    const before = Array.from(activePixels());
    useStore.getState().applyLut();
    expect(Array.from(activePixels())).toEqual(before);
  });
});

describe('wave41 既存アクション回帰', () => {
  it('applyFilter("invert") は従来通りアクティブ画素を反転する', () => {
    seedActiveLayer(4, 4, gradientPixels(4, 4));
    const before = Array.from(activePixels());
    useStore.getState().applyFilter('invert');
    const after = Array.from(activePixels());
    expect(after).not.toEqual(before);
    // 反転: RGB は 255-x、α は不変
    for (let i = 0; i < before.length; i += 4) {
      expect(after[i]).toBe(255 - before[i]);
      expect(after[i + 1]).toBe(255 - before[i + 1]);
      expect(after[i + 2]).toBe(255 - before[i + 2]);
      expect(after[i + 3]).toBe(before[i + 3]);
    }
  });

  it('addAdjustmentLayer は従来通りレイヤーを 1 枚増やす', () => {
    useStore.getState().newDocument(4, 4, 'regress adj');
    const n0 = useStore.getState().doc.layers.length;
    useStore.getState().addAdjustmentLayer('brightness-contrast', { brightness: 10 });
    expect(useStore.getState().doc.layers.length).toBe(n0 + 1);
  });
});
