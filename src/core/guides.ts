export type GuideOrientation = 'h' | 'v';

export interface Guide {
  orientation: GuideOrientation;
  position: number;
}

export interface GuideState {
  guides: Guide[];
  gridSize: number;
  gridEnabled: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface SnappedPoint extends Point {
  snappedX: boolean;
  snappedY: boolean;
}

interface SnapCandidate {
  value: number;
  distance: number;
}

const DEFAULT_GRID_SIZE = 50;

function copyGuide(guide: Guide): Guide {
  return {
    orientation: guide.orientation,
    position: guide.position,
  };
}

function nearestGridLine(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function closerCandidate(current: SnapCandidate | null, value: number, original: number, threshold: number): SnapCandidate | null {
  if (!Number.isFinite(value)) return current;

  const distance = Math.abs(value - original);
  if (distance > threshold) return current;
  if (!current || distance < current.distance) {
    return { value, distance };
  }

  return current;
}

function snapAxis(
  original: number,
  guidePositions: number[],
  state: GuideState,
  threshold: number,
): { value: number; snapped: boolean } {
  if (!Number.isFinite(original) || !Number.isFinite(threshold) || threshold < 0) {
    return { value: original, snapped: false };
  }

  let nearest: SnapCandidate | null = null;

  for (const position of guidePositions) {
    nearest = closerCandidate(nearest, position, original, threshold);
  }

  if (state.gridEnabled && Number.isFinite(state.gridSize) && state.gridSize > 0) {
    nearest = closerCandidate(nearest, nearestGridLine(original, state.gridSize), original, threshold);
  }

  return nearest ? { value: nearest.value, snapped: true } : { value: original, snapped: false };
}

export function createGuideState(): GuideState {
  return {
    guides: [],
    gridSize: DEFAULT_GRID_SIZE,
    gridEnabled: false,
  };
}

export function addGuide(state: GuideState, guide: Guide): GuideState {
  if (
    state.guides.some(
      (item) => item.orientation === guide.orientation && item.position === guide.position,
    )
  ) {
    return state;
  }

  return {
    ...state,
    guides: [...state.guides.map(copyGuide), copyGuide(guide)],
  };
}

export function removeGuide(state: GuideState, index: number): GuideState {
  if (!Number.isInteger(index) || index < 0 || index >= state.guides.length) {
    return state;
  }

  return {
    ...state,
    guides: state.guides.filter((_, guideIndex) => guideIndex !== index).map(copyGuide),
  };
}

export function snapPoint(state: GuideState, point: Point, threshold: number): SnappedPoint {
  const verticalGuides = state.guides
    .filter((guide) => guide.orientation === 'v')
    .map((guide) => guide.position);
  const horizontalGuides = state.guides
    .filter((guide) => guide.orientation === 'h')
    .map((guide) => guide.position);

  const x = snapAxis(point.x, verticalGuides, state, threshold);
  const y = snapAxis(point.y, horizontalGuides, state, threshold);

  return {
    x: x.value,
    y: y.value,
    snappedX: x.snapped,
    snappedY: y.snapped,
  };
}
