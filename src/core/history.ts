/**
 * Generic undo/redo stack. Each command carries its own undo()/redo() closures,
 * so callers (the store) decide how to capture state (pixel snapshots, structural
 * changes, etc.). Keeps a bounded history to cap memory.
 */
export interface Command {
  label: string;
  undo: () => void;
  redo: () => void;
}

export class History {
  private past: Command[] = [];
  private future: Command[] = [];
  constructor(private limit = 50) {}

  /** Record an already-applied command. Clears the redo stack. */
  push(cmd: Command): void {
    this.past.push(cmd);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  undo(): Command | undefined {
    const cmd = this.past.pop();
    if (!cmd) return undefined;
    cmd.undo();
    this.future.push(cmd);
    return cmd;
  }

  redo(): Command | undefined {
    const cmd = this.future.pop();
    if (!cmd) return undefined;
    cmd.redo();
    this.past.push(cmd);
    return cmd;
  }

  clear(): void { this.past = []; this.future = []; }
}

/** Helper: build a pixel-snapshot command for a single layer edit. */
export function pixelSnapshotCommand(
  label: string,
  getTarget: () => Uint8ClampedArray | undefined,
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): Command {
  return {
    label,
    undo: () => { const t = getTarget(); if (t) t.set(before); },
    redo: () => { const t = getTarget(); if (t) t.set(after); },
  };
}
