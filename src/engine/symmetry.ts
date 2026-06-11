export interface SymmetryConfig {
  mode: 'none' | 'horizontal' | 'vertical' | 'both' | 'radial';
  centerX: number;
  centerY: number;
  slices?: number;
}

export function mirrorPoints(
  x: number,
  y: number,
  cfg: SymmetryConfig,
): { x: number; y: number }[] {
  switch (cfg.mode) {
    case 'horizontal':
      return [
        { x, y },
        { x: 2 * cfg.centerX - x, y },
      ];
    case 'vertical':
      return [
        { x, y },
        { x, y: 2 * cfg.centerY - y },
      ];
    case 'both':
      return [
        { x, y },
        { x: 2 * cfg.centerX - x, y },
        { x, y: 2 * cfg.centerY - y },
        { x: 2 * cfg.centerX - x, y: 2 * cfg.centerY - y },
      ];
    case 'radial': {
      const slices = Math.max(2, Math.floor(cfg.slices ?? 6));
      const dx = x - cfg.centerX;
      const dy = y - cfg.centerY;
      const points: { x: number; y: number }[] = [];

      for (let i = 0; i < slices; i++) {
        const angle = (Math.PI * 2 * i) / slices;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        points.push({
          x: cfg.centerX + dx * cos - dy * sin,
          y: cfg.centerY + dx * sin + dy * cos,
        });
      }

      return points;
    }
    case 'none':
    default:
      return [{ x, y }];
  }
}

/**
 * 鏡映点ごとの「角度変換メタ」付き版(US-4004)。
 *
 * 座標列は mirrorPoints と完全同一。各点に「元の角度 θ をその対称コピーへ
 * 写す変換」を表す { flip, rotate } を付与する:
 *   変換後角度 = flip ? (rotate - θ) : (rotate + θ)
 *
 * - horizontal(垂直軸 x=centerX での鏡映)= θ → π-θ なので flip:true, rotate:π。
 * - vertical(水平軸 y=centerY での鏡映)= θ → -θ なので flip:true, rotate:0。
 * - both = 上記2鏡映 + 180°回転(flip:false, rotate:π)。
 * - radial = 各セクタ k は純回転のみ(mirrorPoints の radial は反転コピーを
 *   含まない)なので flip:false, rotate:2πk/n。
 * - 先頭要素は常に元の点(flip:false, rotate:0)。
 */
export function mirrorPointsWithMeta(
  x: number,
  y: number,
  cfg: SymmetryConfig,
): { x: number; y: number; flip: boolean; rotate: number }[] {
  // 座標は mirrorPoints に委譲して同一性を保証する。
  const pts = mirrorPoints(x, y, cfg);

  switch (cfg.mode) {
    case 'horizontal':
      return [
        { ...pts[0], flip: false, rotate: 0 },
        { ...pts[1], flip: true, rotate: Math.PI },
      ];
    case 'vertical':
      return [
        { ...pts[0], flip: false, rotate: 0 },
        { ...pts[1], flip: true, rotate: 0 },
      ];
    case 'both':
      return [
        { ...pts[0], flip: false, rotate: 0 },
        { ...pts[1], flip: true, rotate: Math.PI },
        { ...pts[2], flip: true, rotate: 0 },
        { ...pts[3], flip: false, rotate: Math.PI },
      ];
    case 'radial': {
      const slices = Math.max(2, Math.floor(cfg.slices ?? 6));
      return pts.map((p, i) => ({
        ...p,
        flip: false,
        rotate: (Math.PI * 2 * i) / slices,
      }));
    }
    case 'none':
    default:
      return [{ ...pts[0], flip: false, rotate: 0 }];
  }
}
