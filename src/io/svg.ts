import type { PaintDocument, RGBA } from '../types';
import type { ShapeData } from '../vector/shape';
import type { VectorLayerData, VectorStroke } from '../vector/vector-layer';
import type { PathPoint, VectorPath } from '../vector/path';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPE_KINDS = new Set(['rect', 'rounded-rect', 'ellipse', 'polygon', 'star', 'line']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatNumber(value: number): string {
  const rounded = Math.abs(value) < 0.0000005 ? 0 : value;
  return rounded.toFixed(6).replace(/\.?0+$/, '');
}

function clampByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function colorToSvg(color: RGBA | null | undefined): string | null {
  if (
    !color ||
    !isFiniteNumber(color.r) ||
    !isFiniteNumber(color.g) ||
    !isFiniteNumber(color.b) ||
    !isFiniteNumber(color.a)
  ) {
    return null;
  }

  return `rgba(${clampByte(color.r)},${clampByte(color.g)},${clampByte(color.b)},${(clampByte(color.a) / 255).toFixed(2)})`;
}

function strokeAttributes(stroke: VectorStroke | null | undefined): string[] {
  const color = colorToSvg(stroke?.color);
  if (!stroke || !color || !isFiniteNumber(stroke.width) || stroke.width <= 0) {
    return ['stroke="none"'];
  }

  const attrs = [`stroke="${color}"`, `stroke-width="${formatNumber(stroke.width)}"`];
  const dash = stroke.dashArray ?? stroke.dash;
  if (dash && dash.length > 0 && dash.every((value) => isFiniteNumber(value) && value >= 0)) {
    attrs.push(`stroke-dasharray="${dash.map(formatNumber).join(' ')}"`);
  }
  if (isFiniteNumber(stroke.dashOffset)) {
    attrs.push(`stroke-dashoffset="${formatNumber(stroke.dashOffset)}"`);
  }

  return attrs;
}

function paintAttributes(
  fill: RGBA | null | undefined,
  stroke: VectorStroke | null | undefined,
): string[] {
  return [`fill="${colorToSvg(fill) ?? 'none'}"`, ...strokeAttributes(stroke)];
}

function shapeIsValid(shape: ShapeData): boolean {
  if (
    !isRecord(shape) ||
    !SHAPE_KINDS.has(shape.shape) ||
    !isFiniteNumber(shape.x) ||
    !isFiniteNumber(shape.y) ||
    !isFiniteNumber(shape.width) ||
    !isFiniteNumber(shape.height) ||
    !isRecord(shape.style)
  ) {
    return false;
  }

  if (shape.shape === 'line') {
    return shape.width !== 0 || shape.height !== 0;
  }

  return shape.width > 0 && shape.height > 0;
}

function regularSides(shape: ShapeData, fallback: number): number {
  return Math.max(3, Math.floor(isFiniteNumber(shape.sides) ? shape.sides : fallback));
}

function polygonPoints(shape: ShapeData, sides: number): string {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const radius = Math.min(shape.width, shape.height) / 2;
  const points: string[] = [];

  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / sides;
    points.push(`${formatNumber(cx + Math.cos(angle) * radius)},${formatNumber(cy + Math.sin(angle) * radius)}`);
  }

  return points.join(' ');
}

function starPoints(shape: ShapeData, sides: number): string {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const outerRadius = Math.min(shape.width, shape.height) / 2;
  const innerRatio = isFiniteNumber(shape.innerRatio) ? Math.max(0, Math.min(1, shape.innerRatio)) : 0.5;
  const innerRadius = outerRadius * innerRatio;
  const points: string[] = [];

  for (let i = 0; i < sides * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (i * Math.PI) / sides;
    points.push(`${formatNumber(cx + Math.cos(angle) * radius)},${formatNumber(cy + Math.sin(angle) * radius)}`);
  }

  return points.join(' ');
}

