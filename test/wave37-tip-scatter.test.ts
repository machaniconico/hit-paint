import { describe, expect, it } from 'vitest';
import { scatterOffsets, stampScatteredTip } from '../src/engine/tip-scatter';
import type { TipAlpha } from '../src/engine/tip-stamp';

/** 中央が濃い 4x4 の正方形 tip を作るヘルパ。 */
function makeSolidTip(size = 4): TipAlpha {
  const data = new Float32Array(size * size).fill(1);
  return { width: size, height: size, data };
}

/** coverage の非ゼロ画素のバウンディングボックスを返す(無ければ null)。 */
function coverageBbox(
  coverage: Float32Array,
  cw: number,
  ch: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      if (coverage[y * cw + x] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

describe('scatterOffsets', () => {
  it('returns single zero offset for count<=1 or radius<=0', () => {
    // (1) count=1 → 散布なし。
    expect(scatterOffsets(42, 1, 10)).toEqual([{ dx: 0, dy: 0 }]);
    // radius=0 / 負 → 散布なし。
    expect(scatterOffsets(42, 8, 0)).toEqual([{ dx: 0, dy: 0 }]);
    expect(scatterOffsets(42, 8, -5)).toEqual([{ dx: 0, dy: 0 }]);
    // count=0 でも 1 個は返る。
    expect(scatterOffsets(42, 0, 10)).toEqual([{ dx: 0, dy: 0 }]);
  });

  it('is deterministic and stays within the radius', () => {
    // (2) 同 seed+count+radius → 完全一致。
    const radius = 12;
    const a = scatterOffsets(7, 16, radius);
    const b = scatterOffsets(7, 16, radius);

    expect(a).toHaveLength(16);
    expect(a).toEqual(b);

    // 全オフセットが半径内。
    for (const { dx, dy } of a) {
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(radius + 1e-9);
    }
  });

  it('produces different distributions for different seeds', () => {
    // (3) 異なる seed → (一般に)異なる分布。
    const a = scatterOffsets(1, 8, 10);
    const b = scatterOffsets(2, 8, 10);

    const differs = a.some((o, i) => o.dx !== b[i].dx || o.dy !== b[i].dy);
    expect(differs).toBe(true);
  });
});

describe('stampScatteredTip', () => {
  it('stamps once at the center when scatter=0 / density=1', () => {
    // (4) 散布なし → 中心付近のみ coverage が立つ。
    const cw = 32;
    const ch = 32;
    const tip = makeSolidTip(4);
    const coverage = new Float32Array(cw * ch);

    stampScatteredTip(coverage, cw, ch, tip, { x: 16, y: 16, size: 4, scatter: 0, density: 1, seed: 5 });

    const bbox = coverageBbox(coverage, cw, ch);
    expect(bbox).not.toBeNull();
    // 4px tip を中心(16,16)に1スタンプ → 中心±3px 程度に収まる。
    expect(bbox!.minX).toBeGreaterThanOrEqual(13);
    expect(bbox!.maxX).toBeLessThanOrEqual(19);
    expect(bbox!.minY).toBeGreaterThanOrEqual(13);
    expect(bbox!.maxY).toBeLessThanOrEqual(19);
  });

  it('spreads coverage wider with scatter>0 and density=8', () => {
    // (5) 散布あり → bbox が単一スタンプより広い。
    const cw = 64;
    const ch = 64;
    const tip = makeSolidTip(4);

    const single = new Float32Array(cw * ch);
    stampScatteredTip(single, cw, ch, tip, { x: 32, y: 32, size: 4, scatter: 0, density: 1 });
    const singleBbox = coverageBbox(single, cw, ch)!;

    const scattered = new Float32Array(cw * ch);
    stampScatteredTip(scattered, cw, ch, tip, {
      x: 32,
      y: 32,
      size: 4,
      scatter: 12,
      density: 8,
      seed: 3,
      step: 0,
    });
    const scatteredBbox = coverageBbox(scattered, cw, ch)!;

    const singleW = singleBbox.maxX - singleBbox.minX;
    const singleH = singleBbox.maxY - singleBbox.minY;
    const scatteredW = scatteredBbox.maxX - scatteredBbox.minX;
    const scatteredH = scatteredBbox.maxY - scatteredBbox.minY;

    expect(scatteredW).toBeGreaterThan(singleW);
    expect(scatteredH).toBeGreaterThan(singleH);
  });

  it('is deterministic for the same seed/step', () => {
    // (6) 同 seed/step で2回 → coverage 完全一致。
    const cw = 48;
    const ch = 48;
    const tip = makeSolidTip(4);
    const opts = { x: 24, y: 24, size: 5, scatter: 10, density: 6, seed: 11, step: 3 } as const;

    const a = new Float32Array(cw * ch);
    const b = new Float32Array(cw * ch);
    stampScatteredTip(a, cw, ch, tip, { ...opts });
    stampScatteredTip(b, cw, ch, tip, { ...opts });

    expect(Array.from(a)).toEqual(Array.from(b));

    // step を変えると散布パターンが変わる(打点ごとの変化)。
    const c = new Float32Array(cw * ch);
    stampScatteredTip(c, cw, ch, tip, { ...opts, step: 4 });
    const differs = Array.from(a).some((v, i) => v !== c[i]);
    expect(differs).toBe(true);
  });
});
