// @vitest-environment jsdom
/**
 * Wave39 / US-4104 — store 配線:
 *   1. symmetry の鏡映コピーへ flipX を渡し、キラル(非対称)tip でも回転済み
 *      スタンプ全体の真の鏡像になることを検証する。
 *   2. importSutBrush が selectBrushPressureCurves({ normalize: true })(=ペア
 *      正規化カーブ)を採用していることを検証する。
 *
 * 設計の要:
 * - Wave38(US-4004)は鏡映コピーへ「角度のみ鏡映」(rotate-θ)を渡していた。
 *   これは両軸対称 tip では鏡像になるが、左右非対称(キラル)tip では形状自体が
 *   反転しないため鏡像にならなかった。US-4104 で point.flip を stampTip/
 *   stampScatteredTip の flipX へ渡し、形状も反転させて厳密な鏡像を得る。
 * - mode='none' は metaPoints が [{flip:false,...}] のみ → flipX:false。
 *   stampTip(flipX:false) は従来呼び出しとバイト同一(wave39-tip-flip で実証済み)
 *   なので、tip 経路・tip 無し経路ともゴールデン回帰を割らない。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import initSqlJs from 'sql.js';

import { type SymmetryConfig } from '../src/engine/symmetry';
import { stampTip, type TipAlpha } from '../src/engine/tip-stamp';
import { selectBrushPressureCurves } from '../src/io/sut-pressure';
import { createPresetLibrary } from '../src/engine/brush-presets';
import { useStore } from '../src/state/store';
import { DEFAULT_BRUSH, type BrushSettings, type PointerSample } from '../src/types';

function locateWasm(): string {
  return path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm');
}

/* ------------------------------------------------------------------ */
/* .sut フィクスチャ(wave38-symmetry-tip.test.ts と同形)              */
/* ------------------------------------------------------------------ */

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32be(data.length), 0);
  out.set(body, 4);
  out.set(u32be(crc32(body)), 4 + body.length);
  return out;
}

/** 署名 + IHDR(1x1) + 空 IDAT + IEND の最小 PNG(extractPngFromBlob 用)。 */
function makeMinimalPng(): Uint8Array {
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(1), 0);
  ihdr.set(u32be(1), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', new Uint8Array(0));
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let off = 0;
  out.set(signature, off);
  off += signature.length;
  out.set(ihdrChunk, off);
  off += ihdrChunk.length;
  out.set(idatChunk, off);
  off += idatChunk.length;
  out.set(iendChunk, off);
  return out;
}

/** カーブ署名 [u32BE=12][u32BE=N][u32BE=16][N×float64BE] をエンコードする。 */
function encodeCurve(points: number[]): Uint8Array {
  const out = new Uint8Array(12 + points.length * 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, 12, false);
  view.setUint32(4, points.length, false);
  view.setUint32(8, 16, false);
  for (let i = 0; i < points.length; i += 1) {
    view.setFloat64(12 + i * 8, points[i], false);
  }
  return out;
}

/** 筆圧カーブ blob を同梱した合成 .sut(SQLite)を作る(wave38 フィクスチャと同形)。 */
async function createCurveSutBrush(
  name: string,
  size: number,
  curveData: Uint8Array,
  materialData: Uint8Array,
): Promise<Uint8Array> {
  const SQL = await initSqlJs({ locateFile: locateWasm });
  const db = new SQL.Database();

  try {
    db.run('CREATE TABLE Manager (ToolType INTEGER, Version INTEGER);');
    db.run('INSERT INTO Manager (ToolType, Version) VALUES (?, ?);', [0, 145]);
    db.run('CREATE TABLE Node (NodeName TEXT);');
    db.run('INSERT INTO Node (NodeName) VALUES (?);', [name]);
    db.run(
      'CREATE TABLE Variant (' +
        'Opacity INT, BrushSize REAL, BrushFlow INT, BrushHardness INT, BrushInterval REAL, AntiAlias INT);',
    );
    db.run(
      'INSERT INTO Variant (Opacity, BrushSize, BrushFlow, BrushHardness, BrushInterval, AntiAlias) ' +
        'VALUES (?, ?, ?, ?, ?, ?);',
      [80, size, 90, 50, 20, 3],
    );
    db.run('CREATE TABLE MaterialFile (MaterialName TEXT, MaterialData BLOB);');
    db.run('INSERT INTO MaterialFile (MaterialName, MaterialData) VALUES (?, ?);', [
      `${name}-tip`,
      materialData,
    ]);
    db.run('INSERT INTO MaterialFile (MaterialName, MaterialData) VALUES (?, ?);', [
      `${name}-curve`,
      curveData,
    ]);

    return db.export();
  } finally {
    db.close();
  }
}

/** 固定 RGBA(4x4 中央 2x2 不透明)を返す decodeTip スタブ。 */
function makeTipDecodeStub(): (
  png: Uint8Array,
) => Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  const w = 4;
  const h = 4;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = (y * w + x) * 4;
      const inside = x >= 1 && x <= 2 && y >= 1 && y <= 2;
      data[idx + 3] = inside ? 255 : 0;
    }
  }
  return async () => ({ data, width: w, height: h });
}

