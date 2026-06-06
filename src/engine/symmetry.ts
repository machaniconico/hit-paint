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
