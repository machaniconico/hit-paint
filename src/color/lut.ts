/**
 * HIT Paint — 3D LUT データモデル + トライリニア適用 (US-4301)。
 *
 * 3D LUT (Look-Up Table) は RGB 色空間を size^3 の格子に分割し、各格子点(ノード)に
 * 変換後の RGB を持つカラーグレーディングの基本データ構造。.cube 形式と相互運用する。
 *
 * 【インデックス規約】
 * ノード (ri, gi, bi) (各 0..size-1) の data オフセットは:
 *   offset = ((bi * size + gi) * size + ri) * 3
 * すなわち R が最速で変化し blue が最外側ループ。これは Adobe/.cube の DATA 格納順
 * (LUT_3D_SIZE のデータブロックが R を最内に列挙する規約)と一致する。offset+0/+1/+2 が
 * それぞれ R/G/B チャンネル(0..1)。
 *
 * 設計判断:
 * - data は Float32Array (0..1 正規化) で保持し、8bit 量子化誤差を補間段階に持ち込まない。
 * - jsdom では canvas API が使えないため、補間ロジックは Uint8ClampedArray を直接書き換える
 *   純粋関数として実装し、配列だけで検証可能にする(他フィルタと同じ作法)。
 * - 決定論厳守: Date.now()/Math.random() を一切使わない。
 */

/** size^3 ノードの 3D LUT。data 長 = size*size*size*3、各要素 0..1 の RGB。 */
export interface Lut3D {
  /** 各軸の分割数。size>=2。 */
  size: number;
  /** ノード色の平坦配列。インデックス規約はファイル冒頭 JSDoc 参照。 */
  data: Float32Array;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * ノード (ri, gi, bi) の data 先頭オフセットを返す。
 * R 最速・blue 最外(.cube 規約)。
 */
function nodeOffset(size: number, ri: number, gi: number, bi: number): number {
  return ((bi * size + gi) * size + ri) * 3;
}

/**
 * 恒等 LUT を生成する。ノード (ri, gi, bi) の色 = (ri/(size-1), gi/(size-1), bi/(size-1))。
 * sampleLutTrilinear に通すと入力色をほぼそのまま返す。
 * @param size 各軸の分割数 (>=2)。
 */
export function identityLut(size: number): Lut3D {
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`identityLut: size は 2 以上の整数が必要です (受領: ${size})`);
  }
  const data = new Float32Array(size * size * size * 3);
  const denom = size - 1;
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const o = nodeOffset(size, ri, gi, bi);
        data[o] = ri / denom;
        data[o + 1] = gi / denom;
        data[o + 2] = bi / denom;
      }
    }
  }
  return { size, data };
}

/**
 * 3D LUT を入力色 (r,g,b)(各 0..1、範囲外はクランプ)でトライリニア補間サンプルする。
 *
 * 各軸 x*(size-1) の整数部 i0 と小数部 f で隣接ノード i0/i0+1 を選び、8 近傍ノードを
 * 三次線形補間する。小数部が 0(格子点上)なら該当ノード色に厳密一致する。
 *
 * @returns 補間後の {r,g,b}(各 0..1)。
 */
export function sampleLutTrilinear(
  lut: Lut3D,
  r: number,
  g: number,
  b: number,
): { r: number; g: number; b: number } {
  const { size, data } = lut;
  const maxIdx = size - 1;

  // 0..1 にクランプしてから格子座標へ。
  const rx = clamp01(r) * maxIdx;
  const gx = clamp01(g) * maxIdx;
  const bx = clamp01(b) * maxIdx;

  // 整数部(上限 maxIdx-1 に抑え、i1=i0+1 が常に有効ノードになるようにする)。
  const r0 = rx >= maxIdx ? maxIdx - 1 : Math.floor(rx);
  const g0 = gx >= maxIdx ? maxIdx - 1 : Math.floor(gx);
  const b0 = bx >= maxIdx ? maxIdx - 1 : Math.floor(bx);
  const r1 = r0 + 1;
  const g1 = g0 + 1;
  const b1 = b0 + 1;

  // 小数部(重み)。格子点上では fr/fg/fb=0 となり下側ノードに厳密一致。
  const fr = rx - r0;
  const fg = gx - g0;
  const fb = bx - b0;

  let outR = 0;
  let outG = 0;
  let outB = 0;

  // 8 近傍ノードを重み付き合算。
  for (let cb = 0; cb < 2; cb++) {
    const bi = cb === 0 ? b0 : b1;
    const wb = cb === 0 ? 1 - fb : fb;
    if (wb === 0) continue;
    for (let cg = 0; cg < 2; cg++) {
      const gi = cg === 0 ? g0 : g1;
      const wg = cg === 0 ? 1 - fg : fg;
      const wbg = wb * wg;
      if (wbg === 0) continue;
      for (let cr = 0; cr < 2; cr++) {
        const ri = cr === 0 ? r0 : r1;
        const wr = cr === 0 ? 1 - fr : fr;
        const w = wbg * wr;
        if (w === 0) continue;
        const o = nodeOffset(size, ri, gi, bi);
        outR += data[o] * w;
        outG += data[o + 1] * w;
        outB += data[o + 2] * w;
      }
    }
  }

  return { r: outR, g: outG, b: outB };
}

/**
 * 画素バッファの各 RGB を 3D LUT で変換する(破壊的)。
 * RGB を /255 → sampleLutTrilinear → *255+round で書き換え、α(i+3) は不変。
 *
 * @param pixels RGBA8 平坦配列 (length = width*height*4)。
 */
export function applyLut(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  lut: Lut3D,
): void {
  const count = width * height;
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    const out = sampleLutTrilinear(
      lut,
      pixels[i] / 255,
      pixels[i + 1] / 255,
      pixels[i + 2] / 255,
    );
    pixels[i] = Math.round(out.r * 255);
    pixels[i + 1] = Math.round(out.g * 255);
    pixels[i + 2] = Math.round(out.b * 255);
    // α は不変。
  }
}
