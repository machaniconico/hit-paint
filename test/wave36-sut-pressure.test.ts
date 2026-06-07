import { describe, expect, it } from 'vitest';
import {
  curveIsFlat,
  curveLooksLikePressureResponse,
  decodePressureCurve,
  findPressureCurves,
  samplePressureCurve,
} from '../src/io/sut-pressure';

/** float64BE の制御点列を持つカーブブロック([12][N][16] + N×f64BE)を組み立てる。 */
function makeCurveBlock(values: number[]): Uint8Array {
  const bytes = new Uint8Array(12 + values.length * 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 12, false);
  view.setUint32(4, values.length, false);
  view.setUint32(8, 16, false);
  values.forEach((v, i) => view.setFloat64(12 + i * 8, v, false));
  return bytes;
}

describe('decodePressureCurve', () => {
  it('decodes a hand-built block into its control points', () => {
    const blob = makeCurveBlock([0.0, 0.5, 1.0]);
    const curve = decodePressureCurve(blob);

    expect(curve).not.toBeNull();
    expect(curve!.points).toHaveLength(3);
    expect(curve!.points[0]).toBeCloseTo(0, 6);
    expect(curve!.points[1]).toBeCloseTo(0.5, 6);
    expect(curve!.points[2]).toBeCloseTo(1, 6);
  });

  it('returns null when the head marker is not 12', () => {
    const blob = makeCurveBlock([0.0, 1.0]);
    const view = new DataView(blob.buffer);
    view.setUint32(0, 99, false); // 先頭マーカーを壊す

    expect(decodePressureCurve(blob)).toBeNull();
  });
});

describe('findPressureCurves', () => {
  it('extracts every block embedded with junk in between', () => {
    const a = makeCurveBlock([0.0, 0.25, 0.5, 1.0]);
    const b = makeCurveBlock([1.0, 0.5, 0.0]);
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);

    const blob = new Uint8Array(a.length + junk.length + b.length);
    blob.set(a, 0);
    blob.set(junk, a.length);
    blob.set(b, a.length + junk.length);

    const curves = findPressureCurves(blob);

    expect(curves).toHaveLength(2);
    expect(curves[0].points).toHaveLength(4);
    expect(curves[1].points).toHaveLength(3);
    expect(curves[1].points[0]).toBeCloseTo(1, 6);
  });
});

describe('samplePressureCurve', () => {
  it('linearly interpolates between equally spaced control points', () => {
    expect(samplePressureCurve({ points: [0, 1] }, 0.25)).toBeCloseTo(0.25, 6);
    expect(samplePressureCurve({ points: [0, 0.5, 1] }, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('clamps the input to the endpoint values', () => {
    expect(samplePressureCurve({ points: [0.2, 0.5, 0.9] }, -1)).toBeCloseTo(0.2, 6);
    expect(samplePressureCurve({ points: [0.2, 0.5, 0.9] }, 2)).toBeCloseTo(0.9, 6);
  });

  it('returns the input unchanged for an empty curve', () => {
    expect(samplePressureCurve({ points: [] }, 0.7)).toBeCloseTo(0.7, 6);
  });
});

describe('curveIsFlat', () => {
  it('treats an all-ones curve as flat and a varying curve as not flat', () => {
    expect(curveIsFlat({ points: [1, 1, 1] })).toBe(true);
    expect(curveIsFlat({ points: [0, 1] })).toBe(false);
  });
});

describe('curveLooksLikePressureResponse', () => {
  it('accepts a monotonic ramp with meaningful span', () => {
    expect(curveLooksLikePressureResponse({ points: [0, 0.5, 1] })).toBe(true);
    expect(curveLooksLikePressureResponse({ points: [0.1, 0.4, 0.8] })).toBe(true);
  });

  it('rejects the non-monotonic false-positive observed in real .sut files', () => {
    // 実サンプル(ざっくり/水彩/スプレー/パステル/カスタム)全てで共通して
    // 全ファイル走査が拾った非単調パターン。本物の筆圧応答ではないので弾く。
    expect(
      curveLooksLikePressureResponse({
        points: [0, 0, 0.077, 0.028, 0.23, 0.066, 0.384],
      }),
    ).toBe(false);
  });

  it('rejects near-flat and too-short curves', () => {
    expect(curveLooksLikePressureResponse({ points: [0.5, 0.5, 0.51] })).toBe(false); // span < 0.1
    expect(curveLooksLikePressureResponse({ points: [0.4] })).toBe(false); // 点数 < 2
    expect(curveLooksLikePressureResponse({ points: [] })).toBe(false);
  });
});