/* ------------------------------------------------------------------ */
/* tip / ストロークヘルパ                                              */
/* ------------------------------------------------------------------ */

/**
 * 完全非対称(両軸キラル)な tip。左上の矩形領域(x<3, y<2)のみ不透明。
 * x 反転にも y 反転にも不変でないので、「角度のみ鏡映」(flipX 無し)では
 * 鏡像にならず flipX が必須 — flipY 対称な単純形状では露呈しないバグを捕捉する。
 */
function makeChiralTip(width = 8, height = 8): TipAlpha {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = x < 3 && y < 2 ? 1 : 0;
    }
  }
  return { width, height, data };
}

const DOC_W = 32;
const DOC_H = 32;

/**
 * 指定ブラシ + symmetry で 1 ストローク描き、前後のレイヤー画素を返す。
 * 各呼び出しで newDocument し直すので相互に独立・決定論的。
 */
function runStroke(
  brushPatch: Partial<BrushSettings>,
  samples: PointerSample[],
  symmetryPatch?: Partial<SymmetryConfig>,
): { before: Uint8ClampedArray; after: Uint8ClampedArray } {
  useStore.getState().newDocument(DOC_W, DOC_H, 'wave39 wiring');
  useStore.setState({ brush: { ...DEFAULT_BRUSH, ...brushPatch } });
  if (symmetryPatch) {
    useStore.getState().setSymmetry(symmetryPatch);
  }

  const doc0 = useStore.getState().doc;
  const layer0 = doc0.layers.find((l) => l.id === doc0.activeLayerId)!;
  const before = layer0.pixels!.slice();

  useStore.getState().beginStroke(samples[0]);
  for (let i = 1; i < samples.length; i += 1) {
    useStore.getState().extendStroke(samples[i]);
  }
  useStore.getState().endStroke();

  const doc = useStore.getState().doc;
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
  return { before, after: layer.pixels!.slice() };
}

function pixelsEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** FNV-1a 32bit。ゴールデン回帰用の決定論的ハッシュ。 */
function fnv1a(bytes: Uint8ClampedArray): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** coverage(Float32Array)の「画素境界対称」(軸 x=axis)からの最大ズレ。 */
function coverageBoundaryMirrorDiff(cov: Float32Array, w: number, h: number, axis: number): number {
  let max = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const mx = 2 * axis - 1 - x;
      const other = mx >= 0 && mx < w ? cov[y * w + mx] : 0;
      const d = Math.abs(cov[y * w + x] - other);
      if (d > max) max = d;
    }
  }
  return max;
}

/** RGBA 画素列の「画素境界対称」(軸 x=axis)からの最大ズレ(チャネル単位)。 */
function pixelBoundaryMirrorDiff(pixels: Uint8ClampedArray, w: number, h: number, axis: number): number {
  let max = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const mx = 2 * axis - 1 - x;
      const a = (y * w + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const other = mx >= 0 && mx < w ? pixels[(y * w + mx) * 4 + c] : 0;
        const d = Math.abs(pixels[a + c] - other);
        if (d > max) max = d;
      }
    }
  }
  return max;
}

/* ------------------------------------------------------------------ */
/* テスト本体                                                          */
/* ------------------------------------------------------------------ */

