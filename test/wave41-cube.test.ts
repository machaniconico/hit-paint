import { describe, it, expect } from 'vitest';
import { parseCubeLut, writeCubeLut } from '../src/io/cube';
import { identityLut, type Lut3D } from '../src/color/lut';

/**
 * Wave41 US-4302: .cube LUT パーサ/ライター (Adobe/IRIDAS) のテスト。
 *
 * 検証制約: jsdom で canvas 不可のため、純粋な配列ロジックのみで検証する。
 * Lut3D.data の格納順 (((bi*size+gi)*size+ri)*3, R 最速/blue 最外) が
 * .cube 標準の行順と一致することを確認する。
 */

/** data の特定ノード (ri,gi,bi) の RGB を取り出すヘルパ。 */
function nodeAt(lut: Lut3D, ri: number, gi: number, bi: number): [number, number, number] {
  const o = ((bi * lut.size + gi) * lut.size + ri) * 3;
  return [lut.data[o], lut.data[o + 1], lut.data[o + 2]];
}

describe('parseCubeLut: 基本パース', () => {
  it('SIZE=2 の 8 行を格納順 (R 最速) 通りに data へ詰める', () => {
    // 8 ノードを R が最速で変化する順に列挙 (.cube 標準)
    const text = [
      'LUT_3D_SIZE 2',
      '0.0 0.0 0.0', // (ri0,gi0,bi0)
      '1.0 0.0 0.0', // (ri1,gi0,bi0)  ← R が先に変化
      '0.0 1.0 0.0', // (ri0,gi1,bi0)
      '1.0 1.0 0.0', // (ri1,gi1,bi0)
      '0.0 0.0 1.0', // (ri0,gi0,bi1)
      '1.0 0.0 1.0', // (ri1,gi0,bi1)
      '0.0 1.0 1.0', // (ri0,gi1,bi1)
      '1.0 1.0 1.0', // (ri1,gi1,bi1)
    ].join('\n');

    const lut = parseCubeLut(text);
    expect(lut.size).toBe(2);
    expect(lut.data.length).toBe(8 * 3);

    // 行順 = data 格納順なので連続して一致するはず
    expect(Array.from(lut.data)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1,
    ]);

    // R 最速規約: (ri1,gi0,bi0) は赤 = (1,0,0)
    expect(nodeAt(lut, 1, 0, 0)).toEqual([1, 0, 0]);
    // blue 最外: (ri0,gi0,bi1) は青 = (0,0,1)
    expect(nodeAt(lut, 0, 0, 1)).toEqual([0, 0, 1]);
  });

  it('TITLE / # コメント / 空行 / 前後空白を含んでも正しくパースする', () => {
    const text = [
      '# これはコメント行',
      'TITLE "My Grade"',
      '',
      '   LUT_3D_SIZE 2   ',
      '# データ開始',
      '  0.0 0.0 0.0  ',
      '',
      '1.0 0.0 0.0',
      '0.0 1.0 0.0',
      '1.0 1.0 0.0',
      '   0.0 0.0 1.0',
      '1.0 0.0 1.0',
      '0.0 1.0 1.0',
      '1.0   1.0   1.0',
      '   ',
    ].join('\n');

    const lut = parseCubeLut(text);
    expect(lut.size).toBe(2);
    expect(lut.data.length).toBe(24);
    expect(nodeAt(lut, 0, 0, 0)).toEqual([0, 0, 0]);
    expect(nodeAt(lut, 1, 1, 1)).toEqual([1, 1, 1]);
  });
});

