import { describe, it, expect } from 'vitest';
import type { VectorPath } from '../src/vector/path';
import {
  identityMat,
  translationMat,
  rotationMat,
  scaleMat,
  multiplyMat,
  applyMatToPoint,
  applyMatrixToPath,
  rotatePath,
  skewPath,
  mirrorPath,
  type Mat2x3,
} from '../src/vector/path-transform';

/** 行列の各要素が許容誤差内で一致することを検査するヘルパ。 */
function expectMatClose(actual: Mat2x3, expected: Mat2x3, eps = 1e-9): void {
  for (let i = 0; i < 6; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(eps);
  }
}

describe('US-4503 パスのアフィン変換', () => {
  describe('行列ユーティリティ', () => {
    it('identityMat に点を適用しても座標は不変', () => {
      const p = applyMatToPoint(identityMat(), 3, 7);
      expect(p).toEqual({ x: 3, y: 7 });
    });

    it('applyMatToPoint は x\'=a*x+c*y+e, y\'=b*x+d*y+f の規約に従う', () => {
      const mat: Mat2x3 = [2, 3, 4, 5, 6, 7];
      const p = applyMatToPoint(mat, 1, 1);
      // x' = 2*1 + 4*1 + 6 = 12, y' = 3*1 + 5*1 + 7 = 15
      expect(p).toEqual({ x: 12, y: 15 });
    });

    it('multiplyMat は m1∘m2(先にm2、後からm1)の合成を返す', () => {
      const m2 = translationMat(10, 20);
      const m1 = scaleMat(2, 3);
      const composed = multiplyMat(m1, m2);
      // 点(1,1): まず平行移動→(11,21)、次に拡大→(22,63)
      const direct = applyMatToPoint(composed, 1, 1);
      const step1 = applyMatToPoint(m2, 1, 1);
      const sequential = applyMatToPoint(m1, step1.x, step1.y);
      expect(direct.x).toBeCloseTo(22, 9);
      expect(direct.y).toBeCloseTo(63, 9);
      expect(direct.x).toBeCloseTo(sequential.x, 9);
      expect(direct.y).toBeCloseTo(sequential.y, 9);
    });

    it('translationMat∘scaleMat の合成が手計算行列と一致', () => {
      const composed = multiplyMat(translationMat(5, -2), scaleMat(2, 4));
      // T∘S: x' = 2*x + 5, y' = 4*y - 2 → [2,0,0,4,5,-2]
      expectMatClose(composed, [2, 0, 0, 4, 5, -2]);
    });

    it('rotationMat(90°) が手計算行列 [0,1,-1,0,0,0] と一致', () => {
      expectMatClose(rotationMat(Math.PI / 2), [0, 1, -1, 0, 0, 0]);
    });

    it('rotationMat の合成 R(a)∘R(b) = R(a+b)', () => {
      const a = 0.3;
      const b = 0.7;
      const composed = multiplyMat(rotationMat(a), rotationMat(b));
      expectMatClose(composed, rotationMat(a + b));
    });
  });

  describe('applyMatrixToPath', () => {
    const path: VectorPath = {
      closed: true,
      points: [
        { x: 1, y: 2, outX: 3, outY: 4 },
        { x: 5, y: 6, inX: 7, inY: 8 },
        { x: 9, y: 10 },
      ],
    };

    it('identity 行列では座標が不変(制御点込み)', () => {
      const out = applyMatrixToPath(path, identityMat());
      expect(out.closed).toBe(true);
      expect(out.points[0]).toEqual({ x: 1, y: 2, outX: 3, outY: 4 });
      expect(out.points[1]).toEqual({ x: 5, y: 6, inX: 7, inY: 8 });
      expect(out.points[2]).toEqual({ x: 9, y: 10 });
    });

    it('制御点 outX/outY・inX/inY も同じ行列で点として変換される', () => {
      const mat = translationMat(100, 200);
      const out = applyMatrixToPath(path, mat);
      expect(out.points[0]).toEqual({ x: 101, y: 202, outX: 103, outY: 204 });
      expect(out.points[1]).toEqual({ x: 105, y: 206, inX: 107, inY: 208 });
      expect(out.points[2]).toEqual({ x: 109, y: 210 });
    });

    it('不変: 元のパスは変更されない', () => {
      const before = JSON.stringify(path);
      applyMatrixToPath(path, scaleMat(3, 3));
      expect(JSON.stringify(path)).toBe(before);
    });
  });

  describe('rotatePath', () => {
    it('90°×4 の回転で元座標に復帰する(±1e-9)', () => {
      const path: VectorPath = {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 5, outX: 12, outY: 6 },
        ],
      };
      let current = path;
      for (let i = 0; i < 4; i++) {
        current = rotatePath(current, Math.PI / 2, 0, 0);
      }
      for (let i = 0; i < path.points.length; i++) {
        expect(current.points[i].x).toBeCloseTo(path.points[i].x, 9);
        expect(current.points[i].y).toBeCloseTo(path.points[i].y, 9);
      }
      expect(current.points[2].outX).toBeCloseTo(12, 9);
      expect(current.points[2].outY).toBeCloseTo(6, 9);
    });

    it('指定中心周りの回転は中心点を不動にする', () => {
      const path: VectorPath = {
        closed: false,
        points: [
          { x: 5, y: 5 },
          { x: 15, y: 5 },
        ],
      };
      const out = rotatePath(path, Math.PI / 2, 5, 5);
      // 中心(5,5)は不動
      expect(out.points[0].x).toBeCloseTo(5, 9);
      expect(out.points[0].y).toBeCloseTo(5, 9);
      // (15,5)は中心周り90°で → 中心からの相対(10,0)が(0,10)になり(5,15)
      expect(out.points[1].x).toBeCloseTo(5, 9);
      expect(out.points[1].y).toBeCloseTo(15, 9);
    });

    it('中心既定は重心(全点を回しても重心は不動)', () => {
      const path: VectorPath = {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
        ],
      };
      // 重心は(2,2)
      const out = rotatePath(path, Math.PI / 2);
      let cx = 0;
      let cy = 0;
      for (const p of out.points) {
        cx += p.x;
        cy += p.y;
      }
      cx /= out.points.length;
      cy /= out.points.length;
      expect(cx).toBeCloseTo(2, 9);
      expect(cy).toBeCloseTo(2, 9);
    });
  });

  describe('mirrorPath', () => {
    it("axis='x' は pivot 周りで y を反転する", () => {
      const path: VectorPath = {
        closed: false,
        points: [
          { x: 1, y: 0 },
          { x: 2, y: 10 },
        ],
      };
      const out = mirrorPath(path, 'x', { x: 0, y: 0 });
      expect(out.points[0].x).toBeCloseTo(1, 9);
      expect(out.points[0].y).toBeCloseTo(0, 9);
      expect(out.points[1].x).toBeCloseTo(2, 9);
      expect(out.points[1].y).toBeCloseTo(-10, 9);
    });

    it("axis='y' は pivot 周りで x を反転する", () => {
      const path: VectorPath = {
        closed: false,
        points: [
          { x: 3, y: 7 },
          { x: 8, y: 7 },
        ],
      };
      const out = mirrorPath(path, 'y', { x: 0, y: 0 });
      expect(out.points[0].x).toBeCloseTo(-3, 9);
      expect(out.points[0].y).toBeCloseTo(7, 9);
      expect(out.points[1].x).toBeCloseTo(-8, 9);
      expect(out.points[1].y).toBeCloseTo(7, 9);
    });
  });

  describe('skewPath', () => {
    it("x' = x + kx*y を満たす(pivot 原点・ky=0)", () => {
      const path: VectorPath = {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
          { x: 5, y: 4 },
        ],
      };
      const kx = 0.5;
      const out = skewPath(path, kx, 0, 0, 0);
      for (let i = 0; i < path.points.length; i++) {
        const p = path.points[i];
        expect(out.points[i].x).toBeCloseTo(p.x + kx * p.y, 9);
        expect(out.points[i].y).toBeCloseTo(p.y, 9);
      }
    });

    it("y' = y + ky*x を満たす(pivot 原点・kx=0)", () => {
      const path: VectorPath = {
        closed: false,
        points: [
          { x: 10, y: 0 },
          { x: 3, y: 2 },
        ],
      };
      const ky = 0.25;
      const out = skewPath(path, 0, ky, 0, 0);
      for (let i = 0; i < path.points.length; i++) {
        const p = path.points[i];
        expect(out.points[i].x).toBeCloseTo(p.x, 9);
        expect(out.points[i].y).toBeCloseTo(p.y + ky * p.x, 9);
      }
    });
  });
});
