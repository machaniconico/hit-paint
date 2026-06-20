import type { Lut3D } from '../color/lut';

/**
 * .cube LUT パーサ/ライター (Adobe / IRIDAS 形式)。
 *
 * 設計判断:
 * - Lut3D の data index 規約は US-4301 (src/color/lut.ts) に合わせる:
 *   ((bi * size + gi) * size + ri) * 3 + ch
 *   → R が最速で変化し、B が最も外側 (R fastest / blue outermost)。
 * - .cube 標準のデータ格納順も「R が最速で変化」なので、ファイルの行順と
 *   Lut3D.data の格納順は一致する。よって行 i 番目を data[i*3..i*3+2] に
 *   そのまま詰めれば規約と整合する (ri = i % N, gi = (i / N) % N, bi = i / N^2)。
 * - DOMAIN_MIN/MAX は各チャンネルの入力ドメインを表す。データ値そのものは
 *   出力値だが、本ローダは [DOMAIN_MIN, DOMAIN_MAX] を 0..1 へ正規化して
 *   格納する (既定 0 0 0 / 1 1 1 ではそのまま)。
 * - 決定論厳守: Date.now()/Math.random() は使わない。
 */

interface ParseState {
  size: number | null;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  rows: Array<[number, number, number]>;
}

function parseFloatStrict(token: string, context: string): number {
  // Number() は空文字を 0 にしてしまうので明示的に弾く
  if (token.length === 0) {
    throw new Error(`.cube パース失敗: ${context} に数値がありません`);
  }
  const value = Number(token);
  if (!Number.isFinite(value)) {
    throw new Error(`.cube パース失敗: ${context} の値 "${token}" が数値ではありません`);
  }
  return value;
}

function splitTokens(line: string): string[] {
  return line.trim().split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Adobe / IRIDAS .cube テキストを Lut3D へパースする。
 */
export function parseCubeLut(text: string): Lut3D {
  const state: ParseState = {
    size: null,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    rows: [],
  };

  const lines = text.split(/\r\n|\r|\n/);
  for (const rawLine of lines) {
    // 前後空白を除去。コメント/空行はスキップ
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;

    const upper = line.toUpperCase();

    if (upper.startsWith('TITLE')) {
      // TITLE "..." はメタ情報のため無視
      continue;
    }

    if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('.cube パース失敗: LUT_1D_SIZE (1D LUT) は未対応です。3D LUT のみ対応します');
    }

    if (upper.startsWith('LUT_3D_SIZE')) {
      const tokens = splitTokens(line);
      if (tokens.length < 2) {
        throw new Error('.cube パース失敗: LUT_3D_SIZE に値がありません');
      }
      const size = parseFloatStrict(tokens[1], 'LUT_3D_SIZE');
      if (!Number.isInteger(size) || size < 2) {
        throw new Error(`.cube パース失敗: LUT_3D_SIZE は 2 以上の整数である必要があります (受領: ${tokens[1]})`);
      }
      state.size = size;
      continue;
    }

    if (upper.startsWith('DOMAIN_MIN')) {
      const tokens = splitTokens(line);
      if (tokens.length < 4) {
        throw new Error('.cube パース失敗: DOMAIN_MIN は 3 値が必要です');
      }
      state.domainMin = [
        parseFloatStrict(tokens[1], 'DOMAIN_MIN[0]'),
        parseFloatStrict(tokens[2], 'DOMAIN_MIN[1]'),
        parseFloatStrict(tokens[3], 'DOMAIN_MIN[2]'),
      ];
      continue;
    }

    if (upper.startsWith('DOMAIN_MAX')) {
      const tokens = splitTokens(line);
      if (tokens.length < 4) {
        throw new Error('.cube パース失敗: DOMAIN_MAX は 3 値が必要です');
      }
      state.domainMax = [
        parseFloatStrict(tokens[1], 'DOMAIN_MAX[0]'),
        parseFloatStrict(tokens[2], 'DOMAIN_MAX[1]'),
        parseFloatStrict(tokens[3], 'DOMAIN_MAX[2]'),
      ];
      continue;
    }

    // それ以外はデータ行 "R G B"
    const tokens = splitTokens(line);
    if (tokens.length < 3) {
      throw new Error(`.cube パース失敗: データ行 "${line}" は R G B の 3 値が必要です`);
    }
    const r = parseFloatStrict(tokens[0], 'データ行 R');
    const g = parseFloatStrict(tokens[1], 'データ行 G');
    const b = parseFloatStrict(tokens[2], 'データ行 B');
    state.rows.push([r, g, b]);
  }

  if (state.size === null) {
    throw new Error('.cube パース失敗: LUT_3D_SIZE が見つかりません');
  }

  const size = state.size;
  const expected = size * size * size;
  if (state.rows.length !== expected) {
    throw new Error(
      `.cube パース失敗: データ行数が一致しません (LUT_3D_SIZE=${size} → 期待 ${expected} 行, 実際 ${state.rows.length} 行)`,
    );
  }

  // DOMAIN による 0..1 正規化用のスパン (0 除算は恒等扱い)
  const span: [number, number, number] = [
    state.domainMax[0] - state.domainMin[0],
    state.domainMax[1] - state.domainMin[1],
    state.domainMax[2] - state.domainMin[2],
  ];

  const normalize = (value: number, channel: number): number => {
    const s = span[channel];
    if (s === 0) return value;
    return (value - state.domainMin[channel]) / s;
  };

  const data = new Float32Array(expected * 3);
  // .cube の格納順 (R 最速) と Lut3D の index 規約 (R 最速) は一致するため
  // 行 i をそのまま data[i*3..i*3+2] に詰めればよい。
  for (let i = 0; i < expected; i++) {
    const [r, g, b] = state.rows[i];
    data[i * 3 + 0] = normalize(r, 0);
    data[i * 3 + 1] = normalize(g, 1);
    data[i * 3 + 2] = normalize(b, 2);
  }

  return { size, data };
}