describe('parseCubeLut: DOMAIN 正規化', () => {
  it('DOMAIN_MIN/MAX 指定で [min,max] を 0..1 へ正規化する', () => {
    // DOMAIN を 0..255 にし、データ値 128/255 等が 0..1 へ正規化されることを確認
    const text = [
      'LUT_3D_SIZE 2',
      'DOMAIN_MIN 0 0 0',
      'DOMAIN_MAX 255 255 255',
      '0 0 0',
      '255 0 0',
      '0 255 0',
      '255 255 0',
      '0 0 255',
      '255 0 255',
      '0 255 255',
      '255 255 255',
    ].join('\n');

    const lut = parseCubeLut(text);
    // 255 → 1.0, 0 → 0.0 へ正規化
    expect(nodeAt(lut, 1, 0, 0)).toEqual([1, 0, 0]);
    expect(nodeAt(lut, 1, 1, 1)).toEqual([1, 1, 1]);
    expect(nodeAt(lut, 0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('非自明な DOMAIN_MIN でも線形に正規化する', () => {
    // min=1, max=3, span=2 → 値2 は (2-1)/2 = 0.5
    const text = [
      'LUT_3D_SIZE 2',
      'DOMAIN_MIN 1 1 1',
      'DOMAIN_MAX 3 3 3',
      '1 1 1', // → 0,0,0
      '2 1 1', // → 0.5,0,0
      '1 2 1',
      '2 2 1',
      '1 1 2',
      '2 1 2',
      '1 2 2',
      '3 3 3', // → 1,1,1
    ].join('\n');

    const lut = parseCubeLut(text);
    expect(nodeAt(lut, 0, 0, 0)).toEqual([0, 0, 0]);
    const [r] = nodeAt(lut, 1, 0, 0);
    expect(r).toBeCloseTo(0.5, 6);
    expect(nodeAt(lut, 1, 1, 1)).toEqual([1, 1, 1]);
  });
});

describe('parseCubeLut: 不正入力', () => {
  it('LUT_3D_SIZE 欠落は throw', () => {
    const text = ['0.0 0.0 0.0', '1.0 1.0 1.0'].join('\n');
    expect(() => parseCubeLut(text)).toThrow(/LUT_3D_SIZE/);
  });

  it('データ行数不足は throw', () => {
    const text = ['LUT_3D_SIZE 2', '0.0 0.0 0.0', '1.0 1.0 1.0'].join('\n');
    expect(() => parseCubeLut(text)).toThrow(/行数/);
  });

  it('LUT_1D_SIZE は未対応として throw', () => {
    const text = ['LUT_1D_SIZE 4', '0 0 0', '1 1 1'].join('\n');
    expect(() => parseCubeLut(text)).toThrow(/LUT_1D_SIZE/);
  });

  it('数値でないデータ値は throw', () => {
    const text = [
      'LUT_3D_SIZE 2',
      '0.0 0.0 0.0',
      'foo 0.0 0.0',
      '0.0 1.0 0.0',
      '1.0 1.0 0.0',
      '0.0 0.0 1.0',
      '1.0 0.0 1.0',
      '0.0 1.0 1.0',
      '1.0 1.0 1.0',
    ].join('\n');
    expect(() => parseCubeLut(text)).toThrow(/数値/);
  });
});

describe('writeCubeLut', () => {
  it('出力に LUT_3D_SIZE 行と N^3 のデータ行を含む', () => {
    const lut = identityLut(2);
    const out = writeCubeLut(lut, 'Identity');
    const lines = out.split('\n').filter((l) => l.trim().length > 0);

    expect(out).toContain('TITLE "Identity"');
    expect(out).toContain('LUT_3D_SIZE 2');

    // データ行 = "R G B" の数値 3 つ。8 行あるはず。
    const dataLines = lines.filter((l) => /^[-\d.\s]+$/.test(l) && l.trim().split(/\s+/).length === 3);
    expect(dataLines.length).toBe(8);
  });

  it('SIZE=3 でもデータ行数が N^3=27 になる', () => {
    const lut = identityLut(3);
    const out = writeCubeLut(lut);
    const dataLines = out
      .split('\n')
      .filter((l) => /^[-\d.\s]+$/.test(l) && l.trim().split(/\s+/).length === 3);
    expect(dataLines.length).toBe(27);
  });
});

describe('ラウンドトリップ', () => {
  it('identityLut(2) を write → parse して data が一致する', () => {
    const original = identityLut(2);
    const text = writeCubeLut(original, 'RT');
    const restored = parseCubeLut(text);

    expect(restored.size).toBe(original.size);
    expect(restored.data.length).toBe(original.data.length);
    for (let i = 0; i < original.data.length; i++) {
      expect(restored.data[i]).toBeCloseTo(original.data[i], 5);
    }
  });

  it('identityLut(4) でもラウンドトリップで一致する', () => {
    const original = identityLut(4);
    const text = writeCubeLut(original);
    const restored = parseCubeLut(text);

    expect(restored.size).toBe(4);
    for (let i = 0; i < original.data.length; i++) {
      expect(restored.data[i]).toBeCloseTo(original.data[i], 5);
    }
  });

  it('parse → write → parse でデータが安定する', () => {
    const text1 = [
      'LUT_3D_SIZE 2',
      '0.1 0.2 0.3',
      '0.9 0.2 0.3',
      '0.1 0.8 0.3',
      '0.9 0.8 0.3',
      '0.1 0.2 0.7',
      '0.9 0.2 0.7',
      '0.1 0.8 0.7',
      '0.9 0.8 0.7',
    ].join('\n');

    const lut1 = parseCubeLut(text1);
    const text2 = writeCubeLut(lut1);
    const lut2 = parseCubeLut(text2);

    for (let i = 0; i < lut1.data.length; i++) {
      expect(lut2.data[i]).toBeCloseTo(lut1.data[i], 5);
    }
  });
});