export function shapeToSvg(shape: ShapeData): string {
  try {
    if (!shapeIsValid(shape)) return '';

    const paint = paintAttributes(shape.style.fill, shape.style.stroke).join(' ');

    if (shape.shape === 'rect' || shape.shape === 'rounded-rect') {
      const attrs = [
        `x="${formatNumber(shape.x)}"`,
        `y="${formatNumber(shape.y)}"`,
        `width="${formatNumber(shape.width)}"`,
        `height="${formatNumber(shape.height)}"`,
      ];
      const radius = isFiniteNumber(shape.cornerRadius)
        ? Math.max(0, Math.min(shape.cornerRadius, shape.width / 2, shape.height / 2))
        : 0;
      if (radius > 0) {
        attrs.push(`rx="${formatNumber(radius)}"`, `ry="${formatNumber(radius)}"`);
      }
      return `<rect ${attrs.join(' ')} ${paint} />`;
    }

    if (shape.shape === 'ellipse') {
      return `<ellipse cx="${formatNumber(shape.x + shape.width / 2)}" cy="${formatNumber(shape.y + shape.height / 2)}" rx="${formatNumber(shape.width / 2)}" ry="${formatNumber(shape.height / 2)}" ${paint} />`;
    }

    if (shape.shape === 'polygon') {
      return `<polygon points="${polygonPoints(shape, regularSides(shape, 3))}" ${paint} />`;
    }

    if (shape.shape === 'star') {
      return `<polygon points="${starPoints(shape, regularSides(shape, 5))}" ${paint} />`;
    }

    return `<line x1="${formatNumber(shape.x)}" y1="${formatNumber(shape.y)}" x2="${formatNumber(shape.x + shape.width)}" y2="${formatNumber(shape.y + shape.height)}" ${paint} />`;
  } catch {
    return '';
  }
}

function pointIsValid(point: PathPoint): boolean {
  return isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function hasOutControl(point: PathPoint): boolean {
  return isFiniteNumber(point.outX) && isFiniteNumber(point.outY);
}

function hasInControl(point: PathPoint): boolean {
  return isFiniteNumber(point.inX) && isFiniteNumber(point.inY);
}

function segmentCommand(from: PathPoint, to: PathPoint): string {
  if (hasOutControl(from) || hasInControl(to)) {
    const c1x = hasOutControl(from) ? from.outX as number : from.x;
    const c1y = hasOutControl(from) ? from.outY as number : from.y;
    const c2x = hasInControl(to) ? to.inX as number : to.x;
    const c2y = hasInControl(to) ? to.inY as number : to.y;
    return `C ${formatNumber(c1x)} ${formatNumber(c1y)} ${formatNumber(c2x)} ${formatNumber(c2y)} ${formatNumber(to.x)} ${formatNumber(to.y)}`;
  }

  return `L ${formatNumber(to.x)} ${formatNumber(to.y)}`;
}

export function pathToSvgD(path: VectorPath): string {
  try {
    if (!isRecord(path) || !Array.isArray(path.points) || path.points.length === 0) return '';
    if (!path.points.every(pointIsValid)) return '';

    const points = path.points;
    const commands = [`M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)}`];

    for (let i = 1; i < points.length; i++) {
      commands.push(segmentCommand(points[i - 1], points[i]));
    }

    if (path.closed) {
      const last = points[points.length - 1];
      const first = points[0];
      if (points.length > 1 && (hasOutControl(last) || hasInControl(first))) {
        commands.push(segmentCommand(last, first));
      }
      commands.push('Z');
    }

    return commands.join(' ');
  } catch {
    return '';
  }
}

export function vectorLayerToSvg(data: VectorLayerData): string {
  try {
    if (!isRecord(data) || !Array.isArray(data.subpaths)) return '';

    return data.subpaths
      .map((subpath) => {
        if (!isRecord(subpath)) return '';
        const d = pathToSvgD(subpath.path);
        if (!d) return '';
        const attrs = [`d="${d}"`, ...paintAttributes(subpath.fill, subpath.stroke)];
        return `<path ${attrs.join(' ')} />`;
      })
      .filter((item) => item.length > 0)
      .join('');
  } catch {
    return '';
  }
}

function svgDimension(value: unknown): string {
  return formatNumber(isFiniteNumber(value) && value > 0 ? value : 0);
}

export function documentToSvg(doc: PaintDocument): string {
  try {
    const width = svgDimension(isRecord(doc) ? doc.width : 0);
    const height = svgDimension(isRecord(doc) ? doc.height : 0);
    const layers = isRecord(doc) && Array.isArray(doc.layers) ? doc.layers : [];
    const body = layers
      .map((layer) => {
        if (!isRecord(layer)) return '';
        return `${layer.shapeData ? shapeToSvg(layer.shapeData as ShapeData) : ''}${layer.vectorData ? vectorLayerToSvg(layer.vectorData as VectorLayerData) : ''}`;
      })
      .join('');

    return `<svg width="${width}" height="${height}" xmlns="${SVG_NS}">${body}</svg>`;
  } catch {
    return `<svg width="0" height="0" xmlns="${SVG_NS}"></svg>`;
  }
}