describe('wave39 store wiring: symmetry flip → flipX + normalized curve (US-4104)', () => {
  beforeEach(() => {
    useStore.getState().newDocument(DOC_W, DOC_H, 'wave39 wiring');
    useStore.setState({
      brush: { ...DEFAULT_BRUSH },
      brushPresets: createPresetLibrary(),
    });
  });

  it('engine-level: キラル tip は (元θ, 鏡映 -θ+flipX) で厳密な縦軸鏡像、角度のみ鏡映は不一致', () => {
    // store の horizontal 配線が依拠する幾何恒等式:
    //   mirror_x( stamp(rotation=θ) ) == stamp(rotation=-θ, flipX=true)
    // copy0(rotate+θ=θ, flipX無) と copy1((π-rotate)-θ=-θ, flipX有) のペア。
    const W = 32;
    const H = 32;
    const tip = makeChiralTip();
    const theta = Math.PI / 6;
    // 鏡映軸を画素境界(整数 x=16)に通すため、両中心を整数で軸対称に置く。
    const axis = 16;
    const xA = 10;
    const xB = 2 * axis - xA; // 22

    // 角度のみ鏡映(flipX 無し)では、両軸キラル tip は鏡像にならない(対比)。
    const covAngleOnly = new Float32Array(W * H);
    stampTip(covAngleOnly, W, H, tip, { x: xA, y: 16, size: 8, rotation: theta, flow: 1 });
    stampTip(covAngleOnly, W, H, tip, { x: xB, y: 16, size: 8, rotation: -theta, flipX: false, flow: 1 });
    expect(coverageBoundaryMirrorDiff(covAngleOnly, W, H, axis)).toBeGreaterThan(0.2);

    // US-4104: 鏡映側は rotation=-θ + flipX:true → 厳密な縦軸鏡像。
    const covFlip = new Float32Array(W * H);
    stampTip(covFlip, W, H, tip, { x: xA, y: 16, size: 8, rotation: theta, flipX: false, flow: 1 });
    stampTip(covFlip, W, H, tip, { x: xB, y: 16, size: 8, rotation: -theta, flipX: true, flow: 1 });
    expect(coverageBoundaryMirrorDiff(covFlip, W, H, axis)).toBeLessThan(1e-4);
  });

  it('store 統合: horizontal symmetry + キラル tip(回転なし)で左右厳密鏡映', () => {
    const brush: Partial<BrushSettings> = {
      tip: makeChiralTip(),
      size: 8,
      spacing: 0.5,
      opacity: 1,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
    };
    // centerX=16(画素境界=軸 x=16)。打点 x=10 → 鏡映コピー x=22。
    const samples: PointerSample[] = [{ x: 10, y: 16, pressure: 1, t: 0 }];
    const { before, after } = runStroke(brush, samples, { mode: 'horizontal', centerX: 16, centerY: 16 });

    // 実際に描けている。
    expect(pixelsEqual(before, after)).toBe(false);
    // 左半分にも描画がある(鏡映コピーが効いている)。
    let leftChanged = false;
    for (let y = 0; y < DOC_H && !leftChanged; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const o = (y * DOC_W + x) * 4;
        if (before[o + 3] !== after[o + 3] || before[o] !== after[o]) {
          leftChanged = true;
          break;
        }
      }
    }
    expect(leftChanged).toBe(true);

    // 軸 x=16 での厳密な画素境界鏡映(キラル tip でも flipX により完全一致)。
    expect(pixelBoundaryMirrorDiff(after, DOC_W, DOC_H, 16)).toBe(0);
  });

  it('store 統合: horizontal symmetry + キラル tip + tipAngle 回転でも左右厳密鏡映', () => {
    const brush: Partial<BrushSettings> = {
      tip: makeChiralTip(),
      size: 8,
      spacing: 0.5,
      opacity: 1,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
      tipAngle: Math.PI / 5,
    };
    const samples: PointerSample[] = [{ x: 10, y: 16, pressure: 1, t: 0 }];
    const { before, after } = runStroke(brush, samples, { mode: 'horizontal', centerX: 16, centerY: 16 });

    expect(pixelsEqual(before, after)).toBe(false);
    // 回転が入っても、鏡映側は rotate-θ + flipX で厳密な鏡像になる。
    expect(pixelBoundaryMirrorDiff(after, DOC_W, DOC_H, 16)).toBe(0);
  });

  it("symmetry='none' tip ストロークは Wave38 とバイト同一(golden 0x513cb8f9 相当のシナリオで FNV-1a 一致)", () => {
    // wave38-symmetry-tip.test.ts のゴールデンと完全同一シナリオ(同入力)。
    // mode='none' は metaPoints が単一 {flip:false} なので flipX:false で呼ばれ、
    // stampTip(flipX:false) は従来とバイト同一 → ハッシュ不変。
    const brush: Partial<BrushSettings> = {
      tip: ((): TipAlpha => {
        // wave38 と同じ両軸対称楕円 tip(8x2)。
        const width = 8;
        const height = 2;
        const data = new Float32Array(width * height);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const nx = (x + 0.5 - width / 2) / (width / 2);
            const ny = (y + 0.5 - height / 2) / (height / 2);
            data[y * width + x] = nx * nx + ny * ny <= 1 ? 1 : 0;
          }
        }
        return { width, height, data };
      })(),
      size: 8,
      spacing: 0.5,
      opacity: 1,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
      tipAngle: Math.PI / 6,
      tipFollowStroke: true,
      tipAngleJitter: 0.4,
      tipScatter: 5,
      tipScatterDensity: 4,
    };
    const samples: PointerSample[] = [
      { x: 6, y: 6, pressure: 1, t: 0 },
      { x: 16, y: 14, pressure: 0.8, t: 16 },
      { x: 26, y: 24, pressure: 0.6, t: 32 },
    ];
    const { after } = runStroke(brush, samples);
    expect(fnv1a(after)).toBe(0x513cb8f9);
  });

  it('importSutBrush: pressureSizeCurve が selectBrushPressureCurves({normalize:true}) の出力に一致', async () => {
    const curvePoints = [0.1, 0.4, 0.7, 1.0];
    const bytes = await createCurveSutBrush(
      'curve-brush',
      40,
      encodeCurve(curvePoints),
      makeMinimalPng(),
    );

    // US-4104 で store が採用するペア正規化カーブ選択(normalize:true)。
    const expected = selectBrushPressureCurves(bytes, { normalize: true });
    expect(expected.length).toBeGreaterThanOrEqual(1);

    await useStore.getState().importSutBrush(bytes, { decodeTip: makeTipDecodeStub() });

    const state = useStore.getState();
    expect(state.brush.pressureSizeCurve).toEqual(expected[0]);
    expect(state.brush.pressureFlowCurve).toEqual(expected.length >= 2 ? expected[1] : undefined);
    expect(state.brush.tip).toBeTruthy();
  });
});