function formatFloat(value: number): string {
  // 決定論的で round-trip 可能な表現。指数表記を避け固定小数 6 桁。
  if (!Number.isFinite(value)) return '0.000000';
  return value.toFixed(6);
}

/**
 * Lut3D を Adobe / IRIDAS .cube テキストへ出力する。
 * parse → write → parse のラウンドトリップで値が一致する形式。
 */
export function writeCubeLut(lut: Lut3D, title?: string): string {
  const size = lut.size;
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`.cube 書き出し失敗: size は 2 以上の整数である必要があります (受領: ${size})`);
  }
  const expected = size * size * size;
  if (lut.data.length !== expected * 3) {
    throw new Error(
      `.cube 書き出し失敗: data 長が不正です (size=${size} → 期待 ${expected * 3}, 実際 ${lut.data.length})`,
    );
  }

  const lines: string[] = [];
  if (title !== undefined) {
    // ダブルクォート内のクォートはエスケープせず除去 (round-trip では TITLE は無視されるため安全側)
    const safeTitle = title.replace(/"/g, '');
    lines.push(`TITLE "${safeTitle}"`);
  }
  lines.push(`LUT_3D_SIZE ${size}`);
  // DOMAIN は既定 (0..1) を明示。正規化済み data をそのまま出力する。
  lines.push('DOMAIN_MIN 0.0 0.0 0.0');
  lines.push('DOMAIN_MAX 1.0 1.0 1.0');

  for (let i = 0; i < expected; i++) {
    const r = formatFloat(lut.data[i * 3 + 0]);
    const g = formatFloat(lut.data[i * 3 + 1]);
    const b = formatFloat(lut.data[i * 3 + 2]);
    lines.push(`${r} ${g} ${b}`);
  }

  return lines.join('\n') + '\n';
}
