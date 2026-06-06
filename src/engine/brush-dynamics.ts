export interface DynamicsConfig {
  sizeJitter?: number;
  opacityJitter?: number;
  scatter?: number;
  seed?: number;
}

interface BrushDab {
  size: number;
  opacity: number;
  x: number;
  y: number;
}

function clampUnit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampScatter(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return 0;
  return value;
}

function clampSize(value: number): number {
  if (!Number.isFinite(value) || value < 0.1) return 0.1;
  return value;
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeSeed(seed: number | undefined): number {
  return (seed ?? 1) >>> 0;
}

function normalizeStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.floor(step) >>> 0;
}

function nextLcg(state: number): number {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

function randomUnit(state: number): number {
  return state / 0x100000000;
}

function initialState(seed: number | undefined, step: number): number {
  const normalizedSeed = normalizeSeed(seed);
  const normalizedStep = normalizeStep(step);
  return (normalizedSeed ^ Math.imul(normalizedStep + 1, 0x9e3779b9)) >>> 0;
}

export function applyDynamics(base: BrushDab, cfg: DynamicsConfig, step: number): BrushDab {
  const sizeJitter = clampUnit(cfg.sizeJitter);
  const opacityJitter = clampUnit(cfg.opacityJitter);
  const scatter = clampScatter(cfg.scatter);

  let state = initialState(cfg.seed, step);

  state = nextLcg(state);
  const size = clampSize(base.size * (1 - randomUnit(state) * sizeJitter));

  state = nextLcg(state);
  const opacity = clampOpacity(base.opacity * (1 - randomUnit(state) * opacityJitter));

  state = nextLcg(state);
  const x = base.x + (randomUnit(state) * 2 - 1) * scatter;

  state = nextLcg(state);
  const y = base.y + (randomUnit(state) * 2 - 1) * scatter;

  return { size, opacity, x, y };
}
